import { expect, test } from "bun:test";
import { mkdtemp, writeFile, readFile, rename, rm, symlink } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Change } from "../state";

test("real Git export includes renamed, deleted and untracked files but rejects symlinks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flakey-agent-export-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
  const script = fileURLToPath(new URL("../sandbox/export-changes.mjs", import.meta.url));
  try {
    git("init", "-q");
    await writeFile(join(directory, ".gitignore"), "changes.json\n");
    await writeFile(join(directory, "before.txt"), "old");
    await writeFile(join(directory, "deleted.txt"), "delete me");
    git("add", ".");
    const base = git("write-tree");
    await rename(join(directory, "before.txt"), join(directory, "after.txt"));
    await rm(join(directory, "deleted.txt"));
    await writeFile(join(directory, "new.txt"), "new");
    execFileSync("node", [script, base, "changes.json"], { cwd: directory });
    const changes = JSON.parse(await readFile(join(directory, "changes.json"), "utf8")) as Change[];
    expect(changes.map(change => change.path)).toEqual(["after.txt", "before.txt", "deleted.txt", "new.txt"]);
    expect(changes.find(change => change.path === "before.txt")?.content).toBeNull();
    expect(Buffer.from(changes.find(change => change.path === "after.txt")!.content!, "base64").toString()).toBe("old");
    await symlink("new.txt", join(directory, "link.txt"));
    expect(() => execFileSync("node", [script, base, "changes.json"], { cwd: directory, stdio: "pipe" })).toThrow();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
