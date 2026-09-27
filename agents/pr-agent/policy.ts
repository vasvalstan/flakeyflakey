import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { slackChannelId, slackWorkspaceUrl } from "./config";

export type RunScope = { key: string; branch: string; threadTs: string; slackUrl: string };

export const eventSchema = z.object({
  kind: z.enum(["slack", "review"]), eventId: z.string().min(1).max(200),
  teamId: z.string().regex(/^T[A-Z0-9]+$/), channelId: z.literal(slackChannelId),
  threadTs: z.string().regex(/^\d+\.\d+$/), eventTs: z.string().regex(/^\d+\.\d+$/),
  text: z.string().max(40_000), userId: z.string(),
  expectedHead: z.string().regex(/^[a-f0-9]{40}$/).optional(),
  attempt: z.number().int().min(0).max(10).default(0),
});
export type AgentEvent = z.infer<typeof eventSchema>;
export type Envelope = { payload: string; signature: string };

export function secureEqual(a: string, b: string) {
  const left = Buffer.from(a); const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function signEvent(event: AgentEvent, secret: string): Envelope {
  const payload = JSON.stringify(eventSchema.parse(event));
  return { payload, signature: createHmac("sha256", secret).update(`flakey-event:${payload}`).digest("hex") };
}
export function verifyEnvelope(envelope: Envelope, secret: string, teamId: string): AgentEvent {
  const expected = createHmac("sha256", secret).update(`flakey-event:${envelope.payload}`).digest("hex");
  if (!secureEqual(envelope.signature, expected)) throw new Error("Unverified agent input.");
  const event = eventSchema.parse(JSON.parse(envelope.payload));
  if (event.teamId !== teamId) throw new Error("Slack workspace is not enabled.");
  return event;
}

// Call only after verifying the Slack signature or the server-signed envelope.
export function scopeFor(input: AgentEvent): RunScope {
  const event = eventSchema.parse(input);
  const key = sha256(`${event.teamId}:${event.channelId}:${event.threadTs}`).slice(0, 20);
  return {
    key, branch: `codex/slack-${key}`, threadTs: event.threadTs,
    slackUrl: `${slackWorkspaceUrl}/archives/${slackChannelId}/p${event.threadTs.replace(".", "")}`,
  };
}

export function threadIdFor(event: AgentEvent) {
  const h = sha256(`flakey-thread:${scopeFor(event).key}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function assertPublishPath(path: string) {
  if (!path || path.startsWith("/") || path.includes("\\") || /[\x00-\x1f]/.test(path) ||
      path.split("/").some(part => part === ".." || part === "." || part === "") ||
      /(^|\/)(\.git|\.env(?:\..*)?|node_modules|\.flakey)(\/|$)/.test(path) ||
      path.startsWith("agents/pr-agent/") || path.startsWith(".github/workflows/")) {
    throw new Error(`Publication is not allowed for path: ${path}`);
  }
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
