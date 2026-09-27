import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { agentWorkflow, required } from "./config";
import { GitHub } from "./github";
import { scopeFor, verifyEnvelope } from "./policy";
import { seal, unseal } from "./sealed";
import type { AgentState } from "./agent";

const inputs = z.object({ key: z.string().regex(/^[a-f0-9]{20}$/), encrypted_request: z.string().max(64_000) });
const envelopeSchema = z.object({ payload: z.string(), signature: z.string() });

export function readDispatch(payload: unknown, stateKey: string, signingSecret: string, team: string) {
  const { key, encrypted_request } = inputs.parse(payload);
  const envelope = envelopeSchema.parse(unseal(encrypted_request, stateKey, `request:${key}`));
  const event = verifyEnvelope(envelope, signingSecret, team);
  if (event.kind !== "slack" || scopeFor(event).key !== key) throw new Error("Dispatch does not match the Slack task.");
  return { key, event, envelope };
}

export async function readState(path: string, key: string, secret: string): Promise<Partial<AgentState>> {
  let content: string;
  try { content = await readFile(path, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return {}; throw error; }
  const saved = unseal(content.trim(), secret, `state:${key}`) as { version?: number; state?: Partial<AgentState> };
  if (saved.version !== 1 || !saved.state || (saved.state.task && saved.state.task.key !== key)) throw new Error("Saved state belongs to another task or version.");
  return saved.state;
}

export async function writeState(path: string, key: string, secret: string, state: Partial<AgentState>) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(`${path}.tmp`, seal({ version: 1, state }, secret, `state:${key}`), { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}

type Artifact = { id: number; name: string; expired: boolean; size_in_bytes: number; workflow_run?: { id: number; head_branch: string } };
// Never restore artifacts from PR checks or another workflow, even if named alike.
export async function previousArtifact(github: GitHub, key: string, defaultBranch: string) {
  const name = `flakey-state-${key}`;
  const page = await github.request<{ artifacts: Artifact[] }>(`/actions/artifacts?name=${name}&per_page=100`);
  for (const artifact of page.artifacts.sort((a, b) => b.id - a.id)) {
    if (artifact.name !== name || !artifact.workflow_run || artifact.workflow_run.head_branch !== defaultBranch) continue;
    const run = await github.request<{ path: string; event: string; head_branch: string; repository: { id: number }; head_repository: { id: number } }>(`/actions/runs/${artifact.workflow_run.id}`);
    if (run.path !== `.github/workflows/${agentWorkflow}` || !["workflow_dispatch", "repository_dispatch"].includes(run.event) || run.head_branch !== defaultBranch || run.repository.id !== run.head_repository.id) continue;
    if (artifact.expired) throw new Error("Latest task state expired. Stop rather than restoring an older revision.");
    if (artifact.size_in_bytes > 6_000_000) throw new Error("Saved task artifact exceeds its size limit.");
    return artifact;
  }
}

export async function actionEvent() {
  const payload = JSON.parse(await readFile(required("GITHUB_EVENT_PATH"), "utf8"));
  if (!["workflow_dispatch", "repository_dispatch"].includes(process.env.GITHUB_EVENT_NAME ?? "") || process.env.GITHUB_REPOSITORY !== "vasvalstan/flakeyflakey" || process.env.GITHUB_REF !== `refs/heads/${payload.repository?.default_branch}`) throw new Error("Agent must run from the default branch's dispatch workflow.");
  if (process.env.GITHUB_EVENT_NAME === "repository_dispatch" && payload.action !== "flakey_patch") throw new Error("Unknown dispatch type.");
  return { ...readDispatch(payload.client_payload ?? payload.inputs, required("FLAKEY_STATE_KEY"), required("SLACK_SIGNING_SECRET"), required("SLACK_TEAM_ID")), defaultBranch: payload.repository.default_branch as string };
}
