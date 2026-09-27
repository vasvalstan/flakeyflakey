import { assertEuEndpoint, required, slackChannelId } from "../config";
import { GitHub, GitHubError } from "../github";
import { Slack } from "../slack";
import { sandboxSnapshot } from "../sandbox";

const names = ["LANGSMITH_API_KEY", "LANGSMITH_WORKSPACE_ID", "LANGSMITH_ENDPOINT",
  "OPENAI_API_KEY", "SLACK_TEAM_ID", "SLACK_SIGNING_SECRET", "SLACK_BOT_TOKEN", "FLAKEY_GITHUB_TOKEN", "FLAKEY_SANDBOX_SNAPSHOT",
  "FLAKEY_DISPATCH_TOKEN", "FLAKEY_STATE_KEY", "FLAKEY_APPROVER_SLACK_ID"];
let missing = false;
for (const name of names) {
  try { required(name); console.log(`${name}: configured`); }
  catch { console.log(`${name}: missing`); missing = true; }
}
if (missing) process.exit(1);
assertEuEndpoint();
if (process.argv.includes("--offline")) process.exit(0);

const slack = new Slack();
type Identity = { team_id: string; bot_id?: string };
const bot = await slack.call<Identity>("auth.test", {});
if (bot.team_id !== required("SLACK_TEAM_ID") || !bot.bot_id) throw new Error("Slack bot token belongs to another workspace or is not a bot token.");
if (process.env.SLACK_HISTORY_TOKEN) {
  const history = await slack.call<Identity>("auth.test", {}, true);
  if (history.team_id !== bot.team_id) throw new Error("Slack history token belongs to another workspace.");
}
const latest = await slack.call<{ messages: { type: string; ts: string; thread_ts?: string; subtype?: string }[] }>("conversations.history", { channel: slackChannelId, limit: 20 }, true);
console.log("Slack identity and channel access: OK");
// Join/leave notices cannot have threads, so use an ordinary message for this check.
const message = latest.messages.find(item => item.type === "message" && !item.subtype);
if (message) {
  await slack.call("conversations.replies", { channel: slackChannelId, ts: message.thread_ts ?? message.ts, limit: 1 }, true);
  console.log("Slack thread history: OK");
} else console.log("Slack thread history: not tested (no ordinary message in recent history)");
const repo = await new GitHub().repo();
console.log(`GitHub repository read access: OK (default branch ${repo.default_branch}); write access is checked on first publication`);
if (!await new GitHub().branch("develop")) throw new Error("Create the develop branch before activation.");
try {
  const protection = await new GitHub().request<{
    required_status_checks?: { strict: boolean; contexts: string[] };
    enforce_admins?: { enabled: boolean }; required_conversation_resolution?: { enabled: boolean };
  }>("/branches/develop/protection");
  if (!protection.required_status_checks?.strict || !protection.enforce_admins?.enabled ||
      !protection.required_conversation_resolution?.enabled ||
      !["check", "pr-agent"].every(name => protection.required_status_checks!.contexts.includes(name))) {
    throw new Error("Configure develop's strict check/pr-agent checks, conversation resolution and administrator enforcement before Slack merging.");
  }
  console.log("develop protection read access and merge rules: OK");
} catch (error) {
  if (error instanceof GitHubError && error.status === 403) throw new Error("Add repository Administration: read to FLAKEY_GITHUB_TOKEN to verify branch protection. Administration write is not needed.");
  if (error instanceof GitHubError && error.status === 404) throw new Error("develop exists, but branch protection could not be read. Configure its strict check/pr-agent checks, conversation resolution and administrator enforcement, and ensure FLAKEY_GITHUB_TOKEN has repository Administration: read.");
  throw error;
}
await sandboxSnapshot();
console.log("EU sandbox snapshot: ready");
console.log("Model key is configured; no paid model call was made. No messages or PRs were created.");
