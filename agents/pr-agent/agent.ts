import { StateGraph, StateSchema, START, END, type LangGraphRunnableConfig } from "@langchain/langgraph";
import { z } from "zod";
import { code, type CodingInput, type Decision } from "./coder";
import { GitHub } from "./github";
import { Slack } from "./slack";
import { openSandbox } from "./sandbox";
import { required, maxReviewRounds } from "./config";
import { scopeFor, threadIdFor, verifyEnvelope, type Envelope, type AgentEvent, type RunScope } from "./policy";
import { prepare, publish, readReview } from "./workflow";
import { verify, type Backend } from "./workspace";
import type { Task } from "./state";
import { approvalCommand, approvalHelp, handleApproval } from "./approval";

export const stateSchema = new StateSchema({
  envelope: z.custom<Envelope>(),
  event: z.custom<AgentEvent>().optional(),
  processed: z.array(z.string()).default([]),
  task: z.custom<Task>().optional(),
  request: z.string().default(""),
  review: z.unknown().optional(),
  decision: z.custom<Decision>().optional(),
  reply: z.string().default(""),
  route: z.enum(["work", "finish", "skip"]).default("skip"),
  scheduleReview: z.boolean().default(false),
  diagnostic: z.object({ stage: z.string(), detail: z.string() }).optional(),
});

function failure(stage: string, error: unknown, reply: string) {
  let detail = error instanceof Error ? error.message : String(error);
  for (const name of ["LANGSMITH_API_KEY", "SLACK_BOT_TOKEN", "SLACK_HISTORY_TOKEN", "SLACK_SIGNING_SECRET", "FLAKEY_GITHUB_TOKEN", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) {
    const secret = process.env[name];
    if (secret) detail = detail.replaceAll(secret, "[redacted]");
  }
  return { route: "finish" as const, reply, diagnostic: { stage, detail: detail.slice(-8000) } };
}

type Deps = {
  github: GitHub;
  slack: Pick<Slack, "thread" | "reply">;
  backend: (scope: RunScope) => Promise<Backend>;
  code: (input: CodingInput) => Promise<Decision>;
  enqueue: (event: AgentEvent, delay: number) => Promise<unknown>;
};

export function buildGraph(deps: Deps, checkpointer?: Parameters<StateGraph<typeof stateSchema>["compile"]>[0]) {
  // The Actions runner persists streamed state after each boundary. Tests can
  // additionally supply a checkpointer. The LLM never calls GitHub write APIs.
  return new StateGraph(stateSchema)
    .addNode("intake", async (state, config: LangGraphRunnableConfig) => {
      const event = verifyEnvelope(state.envelope, required("SLACK_SIGNING_SECRET"), required("SLACK_TEAM_ID"));
      if (config.configurable?.thread_id !== threadIdFor(event)) throw new Error("Input belongs to another agent thread.");
      const reset = { event, reply: "", scheduleReview: false, decision: undefined, review: undefined };
      if (state.processed.includes(event.eventId)) return { ...reset, route: "skip" as const };
      const command = event.kind === "slack" ? approvalCommand(event.text) : undefined;
      if (command) {
        try {
          return { ...reset, ...await handleApproval(deps.github, event, state.task, command), diagnostic: undefined, route: "finish" as const };
        } catch (error) {
          // Command parsing and execution never enter the model or sandbox.
          return { ...reset, diagnostic: undefined, route: "finish" as const,
            reply: `Command not completed: ${error instanceof Error ? error.message : "Check GitHub and retry."}` };
        }
      }
      if (state.task?.merged) return { ...reset, route: "finish" as const,
        reply: event.kind === "slack" ? "This PR has been merged. Start a new Slack thread for new work." : "" };
      if (state.task?.approval) return { ...reset, route: "finish" as const,
        reply: event.kind === "slack" ? `This revision has your approval, so coding is paused. Merge it or revoke authorization first.\n${approvalHelp(state.task)}` : "" };
      if (event.kind === "review") {
        if (!state.task?.awaitingReview || event.expectedHead !== state.task.parentSha) return { ...reset, route: "finish" as const };
        try {
          const review = await readReview(deps.github, state.task);
          if (review.status === "pending") return { ...reset, route: "finish" as const,
            scheduleReview: event.attempt < 10,
            reply: event.attempt >= 10 ? `Greptile has not submitted a review for the current commit yet. ${state.task.prUrl}\nMention me with “check the review” to retry. Check that Greptile reviews draft PRs.` : "" };
          if (state.task.reviewRounds >= maxReviewRounds) return { ...reset, route: "finish" as const,
            task: { ...state.task, awaitingReview: false }, reply: `The two correction rounds are complete. Please review ${state.task.prUrl}.\n${approvalHelp(state.task)}` };
          return { ...reset, review, task: { ...state.task, reviewHead: review.head, awaitingReview: false }, route: "work" as const };
        } catch (error) {
          return { ...reset, ...failure("review", error, `Review could not be checked. Inspect the PR and this Actions run and the private EU trace before retrying. ${state.task.prUrl ?? ""}`) };
        }
      }
      try {
        const request = await deps.slack.thread(event);
        // A manual follow-up also gets available review context, but never
        // assumes that an old or missing review approved the current revision.
        const review = state.task?.prNumber ? await readReview(deps.github, state.task) : undefined;
        if (state.task && review?.status === "pending") return { ...reset, request, review, route: "finish" as const,
          task: { ...state.task, verification: undefined, reviewHead: undefined, awaitingReview: true },
          scheduleReview: true, reply: `Greptile is still reviewing the current commit. I’ll check again before starting more coding. ${state.task.prUrl}` };
        if (state.task && review && state.task.reviewRounds >= maxReviewRounds) return { ...reset, request, review, route: "finish" as const,
          task: { ...state.task, awaitingReview: false }, reply: `The two correction rounds are complete. Please review ${state.task.prUrl}.\n${approvalHelp(state.task)}` };
        return { ...reset, request, review, route: "work" as const,
          ...(state.task ? { task: { ...state.task, verification: undefined, reviewHead: review?.status === "reviewed" ? review.head : undefined } } : {}) };
      } catch (error) {
        return { ...reset, ...failure("context", error, "I could not read the Slack thread or current PR. Check the app's channel access and GitHub credentials, then mention me again.") };
      }
    })
    .addNode("prepare", async state => {
      try {
        const scope = scopeFor(state.event!);
        return { task: await prepare(deps.github, await deps.backend(scope), scope, state.task) };
      } catch (error) { return failure("prepare", error, "I could not prepare the repository sandbox. Check the snapshot and repository access in LangSmith, then retry."); }
    })
    .addNode("code", async state => {
      try {
        const decision = await deps.code({ event: state.event!, task: state.task!, request: state.request, review: state.review, diagnostic: state.diagnostic });
        return { decision, diagnostic: undefined, reply: decision.reply, route: decision.action === "publish" ? "work" as const : "finish" as const,
          scheduleReview: decision.action === "stop" && state.review && (state.review as { status?: string }).status === "pending" ? true : false };
      } catch (error) { return failure("code", error, "The coding run stopped before publication. Its sandbox edits are retained temporarily. Check the Actions run and private EU trace and mention me again to continue."); }
    })
    .addNode("verify", async state => {
      try {
        const verification = await verify(await deps.backend(scopeFor(state.event!)), state.task!);
        return { task: { ...state.task!, verification } };
      } catch (error) { return failure("verify", error, "The required checks did not all pass, or files changed during verification. No new revision was published. Check this Actions run and the private EU trace and mention me to fix the failure."); }
    })
    .addNode("publish", async state => {
      try {
        const scope = scopeFor(state.event!);
        const task = await publish(deps.github, await deps.backend(scope), scope, state.task!, state.decision!.title, state.decision!.summary);
        return { task, scheduleReview: true, reply: `Draft PR: ${task.prUrl}\n${state.decision!.reply}\nSandbox checks passed. I’ll check for Greptile’s review.\n${approvalHelp(task)}` };
      } catch (error) { return failure("publish", error, "Publication did not finish cleanly. A branch or draft PR may already exist. Check GitHub and the Actions run and private EU trace before retrying; this Slack thread reuses its existing branch."); }
    })
    .addNode("finish", async state => {
      const event = state.event!;
      if (state.scheduleReview && state.task?.prNumber) {
        const attempt = event.kind === "review" && event.expectedHead === state.task.parentSha ? event.attempt + 1 : 1;
        await deps.enqueue({ ...event, kind: "review", text: "Check Greptile's latest review and correct valid findings.",
          eventId: `review:${state.task.parentSha}:${attempt}:${event.kind === "slack" ? event.eventId : event.userId}`,
          expectedHead: state.task.parentSha, attempt }, 60);
      }
      if (state.reply) await deps.slack.reply(event, state.reply);
      return { processed: [...state.processed, event.eventId].slice(-1000) };
    })
    .addEdge(START, "intake")
    .addConditionalEdges("intake", state => state.route === "skip" ? END : state.route === "work" ? "prepare" : "finish")
    .addConditionalEdges("prepare", state => state.route === "work" ? "code" : "finish")
    .addConditionalEdges("code", state => state.route === "work" ? "verify" : "finish")
    .addConditionalEdges("verify", state => state.route === "work" ? "publish" : "finish")
    .addEdge("publish", "finish")
    .addEdge("finish", END)
    .compile(checkpointer);
}

export type AgentState = typeof stateSchema.State;
export const defaultDependencies = { github: new GitHub(), slack: new Slack(), backend: openSandbox, code };
