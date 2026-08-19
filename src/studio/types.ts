export const STUDIO_API_BASE = "/api/studio" as const;
export const STUDIO_VIEWPORT = { width: 1280, height: 720 } as const;

export type StudioSessionId = string;
export type StudioActionId = string;
export type StudioSavedFlowId = string;
export type StudioIsoDateTime = string;

export type StudioSessionStatus = "ready" | "replaying" | "closed" | "error";
export type StudioRuntime = "local" | "container";
export type StudioLocatorStrategy = "role" | "label" | "placeholder" | "testId" | "alt" | "text" | "css";

export interface StudioLocatorCandidate {
  strategy: StudioLocatorStrategy;
  /** Human-readable Playwright expression, for example getByRole("button", { name: "Pay" }). */
  selector: string;
  /** Strategy value: role, label, placeholder, test id, text, or CSS selector. */
  value: string;
  name?: string;
  matchCount: number;
  unique: boolean;
  score: number;
}

export interface StudioConsoleEntry {
  id: string;
  level: "debug" | "info" | "log" | "warning" | "error";
  text: string;
  at: StudioIsoDateTime;
}

export interface StudioPageError {
  id: string;
  message: string;
  stack?: string;
  at: StudioIsoDateTime;
}

export interface StudioNetworkError {
  id: string;
  url: string;
  method: string;
  resourceType: string;
  errorText: string;
  at: StudioIsoDateTime;
}

export interface StudioEvidence {
  console: StudioConsoleEntry[];
  pageErrors: StudioPageError[];
  networkErrors: StudioNetworkError[];
  actionScreenshotIds: StudioActionId[];
}

interface StudioActionBase {
  id: StudioActionId;
  createdAt: StudioIsoDateTime;
  url: string;
  label: string;
  screenshotAvailable: boolean;
  /** How the step entered the timeline. Existing recorded steps default to `recorder`. */
  source?: "recorder" | "questionnaire";
  /** Groups deterministic questionnaire steps under the reviewed plan that created them. */
  commandPlanId?: string;
}

export interface StudioNavigateAction extends StudioActionBase {
  kind: "navigate";
  targetUrl: string;
}

export interface StudioClickAction extends StudioActionBase {
  kind: "click";
  x: number;
  y: number;
  locator: StudioLocatorCandidate;
  locatorCandidates: StudioLocatorCandidate[];
}

export interface StudioFillAction extends StudioActionBase {
  kind: "fill";
  value: string;
  sensitive?: boolean;
  locator: StudioLocatorCandidate;
  locatorCandidates: StudioLocatorCandidate[];
}

export interface StudioPressAction extends StudioActionBase {
  kind: "press";
  key: string;
  locator?: StudioLocatorCandidate;
}

export interface StudioScrollAction extends StudioActionBase {
  kind: "scroll";
  deltaX: number;
  deltaY: number;
}

export type StudioAssertion =
  | { kind: "urlContains"; value: string }
  | { kind: "textVisible"; text: string }
  | { kind: "elementVisible"; locator: StudioLocatorCandidate };

export interface StudioAssertionAction extends StudioActionBase {
  kind: "assertion";
  assertion: StudioAssertion;
}

export type StudioAction =
  | StudioNavigateAction
  | StudioClickAction
  | StudioFillAction
  | StudioPressAction
  | StudioScrollAction
  | StudioAssertionAction;

export interface StudioTargetBox {
  x: number;
  y: number;
  width: number;
  height: number;
  viewport: {
    width: number;
    height: number;
  };
}

export interface StudioVisualGroundTruthCase {
  caseId: string;
  actionId: StudioActionId;
  sessionId: StudioSessionId;
  createdAt: StudioIsoDateTime;
  pageUrl: string;
  frameRevisionBefore: number;
  actionKind: StudioAction["kind"];
  source: "recorder" | "questionnaire";
  intent: string;
  targetLabel?: string;
  locator?: StudioLocatorCandidate;
  targetBox?: StudioTargetBox;
  beforeScreenshotAvailable: boolean;
  afterScreenshotAvailable: boolean;
}

export interface StudioVisualDataset {
  schemaVersion: 1;
  sessionId: StudioSessionId;
  createdAt: StudioIsoDateTime;
  cases: StudioVisualGroundTruthCase[];
}

export type StudioSemanticEnrichmentStatus = "queued" | "running" | "ready" | "error";
export type StudioSemanticActionRisk = "routine" | "sensitive" | "destructive" | "unknown";

interface StudioSemanticEnrichmentBase {
  provider: "openai";
  model: string;
  requestedAt: StudioIsoDateTime;
}

export type StudioSemanticEnrichment =
  | (StudioSemanticEnrichmentBase & {
      status: "queued" | "running";
    })
  | (StudioSemanticEnrichmentBase & {
      status: "ready";
      completedAt: StudioIsoDateTime;
      intent: string;
      targetRole: string;
      journeyStage: string;
      expectedOutcome: string;
      visualFallback: string;
      confidence: number;
      evidence: string[];
      actionRisk: StudioSemanticActionRisk;
      requiresConfirmation: boolean;
    })
  | (StudioSemanticEnrichmentBase & {
      status: "error";
      completedAt: StudioIsoDateTime;
      error: string;
    });

export interface StudioSession {
  id: StudioSessionId;
  runtime: StudioRuntime;
  status: StudioSessionStatus;
  initialUrl: string;
  url: string;
  title: string;
  recording: boolean;
  semanticEnrichmentEnabled: boolean;
  viewport: typeof STUDIO_VIEWPORT;
  /** Browser-state revision. Reading a frame never changes it. */
  frameRevision: number;
  actions: StudioAction[];
  /** Model annotations are kept separate so Playwright actions remain deterministic. */
  semanticEnrichments: Partial<Record<StudioActionId, StudioSemanticEnrichment>>;
  evidence: StudioEvidence;
  createdAt: StudioIsoDateTime;
  updatedAt: StudioIsoDateTime;
  error?: string;
}

export interface StudioCreateSessionRequest {
  url: string;
  semanticEnrichment?: boolean;
}

export interface StudioFrameResponse {
  blob: Blob;
  frameRevision: number;
}

export type StudioInputRequest =
  | { kind: "click"; x: number; y: number; frameRevision: number; viewport: typeof STUDIO_VIEWPORT }
  | { kind: "text"; text: string }
  | { kind: "key"; key: string }
  | { kind: "scroll"; deltaX: number; deltaY: number; frameRevision: number; viewport: typeof STUDIO_VIEWPORT }
  | { kind: "navigate"; url: string };

export interface StudioRecordingRequest {
  recording: boolean;
}

export type StudioAssertionRequest =
  | { kind: "urlContains"; value: string }
  | { kind: "textVisible"; text: string }
  | { kind: "elementVisible"; locator: StudioLocatorCandidate }
  | { kind: "elementVisible"; x: number; y: number };

export interface StudioCodeResponse {
  code: string;
}

export interface StudioSavedFlowSummary {
  id: StudioSavedFlowId;
  name: string;
  description?: string;
  initialUrl: string;
  finalUrl: string;
  pageTitle: string;
  actionCount: number;
  assertionCount: number;
  screenshotCount: number;
  enrichedActionCount: number;
  recordedAt: StudioIsoDateTime;
  createdAt: StudioIsoDateTime;
  updatedAt: StudioIsoDateTime;
}

export interface StudioSavedFlow extends StudioSavedFlowSummary {
  schemaVersion: 1;
  sourceSessionId: StudioSessionId;
  runtime: StudioRuntime;
  semanticEnrichmentEnabled: boolean;
  viewport: typeof STUDIO_VIEWPORT;
  actions: StudioAction[];
  semanticEnrichments: Partial<Record<StudioActionId, StudioSemanticEnrichment>>;
  evidence: StudioEvidence;
  visualDataset: StudioVisualDataset;
  generatedCode: string;
}

export interface StudioSavedFlowListResponse {
  flows: StudioSavedFlowSummary[];
}

export interface StudioSaveFlowRequest {
  name: string;
  description?: string;
  flowId?: StudioSavedFlowId;
}

export interface StudioReplayStepResult {
  actionId: StudioActionId;
  index: number;
  kind: StudioAction["kind"];
  label: string;
  status: "passed" | "failed";
  durationMs: number;
  error?: string;
}

export interface StudioReplayResult {
  status: "passed" | "failed";
  startedAt: StudioIsoDateTime;
  completedAt: StudioIsoDateTime;
  durationMs: number;
  finalUrl: string;
  steps: StudioReplayStepResult[];
}

export interface StudioMutationResponse {
  session: StudioSession;
  action?: StudioAction;
}

export interface StudioDeleteResponse {
  ok: true;
}

export interface StudioErrorResponse {
  error: string;
  code?: string;
}

export type QuestionnaireExecutionMode = "fill-only" | "submit";
export type QuestionnairePlanStatus = "ready" | "needs-confirmation" | "blocked";

export interface QuestionnaireProfileSummary {
  id: string;
  label: string;
  description: string;
  synthetic: true;
  aliases: string[];
}

export interface QuestionnaireDefinitionSummary {
  id: string;
  title: string;
  version: string;
  description: string;
  questionCount: number;
  profiles: QuestionnaireProfileSummary[];
}

export interface QuestionnaireCatalog {
  questionnaires: QuestionnaireDefinitionSummary[];
  safetyNotice: string;
}

export interface QuestionnairePlanStep {
  index: number;
  questionId: string;
  prompt: string;
  answerId: string;
  answerLabel: string;
}

export interface QuestionnaireRunPlan {
  id: string;
  command: string;
  status: QuestionnairePlanStatus;
  mode: QuestionnaireExecutionMode;
  submitRequested: boolean;
  questionnaireId?: string;
  questionnaireTitle?: string;
  questionnaireVersion?: string;
  profileId?: string;
  profileLabel?: string;
  pageUrl: string;
  createdAt: StudioIsoDateTime;
  source: "deterministic-parser";
  steps: QuestionnairePlanStep[];
  warnings: string[];
  blockers: string[];
}

export interface QuestionnaireCommandRequest {
  command: string;
}

export interface QuestionnaireExecutionRequest {
  planId: string;
  confirmSubmit?: boolean;
}

export interface QuestionnaireExecutionResult {
  status: "completed";
  planId: string;
  filledCount: number;
  totalQuestions: number;
  submitted: boolean;
  actionsRecorded: number;
  visualCasesCaptured: number;
  completedAt: StudioIsoDateTime;
  warnings: string[];
  session: StudioSession;
}
