import { afterAll, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { createApp } from "../routes";
import { verifySlack, Slack } from "../slack";
import type { AgentEvent } from "../policy";

const previous = { secret: process.env.SLACK_SIGNING_SECRET, team: process.env.SLACK_TEAM_ID, bot: process.env.SLACK_BOT_TOKEN };
process.env.SLACK_SIGNING_SECRET = "test-signing-secret";
process.env.SLACK_TEAM_ID = "T123";
process.env.SLACK_BOT_TOKEN = "test-bot-token";
afterAll(() => {
  for (const [key, value] of Object.entries({ SLACK_SIGNING_SECRET: previous.secret, SLACK_TEAM_ID: previous.team, SLACK_BOT_TOKEN: previous.bot })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
function request(payload: unknown, age = 0) {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000) - age);
  return { method: "POST", body, headers: { "content-type": "application/json", "x-slack-request-timestamp": timestamp,
    "x-slack-signature": `v0=${createHmac("sha256", "test-signing-secret").update(`v0:${timestamp}:${body}`).digest("hex")}` } };
}
const callback = () => ({ type: "event_callback", team_id: "T123", event_id: "E1", event: {
  type: "app_mention", user: "U123", channel: "C0C4AMGJEA3", ts: "123.456", thread_ts: "122.456", text: "@Flakey Patch fix this" } });

test("Slack challenge and signed mention, including retry delivery", async () => {
  const jobs: AgentEvent[] = [];
  const app = createApp(async event => { jobs.push(event); });
  const response = await app.request("/slack/events", request({ type: "url_verification", challenge: "challenge" }));
  expect(await response.json()).toEqual({ challenge: "challenge" });
  expect(jobs).toHaveLength(0);
  for (let i = 0; i < 2; i++) expect((await app.request("/slack/events", request(callback()))).status).toBe(200);
  expect(jobs).toHaveLength(2); // durable graph, not process memory, deduplicates
  expect(jobs[0]?.threadTs).toBe("122.456");
  expect(jobs[0]?.eventId).toBe(jobs[1]?.eventId);
});

test("forged/stale signatures and other workspaces/channels cannot enqueue work", async () => {
  const jobs: AgentEvent[] = [];
  const app = createApp(async event => { jobs.push(event); });
  expect((await app.request("/slack/events", { method: "POST", body: "{}" })).status).toBe(401);
  expect((await app.request("/slack/events", request(callback(), 301))).status).toBe(401);
  for (const payload of [
    { ...callback(), team_id: "TOTHER" },
    { ...callback(), event: { ...callback().event, channel: "COTHER" } },
    { ...callback(), event: { ...callback().event, bot_id: "B123" } },
    { ...callback(), event: { ...callback().event, type: "message" } },
  ]) expect((await app.request("/slack/events", request(payload))).status).toBe(200);
  expect(jobs).toHaveLength(0);
  const req = request(callback());
  expect(verifySlack(`${req.body} `, req.headers["x-slack-request-timestamp"], req.headers["x-slack-signature"], "test-signing-secret")).toBe(false);
});

test("queue failure returns retryable response instead of losing the Slack event", async () => {
  const app = createApp(async () => { throw new Error("unavailable"); });
  expect((await app.request("/slack/events", request(callback()))).status).toBe(503);
});

test("Slack API failures never expose tokens, and replies use the allowed thread", async () => {
  const calls: { url: string; body: any }[] = [];
  const fetcher = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return Response.json({ ok: true });
  };
  const slack = new Slack(fetcher);
  await slack.reply({ kind: "slack", eventId: "E", teamId: "T123", channelId: "C0C4AMGJEA3", threadTs: "123.456", eventTs: "123.456", text: "", userId: "U1", attempt: 0 }, "Hello @channel");
  expect(calls[0]?.body.channel).toBe("C0C4AMGJEA3");
  expect(calls[0]?.body.thread_ts).toBe("123.456");
  expect(calls[0]?.body.blocks[0].text.type).toBe("plain_text");
  const denied = new Slack(async () => new Response("test-bot-token", { status: 403 }));
  await expect(denied.call("auth.test", {})).rejects.toThrow("Slack HTTP 403");
});

test("channel and thread history use GET query parameters and preserve pagination", async () => {
  const previousHistoryToken = process.env.SLACK_HISTORY_TOKEN;
  process.env.SLACK_HISTORY_TOKEN = "test-history-token";
  try {
    const requests: URL[] = [];
    const slack = new Slack(async (input, init) => {
      const url = new URL(String(input));
      requests.push(url);
      expect(init?.method).toBe("GET");
      expect(init?.body).toBeUndefined();
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-history-token");
      expect(url.searchParams.get("channel")).toBe("C0C4AMGJEA3");
      expect(url.toString()).not.toContain("test-history-token");
      if (url.pathname.endsWith("conversations.history")) return Response.json({ ok: true, messages: [] });
      expect(url.searchParams.get("ts")).toBe("122.456");
      expect(url.searchParams.get("latest")).toBe("123.456");
      expect(url.searchParams.get("inclusive")).toBe("true");
      expect(url.searchParams.get("limit")).toBe("100");
      const secondPage = url.searchParams.has("cursor");
      return Response.json({ ok: true,
        messages: [{ ts: secondPage ? "123.456" : "122.456", user: "U1", text: secondPage ? "Agreed change" : "Task context" }],
        response_metadata: { next_cursor: secondPage ? "" : "next+page=" },
      });
    });
    await slack.call("conversations.history", { channel: "C0C4AMGJEA3", limit: 20 }, true);
    const transcript = await slack.thread({ kind: "slack", eventId: "E", teamId: "T123", channelId: "C0C4AMGJEA3", threadTs: "122.456", eventTs: "123.456", text: "", userId: "U1", attempt: 0 });
    expect(transcript).toBe("122.456 U1: Task context\n123.456 U1: Agreed change");
    expect(requests).toHaveLength(3);
    expect(requests[2]!.searchParams.get("cursor")).toBe("next+page=");
  } finally {
    if (previousHistoryToken === undefined) delete process.env.SLACK_HISTORY_TOKEN;
    else process.env.SLACK_HISTORY_TOKEN = previousHistoryToken;
  }
});
