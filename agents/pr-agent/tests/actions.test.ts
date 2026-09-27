import { afterAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seal, unseal } from "../sealed";
import { readDispatch, readState, writeState, previousArtifact } from "../actions-state";
import { runAction } from "../actions-runner";
import { enqueue } from "../queue";
import { GitHub } from "../github";
import { scopeFor, signEvent, type AgentEvent } from "../policy";
import type { Task } from "../state";

const event: AgentEvent = { kind: "slack", eventId: "Ev-private", teamId: "T123", channelId: "C0C4AMGJEA3", threadTs: "123.456", eventTs: "123.457", userId: "U1", text: "A private Slack request", attempt: 0 };
const key = scopeFor(event).key;
const secret = "a".repeat(64);
const old = { FLAKEY_STATE_KEY: process.env.FLAKEY_STATE_KEY, SLACK_SIGNING_SECRET: process.env.SLACK_SIGNING_SECRET, SLACK_TEAM_ID: process.env.SLACK_TEAM_ID };
process.env.FLAKEY_STATE_KEY = secret;
process.env.SLACK_SIGNING_SECRET = "signing-secret";
process.env.SLACK_TEAM_ID = "T123";
afterAll(() => { for (const [name, value] of Object.entries(old)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } });

test("encrypted dispatch rejects tampering, other threads, and unsigned payloads", () => {
  const encrypted = seal(signEvent(event, "signing-secret"), secret, `request:${key}`);
  expect(encrypted).not.toContain(event.text);
  expect(readDispatch({ key, encrypted_request: encrypted }, secret, "signing-secret", "T123").event).toEqual(event);
  expect(() => readDispatch({ key: "b".repeat(20), encrypted_request: encrypted }, secret, "signing-secret", "T123")).toThrow();
  const changed = encrypted.slice(0, 40) + (encrypted[40] === "A" ? "B" : "A") + encrypted.slice(41);
  expect(() => unseal(changed, secret, `request:${key}`)).toThrow("authentication");
  const forged = seal({ payload: JSON.stringify(event), signature: "forged" }, secret, `request:${key}`);
  expect(() => readDispatch({ key, encrypted_request: forged }, secret, "signing-secret", "T123")).toThrow("Unverified");
  expect(() => unseal(encrypted, "b".repeat(64), `request:${key}`)).toThrow();
});

test("Slack dispatch reaches GitHub without plaintext and accepts its empty 204 response", async () => {
  let body: any;
  const github = new GitHub(async () => "dispatch-token", async (url, init) => {
    expect(url).toEndWith("/repos/vasvalstan/flakeyflakey/dispatches");
    body = JSON.parse(String(init?.body));
    expect(JSON.stringify(body)).not.toContain(event.text);
    return new Response(null, { status: 204 });
  });
  await enqueue(event, github);
  expect(body.event_type).toBe("flakey_patch");
  expect(readDispatch(body.client_payload, secret, "signing-secret", "T123").event.eventId).toBe(event.eventId);
});

test("state lookup ignores artifacts from PR checks and other workflows", async () => {
  const github = new GitHub(async () => "read-token", async url => {
    if (url.includes("/artifacts?")) return Response.json({ artifacts: [
      { id: 3, name: `flakey-state-${key}`, expired: false, size_in_bytes: 100, workflow_run: { id: 30, head_branch: "main" } },
      { id: 2, name: `flakey-state-${key}`, expired: false, size_in_bytes: 100, workflow_run: { id: 20, head_branch: "main" } },
    ] });
    return Response.json({ path: url.endsWith("/30") ? ".github/workflows/check.yml" : ".github/workflows/flakey-patch.yml",
      event: "repository_dispatch", head_branch: "main", repository: { id: 1 }, head_repository: { id: 1 } });
  });
  expect((await previousArtifact(github, key, "main"))?.id).toBe(2);
});

test("a separate Actions process restores encrypted state and deduplicates Slack retries", async () => {
  const dir = await mkdtemp(join(tmpdir(), "flakey-actions-"));
  try {
    const statePath = join(dir, "state.enc");
    const task: Task = { key, branch: scopeFor(event).branch, baseBranch: "develop", parentSha: "a".repeat(40), parentTree: "b".repeat(40), localBase: "b".repeat(40), reviewRounds: 0 };
    await writeState(statePath, key, secret, { task, processed: [] });
    let coding = 0, replies = 0;
    const deps = {
      github: new GitHub(async () => "token", async url => url.includes("/pulls?") ? Response.json([]) : new Response(null, { status: 404 })),
      slack: { thread: async () => event.text, reply: async () => { replies++; } },
      backend: async () => ({ execute: async () => ({ output: "", exitCode: 0 }), uploadFiles: async () => [], downloadFiles: async () => [] }),
      code: async () => { coding++; return { action: "clarify" as const, title: "Question", summary: "", reply: "Which label should change?" }; },
    };
    const options = { statePath, stateKey: secret, signingSecret: "signing-secret", sleep: async () => {} };
    await runAction(event, deps, options);
    expect((await readState(statePath, key, secret)).processed).toEqual([event.eventId]);
    expect(await readFile(statePath, "utf8")).not.toContain(event.text);
    // A new graph instance simulates the next Actions job.
    await runAction(event, deps, options);
    expect(coding).toBe(1);
    expect(replies).toBe(1);
    await expect(readState(statePath, "b".repeat(20), secret)).rejects.toThrow();
  } finally { await rm(dir, { recursive: true, force: true }); }
});
