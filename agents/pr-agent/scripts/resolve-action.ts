import { appendFile } from "node:fs/promises";
import { actionEvent, previousArtifact } from "../actions-state";
import { GitHub } from "../github";
import { required } from "../config";

try {
  const { key, defaultBranch } = await actionEvent();
  const github = new GitHub(async () => required("GITHUB_TOKEN"));
  const artifact = await previousArtifact(github, key, defaultBranch);
  await appendFile(required("GITHUB_OUTPUT"), `key=${key}\nartifact_id=${artifact?.id ?? ""}\nrun_id=${artifact?.workflow_run?.id ?? ""}\n`);
  console.log(artifact ? "Found encrypted task state from a trusted agent run." : "No previous task artifact; existing branches will fail closed.");
} catch {
  console.error("Could not validate the dispatch or locate trusted task state. Check the workflow and its secrets.");
  process.exitCode = 1;
}
