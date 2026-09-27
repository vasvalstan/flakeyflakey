import { randomUUID } from "node:crypto";
import { sandboxClient } from "../sandbox";
import { required } from "../config";

const client = sandboxClient();
const name = required("FLAKEY_SANDBOX_SNAPSHOT");
const snapshots = await client.listSnapshots();
if (snapshots.some(item => (item.name === name || item.id === name) && item.status === "ready")) {
  console.log(`EU sandbox snapshot already ready: ${name}`);
} else {
  // Import through the snapshot service: in-sandbox BuildKit cannot reliably
  // download Microsoft's redirected image layers through the egress proxy.
  const base = snapshots.find(item => item.name === "flakey-playwright-base-v1" && item.status === "ready")
    ?? await client.createSnapshot("flakey-playwright-base-v1", "mcr.microsoft.com/playwright:v1.61.1-noble", 16 * 1024 ** 3, { timeout: 900 });
  const builder = await client.createSandbox(base.id, {
    name: `flakey-setup-${randomUUID().slice(0, 8)}`, vCpus: 2, memBytes: 4 * 1024 ** 3,
    idleTtlSeconds: 900, deleteAfterStopSeconds: 3600, timeout: 180,
  });
  try {
    const result = await builder.run(`set -e
npm install --global bun@1.3.12 --no-audit --no-fund
test "$(bun --version)" = "1.3.12"
git --version
test -d /ms-playwright/chromium-1228
mkdir -p /workspace
chown pwuser:pwuser /workspace`, { timeout: 600, runConfig: { user: "root" } });
    if (result.exit_code !== 0) throw new Error(`Sandbox preparation failed: ${result.stderr.slice(-2000)}`);
    const snapshot = await builder.captureSnapshot(name, {
      timeout: 900,
      runConfig: { user: "pwuser", work_dir: "/workspace", env_vars: { CI: "true", PLAYWRIGHT_BROWSERS_PATH: "/ms-playwright" } },
    });
    console.log(`EU sandbox snapshot ready: ${snapshot.name}`);
  } finally {
    await builder.delete();
  }
}
