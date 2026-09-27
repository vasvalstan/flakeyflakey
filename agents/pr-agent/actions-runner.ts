import { buildGraph, type AgentState } from "./agent";
import { readState, writeState } from "./actions-state";
import { signEvent, scopeFor, threadIdFor, type AgentEvent } from "./policy";

type Dependencies = Parameters<typeof buildGraph>[0];

// Each job is finite. State is streamed to an encrypted file and uploaded by
// the workflow's always() step. A runner crash may need human reconciliation;
// this deliberately does not claim Agent Server's exact checkpoint recovery.
export async function runAction(event: AgentEvent, deps: Omit<Dependencies, "enqueue">, options: {
  statePath: string; stateKey: string; signingSecret: string; sleep: (ms: number) => Promise<unknown>;
}) {
  const key = scopeFor(event).key;
  let state = await readState(options.statePath, key, options.stateKey);
  let next: AgentEvent | undefined = event;
  const graph = buildGraph({ ...deps, enqueue: async pending => { next = pending; } });
  let iterations = 0;
  while (next) {
    if (++iterations > 34) throw new Error("Review loop reached its job budget.");
    const current: AgentEvent = next;
    next = undefined;
    if (current.kind === "review") await options.sleep(60_000);
    const stream = await graph.stream({ ...state, envelope: signEvent(current, options.signingSecret) }, {
      configurable: { thread_id: threadIdFor(current) }, recursionLimit: 150, streamMode: "values",
    });
    for await (const value of stream) {
      state = value as AgentState;
      await writeState(options.statePath, key, options.stateKey, state);
    }
    if (state.diagnostic) break;
  }
  return state;
}
