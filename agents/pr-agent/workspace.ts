import { readFileSync } from "node:fs";
import { z } from "zod";
import { workspace, verificationCommands } from "./config";
import { assertPublishPath, sha256 } from "./policy";
import type { Change, Task } from "./state";

export type Backend = {
  execute(command: string): PromiseLike<{ output: string; exitCode: number | null }> | { output: string; exitCode: number | null };
  uploadFiles(files: [string, Uint8Array][]): PromiseLike<{ error?: unknown }[]> | { error?: unknown }[];
  downloadFiles(paths: string[]): PromiseLike<{ error?: unknown; content?: Uint8Array | null }[]> | { error?: unknown; content?: Uint8Array | null }[];
};

export const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`;

export async function execute(backend: Backend, command: string) {
  const result = await backend.execute(command);
  if (result.exitCode !== 0) throw new Error(`Sandbox command failed (${result.exitCode}): ${result.output.slice(-10_000)}`);
  return result.output.trim();
}

export async function upload(backend: Backend, path: string, content: Uint8Array | string) {
  const results = await backend.uploadFiles([[path, typeof content === "string" ? new TextEncoder().encode(content) : content]]);
  if (results.some(result => result.error)) throw new Error("Unable to write sandbox input.");
}

export async function initialise(backend: Backend, archive: Uint8Array, parentTree: string) {
  await execute(backend, "mkdir -p /workspace");
  await upload(backend, "/workspace/source.tar.gz", archive);
  // Only this fixed task directory is replaced when recovering an expired box.
  await execute(backend, `test ! -e ${workspace} && mkdir -p ${workspace} && tar -xzf /workspace/source.tar.gz --strip-components=1 -C ${workspace}`);
  const tree = await execute(backend, `cd ${workspace} && git init -q && git config user.name 'Flakey Patch' && git config user.email 'flakey-patch@users.noreply.github.com' && git add -f . && git write-tree`);
  if (tree !== parentTree) throw new Error("Repository archive differs from the Git tree (for example export-ignore or submodules). A full checkout adapter is required.");
  await execute(backend, `cd ${workspace} && git commit -qm 'Sandbox baseline'`);
  return tree;
}

const changeSchema = z.array(z.object({
  path: z.string(), mode: z.enum(["100644", "100755"]), content: z.string().nullable(),
})).max(80);

export async function capture(backend: Backend, task: Task): Promise<Change[]> {
  if (!/^[a-f0-9]{40}$/.test(task.localBase)) throw new Error("Invalid sandbox baseline.");
  const script = readFileSync(new URL("./sandbox/export-changes.mjs", import.meta.url));
  await upload(backend, "/workspace/export-changes.mjs", script);
  await execute(backend, `cd ${workspace} && node /workspace/export-changes.mjs ${quote(task.localBase)} /workspace/changes.json`);
  const [file] = await backend.downloadFiles(["/workspace/changes.json"]);
  if (!file?.content || file.error || file.content.length > 4_100_000) throw new Error("Unable to read a bounded change set.");
  const changes = changeSchema.parse(JSON.parse(new TextDecoder().decode(file.content)));
  const paths = new Set<string>();
  let bytes = 0;
  for (const change of changes) {
    assertPublishPath(change.path);
    if (paths.has(change.path)) throw new Error("Duplicate changed path.");
    paths.add(change.path);
    if (change.content !== null) {
      const decoded = Buffer.from(change.content, "base64");
      if (decoded.toString("base64") !== change.content) throw new Error("Invalid file encoding.");
      bytes += decoded.length;
    }
  }
  if (bytes > 3_000_000) throw new Error("Change set exceeds 3 MB.");
  const packageChange = changes.find(change => change.path === "package.json");
  if (packageChange) {
    if (!packageChange.content) throw new Error("Cannot delete the package verification configuration.");
    const original = JSON.parse(await execute(backend, `cd ${workspace} && git show ${quote(`${task.localBase}:package.json`)}`));
    const changed = JSON.parse(Buffer.from(packageChange.content, "base64").toString("utf8"));
    const scripts = (value: { scripts?: Record<string, string> }) => JSON.stringify(Object.entries(value.scripts ?? {}).sort(([a], [b]) => a.localeCompare(b)));
    if (scripts(original) !== scripts(changed)) throw new Error("Changes to package verification scripts require human implementation.");
  }
  return changes;
}

export const digestChanges = (changes: Change[]) => sha256(JSON.stringify(changes));

export async function stageVerifiedChanges(backend: Backend, task: Task, changes: Change[]) {
  if (!changes.length || !/^[a-f0-9]{40}$/.test(task.localBase)) throw new Error("Expected verified changes and a pinned local baseline.");
  // Reset only the index, preserving working files. Literal pathspecs keep
  // filenames containing glob characters from staging unrelated files.
  return execute(backend, `cd ${workspace} && git read-tree ${quote(task.localBase)} && git --literal-pathspecs add -A -- ${changes.map(change => quote(change.path)).join(" ")} && git write-tree`);
}

export async function verify(backend: Backend, task: Task): Promise<Task["verification"]> {
  const before = await capture(backend, task);
  if (!before.length) throw new Error("No changes to verify.");
  // Select optional checks from the immutable baseline, never agent-edited files.
  const original = JSON.parse(await execute(backend, `cd ${workspace} && git show ${quote(`${task.localBase}:package.json`)}`));
  const commands = [
    ...verificationCommands,
    ...(original.scripts?.["test:e2e"] ? ["bun --no-env-file run test:e2e"] : []),
    ...(original.scripts?.["test:soak"] ? ["bun --no-env-file run test:soak 25"] : []),
  ];
  const logs = [];
  for (const command of commands) {
    const output = await execute(backend, `cd ${workspace} && ${command}`);
    logs.push({ command, output: output.slice(-8_000) });
  }
  const digest = digestChanges(before);
  if (digest !== digestChanges(await capture(backend, task))) throw new Error("Files changed during verification. Review the diff and verify again.");
  return { digest, logs };
}
