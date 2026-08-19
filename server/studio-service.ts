import {
  chromium,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

import {
  STUDIO_VIEWPORT,
  type QuestionnaireExecutionRequest,
  type QuestionnaireExecutionResult,
  type QuestionnaireRunPlan,
  type StudioAction,
  type StudioActionId,
  type StudioAssertion,
  type StudioAssertionAction,
  type StudioAssertionRequest,
  type StudioClickAction,
  type StudioConsoleEntry,
  type StudioEvidence,
  type StudioFillAction,
  type StudioInputRequest,
  type StudioLocatorCandidate,
  type StudioLocatorStrategy,
  type StudioMutationResponse,
  type StudioNetworkError,
  type StudioPageError,
  type StudioReplayResult,
  type StudioReplayStepResult,
  type StudioSavedFlow,
  type StudioSavedFlowId,
  type StudioSavedFlowSummary,
  type StudioSaveFlowRequest,
  type StudioSemanticEnrichment,
  type StudioSession,
  type StudioSessionId,
  type StudioTargetBox,
  type StudioVisualDataset,
  type StudioVisualGroundTruthCase,
} from "../src/studio/types";
import {
  compileQuestionnaireCommand,
  getQuestionnaireCatalog,
  getQuestionnaireDefinition,
} from "./questionnaire-engine";
import {
  enrichStudioActionWithOpenAI,
  OpenAISemanticEnrichmentError,
  OPENAI_SEMANTIC_ENRICHMENT_DEFAULT_MODEL,
} from "./openai-semantic-enrichment";
import {
  SavedFlowStore,
  type SavedFlowScreenshot,
} from "./saved-flow-store";

const MAX_SESSIONS = 5;
const NAVIGATION_TIMEOUT_MS = 30_000;
const ASSERTION_TIMEOUT_MS = 5_000;
const SESSION_IDLE_TTL_MS = 30 * 60_000;
const SESSION_ABSOLUTE_TTL_MS = 2 * 60 * 60_000;
const SESSION_REAPER_INTERVAL_MS = 60_000;
const MAX_DIAGNOSTIC_ENTRIES = 250;
const MAX_INPUT_LENGTH = 20_000;
const MAX_SAVED_FLOW_NAME_LENGTH = 100;
const MAX_SAVED_FLOW_DESCRIPTION_LENGTH = 500;
const REDACTED_VALUE = "[redacted]";
const STUDIO_RUNTIME = Bun.env.STUDIO_RUNTIME === "container" ? "container" : "local";

function configuredOrigin(name: "STUDIO_PUBLIC_ORIGIN" | "STUDIO_INTERNAL_ORIGIN") {
  const value = Bun.env[name]?.trim();
  if (!value) return undefined;
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`${name} must use http or https`);
  }
  return url.origin;
}

const STUDIO_PUBLIC_ORIGIN = configuredOrigin("STUDIO_PUBLIC_ORIGIN");
const STUDIO_INTERNAL_ORIGIN = configuredOrigin("STUDIO_INTERNAL_ORIGIN");
const STUDIO_HOST_GATEWAY = Bun.env.STUDIO_HOST_GATEWAY?.trim();

if (Boolean(STUDIO_PUBLIC_ORIGIN) !== Boolean(STUDIO_INTERNAL_ORIGIN)) {
  throw new Error("STUDIO_PUBLIC_ORIGIN and STUDIO_INTERNAL_ORIGIN must be configured together");
}

type InternalSession = {
  id: StudioSessionId;
  context: BrowserContext;
  page: Page;
  status: StudioSession["status"];
  initialUrl: string;
  recording: boolean;
  semanticEnrichmentEnabled: boolean;
  frameRevision: number;
  lastFrame?: Uint8Array;
  lastFrameRevision?: number;
  actions: StudioAction[];
  screenshots: Map<StudioActionId, Uint8Array>;
  beforeActionScreenshots: Map<StudioActionId, Uint8Array>;
  modelScreenshots: Map<StudioActionId, Uint8Array>;
  modelBeforeActionScreenshots: Map<StudioActionId, Uint8Array>;
  visualCases: Map<StudioActionId, StudioVisualGroundTruthCase>;
  semanticEnrichments: Map<StudioActionId, StudioSemanticEnrichment>;
  enrichmentQueue: Promise<void>;
  enrichmentAbort: AbortController;
  enrichmentControllers: Map<StudioActionId, AbortController>;
  enrichmentTimers: Map<StudioActionId, ReturnType<typeof setTimeout>>;
  secrets: Map<StudioActionId, string>;
  questionnairePlans: Map<string, QuestionnaireRunPlan>;
  console: StudioConsoleEntry[];
  pageErrors: StudioPageError[];
  networkErrors: StudioNetworkError[];
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: number;
  error?: string;
};

type ElementDescription = {
  css: string;
  role?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  testId?: string;
  alt?: string;
  text?: string;
  sensitive?: boolean;
};

type VisualActionContext = {
  beforeScreenshot?: Uint8Array;
  modelBeforeScreenshot?: Uint8Array;
  frameRevisionBefore: number;
  pageUrl: string;
  source: StudioVisualGroundTruthCase["source"];
  intent: string;
  targetLabel?: string;
  targetBox?: StudioTargetBox;
};

export interface StudioSemanticEnrichmentConfig {
  apiKey: string;
  model?: string;
  requestTimeoutMs?: number;
}

export interface StudioServiceOptions {
  semanticEnrichment?: StudioSemanticEnrichmentConfig;
  savedFlowStore?: SavedFlowStore;
}

export class StudioServiceError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "STUDIO_ERROR",
  ) {
    super(message);
    this.name = "StudioServiceError";
  }
}

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const quote = (value: string) => JSON.stringify(value);

function truncate(value: string, max = 2_000) {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function savedFlowName(value: unknown): string {
  if (typeof value !== "string") {
    throw new StudioServiceError("Saved flow name is required", 400, "INVALID_SAVED_FLOW");
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized) {
    throw new StudioServiceError("Saved flow name is required", 400, "INVALID_SAVED_FLOW");
  }
  if (normalized.length > MAX_SAVED_FLOW_NAME_LENGTH) {
    throw new StudioServiceError(
      `Saved flow name must be ${MAX_SAVED_FLOW_NAME_LENGTH} characters or fewer`,
      400,
      "INVALID_SAVED_FLOW",
    );
  }
  return normalized;
}

function savedFlowDescription(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new StudioServiceError(
      "Saved flow description must be text",
      400,
      "INVALID_SAVED_FLOW",
    );
  }
  const normalized = value.trim();
  if (normalized.length > MAX_SAVED_FLOW_DESCRIPTION_LENGTH) {
    throw new StudioServiceError(
      `Saved flow description must be ${MAX_SAVED_FLOW_DESCRIPTION_LENGTH} characters or fewer`,
      400,
      "INVALID_SAVED_FLOW",
    );
  }
  return normalized || undefined;
}

function savedFlowId(value: unknown): StudioSavedFlowId | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !/^[A-Za-z0-9-]{1,80}$/.test(value)) {
    throw new StudioServiceError("Saved flow ID is invalid", 400, "INVALID_SAVED_FLOW");
  }
  return value;
}

function redactText(value: string) {
  return truncate(value)
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(api[_-]?key|authorization|password|passwd|secret|token)\b\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/([?&](?:access_token|api_key|key|password|secret|token)=)[^&#\s]+/gi, "$1[redacted]");
}

function redactModelText(value: string, secretValues: Iterable<string>): string {
  let safe = redactText(value)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, "[redacted-id]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[redacted-number]")
    .replace(/\b\d{8,}\b/g, "[redacted-number]");
  for (const secret of secretValues) {
    if (secret.length >= 4) {
      safe = safe.replace(new RegExp(escapeRegExp(secret), "g"), "[redacted]");
    }
  }
  return safe;
}

function semanticEnrichmentError(error: unknown): string {
  if (error instanceof OpenAISemanticEnrichmentError) {
    if (error.status === 401 || error.status === 403) {
      return "OpenAI could not authenticate this project.";
    }
    if (error.status === 429) {
      return "OpenAI enrichment is temporarily rate limited.";
    }
    if (error.status && error.status >= 500) {
      return "OpenAI enrichment is temporarily unavailable.";
    }
    if (error.code === "MALFORMED_RESPONSE") {
      return "OpenAI returned an enrichment response Flakey could not validate.";
    }
  }
  return "OpenAI could not enrich this capture. Playwright evidence is unchanged.";
}

function sanitizeUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/authorization|credential|key|password|secret|token/i.test(key)) {
        url.searchParams.set(key, REDACTED_VALUE);
      }
    }
    return truncate(url.toString());
  } catch {
    return redactText(rawUrl);
  }
}

function replaceKnownSecrets(value: string, secretValues: readonly string[]): string {
  let safe = value;
  for (const secret of secretValues) {
    if (secret.length >= 4) {
      safe = safe.replace(new RegExp(escapeRegExp(secret), "g"), REDACTED_VALUE);
    } else if (secret && safe === secret) {
      safe = REDACTED_VALUE;
    }
  }
  return safe;
}

function sanitizePersistedText(value: string, secretValues: readonly string[]): string {
  return replaceKnownSecrets(redactText(value), secretValues);
}

function sanitizePersistedUrl(value: string, secretValues: readonly string[]): string {
  return replaceKnownSecrets(sanitizeUrl(value), secretValues);
}

function sanitizePersistedValue<T>(value: T, secretValues: readonly string[]): T {
  if (typeof value === "string") {
    return sanitizePersistedText(value, secretValues) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizePersistedValue(item, secretValues)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        sanitizePersistedValue(item, secretValues),
      ]),
    ) as T;
  }
  return value;
}

function sanitizeLocatorForPersistence(
  locator: StudioLocatorCandidate,
  secretValues: readonly string[],
): StudioLocatorCandidate {
  return {
    ...locator,
    selector: sanitizePersistedText(locator.selector, secretValues),
    value: sanitizePersistedText(locator.value, secretValues),
    name: locator.name
      ? sanitizePersistedText(locator.name, secretValues)
      : undefined,
  };
}

function sanitizeActionForPersistence(
  action: StudioAction,
  secretValues: readonly string[],
): StudioAction {
  const label = sanitizePersistedText(action.label, secretValues);
  const url = sanitizePersistedUrl(action.url, secretValues);
  switch (action.kind) {
    case "navigate":
      return {
        ...action,
        label,
        url,
        targetUrl: sanitizePersistedUrl(action.targetUrl, secretValues),
      };
    case "click":
      return {
        ...action,
        label,
        url,
        locator: sanitizeLocatorForPersistence(action.locator, secretValues),
        locatorCandidates: action.locatorCandidates.map((locator) =>
          sanitizeLocatorForPersistence(locator, secretValues)
        ),
      };
    case "fill":
      return {
        ...action,
        label,
        url,
        value: action.sensitive
          ? REDACTED_VALUE
          : replaceKnownSecrets(action.value, secretValues),
        locator: sanitizeLocatorForPersistence(action.locator, secretValues),
        locatorCandidates: action.locatorCandidates.map((locator) =>
          sanitizeLocatorForPersistence(locator, secretValues)
        ),
      };
    case "press":
      return {
        ...action,
        label,
        url,
        key: sanitizePersistedText(action.key, secretValues),
        locator: action.locator
          ? sanitizeLocatorForPersistence(action.locator, secretValues)
          : undefined,
      };
    case "scroll":
      return { ...action, label, url };
    case "assertion": {
      const assertion = action.assertion.kind === "urlContains"
        ? {
            kind: "urlContains" as const,
            value: sanitizePersistedText(action.assertion.value, secretValues),
          }
        : action.assertion.kind === "textVisible"
          ? {
              kind: "textVisible" as const,
              text: sanitizePersistedText(action.assertion.text, secretValues),
            }
          : {
              kind: "elementVisible" as const,
              locator: sanitizeLocatorForPersistence(
                action.assertion.locator,
                secretValues,
              ),
            };
      return { ...action, label, url, assertion };
    }
  }
}

function isBlockedHost(hostname: string) {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return normalized === "169.254.169.254"
    || normalized === "metadata.google.internal"
    || normalized === "fd00:ec2::254";
}

function looksSecret(value: string) {
  return /^Bearer\s+/i.test(value)
    || /^(?:sk|pk|ghp|github_pat|glpat|xox[baprs])[-_][A-Za-z0-9_-]{12,}$/i.test(value)
    || /^[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}$/.test(value);
}

function validateUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new StudioServiceError("A URL is required", 400, "INVALID_URL");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new StudioServiceError("URL must be absolute", 400, "INVALID_URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new StudioServiceError("Only http and https URLs are supported", 400, "INVALID_URL");
  }
  if (url.username || url.password) {
    throw new StudioServiceError("Credentials are not allowed in Studio URLs", 400, "INVALID_URL");
  }
  if ([...url.searchParams.keys()].some((key) => /authorization|credential|key|password|secret|token/i.test(key))
    || /(?:access_token|api_key|password|secret|token)=/i.test(url.hash)) {
    throw new StudioServiceError("Put credentials in a future authentication setup, not in the URL", 400, "CREDENTIALS_IN_URL");
  }
  if (isBlockedHost(url.hostname)) {
    throw new StudioServiceError("Cloud metadata endpoints are blocked", 403, "BLOCKED_HOST");
  }
  return url.toString();
}

function replaceOrigin(value: string, from: string, to: string) {
  const url = new URL(value);
  if (url.origin !== from) return url.toString();
  const target = new URL(to);
  url.protocol = target.protocol;
  url.host = target.host;
  return url.toString();
}

function browserUrl(value: unknown) {
  const publicUrl = validateUrl(value);
  if (STUDIO_PUBLIC_ORIGIN && STUDIO_INTERNAL_ORIGIN && new URL(publicUrl).origin === STUDIO_PUBLIC_ORIGIN) {
    return validateUrl(replaceOrigin(publicUrl, STUDIO_PUBLIC_ORIGIN, STUDIO_INTERNAL_ORIGIN));
  }
  const url = new URL(publicUrl);
  if (STUDIO_HOST_GATEWAY && ["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
    url.hostname = STUDIO_HOST_GATEWAY;
  }
  return validateUrl(url.toString());
}

function displayUrl(value: string) {
  try {
    const browserTarget = new URL(value).toString();
    if (STUDIO_PUBLIC_ORIGIN && STUDIO_INTERNAL_ORIGIN && new URL(browserTarget).origin === STUDIO_INTERNAL_ORIGIN) {
      return replaceOrigin(browserTarget, STUDIO_INTERNAL_ORIGIN, STUDIO_PUBLIC_ORIGIN);
    }
    const url = new URL(browserTarget);
    if (STUDIO_HOST_GATEWAY && url.hostname === STUDIO_HOST_GATEWAY) url.hostname = "localhost";
    return url.toString();
  } catch {
    return value;
  }
}

function requireString(value: unknown, label: string, max = MAX_INPUT_LENGTH): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new StudioServiceError(`${label} is required`, 400, "INVALID_INPUT");
  }
  if (value.length > max) {
    throw new StudioServiceError(`${label} is too long`, 400, "INVALID_INPUT");
  }
  return value;
}

function requireFinite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new StudioServiceError(`${label} must be a finite number`, 400, "INVALID_INPUT");
  }
  return value;
}

function pushCapped<T>(items: T[], value: T) {
  items.push(value);
  if (items.length > MAX_DIAGNOSTIC_ENTRIES) items.splice(0, items.length - MAX_DIAGNOSTIC_ENTRIES);
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function selectorFor(strategy: StudioLocatorStrategy, value: string, name?: string): string {
  switch (strategy) {
    case "role":
      return name ? `getByRole(${quote(value)}, { name: ${quote(name)}, exact: true })` : `getByRole(${quote(value)})`;
    case "label":
      return `getByLabel(${quote(value)}, { exact: true })`;
    case "placeholder":
      return `getByPlaceholder(${quote(value)}, { exact: true })`;
    case "testId":
      return `getByTestId(${quote(value)})`;
    case "alt":
      return `getByAltText(${quote(value)}, { exact: true })`;
    case "text":
      return `getByText(${quote(value)}, { exact: true })`;
    case "css":
      return `locator(${quote(value)})`;
  }
}

function locatorFor(page: Page, candidate: StudioLocatorCandidate): Locator {
  switch (candidate.strategy) {
    case "role":
      return page.getByRole(candidate.value as Parameters<Page["getByRole"]>[0], candidate.name ? { name: candidate.name, exact: true } : undefined);
    case "label":
      return page.getByLabel(candidate.value, { exact: true });
    case "placeholder":
      return page.getByPlaceholder(candidate.value, { exact: true });
    case "testId":
      return page.getByTestId(candidate.value);
    case "alt":
      return page.getByAltText(candidate.value, { exact: true });
    case "text":
      return page.getByText(candidate.value, { exact: true });
    case "css":
      return page.locator(candidate.value);
  }
}

const strategyScore: Record<StudioLocatorStrategy, number> = {
  role: 0.95,
  label: 0.9,
  testId: 0.85,
  placeholder: 0.78,
  alt: 0.74,
  text: 0.62,
  css: 0.3,
};

async function normalizeCandidate(page: Page, input: StudioLocatorCandidate): Promise<StudioLocatorCandidate> {
  const allowed: StudioLocatorStrategy[] = ["role", "label", "placeholder", "testId", "alt", "text", "css"];
  if (!input || !allowed.includes(input.strategy)) {
    throw new StudioServiceError("Unsupported locator strategy", 400, "INVALID_LOCATOR");
  }
  const value = requireString(input.value, "Locator value", 1_000);
  const name = input.name === undefined ? undefined : requireString(input.name, "Locator name", 500);
  const safe = {
    strategy: input.strategy,
    value,
    name,
    selector: selectorFor(input.strategy, value, name),
    matchCount: 0,
    unique: false,
    score: strategyScore[input.strategy],
  } satisfies StudioLocatorCandidate;
  const matchCount = await locatorFor(page, safe).count().catch(() => 0);
  return { ...safe, matchCount, unique: matchCount === 1, score: Math.min(1, safe.score + (matchCount === 1 ? 0.03 : -0.22)) };
}

async function describeElementAt(page: Page, x: number, y: number): Promise<ElementDescription> {
  return page.evaluate(({ pointX, pointY }) => {
    const original = document.elementFromPoint(pointX, pointY);
    if (!original) throw new Error("No element exists at those coordinates");
    const element = original.closest(
      "button, a[href], input, textarea, select, [role], [data-testid], [contenteditable='true']",
    ) ?? original;

    const clean = (value: string | null | undefined) => value?.replace(/\s+/g, " ").trim().slice(0, 160) || undefined;
    const labelledBy = element.getAttribute("aria-labelledby")
      ?.split(/\s+/)
      .map((labelId) => document.getElementById(labelId)?.textContent ?? "")
      .join(" ");
    const htmlElement = element as HTMLElement;
    const input = element as HTMLInputElement;
    const labels = "labels" in input && input.labels ? Array.from(input.labels).map((label) => label.textContent ?? "").join(" ") : undefined;
    const closestLabel = element.closest("label")?.textContent;
    const tag = element.tagName.toLowerCase();
    const inputType = input.type?.toLowerCase();
    const explicitRole = element.getAttribute("role") || undefined;
    const inferredRole = explicitRole
      ?? (tag === "button" ? "button"
        : tag === "a" && element.hasAttribute("href") ? "link"
          : tag === "textarea" ? "textbox"
            : tag === "select" ? "combobox"
              : tag === "img" ? "img"
                : tag === "input" && ["button", "submit", "reset"].includes(inputType) ? "button"
                  : tag === "input" && inputType === "checkbox" ? "checkbox"
                    : tag === "input" && inputType === "radio" ? "radio"
                      : tag === "input" ? "textbox"
                        : /^h[1-6]$/.test(tag) ? "heading"
                          : undefined);
    const label = clean(labels ?? closestLabel);
    const alt = clean(element.getAttribute("alt"));
    const name = clean(
      element.getAttribute("aria-label")
      ?? labelledBy
      ?? label
      ?? alt
      ?? element.getAttribute("title")
      ?? (tag === "input" ? element.getAttribute("placeholder") : htmlElement.innerText),
    );
    const sensitive = inputType === "password"
      || /password|passwd|secret|token|api.?key/i.test(`${name ?? ""} ${label ?? ""} ${element.getAttribute("name") ?? ""}`);

    const cssPath = (target: Element) => {
      if (target.id) return `#${CSS.escape(target.id)}`;
      const parts: string[] = [];
      let node: Element | null = target;
      while (node && node !== document.documentElement) {
        let part = node.tagName.toLowerCase();
        const parent: Element | null = node.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter((child) => child.tagName === node!.tagName);
          if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        }
        parts.unshift(part);
        node = parent;
      }
      return parts.join(" > ") || tag;
    };

    return {
      css: cssPath(element),
      role: clean(inferredRole),
      name,
      label,
      placeholder: clean(element.getAttribute("placeholder")),
      testId: clean(element.getAttribute("data-testid")),
      alt,
      text: clean(htmlElement.innerText ?? element.textContent),
      sensitive,
    };
  }, { pointX: x, pointY: y });
}

async function candidatesAt(page: Page, x: number, y: number): Promise<StudioLocatorCandidate[]> {
  const description = await describeElementAt(page, x, y).catch((error: unknown) => {
    throw new StudioServiceError(error instanceof Error ? error.message : "Element could not be inspected", 400, "ELEMENT_NOT_FOUND");
  });
  const seeds: Array<Pick<StudioLocatorCandidate, "strategy" | "value" | "name">> = [];
  if (description.role) seeds.push({ strategy: "role", value: description.role, name: description.name });
  if (description.label) seeds.push({ strategy: "label", value: description.label });
  if (description.placeholder) seeds.push({ strategy: "placeholder", value: description.placeholder });
  if (description.testId) seeds.push({ strategy: "testId", value: description.testId });
  if (description.alt) seeds.push({ strategy: "alt", value: description.alt });
  if (description.text && description.text.length <= 120) seeds.push({ strategy: "text", value: description.text });
  seeds.push({ strategy: "css", value: description.css });

  const candidates: StudioLocatorCandidate[] = [];
  for (const seed of seeds) {
    const selector = selectorFor(seed.strategy, seed.value, seed.name);
    const draft: StudioLocatorCandidate = {
      ...seed,
      selector,
      matchCount: 0,
      unique: false,
      score: strategyScore[seed.strategy],
    };
    const matchCount = await locatorFor(page, draft).count().catch(() => 0);
    candidates.push({
      ...draft,
      matchCount,
      unique: matchCount === 1,
      score: Math.max(0.08, Math.min(1, draft.score + (matchCount === 1 ? 0.03 : -0.22))),
    });
  }
  return candidates.sort((a, b) => b.score - a.score);
}

function bestCandidate(candidates: StudioLocatorCandidate[]): StudioLocatorCandidate {
  const candidate = candidates.find((item) => item.unique) ?? candidates.at(-1);
  if (!candidate) throw new StudioServiceError("No locator could be generated", 400, "ELEMENT_NOT_FOUND");
  return candidate;
}

function humanTarget(candidate: StudioLocatorCandidate) {
  const readable = candidate.name
    ?? (candidate.strategy !== "role" && candidate.strategy !== "css" ? candidate.value : undefined);
  return readable ? `“${readable}”` : candidate.selector;
}

function assertCoordinateRequest(session: InternalSession, request: Extract<StudioInputRequest, { kind: "click" | "scroll" }>) {
  if (request.frameRevision !== session.frameRevision
    || request.viewport.width !== STUDIO_VIEWPORT.width
    || request.viewport.height !== STUDIO_VIEWPORT.height) {
    throw new StudioServiceError("The browser changed after this frame was captured", 409, "STALE_FRAME");
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function generatePlaywrightCode(
  initialUrl: string,
  actions: readonly StudioAction[],
): string {
  const lines = [
    'import { test, expect } from "@playwright/test";',
    "",
    'test("recorded Studio flow", async ({ page }) => {',
  ];
  let secretIndex = 0;
  if (actions[0]?.kind !== "navigate") {
    lines.push(`  await page.goto(${quote(initialUrl)});`);
  }
  for (const action of actions) {
    switch (action.kind) {
      case "navigate":
        lines.push(`  await page.goto(${quote(action.targetUrl)});`);
        break;
      case "click":
        lines.push(`  await page.${action.locator.selector}.click();`);
        break;
      case "fill": {
        const value = action.sensitive
          ? `process.env.FLAKEY_SECRET_${secretIndex += 1} ?? ""`
          : quote(action.value);
        lines.push(`  await page.${action.locator.selector}.fill(${value});`);
        break;
      }
      case "press":
        lines.push(action.locator
          ? `  await page.${action.locator.selector}.press(${quote(action.key)});`
          : `  await page.keyboard.press(${quote(action.key)});`);
        break;
      case "scroll":
        lines.push("  // Scroll captured as evidence; locators scroll into view automatically.");
        break;
      case "assertion":
        if (action.assertion.kind === "urlContains") {
          lines.push(
            `  await expect(page).toHaveURL(new RegExp(${quote(escapeRegExp(action.assertion.value))}));`,
          );
        } else if (action.assertion.kind === "textVisible") {
          lines.push(
            `  await expect(page.getByText(${quote(action.assertion.text)}, { exact: false })).toBeVisible();`,
          );
        } else {
          lines.push(
            `  await expect(page.${action.assertion.locator.selector}).toBeVisible();`,
          );
        }
    }
  }
  lines.push("});", "");
  return lines.join("\n");
}

async function createGuardedContext(browser: Browser) {
  const context = await browser.newContext({
    acceptDownloads: false,
    viewport: STUDIO_VIEWPORT,
  });
  await context.route("**/*", async (route) => {
    try {
      const request = route.request();
      const url = new URL(request.url());
      if ((url.protocol === "http:" || url.protocol === "https:") && isBlockedHost(url.hostname)) {
        await route.abort("blockedbyclient");
        return;
      }
      if (!["http:", "https:", "about:", "blob:", "data:"].includes(url.protocol)) {
        await route.abort("blockedbyclient");
        return;
      }
      if (request.isNavigationRequest()) validateUrl(url.toString());
    } catch {
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
  return context;
}

async function captureScreenshot(page: Page, quality: number): Promise<Uint8Array> {
  const sensitiveFields = page.locator([
    'input[type="password"]',
    'input[name*="password" i]',
    'input[name*="secret" i]',
    'input[name*="token" i]',
    'input[name*="api-key" i]',
    'input[autocomplete="cc-number"]',
    'input[autocomplete="cc-csc"]',
  ].join(", "));
  const screenshot = await page.screenshot({
    type: "jpeg",
    quality,
    animations: "disabled",
    mask: [sensitiveFields],
    maskColor: "#5A6578",
  });
  return new Uint8Array(screenshot);
}

async function captureModelScreenshot(
  page: Page,
  quality: number,
  target: StudioTargetBox,
): Promise<Uint8Array> {
  const left = Math.max(0, target.x - 280);
  const top = Math.max(0, target.y - 220);
  const right = Math.min(STUDIO_VIEWPORT.width, target.x + target.width + 280);
  const bottom = Math.min(STUDIO_VIEWPORT.height, target.y + target.height + 180);
  const privateFields = page.locator([
    'input:not([type="button"]):not([type="submit"]):not([type="radio"]):not([type="checkbox"])',
    "textarea",
    "select",
    '[contenteditable]:not([contenteditable="false"])',
    '[role="textbox"]',
    "[data-private]",
    "[data-sensitive]",
    "[data-pii]",
  ].join(", "));
  const screenshot = await page.screenshot({
    animations: "disabled",
    clip: {
      height: bottom - top,
      width: right - left,
      x: left,
      y: top,
    },
    mask: [privateFields],
    maskColor: "#5A6578",
    quality,
    type: "jpeg",
  });
  return new Uint8Array(screenshot);
}

function targetBox(
  box: { x: number; y: number; width: number; height: number } | null | undefined,
): StudioTargetBox | undefined {
  if (!box
    || ![box.x, box.y, box.width, box.height].every(Number.isFinite)
    || box.width <= 0
    || box.height <= 0) {
    return undefined;
  }
  const left = Math.max(0, box.x);
  const top = Math.max(0, box.y);
  const right = Math.min(STUDIO_VIEWPORT.width, box.x + box.width);
  const bottom = Math.min(STUDIO_VIEWPORT.height, box.y + box.height);
  if (right <= left || bottom <= top) return undefined;
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    viewport: { ...STUDIO_VIEWPORT },
  };
}

/**
 * Returns the surface a person can actually see and click. Native controls keep
 * their own geometry; visually-hidden radios/checkboxes inherit the box of an
 * associated label or interactive container.
 */
async function visibleInteractionSurfaceBox(
  control: Locator,
): Promise<{ x: number; y: number; width: number; height: number } | null> {
  const resolved = await control.evaluate((element) => {
    type Box = { x: number; y: number; width: number; height: number };
    const boxFor = (candidate: Element): Box => {
      const rectangle = candidate.getBoundingClientRect();
      return {
        x: rectangle.left,
        y: rectangle.top,
        width: rectangle.width,
        height: rectangle.height,
      };
    };
    const isRendered = (candidate: Element, minimumDimension: number) => {
      const rectangle = candidate.getBoundingClientRect();
      const style = getComputedStyle(candidate);
      const opacity = Number.parseFloat(style.opacity || "1");
      return rectangle.width >= minimumDimension
        && rectangle.height >= minimumDimension
        && rectangle.right > 0
        && rectangle.bottom > 0
        && rectangle.left < window.innerWidth
        && rectangle.top < window.innerHeight
        && style.display !== "none"
        && style.visibility !== "hidden"
        && (!Number.isFinite(opacity) || opacity > 0.05);
    };

    if (isRendered(element, 8)) return boxFor(element);

    const labelable = element as Element & {
      labels?: NodeListOf<HTMLLabelElement> | null;
    };
    const candidates: Element[] = [
      ...Array.from(labelable.labels ?? []),
    ];
    const enclosingSurface = element.closest(
      'label, [role="radio"], [role="checkbox"], [role="option"]',
    );
    if (enclosingSurface) candidates.push(enclosingSurface);

    for (const candidate of [...new Set(candidates)]) {
      if (isRendered(candidate, 8)) return boxFor(candidate);
      const visibleChild = Array.from(candidate.children)
        .find((child) => isRendered(child, 8));
      if (visibleChild) return boxFor(visibleChild);
    }

    const direct = element.getBoundingClientRect();
    return direct.width > 0 && direct.height > 0 ? boxFor(element) : null;
  }).catch(() => null);

  return resolved ?? await control.boundingBox().catch(() => null);
}

export class StudioService {
  private browser?: Browser;
  private browserLaunch?: Promise<Browser>;
  private readonly sessions = new Map<StudioSessionId, InternalSession>();
  private pendingSessions = 0;
  private reaping = false;
  private readonly semanticEnrichment?: Required<StudioSemanticEnrichmentConfig>;
  private readonly savedFlowStore?: SavedFlowStore;
  private readonly sessionReaper = setInterval(() => {
    void this.reapExpiredSessions();
  }, SESSION_REAPER_INTERVAL_MS);

  constructor(options: StudioServiceOptions = {}) {
    this.savedFlowStore = options.savedFlowStore;
    const enrichment = options.semanticEnrichment;
    if (enrichment?.apiKey.trim()) {
      this.semanticEnrichment = {
        apiKey: enrichment.apiKey.trim(),
        model: enrichment.model?.trim() || OPENAI_SEMANTIC_ENRICHMENT_DEFAULT_MODEL,
        requestTimeoutMs: enrichment.requestTimeoutMs ?? 45_000,
      };
    }
    this.sessionReaper.unref();
  }

  private async getBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    this.browserLaunch ??= chromium.launch({ headless: true })
      .then((browser) => {
        this.browser = browser;
        return browser;
      })
      .finally(() => {
        this.browserLaunch = undefined;
      });
    return this.browserLaunch;
  }

  async readiness(): Promise<{ browserVersion: string; activeSessions: number; capacity: number }> {
    const browser = await this.getBrowser();
    return {
      browserVersion: browser.version(),
      activeSessions: this.sessions.size,
      capacity: MAX_SESSIONS,
    };
  }

  private requireSession(sessionId: string): InternalSession {
    const session = this.sessions.get(sessionId);
    if (!session) throw new StudioServiceError("Studio session not found", 404, "SESSION_NOT_FOUND");
    session.lastAccessedAt = Date.now();
    return session;
  }

  private async reapExpiredSessions(): Promise<void> {
    if (this.reaping) return;
    this.reaping = true;
    try {
      const timestamp = Date.now();
      const expired = [...this.sessions.values()].filter((session) =>
        timestamp - session.lastAccessedAt >= SESSION_IDLE_TTL_MS
        || timestamp - Date.parse(session.createdAt) >= SESSION_ABSOLUTE_TTL_MS
      );
      for (const session of expired) {
        if (!this.sessions.delete(session.id)) continue;
        session.status = "closed";
        session.enrichmentAbort.abort();
        for (const timer of session.enrichmentTimers.values()) clearTimeout(timer);
        for (const controller of session.enrichmentControllers.values()) controller.abort();
        session.enrichmentTimers.clear();
        session.enrichmentControllers.clear();
        session.screenshots.clear();
        session.beforeActionScreenshots.clear();
        session.modelScreenshots.clear();
        session.modelBeforeActionScreenshots.clear();
        session.visualCases.clear();
        session.semanticEnrichments.clear();
        session.secrets.clear();
        session.questionnairePlans.clear();
        await session.context.close().catch(() => undefined);
      }
    } finally {
      this.reaping = false;
    }
  }

  private requireMutable(session: InternalSession) {
    if (session.status === "replaying") {
      throw new StudioServiceError("Wait for the current replay to finish before changing the timeline", 409, "REPLAY_RUNNING");
    }
  }

  private attachDiagnostics(session: InternalSession) {
    session.page.on("console", (message) => {
      const raw = message.type();
      const level: StudioConsoleEntry["level"] = raw === "warning"
        ? "warning"
        : raw === "error" || raw === "debug" || raw === "info" || raw === "log"
          ? raw
          : "log";
      pushCapped(session.console, { id: id(), level, text: redactText(message.text()), at: now() });
    });
    session.page.on("pageerror", (error) => {
      pushCapped(session.pageErrors, { id: id(), message: redactText(error.message), stack: error.stack ? redactText(error.stack) : undefined, at: now() });
    });
    session.page.on("requestfailed", (request) => {
      pushCapped(session.networkErrors, {
        id: id(),
        url: sanitizeUrl(displayUrl(request.url())),
        method: request.method(),
        resourceType: request.resourceType(),
        errorText: redactText(request.failure()?.errorText ?? "Request failed"),
        at: now(),
      });
    });
  }

  private async snapshot(session: InternalSession): Promise<StudioSession> {
    const [title, url] = await Promise.all([
      session.page.title().catch(() => ""),
      Promise.resolve(session.page.url()),
    ]);
    return {
      id: session.id,
      runtime: STUDIO_RUNTIME,
      status: session.status,
      initialUrl: sanitizeUrl(session.initialUrl),
      url: sanitizeUrl(displayUrl(url)),
      title: redactText(title),
      recording: session.recording,
      semanticEnrichmentEnabled: session.semanticEnrichmentEnabled,
      viewport: STUDIO_VIEWPORT,
      frameRevision: session.frameRevision,
      actions: session.actions,
      semanticEnrichments: Object.fromEntries(
        [...session.semanticEnrichments].map(([actionId, enrichment]) => [
          actionId,
          structuredClone(enrichment),
        ]),
      ),
      evidence: this.evidenceFor(session),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      error: session.error,
    };
  }

  private evidenceFor(session: InternalSession): StudioEvidence {
    return {
      console: session.console,
      pageErrors: session.pageErrors,
      networkErrors: session.networkErrors,
      actionScreenshotIds: [...session.screenshots.keys()],
    };
  }

  private ownsAction(session: InternalSession, actionId: StudioActionId): boolean {
    return this.sessions.get(session.id) === session
      && session.actions.some((action) => action.id === actionId);
  }

  private async prepareVisualAction(
    session: InternalSession,
    locator: StudioLocatorCandidate,
    input: Pick<VisualActionContext, "intent" | "source"> & {
      targetLabel?: string;
      targetBox?: StudioTargetBox;
    },
  ): Promise<VisualActionContext> {
    const frameRevisionBefore = session.frameRevision;
    const pageUrl = displayUrl(session.page.url());
    const resolvedBox = input.targetBox
      ?? targetBox(await visibleInteractionSurfaceBox(locatorFor(session.page, locator)));
    const [beforeScreenshot, modelBeforeScreenshot] = await Promise.all([
      captureScreenshot(session.page, 72).catch(() => undefined),
      this.semanticEnrichment && session.semanticEnrichmentEnabled && resolvedBox
        ? captureModelScreenshot(session.page, 72, resolvedBox).catch(() => undefined)
        : Promise.resolve(undefined),
    ]);
    return {
      beforeScreenshot,
      frameRevisionBefore,
      modelBeforeScreenshot,
      pageUrl,
      source: input.source,
      intent: input.intent,
      targetLabel: input.targetLabel,
      targetBox: resolvedBox,
    };
  }

  private queueSemanticEnrichment(
    session: InternalSession,
    action: StudioAction,
    visualCase: StudioVisualGroundTruthCase,
  ): void {
    const config = this.semanticEnrichment;
    if (
      !config
      || !session.semanticEnrichmentEnabled
      || (action.kind !== "click" && action.kind !== "fill")
      || (action.kind === "fill" && action.sensitive)
    ) {
      return;
    }
    if (
      !session.modelBeforeActionScreenshots.has(action.id)
      || !session.modelScreenshots.has(action.id)
    ) {
      const completedAt = now();
      session.semanticEnrichments.set(action.id, {
        completedAt,
        error: "A model-safe target capture could not be created. Playwright evidence is unchanged.",
        model: config.model,
        provider: "openai",
        requestedAt: completedAt,
        status: "error",
      });
      session.updatedAt = completedAt;
      return;
    }

    const requestedAt = now();
    const queuedEnrichment: StudioSemanticEnrichment = {
      model: config.model,
      provider: "openai",
      requestedAt,
      status: "queued",
    };
    session.semanticEnrichments.set(action.id, queuedEnrichment);
    session.updatedAt = requestedAt;

    const actionId = action.id;
    const actionKind = action.kind;
    const groundTruth = structuredClone(visualCase);
    const locatorCandidates = structuredClone(action.locatorCandidates);
    const run = async () => {
      const currentEnrichment = session.semanticEnrichments.get(actionId);
      if (
        this.sessions.get(session.id) !== session
        || !session.actions.some((candidate) => candidate.id === actionId)
        || currentEnrichment !== queuedEnrichment
      ) {
        return;
      }

      const runningEnrichment: StudioSemanticEnrichment = {
        model: config.model,
        provider: "openai",
        requestedAt,
        status: "running",
      };
      session.semanticEnrichments.set(actionId, runningEnrichment);
      session.updatedAt = now();

      const beforeScreenshot = session.modelBeforeActionScreenshots.get(actionId);
      const afterScreenshot = session.modelScreenshots.get(actionId);
      if (!beforeScreenshot || !afterScreenshot) {
        const completedAt = now();
        session.semanticEnrichments.set(actionId, {
          completedAt,
          error: "The visual evidence needed for enrichment is no longer available.",
          model: config.model,
          provider: "openai",
          requestedAt,
          status: "error",
        });
        session.updatedAt = completedAt;
        return;
      }

      const controller = new AbortController();
      session.enrichmentControllers.get(actionId)?.abort();
      session.enrichmentControllers.set(actionId, controller);
      let timedOut = false;
      const abortForSession = () => controller.abort();
      session.enrichmentAbort.signal.addEventListener("abort", abortForSession, { once: true });
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, config.requestTimeoutMs);

      try {
        const result = await enrichStudioActionWithOpenAI({
          afterScreenshot: new Uint8Array(afterScreenshot),
          afterScreenshotValuesWithheld: actionKind === "fill",
          apiKey: config.apiKey,
          beforeScreenshot: new Uint8Array(beforeScreenshot),
          groundTruth,
          locatorCandidates,
          model: config.model,
          signal: controller.signal,
        });
        if (
          this.sessions.get(session.id) !== session
          || !session.actions.some((candidate) => candidate.id === actionId)
          || session.semanticEnrichments.get(actionId) !== runningEnrichment
        ) {
          return;
        }

        const completedAt = now();
        const safeModelText = (value: string) =>
          redactModelText(value, session.secrets.values());
        session.semanticEnrichments.set(actionId, {
          actionRisk: result.enrichment.actionRisk,
          completedAt,
          confidence: result.enrichment.confidence,
          evidence: result.enrichment.evidence.map(safeModelText),
          expectedOutcome: safeModelText(result.enrichment.expectedOutcome),
          intent: safeModelText(result.enrichment.intent),
          journeyStage: safeModelText(result.enrichment.journeyStage),
          model: result.model,
          provider: "openai",
          requestedAt,
          requiresConfirmation: result.enrichment.requiresConfirmation,
          status: "ready",
          targetRole: safeModelText(result.enrichment.targetRole),
          visualFallback: safeModelText(result.enrichment.visualFallback),
        });
        session.updatedAt = completedAt;
      } catch (error) {
        if (
          session.enrichmentAbort.signal.aborted
          || this.sessions.get(session.id) !== session
          || !session.actions.some((candidate) => candidate.id === actionId)
          || session.semanticEnrichments.get(actionId) !== runningEnrichment
        ) {
          return;
        }
        const completedAt = now();
        session.semanticEnrichments.set(actionId, {
          completedAt,
          error: timedOut
            ? "OpenAI enrichment timed out. Playwright evidence is unchanged."
            : semanticEnrichmentError(error),
          model: config.model,
          provider: "openai",
          requestedAt,
          status: "error",
        });
        session.updatedAt = completedAt;
      } finally {
        clearTimeout(timeout);
        session.enrichmentAbort.signal.removeEventListener("abort", abortForSession);
        if (session.enrichmentControllers.get(actionId) === controller) {
          session.enrichmentControllers.delete(actionId);
        }
      }
    };

    const existingTimer = session.enrichmentTimers.get(actionId);
    if (existingTimer) clearTimeout(existingTimer);
    session.enrichmentControllers.get(actionId)?.abort();
    session.enrichmentControllers.delete(actionId);

    const enqueue = () => {
      session.enrichmentQueue = session.enrichmentQueue.then(run, run);
    };
    if (actionKind === "fill") {
      const timer = setTimeout(() => {
        if (session.enrichmentTimers.get(actionId) === timer) {
          session.enrichmentTimers.delete(actionId);
        }
        enqueue();
      }, 450);
      session.enrichmentTimers.set(actionId, timer);
    } else {
      enqueue();
    }
  }

  private async appendAction(
    session: InternalSession,
    action: StudioAction,
    visual?: VisualActionContext,
  ): Promise<StudioAction> {
    session.actions.push(action);
    if (action.kind === "fill" && action.sensitive) {
      action.screenshotAvailable = false;
      session.beforeActionScreenshots.delete(action.id);
      session.modelScreenshots.delete(action.id);
      session.modelBeforeActionScreenshots.delete(action.id);
      session.visualCases.delete(action.id);
      session.semanticEnrichments.delete(action.id);
      session.updatedAt = now();
      return action;
    }
    const modelTarget = visual?.targetBox;
    const [screenshot, modelScreenshot] = await Promise.all([
      captureScreenshot(session.page, 72).catch(() => undefined),
      this.semanticEnrichment
        && session.semanticEnrichmentEnabled
        && modelTarget
        ? captureModelScreenshot(session.page, 72, modelTarget).catch(() => undefined)
        : Promise.resolve(undefined),
    ]);
    if (!this.ownsAction(session, action.id)) return action;
    if (screenshot) {
      session.screenshots.set(action.id, screenshot);
      action.screenshotAvailable = true;
    }
    if (visual && (action.kind === "click" || action.kind === "fill")) {
      if (visual.beforeScreenshot) {
        session.beforeActionScreenshots.set(action.id, visual.beforeScreenshot);
      }
      if (visual.modelBeforeScreenshot) {
        session.modelBeforeActionScreenshots.set(action.id, visual.modelBeforeScreenshot);
      }
      if (modelScreenshot) {
        session.modelScreenshots.set(action.id, modelScreenshot);
      }
      const visualCase: StudioVisualGroundTruthCase = {
        caseId: id(),
        actionId: action.id,
        sessionId: session.id,
        createdAt: action.createdAt,
        pageUrl: sanitizeUrl(visual.pageUrl),
        frameRevisionBefore: visual.frameRevisionBefore,
        actionKind: action.kind,
        source: action.source ?? visual.source,
        intent: redactText(visual.intent),
        targetLabel: visual.targetLabel ? redactText(visual.targetLabel) : undefined,
        locator: action.locator,
        targetBox: visual.targetBox,
        beforeScreenshotAvailable: session.beforeActionScreenshots.has(action.id),
        afterScreenshotAvailable: session.screenshots.has(action.id),
      };
      session.visualCases.set(action.id, visualCase);
      this.queueSemanticEnrichment(session, action, visualCase);
    }
    session.updatedAt = now();
    return action;
  }

  async createSession(
    rawUrl: unknown,
    semanticEnrichment: unknown = false,
  ): Promise<StudioSession> {
    if (this.sessions.size + this.pendingSessions >= MAX_SESSIONS) {
      throw new StudioServiceError(`Studio is limited to ${MAX_SESSIONS} active sessions`, 429, "SESSION_LIMIT");
    }
    if (typeof semanticEnrichment !== "boolean") {
      throw new StudioServiceError(
        "semanticEnrichment must be a boolean",
        400,
        "INVALID_INPUT",
      );
    }
    if (semanticEnrichment && !this.semanticEnrichment) {
      throw new StudioServiceError(
        "OpenAI semantic enrichment is not configured for this Studio runner",
        503,
        "SEMANTIC_ENRICHMENT_UNAVAILABLE",
      );
    }
    const url = validateUrl(rawUrl);
    const targetUrl = browserUrl(url);
    this.pendingSessions += 1;
    try {
      const browser = await this.getBrowser();
      const context = await createGuardedContext(browser);
      const page = await context.newPage();
      const createdAt = now();
      const session: InternalSession = {
        id: id(), context, page, status: "ready", initialUrl: url, recording: false,
        semanticEnrichmentEnabled: semanticEnrichment,
        frameRevision: 1, actions: [], screenshots: new Map(), beforeActionScreenshots: new Map(),
        modelScreenshots: new Map(), modelBeforeActionScreenshots: new Map(),
        visualCases: new Map(), semanticEnrichments: new Map(), enrichmentQueue: Promise.resolve(),
        enrichmentAbort: new AbortController(), enrichmentControllers: new Map(),
        enrichmentTimers: new Map(), secrets: new Map(), questionnairePlans: new Map(),
        console: [], pageErrors: [], networkErrors: [],
        createdAt, updatedAt: createdAt, lastAccessedAt: Date.now(),
      };
      this.attachDiagnostics(session);
      try {
        await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
      } catch (error) {
        await context.close();
        throw new StudioServiceError(error instanceof Error ? error.message : "Navigation failed", 502, "NAVIGATION_FAILED");
      }
      this.sessions.set(session.id, session);
      return this.snapshot(session);
    } finally {
      this.pendingSessions -= 1;
    }
  }

  async getSession(sessionId: string): Promise<StudioSession> {
    return this.snapshot(this.requireSession(sessionId));
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = this.requireSession(sessionId);
    this.requireMutable(session);
    this.sessions.delete(sessionId);
    session.status = "closed";
    session.enrichmentAbort.abort();
    for (const timer of session.enrichmentTimers.values()) clearTimeout(timer);
    for (const controller of session.enrichmentControllers.values()) controller.abort();
    session.enrichmentTimers.clear();
    session.enrichmentControllers.clear();
    session.screenshots.clear();
    session.beforeActionScreenshots.clear();
    session.modelScreenshots.clear();
    session.modelBeforeActionScreenshots.clear();
    session.visualCases.clear();
    session.semanticEnrichments.clear();
    session.secrets.clear();
    session.questionnairePlans.clear();
    await session.context.close().catch(() => undefined);
  }

  async setRecording(sessionId: string, recording: unknown): Promise<StudioMutationResponse> {
    if (typeof recording !== "boolean") throw new StudioServiceError("recording must be a boolean", 400, "INVALID_INPUT");
    const session = this.requireSession(sessionId);
    this.requireMutable(session);
    let action: StudioAction | undefined;
    if (recording && !session.recording && session.actions.length === 0) {
      const currentUrl = validateUrl(displayUrl(session.page.url()));
      action = await this.appendAction(session, {
        id: id(), kind: "navigate", targetUrl: currentUrl, url: currentUrl,
        label: `Open ${currentUrl}`, createdAt: now(), screenshotAvailable: false,
      });
    }
    session.recording = recording;
    session.updatedAt = now();
    return { session: await this.snapshot(session), action };
  }

  async input(sessionId: string, request: StudioInputRequest): Promise<StudioMutationResponse> {
    const session = this.requireSession(sessionId);
    this.requireMutable(session);
    if (!request || typeof request !== "object" || !("kind" in request)) {
      throw new StudioServiceError("Input kind is required", 400, "INVALID_INPUT");
    }
    let action: StudioAction | undefined;

    if (request.kind === "navigate") {
      const targetUrl = validateUrl(request.url);
      await session.page.goto(browserUrl(targetUrl), { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
      session.frameRevision += 1;
      if (session.recording) {
        action = await this.appendAction(session, {
          id: id(), kind: "navigate", targetUrl, url: displayUrl(session.page.url()),
          label: `Open ${targetUrl}`, createdAt: now(), screenshotAvailable: false,
        });
      }
    } else if (request.kind === "click") {
      assertCoordinateRequest(session, request);
      const x = requireFinite(request.x, "x");
      const y = requireFinite(request.y, "y");
      if (x < 0 || x > STUDIO_VIEWPORT.width || y < 0 || y > STUDIO_VIEWPORT.height) {
        throw new StudioServiceError("Click coordinates are outside the Studio viewport", 400, "INVALID_COORDINATES");
      }
      const locatorCandidates = await candidatesAt(session.page, x, y);
      const locator = bestCandidate(locatorCandidates);
      const visual = session.recording
        ? await this.prepareVisualAction(session, locator, {
          source: "recorder",
          intent: `Click ${humanTarget(locator)}`,
          targetLabel: humanTarget(locator),
        })
        : undefined;
      await session.page.mouse.click(x, y);
      session.frameRevision += 1;
      if (session.recording) {
        action = await this.appendAction(session, {
          id: id(), kind: "click", x, y, locator, locatorCandidates, url: displayUrl(session.page.url()),
          label: `Click ${humanTarget(locator)}`, createdAt: now(), screenshotAvailable: false,
        } satisfies StudioClickAction, visual);
      }
    } else if (request.kind === "text") {
      if (typeof request.text !== "string" || request.text.length === 0 || request.text.length > MAX_INPUT_LENGTH) {
        throw new StudioServiceError("text must be between 1 and 20000 characters", 400, "INVALID_INPUT");
      }
      const active = await session.page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (!element || (!(element instanceof HTMLInputElement) && !(element instanceof HTMLTextAreaElement) && !element.isContentEditable)) return null;
        const rect = element.getBoundingClientRect();
        const labels = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
          ? Array.from(element.labels ?? []).map((label) => label.textContent ?? "").join(" ")
          : "";
        const metadata = `${element.getAttribute("name") ?? ""} ${element.getAttribute("aria-label") ?? ""} ${labels}`;
        const sensitive = element instanceof HTMLInputElement && element.type.toLowerCase() === "password"
          || /password|passwd|secret|token|api.?key/i.test(metadata);
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, sensitive };
      });
      if (!active) throw new StudioServiceError("Click an editable field before typing", 409, "NO_EDITABLE_TARGET");
      const locatorCandidates = await candidatesAt(session.page, active.x, active.y);
      const locator = bestCandidate(locatorCandidates);
      const previous = session.recording ? session.actions.at(-1) : undefined;
      const previousFill = previous?.kind === "fill" && previous.locator.selector === locator.selector
        ? previous
        : undefined;
      const visual = session.recording
        && !previousFill
        && !active.sensitive
        && !looksSecret(request.text)
        ? await this.prepareVisualAction(session, locator, {
          source: "recorder",
          intent: `Fill ${humanTarget(locator)}`,
          targetLabel: humanTarget(locator),
        })
        : undefined;
      await session.page.keyboard.insertText(request.text);
      const value = await session.page.evaluate(() => {
        const element = document.activeElement as HTMLInputElement | HTMLTextAreaElement | HTMLElement | null;
        return element && "value" in element ? String(element.value) : element?.textContent ?? "";
      });
      const sensitive = Boolean(previousFill?.sensitive) || active.sensitive || looksSecret(value);
      const publicValue = sensitive ? REDACTED_VALUE : value;
      session.frameRevision += 1;
      if (session.recording) {
        if (previousFill) {
          if (this.ownsAction(session, previousFill.id)) {
            previousFill.value = publicValue;
            previousFill.sensitive = sensitive;
            previousFill.label = `Fill ${humanTarget(locator)}`;
            if (sensitive) {
              session.secrets.set(previousFill.id, value);
              session.screenshots.delete(previousFill.id);
              session.beforeActionScreenshots.delete(previousFill.id);
              session.modelScreenshots.delete(previousFill.id);
              session.modelBeforeActionScreenshots.delete(previousFill.id);
              session.visualCases.delete(previousFill.id);
              session.semanticEnrichments.delete(previousFill.id);
              const timer = session.enrichmentTimers.get(previousFill.id);
              if (timer) clearTimeout(timer);
              session.enrichmentTimers.delete(previousFill.id);
              session.enrichmentControllers.get(previousFill.id)?.abort();
              session.enrichmentControllers.delete(previousFill.id);
              previousFill.screenshotAvailable = false;
              action = previousFill;
            } else {
              const visualCase = session.visualCases.get(previousFill.id);
              const modelTarget = visualCase?.targetBox;
              const [screenshot, modelScreenshot] = await Promise.all([
                captureScreenshot(session.page, 72).catch(() => undefined),
                this.semanticEnrichment
                  && session.semanticEnrichmentEnabled
                  && modelTarget
                  ? captureModelScreenshot(session.page, 72, modelTarget).catch(() => undefined)
                  : Promise.resolve(undefined),
              ]);
              if (this.ownsAction(session, previousFill.id) && !previousFill.sensitive) {
                session.secrets.delete(previousFill.id);
                if (screenshot) session.screenshots.set(previousFill.id, screenshot);
                else session.screenshots.delete(previousFill.id);
                if (modelScreenshot) session.modelScreenshots.set(previousFill.id, modelScreenshot);
                else session.modelScreenshots.delete(previousFill.id);
                previousFill.screenshotAvailable = Boolean(screenshot);
                if (visualCase) {
                  visualCase.afterScreenshotAvailable = Boolean(screenshot);
                  this.queueSemanticEnrichment(session, previousFill, visualCase);
                }
                action = previousFill;
              }
            }
          }
        } else {
          const fillAction = {
            id: id(), kind: "fill", value: publicValue, sensitive, locator, locatorCandidates, url: displayUrl(session.page.url()),
            label: `Fill ${humanTarget(locator)}`, createdAt: now(), screenshotAvailable: false,
          } satisfies StudioFillAction;
          if (sensitive) session.secrets.set(fillAction.id, value);
          action = await this.appendAction(session, fillAction, sensitive ? undefined : visual);
        }
      }
    } else if (request.kind === "key") {
      const key = requireString(request.key, "key", 80);
      const active = await session.page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (!element || element === document.body || element === document.documentElement) return null;
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return null;
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      });
      const locator = active ? bestCandidate(await candidatesAt(session.page, active.x, active.y)) : undefined;
      await session.page.keyboard.press(key);
      session.frameRevision += 1;
      if (session.recording) {
        action = await this.appendAction(session, {
          id: id(), kind: "press", key, locator, url: displayUrl(session.page.url()),
          label: `Press ${key}`, createdAt: now(), screenshotAvailable: false,
        });
      }
    } else if (request.kind === "scroll") {
      assertCoordinateRequest(session, request);
      const deltaX = requireFinite(request.deltaX, "deltaX");
      const deltaY = requireFinite(request.deltaY, "deltaY");
      await session.page.mouse.wheel(deltaX, deltaY);
      session.frameRevision += 1;
      if (session.recording) {
        action = await this.appendAction(session, {
          id: id(), kind: "scroll", deltaX, deltaY, url: displayUrl(session.page.url()),
          label: `Scroll ${Math.round(deltaX)}, ${Math.round(deltaY)}`, createdAt: now(), screenshotAvailable: false,
        });
      }
    } else {
      throw new StudioServiceError("Unsupported input kind", 400, "INVALID_INPUT");
    }

    session.updatedAt = now();
    return { session: await this.snapshot(session), action };
  }

  async addAssertion(sessionId: string, request: StudioAssertionRequest): Promise<StudioMutationResponse> {
    const session = this.requireSession(sessionId);
    this.requireMutable(session);
    let assertion: StudioAssertion;
    if (request.kind === "urlContains") {
      assertion = { kind: "urlContains", value: requireString(request.value, "URL fragment", 2_000) };
    } else if (request.kind === "textVisible") {
      const text = requireString(request.text, "Visible text", 2_000);
      const matchCount = await session.page.getByText(text, { exact: false }).count();
      if (matchCount !== 1) {
        throw new StudioServiceError(
          matchCount === 0 ? "That text is not currently visible on the page" : `That text matches ${matchCount} elements; use a more specific value`,
          422,
          matchCount === 0 ? "ASSERTION_TARGET_MISSING" : "ASSERTION_TARGET_AMBIGUOUS",
        );
      }
      assertion = { kind: "textVisible", text };
    } else if (request.kind === "elementVisible") {
      const locator = "locator" in request
        ? await normalizeCandidate(session.page, request.locator)
        : bestCandidate(await candidatesAt(session.page, requireFinite(request.x, "x"), requireFinite(request.y, "y")));
      if (!locator.unique) {
        throw new StudioServiceError(
          locator.matchCount === 0 ? "That element no longer matches the page" : `That locator matches ${locator.matchCount} elements`,
          422,
          locator.matchCount === 0 ? "ASSERTION_TARGET_MISSING" : "ASSERTION_TARGET_AMBIGUOUS",
        );
      }
      assertion = { kind: "elementVisible", locator };
    } else {
      throw new StudioServiceError("Unsupported assertion kind", 400, "INVALID_INPUT");
    }
    const label = assertion.kind === "urlContains"
      ? `URL contains ${assertion.value}`
      : assertion.kind === "textVisible"
        ? `See text ${assertion.text}`
        : `See ${assertion.locator.selector}`;
    const action = await this.appendAction(session, {
      id: id(), kind: "assertion", assertion, label, url: displayUrl(session.page.url()), createdAt: now(), screenshotAvailable: false,
    } satisfies StudioAssertionAction);
    return { session: await this.snapshot(session), action };
  }

  async deleteAction(sessionId: string, actionId: string): Promise<StudioSession> {
    const session = this.requireSession(sessionId);
    this.requireMutable(session);
    const index = session.actions.findIndex((action) => action.id === actionId);
    if (index < 0) throw new StudioServiceError("Studio action not found", 404, "ACTION_NOT_FOUND");
    session.actions.splice(index, 1);
    session.screenshots.delete(actionId);
    session.beforeActionScreenshots.delete(actionId);
    session.modelScreenshots.delete(actionId);
    session.modelBeforeActionScreenshots.delete(actionId);
    session.visualCases.delete(actionId);
    session.semanticEnrichments.delete(actionId);
    const enrichmentTimer = session.enrichmentTimers.get(actionId);
    if (enrichmentTimer) clearTimeout(enrichmentTimer);
    session.enrichmentTimers.delete(actionId);
    session.enrichmentControllers.get(actionId)?.abort();
    session.enrichmentControllers.delete(actionId);
    session.secrets.delete(actionId);
    session.updatedAt = now();
    return this.snapshot(session);
  }

  async currentFrame(sessionId: string): Promise<{ image: Uint8Array; frameRevision: number }> {
    const session = this.requireSession(sessionId);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const frameRevision = session.frameRevision;
      const screenshot = await captureScreenshot(session.page, 78);
      if (frameRevision === session.frameRevision) {
        if (session.lastFrame
          && session.lastFrameRevision === session.frameRevision
          && !sameBytes(session.lastFrame, screenshot)) {
          session.frameRevision += 1;
          session.updatedAt = now();
        }
        session.lastFrame = screenshot;
        session.lastFrameRevision = session.frameRevision;
        return { image: screenshot, frameRevision: session.frameRevision };
      }
    }
    throw new StudioServiceError("The page changed while its frame was captured", 409, "STALE_FRAME");
  }

  actionScreenshot(
    sessionId: string,
    actionId: string,
    phase: "before" | "after" = "after",
  ): Uint8Array {
    const session = this.requireSession(sessionId);
    const screenshot = phase === "before"
      ? session.beforeActionScreenshots.get(actionId)
      : session.screenshots.get(actionId);
    if (!screenshot) throw new StudioServiceError("Action screenshot not found", 404, "SCREENSHOT_NOT_FOUND");
    return screenshot;
  }

  evidence(sessionId: string): StudioEvidence {
    return this.evidenceFor(this.requireSession(sessionId));
  }

  visualDataset(sessionId: string): StudioVisualDataset {
    const session = this.requireSession(sessionId);
    const cases = session.actions
      .map((action) => session.visualCases.get(action.id))
      .filter((item): item is StudioVisualGroundTruthCase => Boolean(item))
      .map((item) => structuredClone(item));
    return {
      schemaVersion: 1,
      sessionId: session.id,
      createdAt: session.createdAt,
      cases,
    };
  }

  private requireSavedFlowStore(): SavedFlowStore {
    if (!this.savedFlowStore) {
      throw new StudioServiceError(
        "Saved flow storage is not configured",
        503,
        "SAVED_FLOW_STORAGE_UNAVAILABLE",
      );
    }
    return this.savedFlowStore;
  }

  listSavedFlows(): StudioSavedFlowSummary[] {
    return this.requireSavedFlowStore().list();
  }

  getSavedFlow(flowId: string): StudioSavedFlow {
    const normalizedFlowId = savedFlowId(flowId);
    const flow = normalizedFlowId
      ? this.requireSavedFlowStore().get(normalizedFlowId)
      : null;
    if (!flow) {
      throw new StudioServiceError("Saved flow not found", 404, "SAVED_FLOW_NOT_FOUND");
    }
    return flow;
  }

  async saveFlow(
    sessionId: string,
    request: StudioSaveFlowRequest | Record<string, unknown>,
  ): Promise<StudioSavedFlow> {
    const store = this.requireSavedFlowStore();
    const session = this.requireSession(sessionId);
    this.requireMutable(session);
    if (session.recording) {
      throw new StudioServiceError(
        "Stop recording before saving this flow",
        409,
        "RECORDING_ACTIVE",
      );
    }
    if (session.actions.length === 0) {
      throw new StudioServiceError(
        "Record at least one step before saving",
        409,
        "EMPTY_SAVED_FLOW",
      );
    }
    const processingEnrichment = [...session.semanticEnrichments.values()].some(
      (enrichment) => enrichment.status === "queued" || enrichment.status === "running",
    );
    if (processingEnrichment) {
      throw new StudioServiceError(
        "Wait for semantic enrichment to finish before saving",
        409,
        "ENRICHMENT_IN_PROGRESS",
      );
    }

    const requestedFlowId = savedFlowId(request.flowId);
    const existing = requestedFlowId ? store.get(requestedFlowId) : null;
    if (requestedFlowId && !existing) {
      throw new StudioServiceError("Saved flow not found", 404, "SAVED_FLOW_NOT_FOUND");
    }
    if (existing && existing.sourceSessionId !== session.id) {
      throw new StudioServiceError(
        "This recording cannot overwrite a flow from another browser session",
        409,
        "SAVED_FLOW_SESSION_MISMATCH",
      );
    }

    const secretValues = [...session.secrets.values()].filter(Boolean);
    const name = sanitizePersistedText(savedFlowName(request.name), secretValues);
    const requestedDescription = savedFlowDescription(request.description);
    const rawDescription = request.description === undefined
      ? existing?.description
      : requestedDescription;
    const description = rawDescription
      ? sanitizePersistedText(rawDescription, secretValues)
      : undefined;
    const snapshot = await this.snapshot(session);
    const actions = snapshot.actions.map((action) =>
      sanitizeActionForPersistence(action, secretValues)
    );
    const actionsById = new Map(actions.map((action) => [action.id, action]));
    const visualDataset = sanitizePersistedValue(
      this.visualDataset(session.id),
      secretValues,
    );
    for (const visualCase of visualDataset.cases) {
      visualCase.pageUrl = sanitizePersistedUrl(visualCase.pageUrl, secretValues);
    }
    const visualCasesByAction = new Map(
      visualDataset.cases.map((visualCase) => [visualCase.actionId, visualCase]),
    );
    const semanticEnrichments = sanitizePersistedValue(
      structuredClone(snapshot.semanticEnrichments),
      secretValues,
    );
    const evidence = sanitizePersistedValue(
      structuredClone(snapshot.evidence),
      secretValues,
    );
    evidence.networkErrors = evidence.networkErrors.map((entry) => ({
      ...entry,
      url: sanitizePersistedUrl(entry.url, secretValues),
    }));
    const screenshots: SavedFlowScreenshot[] = [];
    let protectedInputSeen = false;
    for (const action of session.actions) {
      if (action.kind === "fill" && action.sensitive) {
        protectedInputSeen = true;
      }
      if (protectedInputSeen) {
        const savedAction = actionsById.get(action.id);
        if (savedAction) savedAction.screenshotAvailable = false;
        const visualCase = visualCasesByAction.get(action.id);
        if (visualCase) {
          visualCase.beforeScreenshotAvailable = false;
          visualCase.afterScreenshotAvailable = false;
        }
        continue;
      }
      const before = session.beforeActionScreenshots.get(action.id);
      if (before) screenshots.push({ actionId: action.id, phase: "before", image: before });
      const after = session.screenshots.get(action.id);
      if (after) screenshots.push({ actionId: action.id, phase: "after", image: after });
    }
    evidence.actionScreenshotIds = screenshots
      .filter((screenshot) => screenshot.phase === "after")
      .map((screenshot) => screenshot.actionId);

    const timestamp = now();
    const initialUrl = sanitizePersistedUrl(snapshot.initialUrl, secretValues);
    const finalUrl = sanitizePersistedUrl(snapshot.url, secretValues);
    const flow: StudioSavedFlow = {
      schemaVersion: 1,
      id: requestedFlowId ?? id(),
      name,
      description,
      sourceSessionId: session.id,
      runtime: snapshot.runtime,
      semanticEnrichmentEnabled: snapshot.semanticEnrichmentEnabled,
      initialUrl,
      finalUrl,
      pageTitle: sanitizePersistedText(snapshot.title, secretValues),
      viewport: STUDIO_VIEWPORT,
      actions,
      semanticEnrichments,
      evidence,
      visualDataset,
      generatedCode: generatePlaywrightCode(initialUrl, actions),
      actionCount: actions.length,
      assertionCount: actions.filter((action) => action.kind === "assertion").length,
      screenshotCount: screenshots.length,
      enrichedActionCount: Object.values(semanticEnrichments)
        .filter((enrichment) => enrichment?.status === "ready").length,
      recordedAt: snapshot.createdAt,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };

    try {
      return store.save(flow, screenshots);
    } catch (error) {
      if (error instanceof Error && error.message.includes("Saved flow limit")) {
        throw new StudioServiceError(error.message, 409, "SAVED_FLOW_LIMIT");
      }
      if (
        error instanceof Error
        && (error.message.includes("too large")
          || error.message.includes("storage limit"))
      ) {
        throw new StudioServiceError(error.message, 413, "SAVED_FLOW_TOO_LARGE");
      }
      throw new StudioServiceError(
        "The recording could not be saved",
        500,
        "SAVED_FLOW_WRITE_FAILED",
      );
    }
  }

  deleteSavedFlow(flowId: string): void {
    const normalizedFlowId = savedFlowId(flowId);
    if (!normalizedFlowId || !this.requireSavedFlowStore().delete(normalizedFlowId)) {
      throw new StudioServiceError("Saved flow not found", 404, "SAVED_FLOW_NOT_FOUND");
    }
  }

  savedFlowScreenshot(
    flowId: string,
    actionId: string,
    phase: "before" | "after",
  ): Uint8Array {
    const normalizedFlowId = savedFlowId(flowId);
    const screenshot = normalizedFlowId
      ? this.requireSavedFlowStore().screenshot(normalizedFlowId, actionId, phase)
      : null;
    if (!screenshot) {
      throw new StudioServiceError(
        "Saved flow screenshot not found",
        404,
        "SCREENSHOT_NOT_FOUND",
      );
    }
    return screenshot;
  }

  questionnaireCatalog() {
    return getQuestionnaireCatalog();
  }

  private async detectQuestionnaireIds(page: Page): Promise<string[]> {
    const pageSignals = await page.evaluate(() => ({
      ids: Array.from(document.querySelectorAll<HTMLElement>("[data-questionnaire-id]"))
        .map((element) => element.dataset.questionnaireId?.trim().toLowerCase())
        .filter((value): value is string => Boolean(value)),
      headings: Array.from(document.querySelectorAll("h1, h2, h3, legend"))
        .map((element) => element.textContent?.replace(/\s+/g, " ").trim().toLowerCase() ?? "")
        .filter(Boolean),
    }));
    const detected = new Set(pageSignals.ids);
    for (const questionnaire of getQuestionnaireCatalog().questionnaires) {
      const compactId = questionnaire.id.replace(/[^a-z0-9]/g, "");
      if (pageSignals.headings.some((heading) => heading.replace(/[^a-z0-9]/g, "").includes(compactId))) {
        detected.add(questionnaire.id);
      }
    }
    return [...detected];
  }

  async planQuestionnaire(sessionId: string, rawCommand: unknown): Promise<QuestionnaireRunPlan> {
    const command = requireString(rawCommand, "Command", 2_000);
    const session = this.requireSession(sessionId);
    this.requireMutable(session);
    const pageUrl = sanitizeUrl(displayUrl(session.page.url()));
    const detectedQuestionnaireIds = await this.detectQuestionnaireIds(session.page);
    const plan = {
      ...compileQuestionnaireCommand(command, pageUrl, detectedQuestionnaireIds),
      command: redactText(command),
    };
    session.questionnairePlans.set(plan.id, plan);
    while (session.questionnairePlans.size > 20) {
      const oldest = session.questionnairePlans.keys().next().value;
      if (!oldest) break;
      session.questionnairePlans.delete(oldest);
    }
    session.updatedAt = now();
    return plan;
  }

  async executeQuestionnaire(
    sessionId: string,
    request: QuestionnaireExecutionRequest,
  ): Promise<QuestionnaireExecutionResult> {
    const session = this.requireSession(sessionId);
    this.requireMutable(session);
    if (!request || typeof request !== "object") {
      throw new StudioServiceError("Execution request is required", 400, "INVALID_INPUT");
    }
    const planId = requireString(request.planId, "planId", 200);
    if (request.confirmSubmit !== undefined && typeof request.confirmSubmit !== "boolean") {
      throw new StudioServiceError("confirmSubmit must be a boolean", 400, "INVALID_INPUT");
    }
    const plan = session.questionnairePlans.get(planId);
    if (!plan) throw new StudioServiceError("Questionnaire plan not found or expired", 404, "PLAN_NOT_FOUND");
    if (plan.status === "blocked" || !plan.questionnaireId) {
      throw new StudioServiceError("Blocked questionnaire plans cannot be executed", 422, "PLAN_BLOCKED");
    }
    if (plan.submitRequested && !request.confirmSubmit) {
      throw new StudioServiceError("Confirm submission after reviewing the plan", 409, "SUBMIT_CONFIRMATION_REQUIRED");
    }
    if (session.actions.some((action) => action.commandPlanId === plan.id)) {
      throw new StudioServiceError("This questionnaire plan has already been executed", 409, "PLAN_ALREADY_EXECUTED");
    }
    const currentUrl = sanitizeUrl(displayUrl(session.page.url()));
    if (currentUrl !== plan.pageUrl) {
      throw new StudioServiceError("The page changed after this plan was reviewed", 409, "PLAN_PAGE_CHANGED");
    }
    const definition = getQuestionnaireDefinition(plan.questionnaireId);
    if (!definition) {
      throw new StudioServiceError("Questionnaire definition is no longer available", 409, "DEFINITION_CHANGED");
    }
    if (definition.version !== plan.questionnaireVersion) {
      throw new StudioServiceError("Questionnaire definition changed after the plan was reviewed", 409, "DEFINITION_CHANGED");
    }

    const markers = session.page.locator(`[data-questionnaire-id="${definition.id}" i]`);
    const markerCount = await markers.count();
    const detectedIds = await this.detectQuestionnaireIds(session.page);
    if (!detectedIds.includes(definition.id)) {
      throw new StudioServiceError(`${definition.title} was not found on the current page`, 422, "QUESTIONNAIRE_NOT_FOUND");
    }
    if (markerCount > 1) {
      throw new StudioServiceError(`${definition.title} matched more than one page section`, 422, "QUESTIONNAIRE_AMBIGUOUS");
    }
    const root = markerCount === 1 ? markers : session.page.locator("body");
    const targets: Array<{ step: QuestionnaireRunPlan["steps"][number]; locator: Locator }> = [];

    for (const step of plan.steps) {
      const numericQuestionId = step.questionId.match(/(\d+)$/)?.[1];
      const dataQuestionIds = [...new Set([
        step.questionId,
        numericQuestionId ? `q${numericQuestionId}` : "",
      ].filter(Boolean))];
      let group = root.locator(
        dataQuestionIds.map((questionId) => `[data-question-id="${questionId}"]`).join(", "),
      );
      let groupCount = await group.count();
      if (groupCount === 0) {
        group = root.getByRole("group", { name: step.prompt, exact: true });
        groupCount = await group.count();
      }
      if (groupCount === 0) {
        group = root.locator("fieldset").filter({ hasText: step.prompt });
        groupCount = await group.count();
      }
      if (groupCount !== 1) {
        throw new StudioServiceError(
          groupCount === 0
            ? `Question ${step.questionId} is missing from the page`
            : `Question ${step.questionId} matched ${groupCount} sections`,
          422,
          groupCount === 0 ? "QUESTION_MISSING" : "QUESTION_AMBIGUOUS",
        );
      }

      let target = group.getByRole("radio", { name: step.answerLabel, exact: true });
      let targetCount = await target.count();
      if (targetCount === 0) {
        target = group.locator(`input[type="radio"][value="${step.answerId}"]`);
        targetCount = await target.count();
      }
      if (targetCount !== 1 || !await target.isVisible() || !await target.isEnabled()) {
        throw new StudioServiceError(
          targetCount === 0
            ? `Approved answer “${step.answerLabel}” is missing for ${step.questionId}`
            : `Approved answer “${step.answerLabel}” is not uniquely actionable for ${step.questionId}`,
          422,
          targetCount === 0 ? "ANSWER_MISSING" : "ANSWER_AMBIGUOUS",
        );
      }
      targets.push({ step, locator: target });
    }

    let submitTarget: Locator | undefined;
    if (plan.submitRequested) {
      submitTarget = root.getByTestId("questionnaire-submit");
      if (await submitTarget.count() === 0) {
        submitTarget = root.getByRole("button", { name: /submit|finish|complete/i });
      }
      const submitCount = await submitTarget.count();
      if (submitCount !== 1 || !await submitTarget.isVisible()) {
        throw new StudioServiceError("A unique visible submit control was not found", 422, "SUBMIT_TARGET_MISSING");
      }
    }

    let actionsRecorded = 0;
    for (const { step, locator: target } of targets) {
      await target.scrollIntoViewIfNeeded();
      const box = await visibleInteractionSurfaceBox(target);
      if (!box) {
        throw new StudioServiceError(`Answer control for ${step.questionId} is no longer visible`, 409, "PAGE_CHANGED");
      }
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      const controlBox = await target.boundingBox().catch(() => null) ?? box;
      const locatorCandidates = await candidatesAt(
        session.page,
        controlBox.x + controlBox.width / 2,
        controlBox.y + controlBox.height / 2,
      );
      const locator = bestCandidate(locatorCandidates);
      const visual = await this.prepareVisualAction(session, locator, {
        source: "questionnaire",
        intent: `Reviewed command “${plan.command}” — step ${step.index + 1}: choose “${step.answerLabel}” for “${step.prompt}”`,
        targetLabel: `${step.prompt}: ${step.answerLabel}`,
        targetBox: targetBox(box),
      });
      await target.click();
      session.frameRevision += 1;
      await this.appendAction(session, {
        id: id(),
        kind: "click",
        x: Math.round(x),
        y: Math.round(y),
        locator,
        locatorCandidates,
        url: displayUrl(session.page.url()),
        label: `Choose “${step.answerLabel}” for ${step.questionId}`,
        createdAt: now(),
        screenshotAvailable: false,
        source: "questionnaire",
        commandPlanId: plan.id,
      } satisfies StudioClickAction, visual);
      actionsRecorded += 1;
    }

    let submitted = false;
    if (submitTarget) {
      if (!await submitTarget.isEnabled()) {
        throw new StudioServiceError("Submit did not become enabled after filling the approved answers", 409, "SUBMIT_TARGET_DISABLED");
      }
      await submitTarget.scrollIntoViewIfNeeded();
      const box = await visibleInteractionSurfaceBox(submitTarget);
      if (!box) throw new StudioServiceError("Submit control is no longer visible", 409, "PAGE_CHANGED");
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      const locatorCandidates = await candidatesAt(session.page, x, y);
      const locator = bestCandidate(locatorCandidates);
      const visual = await this.prepareVisualAction(session, locator, {
        source: "questionnaire",
        intent: `Reviewed command “${plan.command}” — submit ${definition.title}`,
        targetLabel: `Submit ${definition.title}`,
        targetBox: targetBox(box),
      });
      await submitTarget.click();
      session.frameRevision += 1;
      await this.appendAction(session, {
        id: id(),
        kind: "click",
        x: Math.round(x),
        y: Math.round(y),
        locator,
        locatorCandidates,
        url: displayUrl(session.page.url()),
        label: `Submit ${definition.title}`,
        createdAt: now(),
        screenshotAvailable: false,
        source: "questionnaire",
        commandPlanId: plan.id,
      } satisfies StudioClickAction, visual);
      actionsRecorded += 1;
      submitted = true;
    }

    session.updatedAt = now();
    return {
      status: "completed",
      planId: plan.id,
      filledCount: targets.length,
      totalQuestions: plan.steps.length,
      submitted,
      actionsRecorded,
      visualCasesCaptured: session.actions.filter((action) =>
        action.commandPlanId === plan.id && session.visualCases.has(action.id)
      ).length,
      completedAt: now(),
      warnings: plan.warnings,
      session: await this.snapshot(session),
    };
  }

  async replay(sessionId: string): Promise<StudioReplayResult> {
    const session = this.requireSession(sessionId);
    if (session.status === "replaying") throw new StudioServiceError("A replay is already running", 409, "REPLAY_RUNNING");
    const actions = structuredClone(session.actions);
    const secrets = new Map(session.secrets);
    const initialUrl = session.initialUrl;
    session.status = "replaying";
    session.updatedAt = now();
    const startedAt = now();
    const started = performance.now();
    const steps: StudioReplayStepResult[] = [];
    let failed = false;
    let context: BrowserContext | undefined;
    let page: Page | undefined;
    try {
      const browser = await this.getBrowser();
      context = await createGuardedContext(browser);
      page = await context.newPage();
      if (actions[0]?.kind !== "navigate") {
        await page.goto(browserUrl(initialUrl), { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
      }
      for (const [index, action] of actions.entries()) {
        const stepStarted = performance.now();
        try {
          await this.executeAction(page, action, secrets);
          steps.push({ actionId: action.id, index, kind: action.kind, label: action.label, status: "passed", durationMs: Math.round(performance.now() - stepStarted) });
        } catch (error) {
          failed = true;
          steps.push({
            actionId: action.id, index, kind: action.kind, label: action.label, status: "failed",
            durationMs: Math.round(performance.now() - stepStarted), error: redactText(error instanceof Error ? error.message : String(error)),
          });
          break;
        }
      }
      return {
        status: failed ? "failed" : "passed",
        startedAt,
        completedAt: now(),
        durationMs: Math.round(performance.now() - started),
        finalUrl: sanitizeUrl(displayUrl(page.url())),
        steps,
      };
    } finally {
      await context?.close().catch(() => undefined);
      session.status = "ready";
      session.updatedAt = now();
    }
  }

  private async executeAction(page: Page, action: StudioAction, secrets: ReadonlyMap<string, string>): Promise<void> {
    switch (action.kind) {
      case "navigate":
        await page.goto(browserUrl(action.targetUrl), { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
        return;
      case "click":
        await locatorFor(page, action.locator).click();
        return;
      case "fill":
        await locatorFor(page, action.locator).fill(action.sensitive ? secrets.get(action.id) ?? "" : action.value);
        return;
      case "press":
        if (action.locator) await locatorFor(page, action.locator).press(action.key);
        else await page.keyboard.press(action.key);
        return;
      case "scroll":
        await page.mouse.wheel(action.deltaX, action.deltaY);
        return;
      case "assertion":
        if (action.assertion.kind === "urlContains") {
          const expectedUrlText = action.assertion.value;
          await page.waitForURL((url) => displayUrl(url.toString()).includes(expectedUrlText), { timeout: ASSERTION_TIMEOUT_MS });
        } else if (action.assertion.kind === "textVisible") {
          await page.getByText(action.assertion.text, { exact: false }).waitFor({ state: "visible", timeout: ASSERTION_TIMEOUT_MS });
        } else {
          await locatorFor(page, action.assertion.locator).waitFor({ state: "visible", timeout: ASSERTION_TIMEOUT_MS });
        }
    }
  }

  generateCode(sessionId: string): string {
    const session = this.requireSession(sessionId);
    return generatePlaywrightCode(session.initialUrl, session.actions);
  }

  async close(): Promise<void> {
    clearInterval(this.sessionReaper);
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    for (const session of sessions) {
      session.enrichmentAbort.abort();
      for (const timer of session.enrichmentTimers.values()) clearTimeout(timer);
      for (const controller of session.enrichmentControllers.values()) controller.abort();
      session.enrichmentTimers.clear();
      session.enrichmentControllers.clear();
      session.screenshots.clear();
      session.beforeActionScreenshots.clear();
      session.modelScreenshots.clear();
      session.modelBeforeActionScreenshots.clear();
      session.visualCases.clear();
      session.semanticEnrichments.clear();
      session.secrets.clear();
      session.questionnairePlans.clear();
    }
    await Promise.all(sessions.map((session) => session.context.close().catch(() => undefined)));
    await this.browser?.close().catch(() => undefined);
    this.browser = undefined;
    this.savedFlowStore?.close();
  }
}
