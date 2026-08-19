/**
 * Shared product types for the Flakey MVP.
 *
 * Dates are ISO-8601 strings and durations are milliseconds so the UI can
 * format them consistently for locale, relative time, and tabular displays.
 */

export type EntityId = string;
export type IsoDateTime = string;

/** The canonical status set from the design system's sacred status palette. */
export type TestStatus =
  | "passed"
  | "failed"
  | "flaky"
  | "skipped"
  | "running"
  | "quarantined"
  | "blocked";

export type ReadinessVerdict = "ready" | "at-risk" | "not-ready";
export type Priority = "critical" | "high" | "medium" | "low";
export type Severity = "blocker" | "critical" | "major" | "minor";

export interface StatusCounts {
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  running: number;
  quarantined: number;
  blocked: number;
  total: number;
}

export type TeamRole =
  | "qa-lead"
  | "qa-engineer"
  | "automation-engineer"
  | "developer"
  | "product-manager"
  | "viewer";

export interface TeamMember {
  id: EntityId;
  name: string;
  initials: string;
  email: string;
  title: string;
  role: TeamRole;
  presence: "online" | "away" | "offline";
  timezone: string;
  avatarUrl?: string;
}

export interface Project {
  id: EntityId;
  name: string;
  key: string;
  defaultBranch: string;
  repository: string;
  testFramework: "playwright";
}

export interface Environment {
  id: EntityId;
  name: string;
  slug: string;
  baseUrl: string;
  health: "healthy" | "degraded" | "unavailable";
  lastCheckedAt: IsoDateTime;
}

export interface EvidenceLink {
  label: string;
  href: string;
  targetType:
    | "run"
    | "test"
    | "manual-case"
    | "manual-execution"
    | "triage"
    | "requirement"
    | "external";
  targetId: EntityId;
}

export interface ReadinessReason {
  id: EntityId;
  status: Extract<TestStatus, "failed" | "flaky" | "blocked" | "quarantined">;
  title: string;
  detail: string;
  count: number;
  evidence: EvidenceLink;
}

export interface AutomationReadinessMetrics extends StatusCounts {
  durationMs: number;
  branch: string;
  latestRunId: EntityId;
}

export interface ManualReadinessMetrics {
  passed: number;
  failed: number;
  blocked: number;
  running: number;
  skipped: number;
  notRun: number;
  total: number;
}

export interface CoverageMetrics {
  covered: number;
  partial: number;
  gaps: number;
  total: number;
}

export interface IssueMetrics {
  open: number;
  blockers: number;
  unassigned: number;
  overdue: number;
}

export interface ReleaseReadiness {
  verdict: ReadinessVerdict;
  headline: string;
  summary: string;
  computedAt: IsoDateTime;
  automation: AutomationReadinessMetrics;
  manual: ManualReadinessMetrics;
  coverage: CoverageMetrics;
  issues: IssueMetrics;
  reasons: ReadinessReason[];
}

export interface Release {
  id: EntityId;
  name: string;
  version: string;
  description: string;
  branch: string;
  environmentId: EntityId;
  ownerId: EntityId;
  startsAt: IsoDateTime;
  targetAt: IsoDateTime;
  state: "planning" | "testing" | "approved" | "shipped";
  readiness: ReleaseReadiness;
}

export interface GitCommit {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
}

export interface RunTrigger {
  provider: "github" | "gitlab" | "bitbucket" | "manual";
  event: "push" | "pull-request" | "schedule" | "manual";
  actor: string;
  ciUrl?: string;
  pullRequest?: number;
}

export interface AutomationRun {
  id: EntityId;
  sequence: number;
  name: string;
  status: TestStatus;
  branch: string;
  commit: GitCommit;
  environmentId: EntityId;
  releaseId?: EntityId;
  startedAt: IsoDateTime;
  completedAt?: IsoDateTime;
  durationMs: number;
  progressPercent: number;
  shardCount: number;
  machineCount: number;
  counts: StatusCounts;
  trigger: RunTrigger;
  featuredResultIds: EntityId[];
}

export interface TestHistoryPoint {
  id: EntityId;
  runId: EntityId;
  runSequence: number;
  status: TestStatus;
  durationMs: number;
  branch: string;
  commit: string;
  occurredAt: IsoDateTime;
}

export interface AutomatedTest {
  id: EntityId;
  stableKey: string;
  title: string;
  suite: string;
  file: string;
  line: number;
  browser: "chromium" | "firefox" | "webkit";
  ownerId?: EntityId;
  requirementIds: EntityId[];
  tags: string[];
  priority: Priority;
  currentStatus: TestStatus;
  durationMs: number;
  flakinessRate: number;
  branch: string;
  lastRunAt: IsoDateTime;
  quarantined: boolean;
  history: TestHistoryPoint[];
}

export interface SourceLocation {
  file: string;
  line: number;
  column?: number;
}

export interface TestError {
  signature: string;
  message: string;
  category: "product" | "test" | "environment" | "unknown";
  stack: string[];
  source?: SourceLocation;
  codeFrame?: string[];
}

export interface AutomationStep {
  id: EntityId;
  title: string;
  status: TestStatus;
  durationMs: number;
  depth: number;
  location?: SourceLocation;
  error?: string;
}

export type EvidenceKind =
  | "screenshot"
  | "video"
  | "trace"
  | "console"
  | "network"
  | "log"
  | "attachment";

export interface EvidenceItem {
  id: EntityId;
  kind: EvidenceKind;
  title: string;
  filename: string;
  createdAt: IsoDateTime;
  sizeBytes?: number;
  mimeType?: string;
  url?: string;
  preview?: string[];
}

export interface TestRunResult {
  id: EntityId;
  runId: EntityId;
  automatedTestId: EntityId;
  status: TestStatus;
  durationMs: number;
  retryCount: number;
  shard: number;
  worker: string;
  startedAt: IsoDateTime;
  completedAt: IsoDateTime;
  steps: AutomationStep[];
  evidenceIds: EntityId[];
  error?: TestError;
  triageItemId?: EntityId;
}

export type ManualCaseLifecycle = "draft" | "active" | "archived";
export type ManualExecutionStatus = TestStatus | "not-run";

export interface ManualTestStep {
  id: EntityId;
  order: number;
  action: string;
  expectedResult: string;
  required: boolean;
}

export interface ManualTestCase {
  id: EntityId;
  key: string;
  title: string;
  description: string;
  preconditions: string[];
  priority: Priority;
  lifecycle: ManualCaseLifecycle;
  ownerId: EntityId;
  assigneeId?: EntityId;
  releaseIds: EntityId[];
  requirementIds: EntityId[];
  automatedTestIds: EntityId[];
  tags: string[];
  estimatedDurationMinutes: number;
  lastUpdatedAt: IsoDateTime;
  steps: ManualTestStep[];
}

export interface ManualStepResult {
  stepId: EntityId;
  status: ManualExecutionStatus;
  note?: string;
  evidenceIds: EntityId[];
}

export interface ManualExecution {
  id: EntityId;
  manualCaseId: EntityId;
  releaseId: EntityId;
  environmentId: EntityId;
  testerId: EntityId;
  status: ManualExecutionStatus;
  startedAt?: IsoDateTime;
  completedAt?: IsoDateTime;
  updatedAt: IsoDateTime;
  note?: string;
  stepResults: ManualStepResult[];
  evidenceIds: EntityId[];
  triageItemId?: EntityId;
}

export type RequirementStatus = "covered" | "partial" | "gap";

export interface Requirement {
  id: EntityId;
  externalKey: string;
  title: string;
  priority: Priority;
  status: RequirementStatus;
  releaseId: EntityId;
  manualCaseIds: EntityId[];
  automatedTestIds: EntityId[];
  externalUrl: string;
  latestEvidenceAt?: IsoDateTime;
}

export type TriageState =
  | "new"
  | "investigating"
  | "known"
  | "resolved"
  | "ignored";

export type TriageSourceType = "automated-test" | "manual-execution" | "environment";

export interface ExternalIssue {
  provider: "jira" | "linear" | "github";
  key: string;
  url: string;
  status: string;
}

export interface TriageItem {
  id: EntityId;
  title: string;
  summary: string;
  sourceType: TriageSourceType;
  sourceId: EntityId;
  releaseId: EntityId;
  status: TestStatus;
  state: TriageState;
  severity: Severity;
  classification: "regression" | "flaky" | "environment" | "test-debt" | "unknown";
  ownerId?: EntityId;
  reporterId: EntityId;
  occurrenceCount: number;
  firstSeenAt: IsoDateTime;
  lastSeenAt: IsoDateTime;
  slaDueAt?: IsoDateTime;
  tags: string[];
  evidenceIds: EntityId[];
  issue?: ExternalIssue;
}

export interface DemoData {
  project: Project;
  environments: Environment[];
  team: TeamMember[];
  releases: Release[];
  runs: AutomationRun[];
  automatedTests: AutomatedTest[];
  testRunResults: TestRunResult[];
  evidence: EvidenceItem[];
  manualCases: ManualTestCase[];
  manualExecutions: ManualExecution[];
  requirements: Requirement[];
  triage: TriageItem[];
}
