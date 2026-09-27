import { expect, test } from "bun:test";
import { GitHub, isGreptile } from "../github";
import { readReview } from "../workflow";
import type { Task } from "../state";

const task: Task = { key: "task", branch: "codex/slack-task", baseBranch: "main", parentSha: "a".repeat(40),
  parentTree: "b".repeat(40), localBase: "b".repeat(40), reviewRounds: 0, prNumber: 12 };
const bot = { login: "greptile-apps[bot]", type: "Bot" };

test("GitHub calls stay scoped; errors never echo credentials or response bodies", async () => {
  let url = "";
  const client = new GitHub(() => Promise.resolve("test-secret"), async (input, options) => {
    url = input;
    expect((options?.headers as Record<string, string>).Authorization).toBe("Bearer test-secret");
    return new Response("test-secret", { status: 403 });
  });
  await expect(client.repo()).rejects.toThrow("HTTP 403");
  expect(url).toBe("https://api.github.com/repos/vasvalstan/flakeyflakey");
});

test("archive redirects never forward the GitHub token", async () => {
  let calls = 0;
  const client = new GitHub(() => Promise.resolve("test-secret"), async (_url, options) => {
    if (++calls === 1) return new Response(null, { status: 302, headers: { location: "https://codeload.github.com/archive" } });
    expect(options?.headers).toBeUndefined();
    return new Response(new Uint8Array([1, 2, 3]));
  });
  expect(await client.archive("a".repeat(40))).toEqual(new Uint8Array([1, 2, 3]));
});

test("archive refuses an unexpected redirect destination", async () => {
  const client = new GitHub(() => Promise.resolve("secret"), async () => new Response(null, {
    status: 302, headers: { location: "https://example.com/archive" },
  }));
  await expect(client.archive("a".repeat(40))).rejects.toThrow("Unexpected");
});

test("bot matching is exact and does not trust a human's name", () => {
  expect(isGreptile(bot)).toBe(true);
  expect(isGreptile({ ...bot, type: "User" })).toBe(false);
  expect(isGreptile({ ...bot, login: "fake-greptile-apps[bot]" })).toBe(false);
});

function reviewClient(reviewHead: string) {
  return new GitHub(() => Promise.resolve("test"), async url => {
    if (url.includes("/reviews?")) return Response.json([{ id: 1, user: bot, commit_id: reviewHead, state: "COMMENTED", body: "Finding" }]);
    if (url.includes("/comments?")) return Response.json([]);
    return Response.json({ number: 12, state: "open", head: { sha: task.parentSha, ref: task.branch } });
  });
}

test("a review on an older commit never counts as review of the new code", async () => {
  expect((await readReview(reviewClient("old-commit"), task)).status).toBe("pending");
  expect((await readReview(reviewClient(task.parentSha), task)).status).toBe("reviewed");
});

test("empty Greptile results mean pending, not approved", async () => {
  const client = new GitHub(() => Promise.resolve("test"), async url => url.includes("?")
    ? Response.json([]) : Response.json({ state: "open", head: { sha: task.parentSha, ref: task.branch } }));
  expect((await readReview(client, task)).status).toBe("pending");
});

test("GitHub pagination reads subsequent pages", async () => {
  const client = new GitHub(() => Promise.resolve("test"), async url => Response.json(new URL(url).searchParams.get("page") === "1"
    ? Array.from({ length: 100 }, (_, id) => ({ id })) : [{ id: 100 }]));
  expect((await client.list("/pulls")).length).toBe(101);
});
