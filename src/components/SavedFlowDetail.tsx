import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Check,
  CheckCircle2,
  ChevronDown,
  Code2,
  Copy,
  Eye,
  Globe2,
  Image,
  Keyboard,
  LoaderCircle,
  MousePointer2,
  Navigation,
  ScrollText,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  Type,
  WifiOff,
  type LucideIcon,
} from "lucide-react";

import { studioApi } from "../studio/api";
import type {
  StudioAction,
  StudioAssertion,
  StudioLocatorCandidate,
  StudioSavedFlow,
  StudioSemanticEnrichment,
  StudioVisualGroundTruthCase,
} from "../studio/types";
import "../styles/saved-flows.css";

export interface SavedFlowDetailProps {
  flow: StudioSavedFlow;
  onBack: () => void;
  onDelete: () => void;
  deleting: boolean;
}

const ACTION_ICONS = {
  assertion: BadgeCheck,
  click: MousePointer2,
  fill: Type,
  navigate: Navigation,
  press: Keyboard,
  scroll: ScrollText,
} satisfies Record<StudioAction["kind"], LucideIcon>;

const ACTION_LABELS = {
  assertion: "Assertion",
  click: "Click",
  fill: "Fill",
  navigate: "Navigate",
  press: "Key press",
  scroll: "Scroll",
} satisfies Record<StudioAction["kind"], string>;

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatStepTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function describeAssertion(assertion: StudioAssertion) {
  switch (assertion.kind) {
    case "urlContains":
      return `URL contains “${assertion.value}”`;
    case "textVisible":
      return `Text “${assertion.text}” is visible`;
    case "elementVisible":
      return `${assertion.locator.selector} is visible`;
  }
}

function describeAction(action: StudioAction) {
  switch (action.kind) {
    case "navigate":
      return `Navigate to ${action.targetUrl}`;
    case "click":
      return action.label || "Click the selected element";
    case "fill":
      return action.sensitive
        ? `Enter a protected value in ${action.label || "the selected field"}`
        : `${action.label || "Fill field"} · “${action.value}”`;
    case "press":
      return `${action.label || "Press key"} · ${action.key}`;
    case "scroll": {
      const vertical = Math.abs(action.deltaY) >= Math.abs(action.deltaX);
      const distance = Math.abs(vertical ? action.deltaY : action.deltaX);
      const direction = vertical
        ? action.deltaY >= 0 ? "down" : "up"
        : action.deltaX >= 0 ? "right" : "left";
      return `Scroll ${distance}px ${direction}`;
    }
    case "assertion":
      return describeAssertion(action.assertion);
  }
}

function recordedMeaning(
  action: StudioAction,
  visualCase?: StudioVisualGroundTruthCase,
) {
  if (visualCase?.intent) return visualCase.intent;
  switch (action.kind) {
    case "navigate":
      return `Open the recorded page at ${action.targetUrl}`;
    case "click":
      return `Activate ${action.label || visualCase?.targetLabel || "the selected control"}`;
    case "fill":
      return action.sensitive
        ? `Enter a protected value in ${action.label || "the selected field"}`
        : `Enter the recorded value in ${action.label || "the selected field"}`;
    case "press":
      return `Send the ${action.key} key to ${action.label || "the active control"}`;
    case "scroll":
      return "Move through the page to reveal the next part of the journey";
    case "assertion":
      return `Verify that ${describeAssertion(action.assertion)}`;
  }
}

function actionLocator(action: StudioAction) {
  if (action.kind === "click" || action.kind === "fill" || action.kind === "press") {
    return action.locator;
  }
  if (action.kind === "assertion" && action.assertion.kind === "elementVisible") {
    return action.assertion.locator;
  }
  return undefined;
}

function actionLocatorCandidates(action: StudioAction) {
  if (action.kind === "click" || action.kind === "fill") {
    return action.locatorCandidates;
  }
  const locator = actionLocator(action);
  return locator ? [locator] : [];
}

function locatorQuality(locator: StudioLocatorCandidate) {
  if (locator.unique && locator.score >= 0.8) {
    return { className: "high", label: "Stable" };
  }
  if (locator.unique && locator.score >= 0.55) {
    return { className: "medium", label: "Review" };
  }
  return { className: "low", label: "Fragile" };
}

function SemanticCapture({
  action,
  enrichment,
  visualCase,
}: {
  action: StudioAction;
  enrichment?: StudioSemanticEnrichment;
  visualCase?: StudioVisualGroundTruthCase;
}) {
  if (enrichment?.status === "ready") {
    return (
      <section className="saved-flow-semantic is-ready" aria-label="Saved semantic enrichment">
        <div className="saved-flow-semantic-heading">
          <span><Sparkles aria-hidden="true" size={14} /> {enrichment.model} meaning</span>
          <strong>Enriched</strong>
        </div>
        <p>{enrichment.intent}</p>
        <div className="saved-flow-semantic-meta">
          <span>Target: {enrichment.targetRole || "Not identified"}</span>
          <span>Model-estimated confidence {Math.round(enrichment.confidence * 100)}%</span>
        </div>
        <dl className="saved-flow-semantic-grid">
          <div><dt>Journey stage</dt><dd>{enrichment.journeyStage}</dd></div>
          <div><dt>Suggested check</dt><dd>{enrichment.expectedOutcome}</dd></div>
          <div><dt>Visual fallback</dt><dd>{enrichment.visualFallback}</dd></div>
          <div>
            <dt>Safety</dt>
            <dd>
              <span className={`saved-flow-risk is-${enrichment.actionRisk}`}>
                {enrichment.actionRisk} risk
              </span>
              {enrichment.requiresConfirmation
                ? <span className="saved-flow-confirmation"><ShieldCheck size={12} /> Confirmation recommended</span>
                : null}
            </dd>
          </div>
        </dl>
        {enrichment.evidence.length > 0 ? (
          <div className="saved-flow-semantic-evidence">
            <strong>Model evidence</strong>
            <ul>
              {enrichment.evidence.map((item, index) => (
                <li key={`${item}-${index}`}><Check aria-hidden="true" size={12} /> <span>{item}</span></li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>
    );
  }

  if (enrichment?.status === "error") {
    return (
      <section className="saved-flow-semantic is-error" aria-label="Semantic enrichment error">
        <div className="saved-flow-semantic-heading">
          <span><AlertTriangle aria-hidden="true" size={14} /> Model enrichment</span>
          <strong>Unavailable</strong>
        </div>
        <p>{recordedMeaning(action, visualCase)}</p>
        <small>{enrichment.error}</small>
      </section>
    );
  }

  if (enrichment?.status === "queued" || enrichment?.status === "running") {
    return (
      <section className="saved-flow-semantic is-pending" aria-label="Incomplete semantic enrichment">
        <div className="saved-flow-semantic-heading">
          <span><Sparkles aria-hidden="true" size={14} /> Model enrichment</span>
          <strong>{enrichment.status}</strong>
        </div>
        <p>{recordedMeaning(action, visualCase)}</p>
        <small>This snapshot was saved before enrichment completed.</small>
      </section>
    );
  }

  return (
    <section className="saved-flow-semantic" aria-label="Recorded step meaning">
      <div className="saved-flow-semantic-heading">
        <span><Eye aria-hidden="true" size={14} /> Recorder meaning</span>
        <strong>Deterministic</strong>
      </div>
      <p>{recordedMeaning(action, visualCase)}</p>
      <small>No model annotation was saved for this step.</small>
    </section>
  );
}

function EmptyEvidence({ children }: { children: ReactNode }) {
  return (
    <div className="saved-flow-evidence-empty">
      <CheckCircle2 aria-hidden="true" size={18} />
      <span>{children}</span>
    </div>
  );
}

export function SavedFlowDetail({
  flow,
  onBack,
  onDelete,
  deleting,
}: SavedFlowDetailProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const [openStepIds, setOpenStepIds] = useState(
    () => new Set(flow.actions.slice(0, 1).map((action) => action.id)),
  );
  const visualCasesByAction = useMemo(
    () => new Map(flow.visualDataset.cases.map((visualCase) => [visualCase.actionId, visualCase])),
    [flow.visualDataset.cases],
  );
  const consoleEvidenceCount = flow.evidence.console.length + flow.evidence.pageErrors.length;

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(flow.generatedCode);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <article className="saved-flow-detail" aria-labelledby="saved-flow-title">
      <header className="saved-flow-header">
        <button className="saved-flow-control saved-flow-back" onClick={onBack} type="button">
          <ArrowLeft aria-hidden="true" size={16} />
          <span>Recorded flows</span>
        </button>
        <div className="saved-flow-title">
          <span>Saved recording</span>
          <h1 id="saved-flow-title">{flow.name}</h1>
        </div>
        <button
          aria-label={`Delete saved flow ${flow.name}`}
          className="saved-flow-control saved-flow-delete"
          disabled={deleting}
          onClick={onDelete}
          type="button"
        >
          {deleting
            ? <LoaderCircle aria-hidden="true" className="spin" size={15} />
            : <Trash2 aria-hidden="true" size={15} />}
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </header>

      <section className="saved-flow-hero" aria-labelledby="saved-flow-summary-heading">
        <div className="saved-flow-hero-copy">
          <p className="saved-flow-eyebrow" id="saved-flow-summary-heading">
            <ScrollText aria-hidden="true" size={14} />
            Recorded {formatDate(flow.recordedAt)}
          </p>
          <h2>{flow.pageTitle || flow.name}</h2>
          {flow.description ? <p className="saved-flow-description">{flow.description}</p> : null}
          <div className="saved-flow-route" title={`${flow.initialUrl} → ${flow.finalUrl}`}>
            <Globe2 aria-hidden="true" size={14} />
            <span>{flow.initialUrl}</span>
            {flow.finalUrl !== flow.initialUrl ? (
              <>
                <ArrowLeft aria-hidden="true" className="saved-flow-route-arrow" size={13} />
                <span>{flow.finalUrl}</span>
              </>
            ) : null}
          </div>
          <div className="saved-flow-context">
            <span>{flow.runtime === "container" ? "Container browser" : "Local browser"}</span>
            <span>{flow.viewport.width}×{flow.viewport.height}</span>
            <span>Updated {formatDate(flow.updatedAt)}</span>
          </div>
        </div>

        <dl className="saved-flow-metrics" aria-label="Recording summary">
          <div>
            <dt>Steps</dt>
            <dd><strong>{flow.actionCount}</strong><span>Recorded actions</span></dd>
          </div>
          <div>
            <dt>Assertions</dt>
            <dd><strong>{flow.assertionCount}</strong><span>Explicit checks</span></dd>
          </div>
          <div>
            <dt>Screenshots</dt>
            <dd><strong>{flow.screenshotCount}</strong><span>Visual evidence</span></dd>
          </div>
          <div>
            <dt>Enriched</dt>
            <dd><strong>{flow.enrichedActionCount}</strong><span>Semantic steps</span></dd>
          </div>
        </dl>
      </section>

      <div className="saved-flow-layout">
        <div className="saved-flow-main">
          <section className="saved-flow-card saved-flow-steps" aria-labelledby="saved-flow-steps-heading">
            <div className="saved-flow-section-heading">
              <span className="saved-flow-section-icon"><ScrollText aria-hidden="true" size={16} /></span>
              <div>
                <h2 id="saved-flow-steps-heading">Recorded journey</h2>
                <p>Expand a step to inspect meaning, locators, and captured browser frames.</p>
              </div>
            </div>

            <ol className="saved-flow-step-list">
              {flow.actions.map((action, index) => {
                const Icon = ACTION_ICONS[action.kind];
                const enrichment = flow.semanticEnrichments[action.id];
                const visualCase = visualCasesByAction.get(action.id);
                const locator = actionLocator(action);
                const candidates = actionLocatorCandidates(action);
                const quality = locator ? locatorQuality(locator) : null;
                const sensitive = action.kind === "fill" && action.sensitive;
                const hasBefore = !sensitive && Boolean(visualCase?.beforeScreenshotAvailable);
                const hasAfter = !sensitive && Boolean(
                  visualCase?.afterScreenshotAvailable
                  || action.screenshotAvailable
                  || flow.evidence.actionScreenshotIds.includes(action.id),
                );

                return (
                  <li key={action.id}>
                    <details
                      className="saved-flow-step"
                      onToggle={(event) => {
                        const open = event.currentTarget.open;
                        setOpenStepIds((current) => {
                          const next = new Set(current);
                          if (open) next.add(action.id);
                          else next.delete(action.id);
                          return next;
                        });
                      }}
                      open={openStepIds.has(action.id)}
                    >
                      <summary>
                        <span className="saved-flow-step-index">{index + 1}</span>
                        <span className="saved-flow-step-summary-copy">
                          <span className="saved-flow-step-topline">
                            <span className="saved-flow-step-kind">
                              <Icon aria-hidden="true" size={13} />
                              {ACTION_LABELS[action.kind]}
                            </span>
                            {enrichment?.status === "ready" ? (
                              <span className="saved-flow-enriched-badge">
                                <Sparkles aria-hidden="true" size={11} />
                                Enriched
                              </span>
                            ) : null}
                          </span>
                          <strong>{describeAction(action)}</strong>
                          <small>{formatStepTime(action.createdAt)} · {action.url}</small>
                        </span>
                        <ChevronDown aria-hidden="true" className="saved-flow-chevron" size={17} />
                      </summary>

                      <div className="saved-flow-step-content">
                        <SemanticCapture
                          action={action}
                          enrichment={enrichment}
                          visualCase={visualCase}
                        />

                        {locator && quality ? (
                          <section className="saved-flow-locator" aria-label="Playwright locator">
                            <div className="saved-flow-locator-heading">
                              <span>Primary Playwright locator</span>
                              <span className={`saved-flow-locator-quality is-${quality.className}`}>
                                <i aria-hidden="true" />
                                {quality.label} · {Math.round(locator.score * 100)}%
                              </span>
                            </div>
                            <code>{locator.selector}</code>
                            <div className="saved-flow-locator-meta">
                              <span className={locator.unique ? "is-unique" : "needs-review"}>
                                {locator.unique
                                  ? <Check aria-hidden="true" size={12} />
                                  : <AlertTriangle aria-hidden="true" size={12} />}
                                {locator.unique ? "Unique · 1 match" : `${locator.matchCount} matches`}
                              </span>
                              <span>{locator.strategy}</span>
                            </div>

                            {candidates.length > 1 ? (
                              <details className="saved-flow-candidates">
                                <summary>{candidates.length} recorded locator candidates</summary>
                                <ol>
                                  {candidates.map((candidate, candidateIndex) => (
                                    <li key={`${candidate.strategy}-${candidate.selector}-${candidateIndex}`}>
                                      <span>
                                        <strong>{candidate.strategy}</strong>
                                        <small>
                                          {candidate.unique ? "Unique" : `${candidate.matchCount} matches`}
                                          {" · "}
                                          {Math.round(candidate.score * 100)}%
                                        </small>
                                      </span>
                                      <code>{candidate.selector}</code>
                                    </li>
                                  ))}
                                </ol>
                              </details>
                            ) : null}
                          </section>
                        ) : null}

                        {sensitive ? (
                          <div className="saved-flow-sensitive">
                            <ShieldCheck aria-hidden="true" size={15} />
                            <span>
                              <strong>Protected input</strong>
                              Screenshot evidence and the entered value were withheld.
                            </span>
                          </div>
                        ) : hasBefore || hasAfter ? (
                          <div className={`saved-flow-screenshots ${hasBefore && hasAfter ? "" : "is-single"}`}>
                            {hasBefore ? (
                              <figure>
                                <figcaption><Image aria-hidden="true" size={13} /> Before</figcaption>
                                <img
                                  alt={`Browser frame before step ${index + 1}: ${describeAction(action)}`}
                                  height={720}
                                  loading="lazy"
                                  src={studioApi.savedFlowScreenshotUrl(
                                    flow.id,
                                    action.id,
                                    "before",
                                    visualCase?.createdAt,
                                  )}
                                  width={1280}
                                />
                              </figure>
                            ) : null}
                            {hasAfter ? (
                              <figure>
                                <figcaption><Image aria-hidden="true" size={13} /> After</figcaption>
                                <img
                                  alt={`Browser frame after step ${index + 1}: ${describeAction(action)}`}
                                  height={720}
                                  loading="lazy"
                                  src={studioApi.savedFlowScreenshotUrl(
                                    flow.id,
                                    action.id,
                                    "after",
                                    visualCase?.createdAt ?? action.createdAt,
                                  )}
                                  width={1280}
                                />
                              </figure>
                            ) : null}
                          </div>
                        ) : (
                          <div className="saved-flow-no-screenshot">
                            <Image aria-hidden="true" size={15} />
                            No screenshot was saved for this step.
                          </div>
                        )}
                      </div>
                    </details>
                  </li>
                );
              })}
            </ol>
          </section>
        </div>

        <aside className="saved-flow-sidebar" aria-label="Saved recording output">
          <section className="saved-flow-card" aria-labelledby="saved-flow-evidence-heading">
            <div className="saved-flow-section-heading">
              <span className="saved-flow-section-icon"><Terminal aria-hidden="true" size={16} /></span>
              <div>
                <h2 id="saved-flow-evidence-heading">Browser evidence</h2>
                <p>Console, page, and failed-request metadata.</p>
              </div>
            </div>

            <div className="saved-flow-evidence-groups">
              <details open>
                <summary>
                  <span><Terminal aria-hidden="true" size={14} /> Console</span>
                  <strong>{consoleEvidenceCount}</strong>
                </summary>
                <div className="saved-flow-evidence-list">
                  {flow.evidence.pageErrors.map((entry) => (
                    <div className="saved-flow-evidence-entry is-error" key={entry.id}>
                      <AlertTriangle aria-hidden="true" size={13} />
                      <div>
                        <strong>Page error</strong>
                        <code>{entry.message}</code>
                      </div>
                    </div>
                  ))}
                  {flow.evidence.console.map((entry) => (
                    <div className={`saved-flow-evidence-entry is-${entry.level}`} key={entry.id}>
                      <Terminal aria-hidden="true" size={13} />
                      <div>
                        <strong>{entry.level}</strong>
                        <code>{entry.text}</code>
                      </div>
                    </div>
                  ))}
                  {consoleEvidenceCount === 0
                    ? <EmptyEvidence>No console or page errors were captured.</EmptyEvidence>
                    : null}
                </div>
              </details>

              <details open>
                <summary>
                  <span><WifiOff aria-hidden="true" size={14} /> Network failures</span>
                  <strong>{flow.evidence.networkErrors.length}</strong>
                </summary>
                <div className="saved-flow-evidence-list">
                  {flow.evidence.networkErrors.map((entry) => (
                    <div className="saved-flow-evidence-entry is-error" key={entry.id}>
                      <WifiOff aria-hidden="true" size={13} />
                      <div>
                        <strong>{entry.method} · {entry.resourceType}</strong>
                        <code>{entry.url}</code>
                        <span>{entry.errorText}</span>
                      </div>
                    </div>
                  ))}
                  {flow.evidence.networkErrors.length === 0
                    ? <EmptyEvidence>No failed requests were captured.</EmptyEvidence>
                    : null}
                </div>
              </details>
            </div>
          </section>

          <section className="saved-flow-card saved-flow-code-card" aria-labelledby="saved-flow-code-heading">
            <div className="saved-flow-section-heading saved-flow-code-heading">
              <span className="saved-flow-section-icon"><Code2 aria-hidden="true" size={16} /></span>
              <div>
                <h2 id="saved-flow-code-heading">Generated Playwright</h2>
                <p>Stored with this recording.</p>
              </div>
              <button
                aria-label="Copy generated Playwright code"
                className="saved-flow-copy"
                disabled={!flow.generatedCode}
                onClick={() => void copyCode()}
                type="button"
              >
                {copyState === "copied"
                  ? <Check aria-hidden="true" size={14} />
                  : <Copy aria-hidden="true" size={14} />}
                {copyState === "copied" ? "Copied" : "Copy"}
              </button>
            </div>
            <div className="saved-flow-code-preview">
              {flow.generatedCode
                ? <pre><code>{flow.generatedCode}</code></pre>
                : <div className="saved-flow-code-empty"><Code2 aria-hidden="true" size={20} />No generated code was saved.</div>}
            </div>
            <p className="sr-only" aria-live="polite">
              {copyState === "copied"
                ? "Generated Playwright code copied to the clipboard."
                : copyState === "failed"
                  ? "Generated Playwright code could not be copied."
                  : ""}
            </p>
          </section>
        </aside>
      </div>
    </article>
  );
}
