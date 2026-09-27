import { beforeEach, afterAll, expect, test } from "bun:test";
import { MemorySaver } from "@langchain/langgraph";
import { buildGraph } from "../agent";
import { GitHub } from "../github";
import { signEvent, scopeFor, threadIdFor, type AgentEvent } from "../policy";
import type { Decision } from "../coder";
import type { Task } from "../state";
import type { Backend } from "../workspace";

const oldSecret = process.env.SLACK_SIGNING_SECRET;
const oldTeam = process.env.SLACK_TEAM_ID;
beforeEach(() => { process.env.SLACK_SIGNING_SECRET = "graph-test-secret"; process.env.SLACK_TEAM_ID = "T123"; });
afterAll(() => {
  if (oldSecret === undefined) delete process.env.SLACK_SIGNING_SECRET; else process.env.SLACK_SIGNING_SECRET = oldSecret;
  if (oldTeam === undefined) delete process.env.SLACK_TEAM_ID; else process.env.SLACK_TEAM_ID = oldTeam;
});
const event = (): AgentEvent => ({ kind: "slack", eventId: "E1", teamId: "T123", channelId: "C0C4AMGJEA3", threadTs: "123.456", eventTs: "123.456", text: "Fix the defect", userId: "U1", attempt: 0 });
const parent = "a".repeat(40), base = "b".repeat(40), tree = "c".repeat(40), head = "d".repeat(40);
const task = (): Task => ({ ...scopeFor(event()), baseBranch: "develop", parentSha: parent, parentTree: base, localBase: base, reviewRounds: 0 });

function fixture(action: Decision["action"] = "publish", failCheck = false, failEnqueue = false) {
  const calls = { coding: 0, sandbox: 0, reviewed: false, writes: [] as any[], commands: [] as string[], replies: [] as string[], jobs: [] as AgentEvent[] };
  let remote: string | undefined;
  let pr: any;
  const github = new GitHub(async () => "test-token", async (url, init) => {
    const path = new URL(url).pathname.replace("/repos/vasvalstan/flakeyflakey", "");
    if (init?.method !== "GET") {
      const body = JSON.parse(String(init?.body)); calls.writes.push({ path, body });
      if (path === "/git/blobs") return Response.json({ sha: "e".repeat(40) });
      if (path === "/git/trees") return Response.json({ sha: tree });
      if (path === "/git/commits") return Response.json({ sha: head });
      if (path === "/git/refs") remote = head;
      if (path === "/pulls") pr = { number: 7, html_url: "https://github.com/vasvalstan/flakeyflakey/pull/7", state: "open", head: { sha: head, ref: scopeFor(event()).branch }, base: { ref: "develop" } };
      return Response.json(pr ?? {});
    }
    if (path === "/pulls") return Response.json(pr ? [pr] : []);
    if (path === "/pulls/7") return Response.json(pr);
    if (path.includes("/reviews")) return Response.json(calls.reviewed ? [{ id: 1, body: "Please inspect the remaining issue", state: "COMMENTED", commit_id: head, user: { type: "Bot", login: "greptile-apps[bot]" } }] : []);
    if (path.includes("/comments")) return Response.json([]);
    if (path.endsWith("/check-runs")) return Response.json({check_runs:[]});
    if (path.startsWith("/git/ref/")) return remote ? Response.json({ object: { sha: remote } }) : new Response(null, { status: 404 });
    throw new Error(`Unexpected path ${path}`);
  });
  const backend: Backend = {
    execute: async command => { calls.commands.push(command); return { output: command.includes("rev-parse") ? tree : command.includes("git show")
      ? JSON.stringify({ scripts: { "test:e2e": "playwright test", "test:soak": "bun scripts/soak-studio.ts" } }) : "passed",
      exitCode: failCheck && command.includes("test:e2e") ? 1 : 0 }; },
    uploadFiles: async () => [{}],
    downloadFiles: async () => [{ content: Buffer.from(JSON.stringify([{ path: "src/example.ts", mode: "100644", content: Buffer.from("fixed").toString("base64") }])) }],
  };
  const graph = buildGraph({ github,
    slack: { thread: async () => "User: fix defect", reply: async (_event, text) => { calls.replies.push(text); } },
    backend: async () => { calls.sandbox++; return backend; },
    code: async () => { calls.coding++; return { action, title: "Fix defect", summary: "Fixes the defect", reply: "Implemented the change." }; },
    enqueue: async next => { if (failEnqueue) { failEnqueue = false; throw new Error("Queue temporarily unavailable"); } calls.jobs.push(next); },
  }, { checkpointer: new MemorySaver() });
  const config = { configurable: { thread_id: threadIdFor(event()) } };
  return { graph, config, calls, invoke: (next = event(), initial?: Task) => graph.invoke({ envelope: signEvent(next, "graph-test-secret"), ...(initial ? { task: initial } : {}) }, config) };
}

test("signed Slack work produces tested draft, queues review, and deduplicates delivery", async () => {
  const f = fixture();
  const result = await f.invoke(event(), task());
  expect(result.task?.prNumber).toBe(7);
  expect(f.calls.writes.find(item => item.path === "/pulls").body.draft).toBe(true);
  expect(f.calls.commands.some(command => command.includes("test:soak 25"))).toBe(true);
  expect(f.calls.jobs[0]?.expectedHead).toBe(head);
  expect(f.calls.replies).toHaveLength(1);
  await f.invoke();
  expect(f.calls.coding).toBe(1);
  expect(f.calls.replies).toHaveLength(1);
  const boxes = f.calls.sandbox;
  await f.invoke(f.calls.jobs[0]);
  expect(f.calls.sandbox).toBe(boxes); // pending review needs no paid sandbox/model
  expect(f.calls.jobs).toHaveLength(2);
  expect(f.calls.coding).toBe(1);
});

test("failed verification cannot reach GitHub publication", async () => {
  const f = fixture("publish", true);
  await f.invoke(event(), task());
  expect(f.calls.writes).toHaveLength(0);
  expect(f.calls.jobs).toHaveLength(0);
  expect(f.calls.replies[0]).toContain("No new revision was published");
});

test("an ordinary change request starting with merge still reaches coding", async () => {
  const f = fixture();
  await f.invoke({ ...event(), text: "<@UBOT> merge the duplicate helper functions" }, task());
  expect(f.calls.coding).toBe(1);
  expect(f.calls.writes.some(write => write.path.endsWith("/merge"))).toBe(false);
});

test("manual review follow-ups wait without spending another sandbox or coding run", async () => {
  const f = fixture();
  await f.invoke(event(), task());
  const sandboxes = f.calls.sandbox, writes = f.calls.writes.length;
  await f.invoke({ ...event(), eventId: "E2", text: "check the review" });
  expect(f.calls.coding).toBe(1);
  expect(f.calls.sandbox).toBe(sandboxes);
  expect(f.calls.writes).toHaveLength(writes);
  expect(f.calls.jobs.at(-1)?.expectedHead).toBe(head);
  expect(f.calls.replies.at(-1)).toContain("still reviewing");
  f.calls.reviewed = true;
  const next = await f.invoke(f.calls.jobs.at(-1));
  expect(f.calls.coding).toBe(2);
  expect(next.task?.reviewRounds).toBe(1);
});

test("manual follow-ups cannot spend coding runs after the correction budget", async () => {
  const f = fixture();
  const first = await f.invoke(event(), task());
  f.calls.reviewed = true;
  await f.invoke({ ...event(), eventId: "E2", text: "check the review" }, { ...first.task!, reviewRounds: 2 });
  expect(f.calls.coding).toBe(1);
  expect(f.calls.replies.at(-1)).toContain("two correction rounds");
});

test("checkpoint resumes after publication without creating another PR", async () => {
  const f = fixture("publish", false, true);
  await expect(f.invoke(event(), task())).rejects.toThrow("Queue temporarily unavailable");
  expect(f.calls.writes.filter(item => item.path === "/pulls")).toHaveLength(1);
  await f.graph.invoke(null, f.config);
  expect(f.calls.writes.filter(item => item.path === "/pulls")).toHaveLength(1);
  expect(f.calls.coding).toBe(1);
  expect(f.calls.jobs).toHaveLength(1);
  expect(f.calls.replies).toHaveLength(1);
});

test("unverified or cross-thread input fails before any action", async () => {
  const f = fixture();
  await expect(f.graph.invoke({ envelope: { payload: "{}", signature: "forged" } }, f.config)).rejects.toThrow("Unverified");
  const other = { ...event(), threadTs: "999.123" };
  await expect(f.graph.invoke({ envelope: signEvent(other, "graph-test-secret") }, f.config)).rejects.toThrow("another agent thread");
  expect(f.calls.sandbox).toBe(0);
  expect(f.calls.writes).toHaveLength(0);
});

test("expired review poll cannot act on a newer revision", async () => {
  const f = fixture();
  await f.invoke(event(), task());
  const poll = { ...f.calls.jobs[0]!, eventId: "stale", expectedHead: parent };
  await f.invoke(poll);
  expect(f.calls.coding).toBe(1);
  expect(f.calls.jobs).toHaveLength(1);
});

test("a current review after two corrections hands control to the human", async () => {
  const f = fixture();
  const first = await f.invoke(event(), task());
  f.calls.reviewed = true;
  const result = await f.invoke(f.calls.jobs[0], { ...first.task!, reviewRounds: 2 });
  expect(f.calls.coding).toBe(1);
  expect(result.task?.awaitingReview).toBe(false);
  expect(f.calls.replies.at(-1)).toContain("two correction rounds");
});
