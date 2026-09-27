import { GitHub, GitHubError, isGreptile, type PullRequest, type Review, type ReviewComment } from "./github";
import { maxReviewRounds, prBaseBranch, workspace } from "./config";
import type { RunScope } from "./policy";
import type { Task } from "./state";
import { capture, digestChanges, execute, initialise, type Backend } from "./workspace";

export async function prepare(github: GitHub, backend: Backend, scope: RunScope, previous?: Task): Promise<Task> {
  if (previous && previous.key !== scope.key) throw new Error("Task belongs to another Slack thread.");
  const prs = await github.prs(scope.branch);
  const pr = prs[0];
  if (pr && pr.state !== "open") throw new Error("This thread's PR is closed. Start a new Slack thread for new work.");
  if (pr && pr.base.ref !== prBaseBranch) throw new Error("Existing PR does not target develop. Human reconciliation is required.");
  const ref = await github.branch(scope.branch);
  if (!previous && (pr || ref)) throw new Error("Saved task state is missing for an existing branch. Stop and recover the previous Actions artifact.");
  if (previous) {
    const present = await backend.execute(`test -d ${workspace}/.git`);
    if (present.exitCode === 0) return previous;
    // An expired sandbox loses unpushed edits and verification; reconstruct only
    // from the durable remote branch, while retaining the review round budget.
  }
  const baseBranch = prBaseBranch;
  const source = ref ?? await github.branch(baseBranch);
  if (!source) throw new Error("The develop branch is missing. Create it before running Flakey Patch.");
  const commit = await github.commit(source.object.sha);
  const localBase = await initialise(backend, await github.archive(commit.sha), commit.tree.sha);
  return {
    key: scope.key, branch: scope.branch, baseBranch, parentSha: commit.sha,
    parentTree: commit.tree.sha, localBase, reviewRounds: previous?.reviewRounds ?? 0,
    ...(pr ? { prNumber: pr.number, prUrl: pr.html_url } : {}),
    awaitingReview: previous?.awaitingReview,
    reviewHead: previous?.reviewHead === commit.sha ? previous.reviewHead : undefined,
  };
}

async function ensureOpen(github: GitHub, task: Task) {
  if (task.baseBranch !== prBaseBranch) throw new Error("Publication must target develop.");
  if (!task.prNumber) return;
  const pr = await github.pr(task.prNumber);
  if (pr.state !== "open" || pr.head.ref !== task.branch || pr.base.ref !== prBaseBranch) throw new Error("The task PR is no longer open on its expected branches.");
}

export async function publish(github: GitHub, backend: Backend, scope: RunScope, task: Task, title: string, summary: string) {
  await ensureOpen(github, task);
  const changes = await capture(backend, task);
  if (!task.verification || task.verification.digest !== digestChanges(changes)) throw new Error("Run verify_changes successfully after the last edit before publishing.");
  if (task.reviewHead && task.reviewRounds >= maxReviewRounds) throw new Error("Two review correction rounds have been used. Human review is required.");
  const treeEntries = [];
  for (const change of changes) {
    const blob = change.content === null ? null : await github.request<{ sha: string }>("/git/blobs", "POST", { content: change.content, encoding: "base64" });
    treeEntries.push({ path: change.path, mode: change.mode, type: "blob", sha: blob?.sha ?? null });
  }
  const tree = await github.request<{ sha: string }>("/git/trees", "POST", { base_tree: task.parentTree, tree: treeEntries });
  const ref = await github.branch(task.branch);
  let head: string;
  if (ref && ref.object.sha !== task.parentSha) {
    const remote = await github.commit(ref.object.sha);
    // A retry after GitHub accepted the update can continue creating the PR.
    if (remote.tree.sha !== tree.sha) throw new Error("Remote branch changed. Stop and reconcile with the other author.");
    head = remote.sha;
  } else {
    const commit = await github.request<{ sha: string }>("/git/commits", "POST", {
      message: title, tree: tree.sha, parents: [task.parentSha],
    });
    head = commit.sha;
    if (ref) await github.request(`/git/refs/heads/${encodeURIComponent(task.branch)}`, "PATCH", { sha: head, force: false });
    else await github.request("/git/refs", "POST", { ref: `refs/heads/${task.branch}`, sha: head });
  }
  const body = `${summary}\n\n## Source\n${scope.slackUrl}\n\n## Verification\n${task.verification.logs.map(log => `- Passed: \`${log.command}\``).join("\n")}\n\nTested change digest: \`${task.verification.digest}\`\n\nDraft for human review. Greptile findings are reviewed before corrections; no automatic merge.`;
  let pr = (await github.prs(task.branch))[0];
  if (pr && pr.state !== "open") throw new Error("This thread already has a closed PR. Start a new thread.");
  if (!pr) {
    try {
      pr = await github.request<PullRequest>("/pulls", "POST", { title, body, head: task.branch, base: task.baseBranch, draft: true });
    } catch (error) {
      if (!(error instanceof GitHubError) || error.status !== 422) throw error;
      pr = (await github.prs(task.branch))[0];
      if (!pr || pr.state !== "open") throw error;
    }
  } else await github.request(`/pulls/${pr.number}`, "PATCH", { title, body });
  const next: Task = { ...task, parentSha: head, parentTree: tree.sha, prNumber: pr.number, prUrl: pr.html_url,
    reviewRounds: task.reviewRounds + (task.reviewHead ? 1 : 0), reviewHead: undefined,
    verification: undefined, awaitingReview: true };
  // Update the local baseline only after publication. If this fails, retained
  // state and GitHub's tree allow the same tool call to be retried safely.
  await execute(backend, `cd ${workspace} && git add -A && git -c user.name='Flakey Patch' -c user.email='flakey-patch@users.noreply.github.com' commit --allow-empty -qm 'Published checkpoint'`);
  next.localBase = await execute(backend, `cd ${workspace} && git rev-parse 'HEAD^{tree}'`);
  if (next.localBase !== tree.sha) throw new Error("Local files changed while publishing. Stop and reconcile the published PR.");
  return next;
}

export async function readReview(github: GitHub, task: Task) {
  if (!task.prNumber) throw new Error("Publish the draft PR first.");
  const pr = await github.pr(task.prNumber);
  if (pr.state !== "open" || pr.head.ref !== task.branch || pr.head.sha !== task.parentSha) throw new Error("PR changed outside this task; inspect it before continuing.");
  const [reviews, comments, issueComments] = await Promise.all([
    github.list<Review>(`/pulls/${task.prNumber}/reviews`),
    github.list<ReviewComment>(`/pulls/${task.prNumber}/comments`),
    github.list<{ body: string; html_url: string; user: { login: string; type: string } }>(`/issues/${task.prNumber}/comments`),
  ]);
  const current = reviews.filter(review => isGreptile(review.user) && review.commit_id === pr.head.sha && !["PENDING", "DISMISSED"].includes(review.state));
  const findings = comments.filter(comment => isGreptile(comment.user)).map(comment => ({
    id: comment.id, body: comment.body, path: comment.path, line: comment.line, url: comment.html_url,
    onCurrentCommit: comment.commit_id === pr.head.sha,
  }));
  return {
    status: current.length ? "reviewed" : "pending", head: pr.head.sha,
    reviews: current.map(review => ({ id: review.id, body: review.body, state: review.state })), findings,
    // Summary comments lack a commit id: useful context, never evidence that the
    // current revision passed review. Older findings also require reinspection.
    summaries: issueComments.filter(comment => isGreptile(comment.user)).slice(-3).map(({ body, html_url }) => ({ body, url: html_url })),
    correctionRoundsRemaining: maxReviewRounds - task.reviewRounds,
  };
}
