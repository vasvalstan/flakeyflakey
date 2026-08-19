import { useMemo, useState, type CSSProperties } from "react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  FileCheck2,
  Filter,
  GitCommitHorizontal,
  Link2,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import type { AutomatedTest, ManualTestCase, Requirement } from "../types";
import StatusBadge from "./StatusBadge";

type TraceabilityWorkspaceProps = {
  automatedTests: AutomatedTest[];
  manualCases: ManualTestCase[];
  onOpenTest: (test: AutomatedTest) => void;
  onToast: (message: string) => void;
  requirements: Requirement[];
};

export default function TraceabilityWorkspace({
  automatedTests,
  manualCases,
  onOpenTest,
  onToast,
  requirements,
}: TraceabilityWorkspaceProps) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "covered" | "partial" | "gap">("all");

  const visible = useMemo(() => requirements.filter((requirement) => {
    const matchesStatus = statusFilter === "all" || requirement.status === statusFilter;
    const matchesSearch = !query.trim() || `${requirement.externalKey} ${requirement.title}`.toLowerCase().includes(query.trim().toLowerCase());
    return matchesStatus && matchesSearch;
  }), [query, requirements, statusFilter]);

  const counts = {
    covered: requirements.filter((item) => item.status === "covered").length,
    partial: requirements.filter((item) => item.status === "partial").length,
    gap: requirements.filter((item) => item.status === "gap").length,
  };
  const coverage = Math.round(((counts.covered + counts.partial) / requirements.length) * 100);

  return (
    <div className="page traceability-page animate-in">
      <header className="page-header">
        <div>
          <div className="eyebrow">Story to evidence</div>
          <div className="page-title-row"><h1>Traceability</h1><span className="release-chip">{coverage}% with evidence</span></div>
          <p>See which release stories have manual and automated proof—without reconciling three tools.</p>
        </div>
        <div className="page-header-actions">
          <button className="button button-secondary" onClick={() => onToast("Audit evidence pack prepared for Payments v2.8.0")}><FileCheck2 size={14} /> Export evidence pack</button>
          <button className="button button-primary" onClick={() => onToast("Jira sync queued for 12 release stories")}><Link2 size={14} /> Sync Jira</button>
        </div>
      </header>

      <section className="traceability-hero panel">
        <div className="coverage-gauge" aria-label={`${coverage}% of requirements have evidence`}>
          <div className="coverage-gauge-ring" style={{ "--coverage": `${coverage}%` } as CSSProperties}><span>{coverage}%</span><small>with evidence</small></div>
          <div><span className="eyebrow">Release evidence</span><h2>{counts.covered + counts.partial} of {requirements.length} stories have test proof.</h2><p>{counts.gap} {counts.gap === 1 ? "story still needs" : "stories still need"} either a manual result or a passing automated run.</p></div>
        </div>
        <div className="coverage-legend">
          <div><span className="coverage-dot dot-covered"><Check size={13} /></span><span><strong>{counts.covered}</strong><small>Covered</small></span></div>
          <div><span className="coverage-dot dot-partial"><CircleAlert size={13} /></span><span><strong>{counts.partial}</strong><small>Partial</small></span></div>
          <div><span className="coverage-dot dot-gap">!</span><span><strong>{counts.gap}</strong><small>Gap</small></span></div>
        </div>
        <div className="audit-ready"><ShieldCheck size={18} /><span><strong>Audit-ready chain</strong><small>Jira story → test → result → defect</small></span></div>
      </section>

      <section className="panel traceability-table-panel">
        <div className="trace-toolbar">
          <div className="filter-chips">
            {(["all", "covered", "partial", "gap"] as const).map((status) => (
              <button key={status} className={statusFilter === status ? "is-active" : ""} onClick={() => setStatusFilter(status)}>
                {status === "all" ? "All stories" : status[0].toUpperCase() + status.slice(1)}
                <span>{status === "all" ? requirements.length : counts[status]}</span>
              </button>
            ))}
          </div>
          <label className="table-search"><Search size={14} /><span className="sr-only">Search stories</span><input placeholder="Search story or key" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        </div>

        <div className="trace-table" role="table" aria-label="Requirement coverage matrix">
          <div className="trace-table-head" role="row">
            <span>Status</span><span>Requirement</span><span>Manual evidence</span><span>Automated evidence</span><span>Latest proof</span><span />
          </div>
          {visible.map((requirement) => {
            const linkedManual = manualCases.filter((testCase) => requirement.manualCaseIds.includes(testCase.id));
            const linkedAutomated = automatedTests.filter((test) => requirement.automatedTestIds.includes(test.id));
            const latestTest = linkedAutomated[0];
            const status = requirement.status === "covered" ? "passed" : requirement.status === "partial" ? "flaky" : "blocked";
            return (
              <div key={requirement.id} className={`trace-row trace-${requirement.status}`} role="row">
                <span role="cell"><StatusBadge status={status} label={requirement.status === "gap" ? "Gap" : requirement.status[0].toUpperCase() + requirement.status.slice(1)} /></span>
                <span className="requirement-cell" role="cell"><a href={requirement.externalUrl} onClick={(event) => event.preventDefault()}><code>{requirement.externalKey}</code><ExternalLink size={11} /></a><strong>{requirement.title}</strong><small>{requirement.priority} priority</small></span>
                <span className="evidence-link-cell" role="cell">
                  {linkedManual.length ? <button onClick={() => onToast(`${linkedManual[0].key} opened in Manual runs`)}><FileCheck2 size={13} /><span><strong>{linkedManual[0].key}</strong><small>{linkedManual[0].title}</small></span></button> : <em>No manual case</em>}
                </span>
                <span className="evidence-link-cell" role="cell">
                  {latestTest ? <button onClick={() => onOpenTest(latestTest)}><GitCommitHorizontal size={13} /><span><strong>{latestTest.title}</strong><small><StatusBadge status={latestTest.currentStatus} size="sm" /> run #1841</small></span></button> : <em>No automated test</em>}
                </span>
                <span className="latest-proof" role="cell">{requirement.latestEvidenceAt ? <><strong>18m ago</strong><small>staging · <code>main</code></small></> : <><strong className="text-blocked">Missing</strong><small>Add evidence before release</small></>}</span>
                <span role="cell"><button className="icon-button" onClick={() => onToast(`${requirement.externalKey} evidence chain opened`)} aria-label={`Open ${requirement.externalKey}`}><ChevronRight size={15} /></button></span>
              </div>
            );
          })}
          {!visible.length ? <div className="table-empty"><Filter size={20} /><strong>No stories match</strong><span>Try another coverage state or search.</span></div> : null}
        </div>
      </section>

      <section className="trace-insight">
        <span className="agent-icon"><Sparkles size={16} /></span>
        <div><span className="ai-label">Release insight · high confidence</span><strong>PAY-482 is the only story preventing complete evidence coverage.</strong><p>Link the existing retry test or complete one 4-step manual case.</p></div>
        <button className="button button-secondary" onClick={() => onToast("Suggested manual case PAY-M36 added to the queue")}>Create suggested case <ArrowRight size={13} /></button>
      </section>
    </div>
  );
}
