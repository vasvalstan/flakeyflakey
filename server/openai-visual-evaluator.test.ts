import { describe, expect, test } from "bun:test";

import type { StudioVisualGroundTruthCase } from "../src/studio/types";
import {
  BROWSER_VISUAL_PREDICTION_SCHEMA,
  evaluateStudioVisualCaseWithOpenAI,
  OPENAI_RESPONSES_ENDPOINT,
  OPENAI_VISUAL_EVALUATION_DEFAULT_MODEL,
  OpenAIVisualEvaluatorError,
  type BrowserVisualPrediction,
  type OpenAIFetch,
} from "./openai-visual-evaluator";

const studioCase: StudioVisualGroundTruthCase = {
  actionId: "action-1",
  actionKind: "click",
  afterScreenshotAvailable: true,
  beforeScreenshotAvailable: true,
  caseId: "case-1",
  createdAt: "2026-07-18T12:00:00.000Z",
  frameRevisionBefore: 3,
  intent: "Click the sign in button",
  locator: {
    matchCount: 1,
    score: 100,
    selector: "page.locator('#never-send-this-selector')",
    strategy: "css",
    unique: true,
    value: "#never-send-this-selector",
  },
  pageUrl: "https://portal.example.test/login",
  sessionId: "session-1",
  source: "recorder",
  targetBox: {
    height: 144,
    viewport: { height: 720, width: 1280 },
    width: 256,
    x: 128,
    y: 72,
  },
  targetLabel: "Sign in",
};

const perfectOutput: BrowserVisualPrediction = {
  action_kind: "click",
  confidence: 0.98,
  evidence: ["Button matching the requested sign-in action is visible."],
  state: "resolved",
  target_box: {
    height: 0.2,
    width: 0.2,
    x: 0.1,
    y: 0.1,
  },
};

function responseWithPrediction(
  output: BrowserVisualPrediction | string,
  topLevel = false,
): Response {
  const text = typeof output === "string" ? output : JSON.stringify(output);
  const body = topLevel
    ? { id: "resp_top", output_text: text }
    : {
        id: "resp_nested",
        output: [
          {
            content: [{ text, type: "output_text" }],
            role: "assistant",
            type: "message",
          },
        ],
      };
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

function screenshot(): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
}

describe("OpenAI visual evaluator request", () => {
  test("sends a screenshot-only strict Responses request and scores a perfect prediction", async () => {
    let requestedUrl = "";
    let requestedInit: RequestInit | undefined;
    const fetchImpl: OpenAIFetch = async (input, init) => {
      requestedUrl = input.toString();
      requestedInit = init;
      return responseWithPrediction(perfectOutput);
    };

    const evaluation = await evaluateStudioVisualCaseWithOpenAI({
      apiKey: "test-api-key",
      beforeScreenshot: screenshot(),
      fetchImpl,
      groundTruth: studioCase,
    });

    expect(requestedUrl).toBe(OPENAI_RESPONSES_ENDPOINT);
    expect(requestedInit?.method).toBe("POST");
    expect(new Headers(requestedInit?.headers).get("Authorization")).toBe("Bearer test-api-key");
    expect(new Headers(requestedInit?.headers).get("Content-Type")).toBe("application/json");

    const body = JSON.parse(String(requestedInit?.body)) as {
      model: string;
      store: boolean;
      input: Array<{
        role: string;
        content: Array<Record<string, unknown>>;
      }>;
      text: {
        format: {
          name: string;
          schema: unknown;
          strict: boolean;
          type: string;
        };
      };
    };
    expect(body.model).toBe(OPENAI_VISUAL_EVALUATION_DEFAULT_MODEL);
    expect(body.store).toBe(false);
    expect(body.input).toHaveLength(1);
    expect(body.input[0]?.role).toBe("user");

    const textInput = body.input[0]?.content.find((item) => item.type === "input_text");
    const imageInput = body.input[0]?.content.find((item) => item.type === "input_image");
    expect(textInput?.text).toContain("Intent: Click the sign in button");
    expect(textInput?.text).toContain("Viewport: 1280x720");
    expect(textInput?.text).toContain("No DOM");
    expect(textInput?.text).toContain("selectors");
    expect(JSON.stringify(body)).not.toContain("#never-send-this-selector");
    expect(imageInput?.detail).toBe("original");
    expect(imageInput?.image_url).toMatch(/^data:image\/jpeg;base64,/);

    expect(body.text.format).toMatchObject({
      name: "browser_visual_prediction",
      schema: BROWSER_VISUAL_PREDICTION_SCHEMA,
      strict: true,
      type: "json_schema",
    });
    expect(evaluation).toMatchObject({
      model: "gpt-5.6",
      responseId: "resp_nested",
      shadowMode: true,
      result: {
        centerWithin32Px: true,
        exactActionKindMatch: true,
        iouAtLeast50: true,
        shadowMode: true,
      },
    });
    expect(evaluation.result.iou).toBeCloseTo(1, 10);
    expect(evaluation.rawEvidence).toEqual(perfectOutput);
  });

  test("extracts the top-level output_text convenience field", async () => {
    const evaluation = await evaluateStudioVisualCaseWithOpenAI({
      apiKey: "test-api-key",
      beforeScreenshot: screenshot(),
      fetchImpl: async () => responseWithPrediction(perfectOutput, true),
      groundTruth: studioCase,
      model: "gpt-5.6-snapshot-test",
    });

    expect(evaluation.model).toBe("gpt-5.6-snapshot-test");
    expect(evaluation.responseId).toBe("resp_top");
    expect(evaluation.result.iou).toBeCloseTo(1, 10);
  });

  test("prefers top-level output_text when nested text is also present", async () => {
    const evaluation = await evaluateStudioVisualCaseWithOpenAI({
      apiKey: "test-api-key",
      beforeScreenshot: screenshot(),
      fetchImpl: async () => new Response(JSON.stringify({
        id: "resp_both",
        output_text: JSON.stringify(perfectOutput),
        output: [{
          content: [{ text: "duplicate output must be ignored", type: "output_text" }],
          type: "message",
        }],
      })),
      groundTruth: studioCase,
    });

    expect(evaluation.responseId).toBe("resp_both");
    expect(evaluation.result.iou).toBeCloseTo(1, 10);
  });
});

describe("OpenAI visual evaluator abstention", () => {
  test.each([
    ["ambiguous", "click"],
    ["blocked", "click"],
    ["resolved", "none"],
  ] as const)("maps %s/%s to abstention", async (state, actionKind) => {
    const output: BrowserVisualPrediction = {
      action_kind: actionKind,
      confidence: 0.35,
      evidence: ["Not safe to resolve from pixels alone."],
      state,
      target_box: null,
    };
    const evaluation = await evaluateStudioVisualCaseWithOpenAI({
      apiKey: "test-api-key",
      beforeScreenshot: screenshot(),
      fetchImpl: async () => responseWithPrediction(output),
      groundTruth: studioCase,
    });

    expect(evaluation.prediction.abstained).toBe(true);
    expect(evaluation.result.abstained).toBe(true);
    expect(evaluation.result.exactActionKindMatch).toBe(false);
    expect(evaluation.result.iou).toBeNull();
  });
});

describe("OpenAI visual evaluator validation", () => {
  test("rejects malformed JSON output", async () => {
    const promise = evaluateStudioVisualCaseWithOpenAI({
      apiKey: "test-api-key",
      beforeScreenshot: screenshot(),
      fetchImpl: async () => responseWithPrediction("{not-json"),
      groundTruth: studioCase,
    });

    await expect(promise).rejects.toMatchObject({
      code: "MALFORMED_RESPONSE",
    });
  });

  test("rejects range-invalid target boxes", async () => {
    const promise = evaluateStudioVisualCaseWithOpenAI({
      apiKey: "test-api-key",
      beforeScreenshot: screenshot(),
      fetchImpl: async () => responseWithPrediction(JSON.stringify({
        ...perfectOutput,
        target_box: {
          height: 0.2,
          width: 0.4,
          x: 0.8,
          y: 0.1,
        },
      })),
      groundTruth: studioCase,
    });

    await expect(promise).rejects.toMatchObject({
      code: "MALFORMED_RESPONSE",
    });
  });

  test("redacts upstream API error bodies while retaining safe status and code", async () => {
    const promise = evaluateStudioVisualCaseWithOpenAI({
      apiKey: "test-api-key",
      beforeScreenshot: screenshot(),
      fetchImpl: async () => new Response(JSON.stringify({
        error: {
          code: "rate_limit_exceeded",
          message: "secret upstream diagnostic must not escape",
        },
      }), { status: 429 }),
      groundTruth: studioCase,
    });

    try {
      await promise;
      throw new Error("Expected the evaluation to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(OpenAIVisualEvaluatorError);
      const evaluatorError = error as OpenAIVisualEvaluatorError;
      expect(evaluatorError).toMatchObject({
        code: "OPENAI_API_ERROR",
        status: 429,
        upstreamCode: "rate_limit_exceeded",
      });
      expect(evaluatorError.message).toContain("HTTP 429");
      expect(evaluatorError.message).not.toContain("secret upstream diagnostic");
    }
  });

  test("requires a nonempty API key before calling fetch", async () => {
    let calls = 0;
    const promise = evaluateStudioVisualCaseWithOpenAI({
      apiKey: "   ",
      beforeScreenshot: screenshot(),
      fetchImpl: async () => {
        calls += 1;
        return responseWithPrediction(perfectOutput);
      },
      groundTruth: studioCase,
    });

    await expect(promise).rejects.toMatchObject({ code: "MISSING_API_KEY" });
    expect(calls).toBe(0);
  });

  test("requires both recorded availability and nonempty before screenshot bytes", async () => {
    let calls = 0;
    const fetchImpl: OpenAIFetch = async () => {
      calls += 1;
      return responseWithPrediction(perfectOutput);
    };
    const unavailable = evaluateStudioVisualCaseWithOpenAI({
      apiKey: "test-api-key",
      beforeScreenshot: screenshot(),
      fetchImpl,
      groundTruth: {
        ...studioCase,
        beforeScreenshotAvailable: false,
      },
    });
    const empty = evaluateStudioVisualCaseWithOpenAI({
      apiKey: "test-api-key",
      beforeScreenshot: new Uint8Array(),
      fetchImpl,
      groundTruth: studioCase,
    });

    await expect(unavailable).rejects.toMatchObject({ code: "MISSING_SCREENSHOT" });
    await expect(empty).rejects.toMatchObject({ code: "MISSING_SCREENSHOT" });
    expect(calls).toBe(0);
  });
});
