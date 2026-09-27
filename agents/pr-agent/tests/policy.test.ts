import { describe, expect, test } from "bun:test";
import { assertPublishPath, scopeFor, signEvent, verifyEnvelope, threadIdFor, type AgentEvent } from "../policy";

const event = (): AgentEvent => ({
  kind: "slack", eventId: "E1", teamId: "T123", channelId: "C0C4AMGJEA3",
  threadTs: "123.456", eventTs: "123.456", text: "fix it", userId: "U1", attempt: 0,
});

describe("Slack task scope", () => {
  test("retries and follow-ups keep the branch; other threads get another branch", () => {
    expect(scopeFor(event()).branch).toBe(scopeFor({ ...event(), eventId: "retry" }).branch);
    expect(threadIdFor(event())).not.toBe(threadIdFor({ ...event(), threadTs: "124.456" }));
    expect(scopeFor(event()).slackUrl).toBe("https://valsaifunland.slack.com/archives/C0C4AMGJEA3/p123456");
  });
  test("rejects other channels, DMs, and unverified context", () => {
    const signed = signEvent(event(), "test-secret");
    expect(verifyEnvelope(signed, "test-secret", "T123")).toEqual(event());
    expect(() => verifyEnvelope(signed, "test-secret", "T999")).toThrow();
    expect(() => verifyEnvelope({ ...signed, payload: signed.payload.replace("C0C4AMGJEA3", "COTHER") }, "test-secret", "T123")).toThrow();
    expect(() => verifyEnvelope({ ...signed, signature: "forged" }, "test-secret", "T123")).toThrow();
  });
});

test("publication prevents path traversal, secrets, workflow edits, and agent self-modification", () => {
  for (const path of ["../outside", "/tmp/outside", "src/../../outside", ".env", "src/.env.local", "a\\b", ".git/config", ".github/workflows/ci.yml", "agents/pr-agent/policy.ts", ".flakey/studio.sqlite"]) {
    expect(() => assertPublishPath(path)).toThrow();
  }
  expect(() => assertPublishPath("src/components/SavedFlowPage.tsx")).not.toThrow();
  expect(() => assertPublishPath("e2e/workspace.pw.ts")).not.toThrow();
});
