import type { StudioVisualGroundTruthCase } from "../src/studio/types";
import {
  evaluateVisualPrediction,
  type NormalizedBoundingBox,
  type ViewportBoundingBox,
  type VisualActionKind,
  type VisualCaseResult,
  type VisualGroundTruthCase,
  type VisualPrediction,
} from "./visual-evaluation";

export const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
export const OPENAI_VISUAL_EVALUATION_DEFAULT_MODEL = "gpt-5.6";

export const BROWSER_VISUAL_PREDICTION_SCHEMA = {
  additionalProperties: false,
  properties: {
    action_kind: {
      enum: ["click", "fill", "select", "press", "none"],
      type: "string",
    },
    confidence: {
      maximum: 1,
      minimum: 0,
      type: "number",
    },
    evidence: {
      items: { type: "string" },
      maxItems: 8,
      type: "array",
    },
    state: {
      enum: ["resolved", "ambiguous", "blocked"],
      type: "string",
    },
    target_box: {
      anyOf: [
        {
          additionalProperties: false,
          properties: {
            height: { maximum: 1, minimum: 0, type: "number" },
            width: { maximum: 1, minimum: 0, type: "number" },
            x: { maximum: 1, minimum: 0, type: "number" },
            y: { maximum: 1, minimum: 0, type: "number" },
          },
          required: ["x", "y", "width", "height"],
          type: "object",
        },
        { type: "null" },
      ],
    },
  },
  required: ["state", "action_kind", "target_box", "confidence", "evidence"],
  type: "object",
} as const;

export type BrowserVisualPredictionState = "resolved" | "ambiguous" | "blocked";
export type BrowserVisualPredictionAction = "click" | "fill" | "select" | "press" | "none";
export type ScreenshotMediaType = "image/jpeg" | "image/png" | "image/webp";
export type ScreenshotInput = string | Uint8Array | ArrayBuffer;

export interface BrowserVisualPrediction {
  state: BrowserVisualPredictionState;
  action_kind: BrowserVisualPredictionAction;
  target_box: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
  confidence: number;
  evidence: string[];
}

export type OpenAIFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface OpenAIVisualEvaluationOptions {
  apiKey: string;
  groundTruth: StudioVisualGroundTruthCase;
  beforeScreenshot: ScreenshotInput;
  screenshotMediaType?: ScreenshotMediaType;
  model?: string;
  fetchImpl?: OpenAIFetch;
}

export interface OpenAIVisualEvaluation {
  model: string;
  responseId?: string;
  prediction: VisualPrediction;
  result: VisualCaseResult;
  /** The validated model output retained for audit, never for execution. */
  rawEvidence: BrowserVisualPrediction;
  shadowMode: true;
}

export type OpenAIVisualEvaluatorErrorCode =
  | "INVALID_GROUND_TRUTH"
  | "MALFORMED_RESPONSE"
  | "MISSING_API_KEY"
  | "MISSING_SCREENSHOT"
  | "OPENAI_API_ERROR"
  | "OPENAI_NETWORK_ERROR";

export class OpenAIVisualEvaluatorError extends Error {
  readonly code: OpenAIVisualEvaluatorErrorCode;
  readonly status?: number;
  readonly upstreamCode?: string;

  constructor(
    message: string,
    code: OpenAIVisualEvaluatorErrorCode,
    options: { status?: number; upstreamCode?: string } = {},
  ) {
    super(message);
    this.name = "OpenAIVisualEvaluatorError";
    this.code = code;
    this.status = options.status;
    this.upstreamCode = options.upstreamCode;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(record: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(record).every((key) => allowed.has(key));
}

function isFiniteInRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number"
    && Number.isFinite(value)
    && value >= minimum
    && value <= maximum;
}

function isPositiveViewport(
  viewport: { width: number; height: number },
): boolean {
  return Number.isFinite(viewport.width)
    && Number.isFinite(viewport.height)
    && viewport.width > 0
    && viewport.height > 0;
}

function invalidGroundTruth(message: string): never {
  throw new OpenAIVisualEvaluatorError(message, "INVALID_GROUND_TRUTH");
}

function toEvaluatorGroundTruth(studioCase: StudioVisualGroundTruthCase): VisualGroundTruthCase {
  const target = studioCase.targetBox;
  if (!target) {
    return invalidGroundTruth("Visual ground truth requires a recorded target box");
  }
  if (!isPositiveViewport(target.viewport)) {
    return invalidGroundTruth("Visual ground truth requires a valid viewport");
  }

  const targetBox: ViewportBoundingBox = {
    coordinateSpace: "viewport",
    height: target.height,
    viewport: {
      height: target.viewport.height,
      width: target.viewport.width,
    },
    width: target.width,
    x: target.x,
    y: target.y,
  };

  return {
    actionId: studioCase.actionId,
    actionKind: studioCase.actionKind,
    caseId: studioCase.caseId,
    intent: studioCase.intent,
    screenshots: {
      after: `studio://${studioCase.sessionId}/${studioCase.actionId}/after`,
      before: `studio://${studioCase.sessionId}/${studioCase.actionId}/before`,
    },
    sessionId: studioCase.sessionId,
    targetBox,
    targetSemanticLabel: studioCase.targetLabel ?? studioCase.intent,
    viewport: {
      height: target.viewport.height,
      width: target.viewport.width,
    },
  };
}

function isBase64(value: string): boolean {
  return value.length > 0
    && value.length % 4 === 0
    && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function screenshotDataUrl(
  screenshot: ScreenshotInput,
  mediaType: ScreenshotMediaType,
): string {
  if (typeof screenshot === "string") {
    const trimmed = screenshot.trim();
    const dataUrlMatch = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(trimmed);
    if (dataUrlMatch) {
      return isBase64(dataUrlMatch[1]) ? trimmed : missingScreenshot();
    }
    return isBase64(trimmed) ? `data:${mediaType};base64,${trimmed}` : missingScreenshot();
  }

  const bytes = screenshot instanceof ArrayBuffer
    ? new Uint8Array(screenshot)
    : screenshot;
  if (bytes.byteLength === 0) {
    return missingScreenshot();
  }
  return `data:${mediaType};base64,${Buffer.from(bytes).toString("base64")}`;
}

function missingScreenshot(): never {
  throw new OpenAIVisualEvaluatorError(
    "A nonempty before screenshot is required",
    "MISSING_SCREENSHOT",
  );
}

function visualPrompt(studioCase: StudioVisualGroundTruthCase): string {
  const viewport = studioCase.targetBox?.viewport;
  if (!viewport) {
    return invalidGroundTruth("Visual ground truth requires a recorded viewport");
  }

  return [
    "Shadow perception only; do not execute any browser action.",
    `Intent: ${studioCase.intent}`,
    `Viewport: ${viewport.width}x${viewport.height} CSS pixels.`,
    "Use screenshot pixels only. No DOM, HTML, accessibility tree, locators, CSS, or selectors are provided.",
    "If resolved, return the intended action and its target rectangle normalized to 0..1.",
    "If the target is ambiguous, occluded, absent, or unsafe to resolve, abstain with ambiguous or blocked.",
  ].join("\n");
}

function collectOutputText(response: Record<string, unknown>): string[] {
  if (typeof response.output_text === "string" && response.output_text.length > 0) {
    return [response.output_text];
  }

  const texts: string[] = [];
  if (!Array.isArray(response.output)) {
    return texts;
  }

  for (const outputItem of response.output) {
    if (!isRecord(outputItem)) {
      continue;
    }
    if (outputItem.type === "output_text"
      && typeof outputItem.text === "string"
      && outputItem.text.length > 0) {
      texts.push(outputItem.text);
    }
    if (!Array.isArray(outputItem.content)) {
      continue;
    }
    for (const contentItem of outputItem.content) {
      if (isRecord(contentItem)
        && contentItem.type === "output_text"
        && typeof contentItem.text === "string"
        && contentItem.text.length > 0) {
        texts.push(contentItem.text);
      }
    }
  }
  return texts;
}

/**
 * Extracts completed output text from either the raw top-level convenience
 * field or Responses output-message content blocks.
 */
export function extractOpenAIResponseOutputText(response: unknown): string {
  if (!isRecord(response)) {
    throw new OpenAIVisualEvaluatorError(
      "OpenAI returned a malformed Responses payload",
      "MALFORMED_RESPONSE",
    );
  }

  const texts = collectOutputText(response);
  if (texts.length === 0) {
    throw new OpenAIVisualEvaluatorError(
      "OpenAI returned no visual prediction output",
      "MALFORMED_RESPONSE",
    );
  }
  return texts.join("");
}

function parseTargetBox(value: unknown): BrowserVisualPrediction["target_box"] {
  if (value === null) {
    return null;
  }
  if (!isRecord(value)
    || !hasOnlyKeys(value, ["x", "y", "width", "height"])
    || !isFiniteInRange(value.x, 0, 1)
    || !isFiniteInRange(value.y, 0, 1)
    || !isFiniteInRange(value.width, 0, 1)
    || !isFiniteInRange(value.height, 0, 1)
    || value.width <= 0
    || value.height <= 0
    || value.x + value.width > 1
    || value.y + value.height > 1) {
    throw new OpenAIVisualEvaluatorError(
      "OpenAI returned an invalid normalized target box",
      "MALFORMED_RESPONSE",
    );
  }

  return {
    height: value.height,
    width: value.width,
    x: value.x,
    y: value.y,
  };
}

export function parseBrowserVisualPrediction(outputText: string): BrowserVisualPrediction {
  let value: unknown;
  try {
    value = JSON.parse(outputText);
  } catch {
    throw new OpenAIVisualEvaluatorError(
      "OpenAI returned invalid visual prediction JSON",
      "MALFORMED_RESPONSE",
    );
  }

  if (!isRecord(value)
    || !hasOnlyKeys(value, ["state", "action_kind", "target_box", "confidence", "evidence"])) {
    throw new OpenAIVisualEvaluatorError(
      "OpenAI returned a malformed visual prediction",
      "MALFORMED_RESPONSE",
    );
  }

  const states: readonly BrowserVisualPredictionState[] = ["resolved", "ambiguous", "blocked"];
  const actions: readonly BrowserVisualPredictionAction[] = ["click", "fill", "select", "press", "none"];
  if (typeof value.state !== "string"
    || !states.includes(value.state as BrowserVisualPredictionState)
    || typeof value.action_kind !== "string"
    || !actions.includes(value.action_kind as BrowserVisualPredictionAction)
    || !isFiniteInRange(value.confidence, 0, 1)
    || !Array.isArray(value.evidence)
    || value.evidence.length > 8
    || !value.evidence.every((item): item is string =>
      typeof item === "string" && item.length <= 240
    )) {
    throw new OpenAIVisualEvaluatorError(
      "OpenAI returned invalid visual prediction fields",
      "MALFORMED_RESPONSE",
    );
  }

  return {
    action_kind: value.action_kind as BrowserVisualPredictionAction,
    confidence: value.confidence,
    evidence: value.evidence,
    state: value.state as BrowserVisualPredictionState,
    target_box: parseTargetBox(value.target_box),
  };
}

function toVisualPrediction(raw: BrowserVisualPrediction): VisualPrediction {
  const targetBox: NormalizedBoundingBox | null = raw.target_box
    ? {
        coordinateSpace: "normalized",
        height: raw.target_box.height,
        width: raw.target_box.width,
        x: raw.target_box.x,
        y: raw.target_box.y,
      }
    : null;
  const actionKind: VisualActionKind | null = raw.action_kind === "none"
    ? null
    : raw.action_kind;

  return {
    abstained: raw.state !== "resolved" || raw.action_kind === "none",
    actionKind,
    confidence: raw.confidence,
    targetBox,
    unsafeAction: false,
  };
}

function safeUpstreamCode(responseBody: unknown): string | undefined {
  if (!isRecord(responseBody) || !isRecord(responseBody.error)) {
    return undefined;
  }
  const code = responseBody.error.code;
  return typeof code === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(code)
    ? code
    : undefined;
}

async function apiFailure(response: Response): Promise<never> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  const upstreamCode = safeUpstreamCode(body);
  const codeSuffix = upstreamCode ? ` (${upstreamCode})` : "";
  throw new OpenAIVisualEvaluatorError(
    `OpenAI Responses API returned HTTP ${response.status}${codeSuffix}`,
    "OPENAI_API_ERROR",
    { status: response.status, upstreamCode },
  );
}

/**
 * Runs one screenshot-only OpenAI perception request and scores it in shadow
 * mode. The returned prediction is audit data and is never executed.
 */
export async function evaluateStudioVisualCaseWithOpenAI(
  options: OpenAIVisualEvaluationOptions,
): Promise<OpenAIVisualEvaluation> {
  const apiKey = options.apiKey.trim();
  if (!apiKey) {
    throw new OpenAIVisualEvaluatorError(
      "A nonempty OpenAI API key is required",
      "MISSING_API_KEY",
    );
  }
  if (!options.groundTruth.beforeScreenshotAvailable) {
    return missingScreenshot();
  }

  const evaluatorGroundTruth = toEvaluatorGroundTruth(options.groundTruth);
  const imageUrl = screenshotDataUrl(
    options.beforeScreenshot,
    options.screenshotMediaType ?? "image/jpeg",
  );
  const model = options.model?.trim() || OPENAI_VISUAL_EVALUATION_DEFAULT_MODEL;
  const requestBody = {
    input: [
      {
        content: [
          {
            text: visualPrompt(options.groundTruth),
            type: "input_text",
          },
          {
            detail: "original",
            image_url: imageUrl,
            type: "input_image",
          },
        ],
        role: "user",
      },
    ],
    max_output_tokens: 500,
    model,
    store: false,
    text: {
      format: {
        name: "browser_visual_prediction",
        schema: BROWSER_VISUAL_PREDICTION_SCHEMA,
        strict: true,
        type: "json_schema",
      },
    },
  };

  let response: Response;
  try {
    response = await (options.fetchImpl ?? globalThis.fetch)(OPENAI_RESPONSES_ENDPOINT, {
      body: JSON.stringify(requestBody),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
  } catch {
    throw new OpenAIVisualEvaluatorError(
      "OpenAI Responses request failed before receiving a response",
      "OPENAI_NETWORK_ERROR",
    );
  }

  if (!response.ok) {
    return apiFailure(response);
  }

  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    throw new OpenAIVisualEvaluatorError(
      "OpenAI returned a malformed Responses payload",
      "MALFORMED_RESPONSE",
    );
  }

  const outputText = extractOpenAIResponseOutputText(responseBody);
  const rawEvidence = parseBrowserVisualPrediction(outputText);
  const prediction = toVisualPrediction(rawEvidence);
  const responseId = isRecord(responseBody) && typeof responseBody.id === "string"
    ? responseBody.id
    : undefined;

  return {
    model,
    prediction,
    rawEvidence,
    responseId,
    result: evaluateVisualPrediction(evaluatorGroundTruth, prediction),
    shadowMode: true,
  };
}
