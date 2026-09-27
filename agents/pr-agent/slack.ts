import { createHmac } from "node:crypto";
import { required, slackChannelId } from "./config";
import { secureEqual, type AgentEvent } from "./policy";

export function verifySlack(body: string, timestamp: string | undefined, signature: string | undefined, secret: string, now = Date.now()) {
  if (!timestamp || !/^\d+$/.test(timestamp) || Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  return secureEqual(signature ?? "", expected);
}

export class Slack {
  constructor(private readonly fetcher: (input: string | URL | Request, init?: RequestInit) => Promise<Response> = fetch) {}

  async call<T>(method: string, body: Record<string, unknown>, history = false): Promise<T> {
    const readHistory = method === "conversations.history" || method === "conversations.replies";
    const url = new URL(`https://slack.com/api/${method}`);
    if (readHistory) {
      for (const [name, value] of Object.entries(body)) {
        if (value !== undefined) url.searchParams.set(name, String(value));
      }
    }
    const response = await this.fetcher(url, {
      method: readHistory ? "GET" : "POST", redirect: "error", signal: AbortSignal.timeout(20_000),
      headers: { Authorization: `Bearer ${history && process.env.SLACK_HISTORY_TOKEN ? required("SLACK_HISTORY_TOKEN") : required("SLACK_BOT_TOKEN")}`, "Content-Type": "application/json; charset=utf-8" },
      ...(readHistory ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`Slack HTTP ${response.status}; retry after checking access or rate limits.`);
    const result = await response.json() as T & { ok: boolean; error?: string };
    if (!result.ok) throw new Error(`Slack request failed: ${result.error ?? "unknown_error"}`);
    return result;
  }

  async thread(event: AgentEvent) {
    type Page = { messages: { ts: string; user?: string; bot_id?: string; text?: string }[]; response_metadata?: { next_cursor?: string } };
    const messages: Page["messages"] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 4; page++) {
      const result: Page = await this.call("conversations.replies", {
        channel: slackChannelId, ts: event.threadTs, latest: event.eventTs, inclusive: true, limit: 100,
        ...(cursor ? { cursor } : {}),
      }, true);
      messages.push(...result.messages);
      cursor = result.response_metadata?.next_cursor;
      if (!cursor) break;
    }
    if (cursor) throw new Error("Slack thread is too long. Start a shorter task thread.");
    const transcript = messages.map(message => `${message.ts} ${message.user ?? message.bot_id ?? "unknown"}: ${message.text ?? ""}`).join("\n");
    if (transcript.length > 60_000) throw new Error("Slack thread exceeds the task context limit. Start a shorter task thread.");
    return transcript;
  }

  reply(event: AgentEvent, text: string) {
    return this.call("chat.postMessage", {
      channel: slackChannelId, thread_ts: event.threadTs, text: text.slice(0, 12_000),
      unfurl_links: false, unfurl_media: false,
      // Plain-text blocks prevent untrusted content from mentioning @channel.
      blocks: [{ type: "section", text: { type: "plain_text", text: text.slice(0, 3000) } }],
    });
  }
}
