import { LangSmithSandbox } from "deepagents";
import { SandboxClient, LangSmithResourceNotFoundError, LangSmithResourceAlreadyExistsError } from "langsmith/sandbox";
import { assertEuEndpoint, euEndpoint, required } from "./config";
import type { RunScope } from "./policy";

export function sandboxClient() {
  assertEuEndpoint();
  return new SandboxClient({ apiEndpoint: `${euEndpoint}/v2/sandboxes`, apiKey: required("LANGSMITH_API_KEY"),
    ...(process.env.LANGSMITH_WORKSPACE_ID ? { headers: { "X-Tenant-ID": process.env.LANGSMITH_WORKSPACE_ID } } : {}) });
}

export async function sandboxSnapshot(client = sandboxClient()) {
  const selected = required("FLAKEY_SANDBOX_SNAPSHOT");
  const snapshot = (await client.listSnapshots()).find(item =>
    (item.name === selected || item.id === selected) && item.status === "ready");
  if (!snapshot) throw new Error("EU snapshot is not ready. Run bun run snapshot first.");
  return snapshot;
}

export async function openSandbox(scope: RunScope) {
  const client = sandboxClient();
  const name = `flakey-${scope.key}`;
  let sandbox;
  try { sandbox = await client.getSandbox(name); }
  catch (error) {
    if (!(error instanceof LangSmithResourceNotFoundError)) throw error;
    try {
      const snapshot = await sandboxSnapshot(client);
      // Resolve our configured label explicitly; the server treats a bare name
      // as a tagged reference, which imported snapshots may not have.
      sandbox = await client.createSandbox(snapshot.id, {
        name,
        idleTtlSeconds: 1800, deleteAfterStopSeconds: 86400,
        vCpus: 2, memBytes: 4 * 1024 ** 3,
        proxyConfig: { access_control: { allow_list: ["registry.npmjs.org", "registry.yarnpkg.com"] } },
        // No API credentials or LangSmith accessDelegation inside the sandbox.
      });
    } catch (createError) {
      if (!(createError instanceof LangSmithResourceAlreadyExistsError)) throw createError;
      sandbox = await client.getSandbox(name);
    }
  }
  const backend = new LangSmithSandbox({ sandbox, defaultTimeout: 600 });
  if (!backend.isRunning) await backend.start({ timeout: 180 });
  return backend;
}
