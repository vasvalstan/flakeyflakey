import { assertEuEndpoint, required, slackChannelId } from "../config";
import { GitHub } from "../github";
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
await sandboxSnapshot();
console.log("EU sandbox snapshot: ready");
console.log("Model key is configured; no paid model call was made. No messages or PRs were created.");
