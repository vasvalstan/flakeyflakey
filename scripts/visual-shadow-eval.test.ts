import { describe, expect, test } from "bun:test";

import { summarizeVisualEvaluation, type VisualCaseResult } from "../server/visual-evaluation";
import {
  OPENAI_RESPONSES_ENDPOINT,
  OPENAI_VISUAL_EVALUATION_DEFAULT_MODEL,
  type OpenAIFetch,
} from "../server/openai-visual-evaluator";
import {
  buildBeforeScreenshotUrl,
  buildBoundedVisualShadowReport,
  buildVisualDatasetUrl,
  EXTERNAL_UPLOAD_CONFIRMATION_NOTICE,
  isEligibleVisualCase,
  normalizeStudioApiBase,
  parseVisualShadowEvalArgs,
  runVisualShadowEval,
  validateStudioVisualDataset,
} from "./visual-shadow-eval";

const validCase = {
  actionId: "action-1",
  actionKind: "click",
  afterScreenshotAvailable: true,
  beforeScreenshotAvailable: true,
  caseId: "case-1",
  createdAt: "2026-07-18T12:00:00.000Z",
  frameRevisionBefore: 5,
  intent: "Click the continue button",
  pageUrl: "https://private.example.test/questionnaire",
  sessionId: "session-1",
  source: "recorder",
  targetBox: {
    height: 50,
    viewport: { height: 720, width: 1280 },
    width: 200,
    x: 100,
    y: 200,
  },
  targetLabel: "Continue",
} as const;

function result(overrides: Partial<VisualCaseResult> = {}): VisualCaseResult {
  return {
    abstained: false,
    actionId: "action-1",
    boxComparable: true,
    caseId: "case-1",
    centerDistancePx: 0,
    centerWithin32Px: true,
    confidence: 0.95,
    exactActionKindMatch: true,
    iou: 1,
    iouAtLeast50: true,
    normalizedCenterDistance: 0,
    sessionId: "session-1",
    shadowMode: true,
    unsafeAction: false,
    ...overrides,
  };
}

describe("visual shadow CLI argument parsing", () => {
  test("requires explicit upload confirmation before accepting the run", () => {
    expect(() => parseVisualShadowEvalArgs(["--session", "session-1"]))
      .toThrow(EXTERNAL_UPLOAD_CONFIRMATION_NOTICE);
  });

  test("uses safe defaults and the adapter default model", () => {
    const args = parseVisualShadowEvalArgs([
      "--session",
      "session-1",
      "--confirm-external-upload",
    ]);

    expect(args).toEqual({
      baseUrl: "http://127.0.0.1:8787/api/studio",
      confirmExternalUpload: true,
      maxCases: 20,
      model: OPENAI_VISUAL_EVALUATION_DEFAULT_MODEL,
      sessionId: "session-1",
    });
  });

  test("uses OPENAI_VISUAL_MODEL without accepting an API key argument", () => {
    const args = parseVisualShadowEvalArgs(
      [
        "--session",
        "session-1",
        "--confirm-external-upload",
        "--max-cases",
        "100",
      ],
      { OPENAI_VISUAL_MODEL: "gpt-5.6-test-snapshot" },
    );
    expect(args.model).toBe("gpt-5.6-test-snapshot");
    expect(args.maxCases).toBe(100);

    const leakedSecret = "sk-should-never-be-echoed";
    try {
      parseVisualShadowEvalArgs([
        "--session",
        "session-1",
        "--confirm-external-upload",
        `--api-key=${leakedSecret}`,
      ]);
      throw new Error("Expected parser to reject the unknown option");
    } catch (error) {
      expect(String(error)).not.toContain(leakedSecret);
    }
  });

  test.each(["0", "101", "1.5", "NaN"])(
    "rejects invalid max-cases value %s",
    (value) => {
      expect(() => parseVisualShadowEvalArgs([
        "--session",
        "session-1",
        "--confirm-external-upload",
        "--max-cases",
        value,
      ])).toThrow("must be an integer from 1 to 100");
    },
  );
});

describe("visual shadow CLI URLs", () => {
  test("accepts either an origin or the exact Studio API base", () => {
    expect(normalizeStudioApiBase("http://127.0.0.1:8787"))
      .toBe("http://127.0.0.1:8787/api/studio");
    expect(normalizeStudioApiBase("https://studio.example.test/api/studio/"))
      .toBe("https://studio.example.test/api/studio");
  });

  test("builds read-only dataset and before-screenshot endpoints", () => {
    expect(buildVisualDatasetUrl("https://studio.example.test", "session:one"))
      .toBe("https://studio.example.test/api/studio/sessions/session%3Aone/visual-dataset");
    expect(buildBeforeScreenshotUrl(
      "https://studio.example.test/api/studio",
      "session:one",
      "action/two",
    )).toBe(
      "https://studio.example.test/api/studio/sessions/session%3Aone/actions/action%2Ftwo/screenshot?phase=before",
    );
  });

  test("rejects credentials, queries, fragments, and unrelated paths", () => {
    for (const value of [
      "https://user:secret@studio.example.test",
      "https://studio.example.test?token=secret",
      "https://studio.example.test/#fragment",
      "https://studio.example.test/api/other",
    ]) {
      expect(() => normalizeStudioApiBase(value)).toThrow();
    }
  });
});

describe("visual dataset validation", () => {
  test("reconstructs validated essentials and identifies eligible cases", () => {
    const dataset = validateStudioVisualDataset({
      cases: [{
        ...validCase,
        locator: {
          selector: "#dom-selector-must-not-be-retained",
        },
      }],
      createdAt: "2026-07-18T12:00:00.000Z",
      schemaVersion: 1,
      sessionId: "session-1",
    }, "session-1");

    expect(dataset.cases).toHaveLength(1);
    expect(dataset.cases[0]).not.toHaveProperty("locator");
    expect(isEligibleVisualCase(dataset.cases[0]!)).toBe(true);
  });

  test("rejects a session mismatch and malformed target geometry", () => {
    expect(() => validateStudioVisualDataset({
      cases: [validCase],
      createdAt: "2026-07-18T12:00:00.000Z",
      schemaVersion: 1,
      sessionId: "another-session",
    }, "session-1")).toThrow("invalid visual dataset");

    expect(() => validateStudioVisualDataset({
      cases: [{
        ...validCase,
        targetBox: {
          ...validCase.targetBox,
          x: 1_200,
          width: 200,
        },
      }],
      createdAt: "2026-07-18T12:00:00.000Z",
      schemaVersion: 1,
      sessionId: "session-1",
    }, "session-1")).toThrow("invalid target box");
  });
});

describe("bounded visual shadow report", () => {
  test("includes aggregate metrics while excluding raw and page-level evidence", () => {
    const summary = summarizeVisualEvaluation([
      result(),
      result({
        abstained: true,
        boxComparable: false,
        centerDistancePx: null,
        centerWithin32Px: false,
        exactActionKindMatch: false,
        iou: null,
        iouAtLeast50: false,
        normalizedCenterDistance: null,
      }),
    ]);
    const report = buildBoundedVisualShadowReport({
      datasetCases: 8,
      eligibleCases: 5,
      failures: [
        "OPENAI_NETWORK_ERROR",
        "unsafe failure contains patient@example.test",
      ],
      maxCases: 4,
      model: "gpt-5.6-test",
      selectedCases: 4,
      sessionId: "session-1",
      summary,
    });
    const output = JSON.stringify(report);

    expect(report).toMatchObject({
      browserActionsExecuted: false,
      cases: {
        attempted: 4,
        dataset: 8,
        eligible: 5,
        failed: 2,
        ineligible: 3,
        limited: 1,
        selected: 4,
        succeeded: 2,
      },
      failures: {
        byCode: [
          { code: "OPENAI_NETWORK_ERROR", count: 1 },
          { code: "UNCLASSIFIED_FAILURE", count: 1 },
        ],
        total: 2,
      },
      metrics: {
        abstentionCount: 1,
        exactActionKindMatchCount: 1,
      },
      predictionsForwardedToExecution: false,
      shadowMode: true,
    });
    expect(report).not.toHaveProperty("results");
    expect(output).not.toContain("patient@example.test");
    expect(output).not.toContain("pageUrl");
    expect(output).not.toContain("rawEvidence");
    expect(output).not.toContain("screenshot");
  });
});

describe("visual shadow pipeline", () => {
  test("reads recorder evidence, scores a model proposal, and never calls an execution endpoint", async () => {
    const requests: Array<{ method: string; url: string; body?: string }> = [];
    const fetchImpl: OpenAIFetch = async (input, init) => {
      const url = input.toString();
      const method = init?.method ?? "GET";
      requests.push({
        body: typeof init?.body === "string" ? init.body : undefined,
        method,
        url,
      });

      if (url.endsWith("/visual-dataset")) {
        return Response.json({
          cases: [{
            ...validCase,
            locator: {
              selector: "#recorded-oracle-must-not-reach-the-model",
            },
          }],
          createdAt: "2026-07-18T12:00:00.000Z",
          schemaVersion: 1,
          sessionId: "session-1",
        });
      }
      if (url.includes("/screenshot?phase=before")) {
        return new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
          headers: { "content-type": "image/jpeg" },
        });
      }
      if (url === OPENAI_RESPONSES_ENDPOINT) {
        return Response.json({
          id: "resp_shadow_pipeline",
          output_text: JSON.stringify({
            action_kind: "click",
            confidence: 0.98,
            evidence: ["The requested control is visible."],
            state: "resolved",
            target_box: {
              height: 50 / 720,
              width: 200 / 1280,
              x: 100 / 1280,
              y: 200 / 720,
            },
          }),
        });
      }
      throw new Error("Unexpected request");
    };
    const args = parseVisualShadowEvalArgs([
      "--session",
      "session-1",
      "--confirm-external-upload",
      "--max-cases",
      "1",
    ]);

    const report = await runVisualShadowEval(args, "test-api-key", fetchImpl);

    expect(report).toMatchObject({
      browserActionsExecuted: false,
      cases: {
        attempted: 1,
        failed: 0,
        selected: 1,
        succeeded: 1,
      },
      metrics: {
        exactActionKindMatchRate: 1,
        iouAtLeast50Rate: 1,
      },
      predictionsForwardedToExecution: false,
      shadowMode: true,
    });
    expect(requests.map(({ method, url }) => ({ method, url }))).toEqual([
      {
        method: "GET",
        url: "http://127.0.0.1:8787/api/studio/sessions/session-1/visual-dataset",
      },
      {
        method: "GET",
        url: "http://127.0.0.1:8787/api/studio/sessions/session-1/actions/action-1/screenshot?phase=before",
      },
      {
        method: "POST",
        url: OPENAI_RESPONSES_ENDPOINT,
      },
    ]);
    const modelRequest = requests.at(-1)?.body ?? "";
    expect(modelRequest).not.toContain("#recorded-oracle-must-not-reach-the-model");
    expect(modelRequest).not.toContain(validCase.pageUrl);
    expect(modelRequest).toContain("\"type\":\"input_image\"");
    expect(requests.some(({ method, url }) =>
      method !== "GET"
      && url.startsWith("http://127.0.0.1:8787/api/studio")
    )).toBe(false);
  });
});
