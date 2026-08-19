import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  ArrowRight,
  Ban,
  Bug,
  Camera,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  FilePlus2,
  MoreHorizontal,
  Paperclip,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Save,
  Sparkles,
  Square,
  TriangleAlert,
  X,
} from "lucide-react";

import type {
  ManualExecution,
  ManualExecutionStatus,
  ManualStepResult,
  ManualTestCase,
  TeamMember,
  TestStatus,
} from "../types";
import StatusBadge from "./StatusBadge";

type ManualWorkspaceProps = {
  cases: ManualTestCase[];
  executions: ManualExecution[];
  onExecutionChange: (execution: ManualExecution) => void;
  onToast: (message: string) => void;
  releaseName: string;
  team: TeamMember[];
};

const RESULT_ACTIONS: Array<{
  status: Extract<ManualExecutionStatus, "passed" | "failed" | "blocked" | "skipped">;
  label: string;
  icon: typeof Check;
}> = [
  { status: "passed", label: "Pass", icon: Check },
  { status: "failed", label: "Fail", icon: X },
  { status: "blocked", label: "Blocked", icon: TriangleAlert },
  { status: "skipped", label: "Skip", icon: Ban },
];

const statusForBadge = (status: ManualExecutionStatus): TestStatus => status === "not-run" ? "skipped" : status;

export default function ManualWorkspace({ cases, executions, onExecutionChange, onToast, releaseName, team }: ManualWorkspaceProps) {
  const [selectedCaseId, setSelectedCaseId] = useState(cases[0]?.id ?? "");
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [newCaseOpen, setNewCaseOpen] = useState(false);

  const selectedCase = cases.find((testCase) => testCase.id === selectedCaseId) ?? cases[0];
  const selectedExecution = executions.find((execution) => execution.manualCaseId === selectedCase?.id);
  const assignee = team.find((member) => member.id === selectedCase?.assigneeId);
  const criticalCasePassed = executions.find((execution) => execution.manualCaseId === "manual-case-3ds")?.status === "passed";
  const cycleProgress = criticalCasePassed ? 88 : 84;
  const completedCases = criticalCasePassed ? 22 : 21;

  useEffect(() => {
    if (!isRecording) return;
    const interval = window.setInterval(() => setElapsedSeconds((current) => current + 1), 1000);
    return () => window.clearInterval(interval);
  }, [isRecording]);

  const progress = useMemo(() => {
    if (!selectedCase || !selectedExecution) return { completed: 0, total: selectedCase?.steps.length ?? 0, percent: 0 };
    const completed = selectedExecution.stepResults.filter((result) => result.status !== "not-run").length;
    return { completed, total: selectedCase.steps.length, percent: Math.round((completed / selectedCase.steps.length) * 100) };
  }, [selectedCase, selectedExecution]);

  if (!selectedCase) return null;

  const ensureExecution = (): ManualExecution => selectedExecution ?? {
    id: `exec-${selectedCase.id}`,
    manualCaseId: selectedCase.id,
    releaseId: selectedCase.releaseIds[0] ?? "release-payments-2-8",
    environmentId: "env-staging",
    testerId: selectedCase.assigneeId ?? team[0]?.id ?? "member-owner",
    status: "running",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    stepResults: selectedCase.steps.map((step) => ({ stepId: step.id, status: "not-run", evidenceIds: [] })),
    evidenceIds: [],
  };

  const updateStep = (stepId: string, status: ManualStepResult["status"]) => {
    const execution = ensureExecution();
    const existingResults = execution.stepResults.length
      ? execution.stepResults
      : selectedCase.steps.map((step) => ({ stepId: step.id, status: "not-run" as const, evidenceIds: [] }));
    onExecutionChange({
      ...execution,
      status: "running",
      updatedAt: new Date().toISOString(),
      stepResults: existingResults.map((result) => result.stepId === stepId ? { ...result, status } : result),
    });
    if (!isRecording) setIsRecording(true);
  };

  const updateNote = (stepId: string, note: string) => {
    const execution = ensureExecution();
    onExecutionChange({
      ...execution,
      updatedAt: new Date().toISOString(),
      stepResults: execution.stepResults.map((result) => result.stepId === stepId ? { ...result, note } : result),
    });
  };

  const completeSession = () => {
    const execution = ensureExecution();
    const statuses = execution.stepResults.map((result) => result.status);
    const finalStatus: ManualExecutionStatus = statuses.includes("failed")
      ? "failed"
      : statuses.includes("blocked")
        ? "blocked"
        : "passed";
    onExecutionChange({
      ...execution,
      status: finalStatus,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    setIsRecording(false);
    onToast(finalStatus === "passed" ? "Manual run passed — release readiness updated" : "Manual run completed and added to triage");
  };

  const formatTimer = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

  return (
    <div className="page manual-page animate-in">
      <header className="page-header">
        <div>
          <div className="eyebrow">Guided manual QA</div>
          <div className="page-title-row"><h1>Manual runs</h1><span className="release-chip">{releaseName} · 4.18.0</span></div>
          <p>Clear steps, captured evidence, and release impact—without the spreadsheet.</p>
        </div>
        <div className="page-header-actions">
          <button className="button button-secondary" onClick={() => onToast("Zephyr import is ready to connect from Settings")}><RotateCcw size={14} /> Import cases</button>
          <button className="button button-primary" onClick={() => setNewCaseOpen(true)}><Plus size={14} /> New case</button>
        </div>
      </header>

      <div className="manual-layout">
        <aside className="panel manual-queue" aria-label="Manual test queue">
          <div className="manual-queue-heading">
            <div><span className="eyebrow">My queue</span><h2>Release checks</h2></div>
            <span>{cases.length}</span>
          </div>
          <div className="queue-progress">
            <div><span>Cycle progress</span><strong>{cycleProgress}%</strong></div>
            <div className="progress-track"><span style={{ width: `${cycleProgress}%` }} /></div>
            <small>{completedCases} of 25 cases complete</small>
          </div>
          <div className="case-list">
            {cases.map((testCase) => {
              const execution = executions.find((item) => item.manualCaseId === testCase.id);
              const status = execution?.status ?? "not-run";
              const member = team.find((item) => item.id === testCase.assigneeId);
              return (
                <button
                  key={testCase.id}
                  className={`case-row ${selectedCase.id === testCase.id ? "is-selected" : ""}`}
                  onClick={() => { setSelectedCaseId(testCase.id); setAttachments([]); setElapsedSeconds(0); setIsRecording(false); }}
                >
                  <StatusBadge status={statusForBadge(status)} size="sm" label={status === "not-run" ? "Not run" : undefined} />
                  <span className="case-copy"><strong>{testCase.title}</strong><small>{testCase.key} · {testCase.steps.length} steps · {testCase.estimatedDurationMinutes}m</small></span>
                  {member ? <span className="mini-avatar">{member.initials}</span> : null}
                  <ChevronRight size={14} />
                </button>
              );
            })}
          </div>
          <button className="panel-footer-action" onClick={() => setNewCaseOpen(true)}><FilePlus2 size={13} /> Add a test case</button>
        </aside>

        <section className="manual-runner" aria-labelledby="manual-case-title">
          <div className="panel runner-header">
            <div className="runner-breadcrumb"><span>Manual</span><ChevronRight size={12} /><code>{selectedCase.key}</code></div>
            <div className="runner-title-row">
              <div>
                <div className="runner-badges"><span className={`priority-chip priority-${selectedCase.priority}`}>{selectedCase.priority}</span><span className="plain-chip">Checkout</span></div>
                <h2 id="manual-case-title">{selectedCase.title}</h2>
                <p>{selectedCase.description}</p>
              </div>
              <button className="icon-button" aria-label="More case actions"><MoreHorizontal size={18} /></button>
            </div>
            <div className="runner-meta">
              <span><ClipboardCheck size={14} /> {selectedCase.steps.length} steps</span>
              <span><Clock3 size={14} /> ~{selectedCase.estimatedDurationMinutes} min</span>
              <span>{assignee ? <><span className="mini-avatar">{assignee.initials}</span>{assignee.name}</> : "Unassigned"}</span>
              <span><Save size={14} /> Auto-saved</span>
            </div>
          </div>

          <div className="recording-bar" aria-live="polite">
            <div className={`recording-state ${isRecording ? "is-recording" : ""}`}>
              <span className="recording-dot" />
              <span><strong>{isRecording ? "Session recording" : selectedExecution?.completedAt ? "Session complete" : "Session ready"}</strong><small>{isRecording ? "Actions and evidence are saved to this run" : "Start when the staging environment is ready"}</small></span>
            </div>
            <div className="recording-controls">
              <code className="recording-timer">{formatTimer(elapsedSeconds)}</code>
              <button className="button button-secondary recording-button" onClick={() => setIsRecording((current) => !current)}>
                {isRecording ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Start session</>}
              </button>
            </div>
          </div>

          <div className="runner-progress-bar">
            <div><span>Execution progress</span><strong>{progress.completed} / {progress.total} steps</strong></div>
            <div className="progress-track"><span style={{ width: `${progress.percent}%` }} /></div>
          </div>

          <div className="manual-step-list">
            {selectedCase.steps.map((step, index) => {
              const result = selectedExecution?.stepResults.find((item) => item.stepId === step.id);
              const status = result?.status ?? "not-run";
              return (
                <article key={step.id} className={`manual-step-card manual-step-${status}`}>
                  <div className="manual-step-number">{status === "passed" ? <Check size={15} /> : status === "failed" ? <X size={15} /> : index + 1}</div>
                  <div className="manual-step-body">
                    <div className="manual-step-copy">
                      <span className="eyebrow">Action</span>
                      <h3>{step.action}</h3>
                      <div className="expected-result"><Sparkles size={13} /><span><small>Expected result</small>{step.expectedResult}</span></div>
                    </div>
                    <div className="step-result-actions" role="group" aria-label={`Result for step ${index + 1}`}>
                      {RESULT_ACTIONS.map((action) => {
                        const Icon = action.icon;
                        return (
                          <button
                            key={action.status}
                            className={`result-button result-${action.status} ${status === action.status ? "is-active" : ""}`}
                            onClick={() => updateStep(step.id, action.status)}
                            aria-pressed={status === action.status}
                          >
                            <Icon size={15} /> {action.label}
                          </button>
                        );
                      })}
                    </div>
                    {status === "failed" || status === "blocked" ? (
                      <div className="failure-note animate-in">
                        <label className="field-label" htmlFor={`note-${step.id}`}>{status === "failed" ? "What happened?" : "What is blocking this step?"}</label>
                        <textarea
                          id={`note-${step.id}`}
                          className="text-area"
                          value={result?.note ?? ""}
                          onChange={(event) => updateNote(step.id, event.target.value)}
                          placeholder="Add a short, specific note for whoever investigates…"
                        />
                        <button className="button button-secondary" onClick={() => onToast("Bug draft prepared with this step and session evidence")}><Bug size={14} /> Draft bug from step</button>
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>

          <div className="panel runner-evidence">
            <div><span className="evidence-upload-icon"><Camera size={17} /></span><span><strong>Session evidence</strong><small>Attach screenshots, videos, or logs to this run.</small></span></div>
            <label className="button button-secondary file-button">
              <Paperclip size={14} /> Attach evidence
              <input type="file" multiple onChange={(event) => setAttachments(Array.from(event.target.files ?? []).map((file) => file.name))} />
            </label>
            {attachments.length ? <div className="attachment-list">{attachments.map((file) => <span key={file}><Paperclip size={12} />{file}<button aria-label={`Remove ${file}`} onClick={() => setAttachments((items) => items.filter((item) => item !== file))}><X size={12} /></button></span>)}</div> : null}
          </div>

          <footer className="runner-footer">
            <div><CheckCircle2 size={16} /><span><strong>{progress.percent === 100 ? "All required steps resolved" : `${progress.total - progress.completed} steps remaining`}</strong><small>The release verdict updates as soon as you finish.</small></span></div>
            <button className="button button-primary button-large" disabled={progress.percent < 100} onClick={completeSession}>
              Complete run <ArrowRight size={15} />
            </button>
          </footer>
        </section>
      </div>

      {newCaseOpen ? <NewCaseDialog onClose={() => setNewCaseOpen(false)} onToast={onToast} /> : null}
    </div>
  );
}

function NewCaseDialog({ onClose, onToast }: { onClose: () => void; onToast: (message: string) => void }) {
  const [title, setTitle] = useState("");
  const cardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [onClose]);

  const trapFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button, input, select, textarea, [tabindex]:not([tabindex='-1'])"));
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

  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-labelledby="new-case-title">
      <button className="modal-scrim" onClick={onClose} aria-label="Close new test case" />
      <section ref={cardRef} className="modal-card animate-in" onKeyDown={trapFocus}>
        <header><div><span className="eyebrow">Manual test library</span><h2 id="new-case-title">Create a test case</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={17} /></button></header>
        <div className="modal-form">
          <label className="field-label" htmlFor="new-case-name">Case title</label>
          <input id="new-case-name" className="text-input input-large" value={title} onChange={(event) => setTitle(event.target.value)} autoFocus placeholder="e.g. Refund a partially captured payment" />
          <div className="issue-fields">
            <label><span className="field-label">Priority</span><select className="select-input" defaultValue="High"><option>Critical</option><option>High</option><option>Medium</option><option>Low</option></select></label>
            <label><span className="field-label">Assignee</span><select className="select-input" defaultValue="Vas Valstan"><option>Vas Valstan</option><option>Maya Chen</option><option>Unassigned</option></select></label>
          </div>
          <div className="new-step-placeholder"><span><Square size={14} /> Step 1</span><input className="text-input" placeholder="Tester action" /><input className="text-input" placeholder="Expected result" /></div>
          <button className="text-button"><Plus size={13} /> Add another step</button>
        </div>
        <footer><button className="button button-ghost" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={!title.trim()} onClick={() => { onClose(); onToast(`Manual case “${title}” created as a draft`); }}>Create draft</button></footer>
      </section>
    </div>
  );
}
