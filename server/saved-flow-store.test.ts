import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { STUDIO_VIEWPORT, type StudioSavedFlow } from "../src/studio/types";
import { SavedFlowStore } from "./saved-flow-store";

const RECORDED_AT = "2026-07-18T09:00:00.000Z";
const CREATED_AT = "2026-07-18T09:05:00.000Z";
const UPDATED_AT = "2026-07-18T09:10:00.000Z";

function savedFlow(overrides: Partial<StudioSavedFlow> = {}): StudioSavedFlow {
  const flow: StudioSavedFlow = {
    schemaVersion: 1,
    id: "flow-1",
    name: "Sign in journey",
    description: "Recorded inside Test Studio",
    sourceSessionId: "session-1",
    runtime: "local",
    semanticEnrichmentEnabled: true,
    viewport: STUDIO_VIEWPORT,
    initialUrl: "https://example.test/sign-in",
    finalUrl: "https://example.test/dashboard",
    pageTitle: "Dashboard",
    actionCount: 1,
    assertionCount: 0,
    screenshotCount: 2,
    enrichedActionCount: 1,
    recordedAt: RECORDED_AT,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
    actions: [
      {
        id: "action-1",
        kind: "navigate",
        createdAt: RECORDED_AT,
        url: "https://example.test/sign-in",
        label: "Navigate to sign in",
        screenshotAvailable: true,
        targetUrl: "https://example.test/sign-in",
      },
    ],
    semanticEnrichments: {
      "action-1": {
        provider: "openai",
        model: "gpt-5.6",
        requestedAt: RECORDED_AT,
        status: "ready",
        completedAt: CREATED_AT,
        intent: "Open the sign-in page",
        targetRole: "page",
        journeyStage: "authentication",
        expectedOutcome: "The sign-in form is visible",
        visualFallback: "Find the form headed Sign in",
        confidence: 0.98,
        evidence: ["Sign in heading"],
        actionRisk: "routine",
        requiresConfirmation: false,
      },
    },
    evidence: {
      console: [],
      pageErrors: [],
      networkErrors: [],
      actionScreenshotIds: ["action-1"],
    },
    visualDataset: {
      schemaVersion: 1,
      sessionId: "session-1",
      createdAt: CREATED_AT,
      cases: [],
    },
    generatedCode: "test('sign in', async ({ page }) => {});",
  };

  return { ...flow, ...overrides };
}

describe("SavedFlowStore", () => {
  let directory = "";
  let databasePath = "";
  let store: SavedFlowStore | undefined;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "flakey-saved-flow-store-"));
    databasePath = join(directory, "studio.sqlite");
    store = new SavedFlowStore(databasePath);
  });

  afterEach(async () => {
    store?.close();
    store = undefined;
    await rm(directory, { force: true, recursive: true });
  });

  test("persists flow metadata, payload, and screenshots across reopening", () => {
    const flow = savedFlow();
    const beforeImage = new Uint8Array([0xff, 0xd8, 0x01, 0xff, 0xd9]);
    const afterImage = new Uint8Array([0xff, 0xd8, 0x02, 0xff, 0xd9]);

    expect(store?.save(flow, [
      { actionId: "action-1", phase: "before", image: beforeImage },
      { actionId: "action-1", phase: "after", image: afterImage },
    ])).toEqual(flow);

    store?.close();
    store = new SavedFlowStore(databasePath);

    expect(store.list()).toEqual([
      {
        id: flow.id,
        name: flow.name,
        description: flow.description,
        initialUrl: flow.initialUrl,
        finalUrl: flow.finalUrl,
        pageTitle: flow.pageTitle,
        actionCount: flow.actionCount,
        assertionCount: flow.assertionCount,
        screenshotCount: flow.screenshotCount,
        enrichedActionCount: flow.enrichedActionCount,
        recordedAt: flow.recordedAt,
        createdAt: flow.createdAt,
        updatedAt: flow.updatedAt,
      },
    ]);
    expect(store.get(flow.id)).toEqual(flow);
    expect(store.screenshot(flow.id, "action-1", "before")).toEqual(beforeImage);
    expect(store.screenshot(flow.id, "action-1", "after")).toEqual(afterImage);
  });

  test("updates a flow and replaces its screenshot set atomically", () => {
    const original = savedFlow();
    store?.save(original, [
      {
        actionId: "action-1",
        phase: "before",
        image: new Uint8Array([1, 2, 3]),
      },
    ]);

    const updated = savedFlow({
      name: "Updated sign in journey",
      description: undefined,
      finalUrl: "https://example.test/account",
      pageTitle: "Account",
      screenshotCount: 1,
      enrichedActionCount: 0,
      updatedAt: "2026-07-18T10:00:00.000Z",
      semanticEnrichments: {},
      generatedCode: "test('account', async ({ page }) => {});",
    });
    const replacementImage = new Uint8Array([9, 8, 7]);

    store?.save(updated, [
      {
        actionId: "action-1",
        phase: "after",
        image: replacementImage,
      },
    ]);

    expect(store?.list()).toHaveLength(1);
    expect(store?.list()[0]).toMatchObject({
      id: original.id,
      name: updated.name,
      description: undefined,
      finalUrl: updated.finalUrl,
      screenshotCount: 1,
      updatedAt: updated.updatedAt,
    });
    expect(store?.get(original.id)).toEqual(updated);
    expect(store?.screenshot(original.id, "action-1", "before")).toBeNull();
    expect(store?.screenshot(original.id, "action-1", "after")).toEqual(
      replacementImage,
    );
  });

  test("deletes a flow with its screenshots and reports missing records", () => {
    const flow = savedFlow();
    store?.save(flow, [
      {
        actionId: "action-1",
        phase: "before",
        image: new Uint8Array([4, 5, 6]),
      },
    ]);

    expect(store?.delete(flow.id)).toBe(true);
    expect(store?.get(flow.id)).toBeNull();
    expect(store?.screenshot(flow.id, "action-1", "before")).toBeNull();
    expect(store?.delete(flow.id)).toBe(false);
    expect(store?.get("missing-flow")).toBeNull();
    expect(
      store?.screenshot("missing-flow", "missing-action", "after"),
    ).toBeNull();
  });
});
