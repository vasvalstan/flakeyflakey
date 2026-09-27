import { expect, test } from "bun:test";
import { GitHub } from "../github";
import { publish, prepare } from "../workflow";
import { verify, capture, digestChanges, type Backend } from "../workspace";
import type { Change, Task } from "../state";
import type { RunScope } from "../policy";

const scope: RunScope = { key: "task", branch: "codex/slack-task", threadTs: "123.456", slackUrl: "https://valsaifunland.slack.com/archives/C0C4AMGJEA3/p123456" };
const tree = "c".repeat(40);
const parent = "a".repeat(40);
const baseTree = "b".repeat(40);
const head = "d".repeat(40);
const task = (): Task => ({ key: scope.key, branch: scope.branch, baseBranch: "develop", parentSha: parent,
  parentTree: baseTree, localBase: baseTree, reviewRounds: 0 });
const change = (): Change[] => [{ path: "src/example.ts", mode: "100644", content: Buffer.from("export const answer = 42;\n").toString("base64") }];

function sandbox(changes = change(), failure?: string): Backend {
  return {
    execute: async command => ({ output: command.includes("rev-parse") ? tree : command.includes("git show")
      ? JSON.stringify({ scripts: { "test:e2e": "playwright test", "test:soak": "bun scripts/soak-studio.ts" } }) : "done",
      exitCode: failure && command.includes(failure) ? 1 : 0 }),
    uploadFiles: async () => [{ }],
    downloadFiles: async () => [{ content: new TextEncoder().encode(JSON.stringify(changes)) }],
  };
}

function github(options: { existingPr?: boolean; remote?: string; remoteTree?: string } = {}) {
  const writes: { path: string; body: any }[] = [];
  const client = new GitHub(() => Promise.resolve("test"), async (url, init) => {
    const path = new URL(url).pathname.replace("/repos/vasvalstan/flakeyflakey", "");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (init?.method !== "GET") {
      writes.push({ path, body });
      if (path === "/git/blobs") return Response.json({ sha: "e".repeat(40) });
      if (path === "/git/trees") return Response.json({ sha: tree });
      if (path === "/git/commits") return Response.json({ sha: head });
      if (path === "/pulls") return Response.json({ number: 7, html_url: "https://github.com/vasvalstan/flakeyflakey/pull/7", state: "open" });
      return Response.json({});
    }
    if (path === "/pulls") return Response.json(options.existingPr ? [{ number: 7, state: "open", html_url: "https://github.com/vasvalstan/flakeyflakey/pull/7" }] : []);
    if (path.startsWith("/git/ref/heads/")) return options.remote
      ? Response.json({ object: { sha: options.remote } }) : new Response(null, { status: 404 });
    if (path.startsWith("/git/commits/")) return Response.json({ sha: options.remote, tree: { sha: options.remoteTree } });
    throw new Error(`Unexpected GET ${path}`);
  });
  return { client, writes };
}

test("publish refuses unverified changes and never writes to GitHub", async () => {
  const { client, writes } = github();
  await expect(publish(client, sandbox(), scope, task(), "Fix", "Summary")).rejects.toThrow("verify_changes");
  expect(writes).toHaveLength(0);
});

test("editing after successful verification invalidates publication", async () => {
  const changes = change();
  const backend = sandbox(changes);
  const current = task();
  current.verification = await verify(backend, current);
  changes[0]!.content = Buffer.from("changed after tests").toString("base64");
  const { client, writes } = github();
  await expect(publish(client, backend, scope, current, "Fix", "Summary")).rejects.toThrow("verify_changes");
  expect(writes).toHaveLength(0);
});

test("a failing browser test stops verification", async () => {
  await expect(verify(sandbox(change(), "test:e2e"), task())).rejects.toThrow("Sandbox command failed");
});

test("older repository baselines still require unit tests and build without nonexistent browser scripts", async () => {
  const backend = sandbox();
  const execute = backend.execute;
  backend.execute = async command => command.includes("git show")
    ? { output: JSON.stringify({ scripts: { test: "bun test", build: "tsc --noEmit && bun --bun vite build" } }), exitCode: 0 }
    : execute(command);
  const result = await verify(backend, task());
  expect(result?.logs.map(item => item.command)).toEqual([
    "bun --no-env-file install --frozen-lockfile",
    "bun --no-env-file test --timeout 30000 ./src ./server ./scripts",
    "bun --no-env-file run build",
  ]);
});

test("a failing build stops verification on every repository version", async () => {
  await expect(verify(sandbox(change(), "run build"), task())).rejects.toThrow("Sandbox command failed");
});

test("publish creates a draft tied to Slack and reports actual test commands", async () => {
  const { client, writes } = github();
  const backend = sandbox();
  const current = task();
  current.verification = await verify(backend, current);
  const next = await publish(client, backend, scope, current, "Fix", "Summary");
  const pr = writes.find(write => write.path === "/pulls")!;
  expect(pr.body.draft).toBe(true);
  expect(pr.body.head).toBe(scope.branch);
  expect(pr.body.base).toBe("develop");
  expect(pr.body.body).toContain(scope.slackUrl);
  expect(pr.body.body).toContain("test:e2e");
  expect(next.prNumber).toBe(7);
  expect(next.parentSha).toBe(head);
  expect(next.verification).toBeUndefined();
  expect(next.awaitingReview).toBe(true);
});

test("a retry after publishing the same tree reuses the PR and commit", async () => {
  const { client, writes } = github({ existingPr: true, remote: head, remoteTree: tree });
  const current = task();
  current.verification = { digest: digestChanges(change()), logs: [] };
  await publish(client, sandbox(), scope, current, "Fix", "Summary");
  expect(writes.filter(write => write.path === "/pulls")).toHaveLength(0);
  expect(writes.filter(write => write.path === "/git/commits")).toHaveLength(0);
});

test("concurrent edits on the remote branch are not overwritten", async () => {
  const { client, writes } = github({ remote: head, remoteTree: "f".repeat(40) });
  const current = task();
  current.verification = { digest: digestChanges(change()), logs: [] };
  await expect(publish(client, sandbox(), scope, current, "Fix", "Summary")).rejects.toThrow("Remote branch changed");
  expect(writes.filter(write => write.path.includes("/git/refs"))).toHaveLength(0);
});

test("third automated correction is refused", async () => {
  const { client, writes } = github();
  const current = { ...task(), reviewRounds: 2, reviewHead: parent,
    verification: { digest: digestChanges(change()), logs: [] } };
  await expect(publish(client, sandbox(), scope, current, "Fix", "Summary")).rejects.toThrow("Two review correction");
  expect(writes).toHaveLength(0);
});

test("a closed task PR cannot spawn a replacement PR", async () => {
  const client = new GitHub(() => Promise.resolve("test"), async () => Response.json([{ number: 7, state: "closed" }]));
  await expect(prepare(client, sandbox(), scope)).rejects.toThrow("closed");
});

test("missing Actions state never resets the budget on an existing task branch", async () => {
  const { client } = github({ remote: head });
  await expect(prepare(client, sandbox(), scope)).rejects.toThrow("Saved task state is missing");
});

test("publication refuses main even when a caller supplies a verification receipt", async () => {
  const { client, writes } = github();
  await expect(publish(client, sandbox(), scope, { ...task(), baseBranch: "main" }, "Fix", "Summary")).rejects.toThrow("target develop");
  expect(writes).toHaveLength(0);
});

test("verification cannot be bypassed by editing package scripts", async () => {
  const changes: Change[] = [{ path: "package.json", mode: "100644", content: Buffer.from(JSON.stringify({ scripts: { check: "true" } })).toString("base64") }];
  const backend = sandbox(changes);
  backend.execute = async () => ({ output: JSON.stringify({ scripts: { check: "bun test && bun run build" } }), exitCode: 0 });
  await expect(capture(backend, task())).rejects.toThrow("verification scripts");
});

test("new sandbox resolves develop to a pinned SHA before downloading", async () => {
  const requests: string[] = [];
  const client = new GitHub(async () => "test", async (url, init) => {
    requests.push(url);
    if (url.includes("codeload.github.com")) return new Response("archive");
    const path = new URL(url).pathname.replace("/repos/vasvalstan/flakeyflakey", "");
    if (path === "/pulls") return Response.json([]);
    if (!path) return Response.json({ default_branch: "main" });
    if (path === "/git/ref/heads/develop") return Response.json({ object: { sha: parent } });
    if (path.startsWith("/git/ref/")) return new Response(null, { status: 404 });
    if (path === `/git/commits/${parent}`) return Response.json({ sha: parent, tree: { sha: baseTree } });
    if (path === `/tarball/${parent}`) return new Response(null, { status: 302, headers: { location: "https://codeload.github.com/test" } });
    throw new Error(`Unexpected request: ${path} ${init?.method}`);
  });
  const backend = sandbox();
  backend.execute = async command => ({ output: command.includes("write-tree") ? baseTree : "", exitCode: 0 });
  const result = await prepare(client, backend, scope);
  expect(result.parentSha).toBe(parent);
  expect(requests.some(url => url.includes("/git/commits/main"))).toBe(false);
});
