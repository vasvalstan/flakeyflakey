import { appendFile } from "node:fs/promises";
import { actionEvent, readState } from "../actions-state";
import { runAction } from "../actions-runner";
import { defaultDependencies } from "../agent";
import { assertEuEndpoint, required } from "../config";
import { approvalCommand } from "../approval";

try {
  assertEuEndpoint();
  const { event, key } = await actionEvent();
  const statePath = ".runtime/state/state.enc";
  const stateKey = required("FLAKEY_STATE_KEY");
  const previous = await readState(statePath, key, stateKey);
  const runUrl = `https://github.com/vasvalstan/flakeyflakey/actions/runs/${required("GITHUB_RUN_ID")}`;
  if (!previous.processed?.includes(event.eventId)) await defaultDependencies.slack.reply(event,
    `${approvalCommand(event.text) ? "I’m checking your PR command." : "I’m starting the task against develop."} Follow the run: ${runUrl}`);
  const state = await runAction(event, defaultDependencies, { statePath, stateKey,
    signingSecret: required("SLACK_SIGNING_SECRET"), sleep: ms => Bun.sleep(ms) });
  const status = state.diagnostic ? `Stopped at ${state.diagnostic.stage}. Details are in the private EU trace.`
    : state.task?.merged ? "PR merged into develop following explicit Slack authorization." : "Agent run completed. Merging requires explicit human authorization.";
  console.log(status);
  await appendFile(required("GITHUB_STEP_SUMMARY"), `${status}\n\n${state.task?.prUrl ?? "No PR published by this task yet."}\n`);
  if (state.diagnostic) process.exitCode = 1;
} catch {
  // Public Actions logs must not include Slack context, API bodies or secrets.
  console.error("Agent run stopped. Check secrets, the encrypted state artifact and private EU traces before retrying.");
  process.exitCode = 1;
}
