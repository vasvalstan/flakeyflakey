// Executed only in the disposable coding sandbox. The server reinstalls this
// helper before every capture; the verification receipt lives in graph state.
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, writeFileSync } from "node:fs";
const [base, destination] = process.argv.slice(2);
const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 10_000_000 });
// Some repository baselines omit .gitignore. Ignore untracked dependency,
// build and test output explicitly; tracked edits still come from git diff.
const generated = ["node_modules/", "/dist/", "/playwright-report/", "/test-results/", "/output/playwright/", "/output/soak/", "/.flakey/"];
const paths = [...new Set([
  ...git("diff", "--name-only", "--no-renames", "-z", base, "--").split("\0"),
  ...git("ls-files", "--others", "--exclude-standard", ...generated.map(pattern => `--exclude=${pattern}`), "-z").split("\0"),
].filter(Boolean))].sort();
if (paths.length > 80) throw new Error("Split this change: maximum 80 files per PR.");
let total = 0;
const changes = paths.map(path => {
  let stat;
  try { stat = lstatSync(path); } catch (error) { if (error.code !== "ENOENT") throw error; }
  if (!stat) return { path, mode: "100644", content: null };
  if (!stat.isFile()) throw new Error(`Only regular files can be published: ${path}`);
  const bytes = readFileSync(path);
  total += bytes.length;
  if (total > 3_000_000) throw new Error("Split this change: maximum 3 MB per PR.");
  return { path, mode: stat.mode & 0o111 ? "100755" : "100644", content: bytes.toString("base64") };
});
writeFileSync(destination, JSON.stringify(changes));
