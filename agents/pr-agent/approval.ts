import { prBaseBranch, repository, required } from "./config";
import { GitHub, isGreptile, type PullRequest, type Review } from "./github";
import { scopeFor, type AgentEvent } from "./policy";
import type { Task } from "./state";

type Command = { action: "approve" | "merge" | "revoke"; number: number; head: string } | { action: "invalid" };
export function approvalCommand(text: string): Command | undefined {
  const plain = text.trim().replace(/^<@[A-Z0-9]+>\s*/, "");
  // Reserve the documented #PR command prefix, not ordinary coding requests
  // such as "merge the duplicate helpers" or "revoke an expired session".
  if (!/^(approve|merge|revoke)(?:\s+#|$)/i.test(plain)) return;
  const match = /^(approve|merge|revoke) #([1-9]\d*) ([a-f0-9]{40})$/i.exec(plain);
  if (!match || !Number.isSafeInteger(Number(match[2]))) return { action: "invalid" };
  return { action: match[1]!.toLowerCase() as "approve" | "merge" | "revoke", number: Number(match[2]), head: match[3]!.toLowerCase() };
}

export function approvalHelp(task: Task) {
  return `After testing the preview, authorize this commit in this thread:\n@Flakey Patch approve #${task.prNumber} ${task.parentSha}\nThen merge it with:\n@Flakey Patch merge #${task.prNumber} ${task.parentSha}\nTo withdraw authorization, use revoke with the same PR number and commit.`;
}

type MergePR = PullRequest & {
  merged: boolean; merge_commit_sha: string | null;
  head: PullRequest["head"] & { repo: { full_name: string } | null };
  base: PullRequest["base"] & { sha: string; repo: { full_name: string } };
};

async function taskPR(github: GitHub, task: Task, command: Exclude<Command, { action: "invalid" }>) {
  const pr = await github.request<MergePR>(`/pulls/${command.number}`);
  const repo = `${repository.owner}/${repository.name}`;
  if (pr.number !== task.prNumber || pr.head.ref !== task.branch || pr.head.sha !== command.head ||
      pr.head.repo?.full_name !== repo || pr.base.repo.full_name !== repo || pr.base.ref !== prBaseBranch) {
    throw new Error("PR number, commit, repository or target branch changed. Only this thread's PR into develop can be authorized.");
  }
  return pr;
}

async function readyToAuthorize(github: GitHub, task: Task, pr: MergePR) {
  if (pr.state !== "open" || pr.merged) throw new Error("This PR is no longer open.");
  const [gate, checks, statuses, reviews] = await Promise.all([
    github.mergeGate(pr.number), github.checkRuns(pr.head.sha),
    github.list<{ context: string; state: string }>(`/commits/${pr.head.sha}/statuses`),
    github.list<Review>(`/pulls/${pr.number}/reviews`),
  ]);
  if (gate.headRefOid !== task.parentSha || gate.baseRefOid !== pr.base.sha) throw new Error("PR changed during verification; try again.");
  const rules = gate.baseRef?.branchProtectionRule;
  if (!rules?.requiresStrictStatusChecks || !rules.isAdminEnforced || !rules.requiresConversationResolution ||
      !["check", "pr-agent"].every(name => rules.requiredStatusCheckContexts.includes(name))) {
    throw new Error("develop must enforce up-to-date check/pr-agent checks, resolved discussions and rules for administrators before Slack merging is enabled.");
  }
  if (gate.reviewThreads.pageInfo.hasNextPage || gate.reviewThreads.nodes.some(thread => !thread.isResolved)) {
    throw new Error("Resolve every review discussion in GitHub before approving or merging.");
  }
  if (gate.reviewDecision === "CHANGES_REQUESTED" || gate.reviewDecision === "REVIEW_REQUIRED") {
    throw new Error("GitHub still requires an independent review. Slack authorization does not replace it.");
  }
  const greptile = reviews.filter(review => isGreptile(review.user) && review.commit_id === pr.head.sha)
    .sort((a, b) => b.id - a.id)[0];
  if (!greptile || !["COMMENTED", "APPROVED"].includes(greptile.state)) {
    throw new Error("Wait for Greptile's completed review of this exact commit.");
  }
  // Any unresolved change request still needs human attention, even if branch
  // protection does not require an independent approval.
  const latestReviews = new Map<string, Review>();
  for (const review of [...reviews].sort((a, b) => a.id - b.id)) {
    if (["APPROVED", "CHANGES_REQUESTED", "DISMISSED"].includes(review.state)) latestReviews.set(review.user.login, review);
  }
  if ([...latestReviews.values()].some(review => review.state === "CHANGES_REQUESTED")) throw new Error("A reviewer still requests changes.");
  const requiredChecks = [["check", 15368], ["pr-agent", 15368], ["Greptile Review", 867647]] as const;
  for (const [name, appId] of requiredChecks) {
    const matches = checks.filter(check => check.name === name && check.app.id === appId);
    if (!matches.length || matches.some(check => check.status !== "completed" || check.conclusion !== "success")) {
      throw new Error(`Wait for a successful ${name} check on this commit.`);
    }
  }
  if (checks.some(check => check.status !== "completed" || !["success", "neutral", "skipped"].includes(check.conclusion ?? ""))) {
    throw new Error("Other GitHub checks are pending or failed.");
  }
  // Commit-status responses are newest first. Superseded failures are not a veto.
  const latestStatuses = new Map<string, string>();
  for (const status of statuses) if (!latestStatuses.has(status.context)) latestStatuses.set(status.context, status.state);
  if ([...latestStatuses.values()].some(state => state !== "success")) throw new Error("A GitHub status is pending or failed.");
  if (["DIRTY", "BEHIND", "UNKNOWN"].includes(gate.mergeStateStatus) || (!gate.isDraft && gate.mergeStateStatus !== "CLEAN")) {
    throw new Error("GitHub has not confirmed this PR is up to date and mergeable. Update the branch or retry after checks finish.");
  }
  return gate;
}

export async function handleApproval(github: GitHub, event: AgentEvent, task: Task | undefined, command: Command) {
  if (event.kind !== "slack" || event.userId !== required("FLAKEY_APPROVER_SLACK_ID")) {
    throw new Error("Only the configured Slack owner can approve, revoke or merge.");
  }
  if (command.action === "invalid") throw new Error("Use an exact command: approve, merge or revoke, followed by #PR and its full 40-character commit SHA. Send it in the original task thread.");
  const scope = scopeFor(event);
  if (!task?.prNumber || task.key !== scope.key || task.branch !== scope.branch || task.baseBranch !== prBaseBranch || task.prNumber !== command.number) {
    throw new Error("No matching saved PR in this Slack thread. Use the original task thread; the setup PR cannot be merged from Slack.");
  }
  if (command.action === "revoke") {
    if (task.approval && task.approval.head !== command.head) throw new Error("Use the commit from the approval you want to revoke.");
    return { task: { ...task, approval: undefined, awaitingReview: false }, reply: "Slack authorization withdrawn. Nothing was merged. Mention me with a new change request to resume coding." };
  }
  if (command.head !== task.parentSha) throw new Error("That commit is stale. Inspect the latest revision and use its full SHA.");
  const pr = await taskPR(github, task, command);
  if (pr.merged) return { task: { ...task, approval: undefined, awaitingReview: false,
    merged: { head: command.head, commit: pr.merge_commit_sha! } }, reply: `PR #${pr.number} is already merged into develop. No second merge was attempted.` };
  if (command.action === "merge" && (!task.approval || task.approval.head !== command.head ||
      task.approval.userId !== event.userId || task.approval.base !== pr.base.sha)) {
    throw new Error("Approve this exact revision against the current develop branch first. A changed head or base requires fresh authorization.");
  }
  const gate = await readyToAuthorize(github, task, pr);
  if (command.action === "approve") {
    await github.markReady(pr.number, command.head);
    const current = await taskPR(github, task, command);
    if (current.state !== "open" || current.base.sha !== gate.baseRefOid) throw new Error("PR changed while approving; inspect it and retry.");
    // Audit only: comments are never read back as authorization. The encrypted
    // state is authoritative, so a forged PR comment cannot authorize a merge.
    const marker = `<!-- flakey-slack-approval:${command.head}:${event.userId}:${event.eventId} -->`;
    const comments = await github.list<{ body: string }>(`/issues/${pr.number}/comments`);
    if (!comments.some(comment => comment.body.includes(marker))) await github.request(`/issues/${pr.number}/comments`, "POST", {
      body: `Slack owner sent an explicit approve command for commit \`${command.head}\` against develop \`${gate.baseRefOid}\`.\n\nThis records Slack authorization, not a GitHub APPROVE review or automated proof of preview acceptance. A separate explicit merge command must pass all gates again.\n\n${scope.slackUrl}\n\n${marker}`,
    });
    return { task: { ...task, awaitingReview: false, approval: { head: command.head, base: gate.baseRefOid, userId: event.userId, eventId: event.eventId } },
      reply: `Authorized PR #${pr.number} at ${command.head} and marked it ready for review. Nothing was merged.\nWhen ready: @Flakey Patch merge #${pr.number} ${command.head}` };
  }
  if (gate.isDraft || gate.mergeStateStatus !== "CLEAN") throw new Error("PR must be ready for review and mergeable before merging.");
  const current = await taskPR(github, task, command);
  if (current.state !== "open" || current.base.sha !== task.approval!.base) throw new Error("PR changed before merging; inspect it and approve again.");
  // GitHub enforces the expected head atomically, and strict branch rules also
  // apply to the owner credential. Never update develop via the Git refs API.
  const result = await github.request<{ merged: boolean; sha: string }>(`/pulls/${pr.number}/merge`, "PUT", { sha: command.head, merge_method: "squash" });
  if (!result.merged) throw new Error("GitHub did not confirm the merge. Inspect the PR before retrying.");
  return { task: { ...task, approval: undefined, awaitingReview: false, merged: { head: command.head, commit: result.sha } },
    reply: `Merged PR #${pr.number} into develop at ${result.sha}. Start a new Slack thread for the next change.` };
}
