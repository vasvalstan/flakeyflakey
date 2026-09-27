import { expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile, readFile, rename, rm, symlink } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Change } from "../state";
import {quote,stageVerifiedChanges,type Backend} from "../workspace";
import type {Task} from "../state";

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

test("export ignores generated untracked files without .gitignore and keeps tracked output changes and real file limits", async () => {
  const directory = await mkdtemp(join(tmpdir(), "flakey-agent-no-ignore-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: directory, encoding: "utf8" }).trim();
  const script = fileURLToPath(new URL("../sandbox/export-changes.mjs", import.meta.url));
  try {
    git("init", "-q");
    await mkdir(join(directory,"dist"));await mkdir(join(directory,"node_modules"));await mkdir(join(directory,"src"));
    await writeFile(join(directory,"dist/tracked.txt"),"before");
    await writeFile(join(directory,"src/heading.ts"),"before");
    git("add",".");const base=git("write-tree");
    await writeFile(join(directory,"dist/tracked.txt"),"after");
    await writeFile(join(directory,"src/heading.ts"),"after");
    await writeFile(join(directory,"src/heading.test.ts"),"new test");
    await writeFile(join(directory,"dist/generated.js"),"generated");
    for(let i=0;i<100;i++)await writeFile(join(directory,`node_modules/package-${i}.js`),"dependency");
    const output=join(tmpdir(),`flakey-export-${directory.split("/").at(-1)}.json`);
    try {
      execFileSync("node",[script,base,output],{cwd:directory});
      const changes=JSON.parse(await readFile(output,"utf8")) as Change[];
      expect(changes.map(c=>c.path)).toEqual(["dist/tracked.txt","src/heading.test.ts","src/heading.ts"]);
      const backend:Backend={
        execute:async command=>({output:execFileSync("sh",["-c",command.replace("cd /workspace/flakeyflakey",`cd ${quote(directory)}`)],{encoding:"utf8"}),exitCode:0}),
        uploadFiles:async()=>[],downloadFiles:async()=>[],
      };
      const staged=await stageVerifiedChanges(backend,{localBase:base} as Task,changes);
      expect(staged).toBe(git("write-tree"));
      expect(git("ls-files","node_modules","dist/generated.js")).toBe("");
      expect(git("diff","--cached","--name-only",base).split("\n")).toEqual(changes.map(c=>c.path));
      await writeFile(join(directory,"src/literal*.ts"),"literal filename");
      await writeFile(join(directory,"src/literal-other.ts"),"must stay untracked");
      await stageVerifiedChanges(backend,{localBase:base} as Task,[...changes,{path:"src/literal*.ts",mode:"100644",content:Buffer.from("literal filename").toString("base64")}]);
      expect(git("ls-files").split("\n")).toContain("src/literal*.ts");
      expect(git("ls-files","src/literal-other.ts")).toBe("");
      for(let i=0;i<81;i++)await writeFile(join(directory,`src/real-${i}.ts`),"source");
      expect(()=>execFileSync("node",[script,base,output],{cwd:directory,stdio:"pipe"})).toThrow();
    } finally { await rm(output,{force:true}); }
  } finally { await rm(directory,{recursive:true,force:true}); }
});
