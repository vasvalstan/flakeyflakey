import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { STUDIO_VIEWPORT, type StudioFillAction } from "../src/studio/types";
import { StudioService, StudioServiceError } from "./studio-service";

const target = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    if (new URL(request.url).pathname === "/questionnaire") {
      return new Response(Bun.file(new URL("../public/demo-questionnaire.html", import.meta.url)), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    return new Response(`<!doctype html>
      <html lang="en">
        <head><title>Studio fixture</title></head>
        <body>
          <button style="position:absolute;left:20px;top:20px;width:160px;height:42px"
            onclick="document.querySelector('#result').textContent='Done'">Complete flow</button>
          <label style="position:absolute;left:20px;top:82px">Password
            <input type="password" style="width:180px;height:36px" />
          </label>
          <p id="result" style="position:absolute;left:20px;top:140px"></p>
          <label for="display-name" style="position:absolute;left:20px;top:190px">Display name</label>
          <input id="display-name" style="position:absolute;left:20px;top:215px;width:180px;height:36px" />
        </body>
      </html>`, { headers: { "content-type": "text/html" } });
  },
});

const service = new StudioService();
let sessionId = "";

beforeAll(async () => {
  const session = await service.createSession(target.url.toString());
  sessionId = session.id;
});

afterAll(async () => {
  await service.close();
  await target.stop(true);
});

describe("StudioService", () => {
  test("rejects unsafe target schemes", async () => {
    await expect(service.createSession("file:///etc/passwd")).rejects.toBeInstanceOf(StudioServiceError);
  });

  test("records, redacts, generates, and replays a semantic flow", async () => {
    const initialFrame = await service.currentFrame(sessionId);
    expect(initialFrame.frameRevision).toBe(1);

    await service.setRecording(sessionId, true);
    const click = await service.input(sessionId, {
      frameRevision: initialFrame.frameRevision,
      kind: "click",
      viewport: STUDIO_VIEWPORT,
      x: 100,
      y: 41,
    });
    expect(click.action?.kind).toBe("click");
    if (click.action?.kind === "click") {
      expect(click.action.locator.strategy).toBe("role");
      expect(click.action.locator.unique).toBe(true);
      const dataset = service.visualDataset(sessionId);
      const visualCase = dataset.cases.find((item) => item.actionId === click.action?.id);
      expect(dataset.schemaVersion).toBe(1);
      expect(visualCase?.actionKind).toBe("click");
      expect(visualCase?.source).toBe("recorder");
      expect(visualCase?.targetBox?.width).toBeGreaterThan(0);
      expect(visualCase?.targetBox?.height).toBeGreaterThan(0);
      expect(visualCase?.beforeScreenshotAvailable).toBe(true);
      expect(visualCase?.afterScreenshotAvailable).toBe(true);
      expect(service.actionScreenshot(sessionId, click.action.id, "before").byteLength).toBeGreaterThan(0);
      expect(service.actionScreenshot(sessionId, click.action.id, "after").byteLength).toBeGreaterThan(0);
    }

    await service.addAssertion(sessionId, { kind: "textVisible", text: "Done" });
    const passwordFrame = await service.currentFrame(sessionId);
    await service.input(sessionId, {
      frameRevision: passwordFrame.frameRevision,
      kind: "click",
      viewport: STUDIO_VIEWPORT,
      x: 120,
      y: 110,
    });
    const typed = await service.input(sessionId, { kind: "text", text: "sk-secret_123456789012" });
    expect(typed.action?.kind).toBe("fill");
    const fill = typed.action as StudioFillAction;
    expect(fill.sensitive).toBe(true);
    expect(fill.value).toBe("[redacted]");
    expect(service.visualDataset(sessionId).cases.some((item) => item.actionId === fill.id)).toBe(false);
    expect(() => service.actionScreenshot(sessionId, fill.id, "before")).toThrow(StudioServiceError);

    const scrollFrame = await service.currentFrame(sessionId);
    await service.input(sessionId, {
      deltaX: 0,
      deltaY: 240,
      frameRevision: scrollFrame.frameRevision,
      kind: "scroll",
      viewport: STUDIO_VIEWPORT,
    });
    await service.setRecording(sessionId, false);

    const code = service.generateCode(sessionId);
    expect(code).toContain('import { test, expect } from "@playwright/test"');
    expect(code).toContain("process.env.FLAKEY_SECRET_1");
    expect(code).not.toContain("sk-secret_123456789012");
    expect(code).not.toContain("page.mouse.wheel");

    const replay = await service.replay(sessionId);
    expect(replay.status).toBe("passed");
    expect(replay.steps.every((step) => step.status === "passed")).toBe(true);
  }, 20_000);

  test("rejects coordinates from a stale frame", async () => {
    const session = await service.getSession(sessionId);
    await expect(service.input(sessionId, {
      frameRevision: Math.max(1, session.frameRevision - 1),
      kind: "click",
      viewport: STUDIO_VIEWPORT,
      x: 100,
      y: 41,
    })).rejects.toMatchObject({ code: "STALE_FRAME", status: 409 });
  });

  test("keeps the original before frame when consecutive text coalesces", async () => {
    const coalescedSession = await service.createSession(target.url.toString());
    try {
      const frame = await service.currentFrame(coalescedSession.id);
      await service.setRecording(coalescedSession.id, true);
      await service.input(coalescedSession.id, {
        frameRevision: frame.frameRevision,
        kind: "click",
        viewport: STUDIO_VIEWPORT,
        x: 100,
        y: 233,
      });
      const first = await service.input(coalescedSession.id, { kind: "text", text: "Ada" });
      expect(first.action?.kind).toBe("fill");
      const actionId = first.action!.id;
      const originalBefore = service.actionScreenshot(coalescedSession.id, actionId, "before");

      const second = await service.input(coalescedSession.id, { kind: "text", text: " Lovelace" });
      expect(second.action?.id).toBe(actionId);
      expect(service.actionScreenshot(coalescedSession.id, actionId, "before")).toEqual(originalBefore);
      expect(service.visualDataset(coalescedSession.id).cases.filter((item) => item.actionId === actionId)).toHaveLength(1);
    } finally {
      await service.deleteSession(coalescedSession.id);
    }
  });

  test("compiles and executes an approved questionnaire profile without submitting", async () => {
    const questionnaireUrl = new URL("/questionnaire?variant=phq-8", target.url);
    const questionnaireSession = await service.createSession(questionnaireUrl.toString());

    try {
      const plan = await service.planQuestionnaire(
        questionnaireSession.id,
        "Complete PHQ-8 using the mild test profile. Do not submit.",
      );
      expect(plan.status).toBe("ready");
      expect(plan.questionnaireId).toBe("phq-8");
      expect(plan.profileId).toBe("mild");
      expect(plan.submitRequested).toBe(false);
      expect(plan.steps).toHaveLength(8);

      const result = await service.executeQuestionnaire(questionnaireSession.id, {
        planId: plan.id,
      });
      expect(result.status).toBe("completed");
      expect(result.filledCount).toBe(8);
      expect(result.submitted).toBe(false);
      expect(result.actionsRecorded).toBe(8);
      expect(result.visualCasesCaptured).toBe(8);
      expect(result.session.actions.filter((action) => action.commandPlanId === plan.id)).toHaveLength(8);
      expect(result.session.actions.every((action) => action.source === "questionnaire")).toBe(true);
      expect(result.session.actions.every((action) =>
        action.kind === "click"
        && action.locator.strategy === "testId"
        && action.locator.unique
      )).toBe(true);
      const dataset = service.visualDataset(questionnaireSession.id);
      expect(dataset.cases).toHaveLength(8);
      expect(dataset.cases.every((item) =>
        item.source === "questionnaire"
        && item.actionKind === "click"
        && Boolean(item.targetBox)
        && item.targetBox!.width >= 40
        && item.targetBox!.height >= 40
        && item.targetBox!.x >= 0
        && item.targetBox!.y >= 0
        && item.targetBox!.x + item.targetBox!.width <= item.targetBox!.viewport.width
        && item.targetBox!.y + item.targetBox!.height <= item.targetBox!.viewport.height
        && item.beforeScreenshotAvailable
        && item.afterScreenshotAvailable
      )).toBe(true);
      expect(dataset.cases.every((item) => {
        const action = result.session.actions.find((candidate) => candidate.id === item.actionId);
        const box = item.targetBox;
        return action?.kind === "click"
          && Boolean(box)
          && action.x >= box!.x
          && action.x <= box!.x + box!.width
          && action.y >= box!.y
          && action.y <= box!.y + box!.height;
      })).toBe(true);
      expect(dataset.cases.every((item) =>
        service.actionScreenshot(questionnaireSession.id, item.actionId, "before").byteLength > 0
        && service.actionScreenshot(questionnaireSession.id, item.actionId, "after").byteLength > 0
      )).toBe(true);

      await service.addAssertion(questionnaireSession.id, {
        kind: "textVisible",
        text: "8 of 8 answered",
      });
      const replay = await service.replay(questionnaireSession.id);
      expect(replay.status).toBe("passed");
    } finally {
      await service.deleteSession(questionnaireSession.id);
    }
  }, 30_000);

  test("requires a second confirmation before a questionnaire submission", async () => {
    const questionnaireUrl = new URL("/questionnaire?variant=phq-9", target.url);
    const questionnaireSession = await service.createSession(questionnaireUrl.toString());

    try {
      const plan = await service.planQuestionnaire(
        questionnaireSession.id,
        "Complete PHQ-9 using the severe synthetic profile and submit.",
      );
      expect(plan.status).toBe("needs-confirmation");
      expect(plan.steps).toHaveLength(9);

      await expect(service.executeQuestionnaire(questionnaireSession.id, {
        planId: plan.id,
      })).rejects.toMatchObject({
        code: "SUBMIT_CONFIRMATION_REQUIRED",
        status: 409,
      });

      const result = await service.executeQuestionnaire(questionnaireSession.id, {
        confirmSubmit: true,
        planId: plan.id,
      });
      expect(result.filledCount).toBe(9);
      expect(result.submitted).toBe(true);
      expect(result.actionsRecorded).toBe(10);
      expect(result.visualCasesCaptured).toBe(10);

      await service.addAssertion(questionnaireSession.id, {
        kind: "textVisible",
        text: "Responses ready for review",
      });
      const replay = await service.replay(questionnaireSession.id);
      expect(replay.status).toBe("passed");
    } finally {
      await service.deleteSession(questionnaireSession.id);
    }
  }, 30_000);
});
