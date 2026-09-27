import { required } from "./config";
import { GitHub } from "./github";
import { seal } from "./sealed";
import { scopeFor, signEvent, type AgentEvent } from "./policy";

// Only opaque ciphertext and a thread hash reach the public Actions event.
export async function enqueue(event: AgentEvent, github = new GitHub(async () => required("FLAKEY_DISPATCH_TOKEN"))) {
  const key = scopeFor(event).key;
  const encrypted = seal(signEvent(event, required("SLACK_SIGNING_SECRET")), required("FLAKEY_STATE_KEY"), `request:${key}`);
  await github.request("/dispatches", "POST", {
    event_type: "flakey_patch", client_payload: { key, encrypted_request: encrypted },
  });
}
