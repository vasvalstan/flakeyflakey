import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  Bug,
  Check,
  ChevronDown,
  Circle,
  Clipboard,
  Code2,
  ExternalLink,
  FileCode2,
  Image,
  Lightbulb,
  ListTree,
  MonitorPlay,
  MoreHorizontal,
  Play,
  RefreshCw,
  Sparkles,
  TerminalSquare,
  UserPlus,
  X,
} from "lucide-react";

import type { AutomatedTest, EvidenceItem, TeamMember, TestRunResult } from "../types";
import HistoryStrip from "./HistoryStrip";
import StatusBadge from "./StatusBadge";

type EvidenceTab = "steps" | "screenshot" | "console" | "trace";

type EvidenceDrawerProps = {
  evidence: EvidenceItem[];
  onClose: () => void;
  onToast: (message: string) => void;
  result?: TestRunResult;
  team: TeamMember[];
  test: AutomatedTest;
};

const formatDuration = (durationMs: number) =>
  durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`;

export default function EvidenceDrawer({ evidence, onClose, onToast, result, team, test }: EvidenceDrawerProps) {
  const [activeTab, setActiveTab] = useState<EvidenceTab>("steps");
  const [draftOpen, setDraftOpen] = useState(false);
  const [issueTitle, setIssueTitle] = useState(`[${test.suite}] ${test.title} fails on ${test.branch}`);
  const [copied, setCopied] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const owner = team.find((member) => member.id === test.ownerId);
  const hasSelectorFailure = test.currentStatus === "failed" || test.currentStatus === "flaky";

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    drawerRef.current?.querySelector<HTMLElement>("button")?.focus();
    return () => previouslyFocused?.focus();
  }, []);

  const trapFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>("button, input, textarea, [href], [tabindex]:not([tabindex='-1'])"),
    ).filter((element) => !element.hasAttribute("disabled"));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const copyLocator = async () => {
    await navigator.clipboard?.writeText("getByRole('button', { name: 'Place order' })");
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="drawer-layer">
      <button className="drawer-scrim" onClick={onClose} aria-label="Close evidence drawer" />
      <aside
        ref={drawerRef}
        className="evidence-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-title"
        onKeyDown={trapFocus}
      >
        <header className="drawer-header">
          <div className="drawer-title-line">
            <StatusBadge status={test.currentStatus} />
            <span className="drawer-run-id mono">RUN #1841 · RETRY 1/1</span>
            <button className="icon-button drawer-more" aria-label="More test actions"><MoreHorizontal size={17} /></button>
            <button className="icon-button" onClick={onClose} aria-label="Close evidence"><X size={18} /></button>
          </div>
          <h2 id="evidence-title">{test.title}</h2>
          <div className="drawer-path"><FileCode2 size={13} /><code>{test.file}:{test.line}</code><span>·</span><span>{test.browser}</span></div>
          <div className="drawer-actions">
            <button className="button button-primary" onClick={() => onToast("Reproduction sandbox queued for this commit")}>
              <Play size={14} /> Open in sandbox
            </button>
            <button className="button button-secondary" onClick={() => onToast("Failed test added to rerun queue")}>
              <RefreshCw size={14} /> Rerun
            </button>
            <button className="button button-secondary" onClick={() => onToast(owner ? `Assigned to ${owner.name}` : "Assigned to you")}>
              <UserPlus size={14} /> {owner ? owner.name.split(" ")[0] : "Assign"}
            </button>
            <button className="button button-secondary" onClick={() => setDraftOpen(true)}>
              <Bug size={14} /> Draft bug
            </button>
          </div>
        </header>

        <div className="drawer-meta-strip">
          <span><small>Status</small><StatusBadge status={test.currentStatus} size="sm" /></span>
          <span><small>Duration</small><strong className="mono">{formatDuration(result?.durationMs ?? test.durationMs)}</strong></span>
          <span><small>Flakiness</small><strong className={`mono ${test.flakinessRate > 5 ? "text-flaky" : ""}`}>{test.flakinessRate.toFixed(1)}%</strong></span>
          <span><small>Recent</small><HistoryStrip history={test.history} /></span>
        </div>

        {hasSelectorFailure ? (
          <section className="insight-card" aria-label="Pattern insight">
            <div className="insight-heading">
              <span className="ai-label"><Sparkles size={12} /> Pattern insight</span>
              <span className="confidence-badge">86% confidence</span>
            </div>
            <h3>Likely selector drift after a copy change</h3>
            <p>Six failures share the same DOM change. The button is present, but its accessible name changed.</p>
            <div className="locator-diff">
              <div><small>Current</small><code>getByRole('button', {'{ name: "Pay now" }'})</code></div>
              <ArrowRight size={15} />
              <div><small>Suggested</small><code>getByRole('button', {'{ name: "Place order" }'})</code></div>
              <button className="icon-button" onClick={copyLocator} aria-label="Copy suggested locator">
                {copied ? <Check size={15} /> : <Clipboard size={15} />}
              </button>
            </div>
            <div className="insight-actions">
              <button className="text-button" onClick={() => onToast("Suggested locator accepted in this demo branch")}><Check size={13} /> Accept suggestion</button>
              <button className="text-button text-muted" onClick={() => onToast("Suggestion dismissed")}>Dismiss</button>
            </div>
          </section>
        ) : null}

        <div className="evidence-tabs" role="tablist" aria-label="Evidence type">
          <EvidenceTabButton value="steps" active={activeTab} onSelect={setActiveTab} icon={<ListTree size={14} />} label="Steps" count={result?.steps.length ?? 5} />
          <EvidenceTabButton value="screenshot" active={activeTab} onSelect={setActiveTab} icon={<Image size={14} />} label="Screenshot" count={evidence.filter((item) => item.kind === "screenshot").length || 1} />
          <EvidenceTabButton value="console" active={activeTab} onSelect={setActiveTab} icon={<TerminalSquare size={14} />} label="Console" count={3} />
          <EvidenceTabButton value="trace" active={activeTab} onSelect={setActiveTab} icon={<MonitorPlay size={14} />} label="Trace" />
        </div>

        <div className="evidence-content">
          {activeTab === "steps" ? <StepsPanel result={result} test={test} /> : null}
          {activeTab === "screenshot" ? <ScreenshotPanel test={test} /> : null}
          {activeTab === "console" ? <ConsolePanel /> : null}
          {activeTab === "trace" ? <TracePanel onToast={onToast} /> : null}
        </div>

        {draftOpen ? (
          <section className="issue-draft" aria-labelledby="issue-draft-title">
            <div className="issue-draft-heading">
              <div><span className="jira-mark">J</span><span><strong id="issue-draft-title">Draft Jira bug</strong><small>Evidence is attached automatically</small></span></div>
              <button className="icon-button" onClick={() => setDraftOpen(false)} aria-label="Close issue draft"><X size={15} /></button>
            </div>
            <label className="field-label" htmlFor="issue-title">Summary</label>
            <input id="issue-title" className="text-input" value={issueTitle} onChange={(event) => setIssueTitle(event.target.value)} />
            <div className="issue-fields">
              <label><span className="field-label">Priority</span><select className="select-input" defaultValue="Blocker"><option>Blocker</option><option>High</option><option>Medium</option></select></label>
              <label><span className="field-label">Assignee</span><select className="select-input" defaultValue="Maya Chen"><option>Maya Chen</option><option>Vas Valstan</option><option>Unassigned</option></select></label>
            </div>
            <div className="draft-evidence-row"><Lightbulb size={14} /><span>Trace, screenshot, stack, and run metadata included</span></div>
            <div className="issue-draft-actions">
              <button className="button button-ghost" onClick={() => setDraftOpen(false)}>Cancel</button>
              <button className="button button-primary" onClick={() => { setDraftOpen(false); onToast("QA-482 drafted with complete run evidence"); }}>
                Create QA-482 <ExternalLink size={13} />
              </button>
            </div>
          </section>
        ) : null}
      </aside>
    </div>
  );
}

function EvidenceTabButton({
  active,
  count,
  icon,
  label,
  onSelect,
  value,
}: {
  active: EvidenceTab;
  count?: number;
  icon: ReactNode;
  label: string;
  onSelect: (tab: EvidenceTab) => void;
  value: EvidenceTab;
}) {
  return (
    <button role="tab" aria-selected={active === value} className={active === value ? "is-active" : ""} onClick={() => onSelect(value)}>
      {icon}{label}{count !== undefined ? <span>{count}</span> : null}
    </button>
  );
}

function StepsPanel({ result, test }: { result?: TestRunResult; test: AutomatedTest }) {
  const fallbackSteps = [
    { id: "s1", title: "Navigate to /checkout", durationMs: 612, depth: 0, status: "passed" as const },
    { id: "s2", title: "Fill delivery details", durationMs: 1280, depth: 0, status: "passed" as const },
    { id: "s3", title: "Select saved Visa ending 4242", durationMs: 483, depth: 0, status: "passed" as const },
    { id: "s4", title: "Click Pay now", durationMs: 5000, depth: 0, status: "failed" as const, error: "Timed out waiting for getByRole('button', { name: 'Pay now' })" },
    { id: "s5", title: "Confirm order receipt", durationMs: 0, depth: 0, status: "skipped" as const },
  ];
  const steps = result?.steps.length ? result.steps : fallbackSteps;
  const error = result?.error;

  return (
    <div className="steps-panel">
      <div className="attempt-heading"><span>Attempt 2 of 2</span><small className="mono">{formatDuration(result?.durationMs ?? test.durationMs)}</small></div>
      <ol className="step-list">
        {steps.map((step, index) => (
          <li key={step.id} className={`step-item step-${step.status}`}>
            <span className="step-index">{index + 1}</span>
            <span className="step-status"><Circle size={10} fill="currentColor" /></span>
            <span className="step-copy"><code>{step.title}</code>{step.error ? <small>{step.error}</small> : null}</span>
            <span className="step-duration mono">{formatDuration(step.durationMs)}</span>
            {step.error ? <ChevronDown size={14} /> : null}
          </li>
        ))}
      </ol>
      <div className="error-panel">
        <div className="error-title"><Code2 size={14} /><strong>{error?.message ?? "TimeoutError: locator.click exceeded 5000ms"}</strong><button className="icon-button" aria-label="Copy error"><Clipboard size={14} /></button></div>
        <pre><code>{error?.stack.join("\n") ?? `at checkout.spec.ts:48:24\n  46 | await page.getByLabel('Card number').fill('4242...')\n  47 | await expect(page.getByText('Total £129.00')).toBeVisible()\n> 48 | await page.getByRole('button', { name: 'Pay now' }).click()\n     |                                                ^\n  49 | await expect(page).toHaveURL(/receipt/)`}</code></pre>
      </div>
    </div>
  );
}

function ScreenshotPanel({ test }: { test: AutomatedTest }) {
  return (
    <div className="screenshot-panel">
      <div className="screenshot-toolbar"><span>failure-1.png</span><small>1440 × 900 · after step 4</small><button className="text-button"><ExternalLink size={12} /> Open original</button></div>
      <div className="screenshot-checker">
        <div className="browser-capture">
          <div className="capture-browser-bar"><i /><i /><i /><span>staging.acme.dev/checkout</span></div>
          <div className="capture-page">
            <div className="capture-nav"><strong>ACME</strong><span>Cart · Checkout · Account</span></div>
            <div className="capture-content">
              <div className="capture-form"><small>SECURE CHECKOUT</small><h3>Complete your order</h3><div className="capture-field" /><div className="capture-field short" /><button>Place order</button></div>
              <div className="capture-summary"><small>ORDER SUMMARY</small><span>Pro annual</span><strong>£129.00</strong></div>
            </div>
            <div className="capture-highlight"><span>Expected: “Pay now”</span><i /></div>
          </div>
        </div>
      </div>
      <p className="screenshot-caption"><Image size={13} /> Captured automatically when <code>{test.title}</code> failed.</p>
    </div>
  );
}

function ConsolePanel() {
  return (
    <div className="console-panel mono">
      <div className="console-toolbar"><span>Browser console</span><small>3 messages · chromium</small></div>
      <p><span className="console-time">14:32:08.412</span><span className="console-info">INFO</span> Checkout initialized <em>{`{ cartId: "cart_8421" }`}</em></p>
      <p><span className="console-time">14:32:09.001</span><span className="console-warn">WARN</span> Feature flag <em>checkout_copy_v2</em> enabled</p>
      <p><span className="console-time">14:32:14.227</span><span className="console-error">ERROR</span> Locator timed out after 5000ms</p>
    </div>
  );
}

function TracePanel({ onToast }: { onToast: (message: string) => void }) {
  return (
    <div className="trace-panel">
      <div className="trace-preview">
        <div className="trace-timeline">
          <span style={{ width: "11%" }} /><span style={{ width: "23%" }} /><span style={{ width: "13%" }} /><span className="trace-failed" style={{ width: "42%" }} />
        </div>
        <MonitorPlay size={34} />
        <h3>Full Playwright trace is ready</h3>
        <p>Inspect DOM snapshots, network, source, and action timing at the exact point of failure.</p>
        <button className="button button-primary" onClick={() => onToast("Playwright trace opened in a new evidence session")}><ExternalLink size={14} /> Open trace viewer</button>
      </div>
    </div>
  );
}
