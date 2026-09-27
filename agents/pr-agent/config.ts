export const repository = { owner: "vasvalstan", name: "flakeyflakey" } as const;
export const slackChannelId = "C0C4AMGJEA3";
export const slackWorkspaceUrl = "https://valsaifunland.slack.com";
export const workspace = "/workspace/flakeyflakey";
export const maxReviewRounds = 2;
export const prBaseBranch = "develop";
export const agentWorkflow = "flakey-patch.yml";
export const euEndpoint = "https://eu.api.smith.langchain.com";

export function required(name: string) {
  const value = process.env[name];
  if (!value || value.startsWith("<")) throw new Error(`Configure ${name} in the agent's secret environment.`);
  return value;
}

export function assertEuEndpoint() {
  if (required("LANGSMITH_ENDPOINT").replace(/\/$/, "") !== euEndpoint) {
    throw new Error(`Use LANGSMITH_ENDPOINT=${euEndpoint} for this deployment.`);
  }
}
export const verificationCommands = [
  "bun --no-env-file install --frozen-lockfile",
  "bun --no-env-file test --timeout 30000 ./src ./server ./scripts",
  "bun --no-env-file run build",
] as const;
