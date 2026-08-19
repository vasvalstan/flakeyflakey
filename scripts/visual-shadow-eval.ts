import type {
  StudioAction,
  StudioTargetBox,
  StudioVisualDataset,
  StudioVisualGroundTruthCase,
} from "../src/studio/types";
import {
  evaluateStudioVisualCaseWithOpenAI,
  OPENAI_VISUAL_EVALUATION_DEFAULT_MODEL,
  OpenAIVisualEvaluatorError,
  type OpenAIFetch,
} from "../server/openai-visual-evaluator";
import {
  summarizeVisualEvaluation,
  type VisualCaseResult,
  type VisualEvaluationReport,
} from "../server/visual-evaluation";

const DEFAULT_BASE_URL = "http://127.0.0.1:8787";
const DEFAULT_MAX_CASES = 20;
const MAX_MAX_CASES = 100;
const MAX_DATASET_BYTES = 5_000_000;
const MAX_SCREENSHOT_BYTES = 12_000_000;
const MAX_DATASET_CASES = 10_000;
const MAX_FAILURE_CATEGORIES = 12;

const VISUALLY_EVALUABLE_ACTIONS = new Set<StudioAction["kind"]>([
  "click",
  "fill",
  "press",
]);

export const EXTERNAL_UPLOAD_CONFIRMATION_NOTICE = [
  "Refusing to read or upload action screenshots without --confirm-external-upload.",
  "Masked screenshots may still contain visible personal or health data.",
  "Obtain the required approval before running this shadow evaluation.",
].join(" ");

export interface VisualShadowEvalArgs {
  baseUrl: string;
  confirmExternalUpload: true;
  maxCases: number;
  model: string;
  sessionId: string;
}

export interface VisualShadowReportInput {
  datasetCases: number;
  eligibleCases: number;
  failures: readonly string[];
  maxCases: number;
  model: string;
  selectedCases: number;
  sessionId: string;
  summary: VisualEvaluationReport;
}

export interface VisualShadowReport {
  schemaVersion: 1;
  shadowMode: true;
  browserActionsExecuted: false;
  predictionsForwardedToExecution: false;
  model: string;
  sessionId: string;
  cases: {
    dataset: number;
    eligible: number;
    ineligible: number;
    selected: number;
    limited: number;
    attempted: number;
    succeeded: number;
    failed: number;
    maxCases: number;
  };
  failures: {
    total: number;
    byCode: Array<{ code: string; count: number }>;
  };
  metrics: {
    exactActionKindMatchCount: number;
    exactActionKindMatchRate: number;
    boxComparableCases: number;
    meanIou: number;
    iouAtLeast50Count: number;
    iouAtLeast50Rate: number;
    centerWithin32PxCount: number;
    centerWithin32PxRate: number;
    abstentionCount: number;
    abstentionRate: number;
    unsafeActionCount: number;
    unsafeActionRate: number;
  };
}

export class VisualShadowEvalCliError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "VisualShadowEvalCliError";
    this.code = code;
  }
}

function cliError(message: string, code: string): never {
  throw new VisualShadowEvalCliError(message, code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonemptyBoundedString(
  value: unknown,
  maximumLength: number,
): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maximumLength;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function requiredOptionValue(
  argv: readonly string[],
  index: number,
  optionName: string,
): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    return cliError(`${optionName} requires a value.`, "INVALID_ARGUMENTS");
  }
  return value;
}

function validateOpaqueId(value: string, optionName: string): string {
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(value)) {
    return cliError(
      `${optionName} must be a nonempty opaque identifier.`,
      "INVALID_ARGUMENTS",
    );
  }
  return value;
}

function validateModel(value: string): string {
  const model = value.trim();
  if (!/^[A-Za-z0-9._:-]{1,160}$/.test(model)) {
    return cliError(
      "--model must be a nonempty OpenAI model identifier.",
      "INVALID_ARGUMENTS",
    );
  }
  return model;
}

function parseMaxCases(value: string): number {
  if (!/^\d+$/.test(value)) {
    return cliError(
      `--max-cases must be an integer from 1 to ${MAX_MAX_CASES}.`,
      "INVALID_ARGUMENTS",
    );
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > MAX_MAX_CASES) {
    return cliError(
      `--max-cases must be an integer from 1 to ${MAX_MAX_CASES}.`,
      "INVALID_ARGUMENTS",
    );
  }
  return parsed;
}

/**
 * Parses only non-secret command-line options. OPENAI_API_KEY is intentionally
 * absent from this interface and is read from the environment by the entrypoint.
 */
export function parseVisualShadowEvalArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>> = {},
): VisualShadowEvalArgs {
  let baseUrl = DEFAULT_BASE_URL;
  let confirmed = false;
  let maxCases = DEFAULT_MAX_CASES;
  let model = env.OPENAI_VISUAL_MODEL?.trim()
    || OPENAI_VISUAL_EVALUATION_DEFAULT_MODEL;
  let sessionId: string | undefined;
  const seen = new Set<string>();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--confirm-external-upload") {
      if (seen.has(argument)) {
        return cliError("An option was provided more than once.", "INVALID_ARGUMENTS");
      }
      seen.add(argument);
      confirmed = true;
      continue;
    }

    if (argument === "--session"
      || argument === "--base-url"
      || argument === "--model"
      || argument === "--max-cases") {
      if (seen.has(argument)) {
        return cliError("An option was provided more than once.", "INVALID_ARGUMENTS");
      }
      seen.add(argument);
      const value = requiredOptionValue(argv, index, argument);
      index += 1;
      if (argument === "--session") sessionId = validateOpaqueId(value, argument);
      else if (argument === "--base-url") baseUrl = normalizeStudioApiBase(value);
      else if (argument === "--model") model = validateModel(value);
      else maxCases = parseMaxCases(value);
      continue;
    }

    // Do not echo unknown arguments: they may contain an accidentally supplied
    // API key or other secret.
    return cliError("Unknown command-line option.", "INVALID_ARGUMENTS");
  }

  if (!confirmed) {
    return cliError(EXTERNAL_UPLOAD_CONFIRMATION_NOTICE, "UPLOAD_NOT_CONFIRMED");
  }
  if (!sessionId) {
    return cliError("--session <id> is required.", "INVALID_ARGUMENTS");
  }

  return {
    baseUrl: normalizeStudioApiBase(baseUrl),
    confirmExternalUpload: true,
    maxCases,
    model: validateModel(model),
    sessionId,
  };
}

/**
 * Accepts either an origin or that origin's exact /api/studio base.
 */
export function normalizeStudioApiBase(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return cliError(
      "--base-url must be an absolute HTTP(S) URL.",
      "INVALID_ARGUMENTS",
    );
  }

  if ((url.protocol !== "http:" && url.protocol !== "https:")
    || url.username
    || url.password
    || url.search
    || url.hash) {
    return cliError(
      "--base-url must be an HTTP(S) origin or its /api/studio path, without credentials, query, or fragment.",
      "INVALID_ARGUMENTS",
    );
  }

  const pathname = url.pathname.replace(/\/+$/, "");
  if (pathname === "") {
    url.pathname = "/api/studio";
  } else if (pathname === "/api/studio") {
    url.pathname = pathname;
  } else {
    return cliError(
      "--base-url path must be empty or /api/studio.",
      "INVALID_ARGUMENTS",
    );
  }

  return url.toString().replace(/\/$/, "");
}

export function buildVisualDatasetUrl(baseUrl: string, sessionId: string): string {
  const base = normalizeStudioApiBase(baseUrl);
  return `${base}/sessions/${encodeURIComponent(sessionId)}/visual-dataset`;
}

export function buildBeforeScreenshotUrl(
  baseUrl: string,
  sessionId: string,
  actionId: string,
): string {
  const base = normalizeStudioApiBase(baseUrl);
  return [
    base,
    "/sessions/",
    encodeURIComponent(sessionId),
    "/actions/",
    encodeURIComponent(actionId),
    "/screenshot?phase=before",
  ].join("");
}

function validateTargetBox(value: unknown): StudioTargetBox | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)
    || !isFiniteNumber(value.x)
    || !isFiniteNumber(value.y)
    || !isFiniteNumber(value.width)
    || !isFiniteNumber(value.height)
    || !isRecord(value.viewport)
    || !isFiniteNumber(value.viewport.width)
    || !isFiniteNumber(value.viewport.height)
    || value.x < 0
    || value.y < 0
    || value.width <= 0
    || value.height <= 0
    || value.viewport.width <= 0
    || value.viewport.height <= 0
    || value.x + value.width > value.viewport.width + 1
    || value.y + value.height > value.viewport.height + 1) {
    return cliError(
      "Visual dataset contains an invalid target box.",
      "INVALID_DATASET",
    );
  }
  return {
    height: value.height,
    viewport: {
      height: value.viewport.height,
      width: value.viewport.width,
    },
    width: value.width,
    x: value.x,
    y: value.y,
  };
}

function validateVisualCase(
  value: unknown,
  expectedSessionId: string,
): StudioVisualGroundTruthCase {
  if (!isRecord(value)
    || !isNonemptyBoundedString(value.caseId, 200)
    || !isNonemptyBoundedString(value.actionId, 200)
    || value.sessionId !== expectedSessionId
    || !isNonemptyBoundedString(value.createdAt, 100)
    || !isNonemptyBoundedString(value.pageUrl, 4_096)
    || !Number.isSafeInteger(value.frameRevisionBefore)
    || (value.frameRevisionBefore as number) < 0
    || !isNonemptyBoundedString(value.actionKind, 40)
    || !["navigate", "click", "fill", "press", "scroll", "assertion"].includes(value.actionKind)
    || (value.source !== "recorder" && value.source !== "questionnaire")
    || !isNonemptyBoundedString(value.intent, 2_000)
    || typeof value.beforeScreenshotAvailable !== "boolean"
    || typeof value.afterScreenshotAvailable !== "boolean"
    || (value.targetLabel !== undefined
      && !isNonemptyBoundedString(value.targetLabel, 2_000))) {
    return cliError(
      "Visual dataset contains an invalid case.",
      "INVALID_DATASET",
    );
  }

  // Reconstruct the case from validated essentials. Locator candidates and
  // other DOM-derived fields are not needed by this screenshot-only CLI.
  return {
    actionId: value.actionId,
    actionKind: value.actionKind as StudioAction["kind"],
    afterScreenshotAvailable: value.afterScreenshotAvailable,
    beforeScreenshotAvailable: value.beforeScreenshotAvailable,
    caseId: value.caseId,
    createdAt: value.createdAt,
    frameRevisionBefore: value.frameRevisionBefore as number,
    intent: value.intent,
    pageUrl: value.pageUrl,
    sessionId: expectedSessionId,
    source: value.source,
    targetBox: validateTargetBox(value.targetBox),
    targetLabel: value.targetLabel as string | undefined,
  };
}

/**
 * Runtime-validates the recorder dataset before any screenshot is requested.
 * It returns a reconstructed object containing only fields used by evaluation.
 */
export function validateStudioVisualDataset(
  value: unknown,
  expectedSessionId: string,
): StudioVisualDataset {
  if (!isRecord(value)
    || value.schemaVersion !== 1
    || value.sessionId !== expectedSessionId
    || !isNonemptyBoundedString(value.createdAt, 100)
    || !Array.isArray(value.cases)
    || value.cases.length > MAX_DATASET_CASES) {
    return cliError(
      "Studio returned an invalid visual dataset.",
      "INVALID_DATASET",
    );
  }

  return {
    cases: value.cases.map((item) => validateVisualCase(item, expectedSessionId)),
    createdAt: value.createdAt,
    schemaVersion: 1,
    sessionId: expectedSessionId,
  };
}

export function isEligibleVisualCase(
  visualCase: StudioVisualGroundTruthCase,
): boolean {
  return visualCase.beforeScreenshotAvailable
    && Boolean(visualCase.targetBox)
    && VISUALLY_EVALUABLE_ACTIONS.has(visualCase.actionKind);
}

function boundedCount(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function boundedRate(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function boundedMetric(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function safeFailureCode(value: string): string {
  return /^[A-Z0-9_]{1,64}$/.test(value)
    ? value
    : "UNCLASSIFIED_FAILURE";
}

/**
 * Produces the only JSON shape printed by the CLI. Per-case predictions,
 * screenshots, prompts, URLs, semantic labels, and raw model evidence are
 * deliberately excluded.
 */
export function buildBoundedVisualShadowReport(
  input: VisualShadowReportInput,
): VisualShadowReport {
  const failureCounts = new Map<string, number>();
  for (const failure of input.failures) {
    const code = safeFailureCode(failure);
    failureCounts.set(code, (failureCounts.get(code) ?? 0) + 1);
  }
  const byCode = [...failureCounts.entries()]
    .map(([code, count]) => ({ code, count }))
    .sort((first, second) => (
      second.count - first.count || first.code.localeCompare(second.code)
    ));
  const boundedByCode = byCode.slice(0, MAX_FAILURE_CATEGORIES);
  const omittedCount = byCode
    .slice(MAX_FAILURE_CATEGORIES)
    .reduce((total, item) => total + item.count, 0);
  if (omittedCount > 0) {
    boundedByCode.push({ code: "OTHER_FAILURES", count: omittedCount });
  }

  const datasetCases = boundedCount(input.datasetCases);
  const eligibleCases = Math.min(datasetCases, boundedCount(input.eligibleCases));
  const selectedCases = Math.min(
    eligibleCases,
    boundedCount(input.selectedCases),
  );
  const succeeded = Math.min(selectedCases, boundedCount(input.summary.totalCases));
  const failed = Math.min(selectedCases - succeeded, input.failures.length);

  return {
    browserActionsExecuted: false,
    cases: {
      attempted: succeeded + failed,
      dataset: datasetCases,
      eligible: eligibleCases,
      failed,
      ineligible: datasetCases - eligibleCases,
      limited: eligibleCases - selectedCases,
      maxCases: Math.min(MAX_MAX_CASES, Math.max(1, boundedCount(input.maxCases))),
      selected: selectedCases,
      succeeded,
    },
    failures: {
      byCode: boundedByCode,
      total: failed,
    },
    metrics: {
      abstentionCount: boundedCount(input.summary.abstentionCount),
      abstentionRate: boundedRate(input.summary.abstentionRate),
      boxComparableCases: boundedCount(input.summary.boxComparableCases),
      centerWithin32PxCount: boundedCount(input.summary.centerWithin32PxCount),
      centerWithin32PxRate: boundedRate(input.summary.centerWithin32PxRate),
      exactActionKindMatchCount: boundedCount(input.summary.exactActionKindMatchCount),
      exactActionKindMatchRate: boundedRate(input.summary.exactActionKindMatchRate),
      iouAtLeast50Count: boundedCount(input.summary.iouAtLeast50Count),
      iouAtLeast50Rate: boundedRate(input.summary.iouAtLeast50Rate),
      meanIou: boundedMetric(input.summary.meanIou),
      unsafeActionCount: boundedCount(input.summary.unsafeActionCount),
      unsafeActionRate: boundedRate(input.summary.unsafeActionRate),
    },
    model: input.model,
    predictionsForwardedToExecution: false,
    schemaVersion: 1,
    sessionId: input.sessionId,
    shadowMode: true,
  };
}

async function responseBytes(
  response: Response,
  maximumBytes: number,
): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > maximumBytes) {
      return cliError("Studio response exceeded the safe size limit.", "RESPONSE_TOO_LARGE");
    }
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > maximumBytes) {
    return cliError("Studio response had an invalid size.", "INVALID_RESPONSE_SIZE");
  }
  return bytes;
}

async function fetchDataset(
  args: VisualShadowEvalArgs,
  fetchImpl: OpenAIFetch,
): Promise<StudioVisualDataset> {
  let response: Response;
  try {
    response = await fetchImpl(buildVisualDatasetUrl(args.baseUrl, args.sessionId), {
      headers: { Accept: "application/json" },
      method: "GET",
      redirect: "error",
    });
  } catch {
    return cliError(
      "Could not reach the local Studio API.",
      "STUDIO_NETWORK_ERROR",
    );
  }
  if (!response.ok) {
    return cliError(
      `Studio visual dataset request returned HTTP ${response.status}.`,
      "STUDIO_API_ERROR",
    );
  }
  const bytes = await responseBytes(response, MAX_DATASET_BYTES);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return cliError(
      "Studio returned malformed visual dataset JSON.",
      "INVALID_DATASET",
    );
  }
  return validateStudioVisualDataset(value, args.sessionId);
}

async function fetchBeforeScreenshot(
  args: VisualShadowEvalArgs,
  actionId: string,
  fetchImpl: OpenAIFetch,
): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetchImpl(
      buildBeforeScreenshotUrl(args.baseUrl, args.sessionId, actionId),
      {
        headers: { Accept: "image/jpeg" },
        method: "GET",
        redirect: "error",
      },
    );
  } catch {
    return cliError(
      "Could not fetch an action screenshot from Studio.",
      "SCREENSHOT_NETWORK_ERROR",
    );
  }
  if (!response.ok) {
    return cliError(
      `Studio action screenshot request returned HTTP ${response.status}.`,
      `SCREENSHOT_HTTP_${response.status}`,
    );
  }
  const contentType = response.headers.get("content-type")?.split(";")[0].trim();
  if (contentType !== "image/jpeg") {
    return cliError(
      "Studio returned an unexpected screenshot media type.",
      "INVALID_SCREENSHOT_MEDIA_TYPE",
    );
  }
  return responseBytes(response, MAX_SCREENSHOT_BYTES);
}

function safeFailureFrom(error: unknown): string {
  if (error instanceof OpenAIVisualEvaluatorError) return error.code;
  if (error instanceof VisualShadowEvalCliError) return safeFailureCode(error.code);
  return "UNCLASSIFIED_FAILURE";
}

export async function runVisualShadowEval(
  args: VisualShadowEvalArgs,
  apiKey: string,
  fetchImpl: OpenAIFetch = globalThis.fetch,
): Promise<VisualShadowReport> {
  // Keep this guard adjacent to all I/O even though the parser also enforces it.
  if (args.confirmExternalUpload !== true) {
    return cliError(EXTERNAL_UPLOAD_CONFIRMATION_NOTICE, "UPLOAD_NOT_CONFIRMED");
  }
  if (!apiKey.trim()) {
    return cliError(
      "OPENAI_API_KEY must be set in the environment.",
      "MISSING_API_KEY",
    );
  }

  const dataset = await fetchDataset(args, fetchImpl);
  const eligibleCases = dataset.cases.filter(isEligibleVisualCase);
  const selectedCases = eligibleCases.slice(0, args.maxCases);
  const failures: string[] = [];
  const results: VisualCaseResult[] = [];

  // Deliberately sequential: each screenshot is held only for its one shadow
  // request, and no prediction is ever forwarded to a Studio input endpoint.
  for (const visualCase of selectedCases) {
    try {
      const beforeScreenshot = await fetchBeforeScreenshot(
        args,
        visualCase.actionId,
        fetchImpl,
      );
      const evaluation = await evaluateStudioVisualCaseWithOpenAI({
        apiKey,
        beforeScreenshot,
        fetchImpl,
        groundTruth: visualCase,
        model: args.model,
        screenshotMediaType: "image/jpeg",
      });
      results.push(evaluation.result);
    } catch (error) {
      failures.push(safeFailureFrom(error));
    }
  }

  return buildBoundedVisualShadowReport({
    datasetCases: dataset.cases.length,
    eligibleCases: eligibleCases.length,
    failures,
    maxCases: args.maxCases,
    model: args.model,
    selectedCases: selectedCases.length,
    sessionId: args.sessionId,
    summary: summarizeVisualEvaluation(results),
  });
}

export const VISUAL_SHADOW_EVAL_USAGE = [
  "Usage:",
  "  bun run scripts/visual-shadow-eval.ts --session <id> --confirm-external-upload",
  "    [--base-url http://127.0.0.1:8787] [--model <model>] [--max-cases 1..100]",
  "",
  "OPENAI_API_KEY is read only from the environment.",
  EXTERNAL_UPLOAD_CONFIRMATION_NOTICE,
].join("\n");

async function main(): Promise<void> {
  const args = parseVisualShadowEvalArgs(process.argv.slice(2), process.env);
  const apiKey = process.env.OPENAI_API_KEY ?? "";
  console.error(
    "External upload approved: masked screenshots may still contain visible personal or health data.",
  );
  const report = await runVisualShadowEval(args, apiKey);
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    const safeMessage = error instanceof VisualShadowEvalCliError
      ? error.message
      : "Visual shadow evaluation failed.";
    console.error(safeMessage);
    console.error(VISUAL_SHADOW_EVAL_USAGE);
    process.exitCode = 1;
  }
}
