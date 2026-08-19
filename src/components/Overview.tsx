import type { ReactNode } from "react";
import {
  ArrowRight,
  Bot,
  Box,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  ExternalLink,
  GitBranch,
  Layers3,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";

import type {
  AutomatedTest,
  AutomationRun,
  Release,
  TeamMember,
  TriageItem,
} from "../types";
import HistoryStrip from "./HistoryStrip";
import StatusBadge from "./StatusBadge";

type OverviewProps = {
  automatedTests: AutomatedTest[];
  manualCompletion: number;
  onNavigateManual: () => void;
  onNavigateTests: () => void;
  onOpenTest: (test: AutomatedTest) => void;
  onToast: (message: string) => void;
  release: Release;
  runs: AutomationRun[];
  team: TeamMember[];
  triage: TriageItem[];
};

const formatDuration = (durationMs: number) => {
  if (durationMs < 1000) return `${durationMs}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)}s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
};

const getMember = (team: TeamMember[], id?: string) => team.find((member) => member.id === id);

export default function Overview({
  automatedTests,
  manualCompletion,
  onNavigateManual,
  onNavigateTests,
  onOpenTest,
  onToast,
  release,
  runs,
  team,
  triage,
}: OverviewProps) {
  const currentRun = runs.find((run) => run.status === "running") ?? runs[0];
  const attentionTests = automatedTests
    .filter((test) => ["failed", "flaky", "blocked"].includes(test.currentStatus))
    .slice(0, 4);
  const openTriage = triage.filter((item) => item.state !== "resolved").slice(0, 4);
  const automatedPassRate = Math.round(
    (release.readiness.automation.passed / release.readiness.automation.total) * 1000,
  ) / 10;
  const coverageRate = Math.round(
    (release.readiness.coverage.covered / release.readiness.coverage.total) * 100,
  );

  return (
    <div className="page overview-page animate-in">
      <header className="page-header">
        <div>
          <div className="eyebrow">Release command center</div>
          <div className="page-title-row">
            <h1>{release.name}</h1>
            <span className="release-chip">{release.version}</span>
          </div>
          <p>One live view across automation, manual QA, and requirement evidence.</p>
        </div>
        <div className="page-header-actions">
          <button className="button button-secondary" onClick={() => onToast("Readiness recalculated from the latest evidence") }>
            <RefreshCw size={14} /> Recalculate
          </button>
          <button className="button button-primary" onClick={onNavigateManual}>
            <Play size={14} /> Continue manual run
          </button>
        </div>
      </header>

      <section className="readiness-panel" aria-labelledby="readiness-title">
        <div className="readiness-summary">
          <div className="readiness-label">
            <span className="status-orb status-orb-flaky"><CircleAlert size={16} /></span>
            Release readiness
          </div>
          <div className="readiness-verdict-row">
            <div className="readiness-ring" aria-label="Readiness score 86 out of 100">
              <span>86</span><small>/100</small>
            </div>
            <div>
              <h2 id="readiness-title">AT RISK</h2>
              <p>{release.readiness.summary}</p>
            </div>
          </div>
          <div className="readiness-meta">
            <span><Clock3 size={13} /> Updated just now</span>
            <span><GitBranch size={13} /> <code>{release.branch}</code></span>
            <span><Box size={13} /> staging</span>
          </div>
        </div>

        <div className="readiness-details">
          <div className="readiness-bars" aria-label="Release progress">
            <ProgressMetric label="Automated" value={automatedPassRate} tone="pass" />
            <ProgressMetric label="Manual" value={manualCompletion} tone="brand" />
            <ProgressMetric label="Coverage" value={coverageRate} tone="running" />
          </div>
          <div className="because-list">
            <div className="because-heading">
              <span>Because</span>
              <small>{release.readiness.reasons.length} actions remain</small>
            </div>
            {release.readiness.reasons.map((reason) => (
              <button
                key={reason.id}
                className="reason-row"
                onClick={reason.evidence.targetType === "manual-case" ? onNavigateManual : onNavigateTests}
              >
                <StatusBadge status={reason.status} size="sm" />
                <span><strong>{reason.title}</strong><small>{reason.detail}</small></span>
                <ChevronRight size={15} />
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="kpi-grid" aria-label="Release metrics">
        <KpiCard
          icon={<CheckCircle2 size={16} />}
          label="Automation pass rate"
          value={`${automatedPassRate}%`}
          detail={`${release.readiness.automation.passed} of ${release.readiness.automation.total} passed`}
          tone="pass"
          onClick={onNavigateTests}
        />
        <KpiCard
          icon={<Users size={16} />}
          label="Manual progress"
          value={`${manualCompletion}%`}
          detail={`${release.readiness.manual.passed} passed · ${release.readiness.manual.notRun} not run`}
          tone="brand"
          onClick={onNavigateManual}
        />
        <KpiCard
          icon={<CircleAlert size={16} />}
          label="Open blockers"
          value={String(release.readiness.issues.blockers)}
          detail={`${release.readiness.issues.unassigned} needs an owner`}
          tone="fail"
          onClick={onNavigateTests}
        />
        <KpiCard
          icon={<Layers3 size={16} />}
          label="Requirement coverage"
          value={`${coverageRate}%`}
          detail={`${release.readiness.coverage.gaps} ${release.readiness.coverage.gaps === 1 ? "story needs" : "stories need"} evidence`}
          tone="running"
          onClick={() => onToast("Coverage is available in the Traceability workspace")}
        />
      </section>

      <div className="overview-grid">
        <section className="panel live-run-panel" aria-labelledby="live-run-title">
          <div className="panel-heading">
            <div>
              <span className="eyebrow"><span className="running-dot" /> Live from CI</span>
              <h2 id="live-run-title">{currentRun.name}</h2>
            </div>
            <StatusBadge status={currentRun.status} />
          </div>

          <div className="run-mainline">
            <div className="run-progress-copy">
              <strong>{currentRun.progressPercent}%</strong>
              <span>{currentRun.counts.passed + currentRun.counts.failed + currentRun.counts.flaky} of {currentRun.counts.total} tests reported</span>
            </div>
            <div className="progress-track" aria-label={`${currentRun.progressPercent}% complete`}>
              <span style={{ width: `${currentRun.progressPercent}%` }} />
            </div>
          </div>

          <div className="run-counts-strip">
            <span className="count-pass">✓ <strong>{currentRun.counts.passed}</strong> passed</span>
            <span className="count-fail">✕ <strong>{currentRun.counts.failed}</strong> failed</span>
            <span className="count-flaky">⚡ <strong>{currentRun.counts.flaky}</strong> flaky</span>
            <span className="count-skip">⊘ <strong>{currentRun.counts.skipped}</strong> skipped</span>
          </div>

          <div className="run-footer">
            <span><GitBranch size={13} /> <code>{currentRun.branch}</code></span>
            <span><code>{currentRun.commit.shortSha}</code> · {currentRun.commit.message}</span>
            <span>{currentRun.machineCount} machines · {currentRun.shardCount} shards</span>
            <button className="text-button" onClick={onNavigateTests}>View run <ArrowRight size={13} /></button>
          </div>
        </section>

        <aside className="panel attention-panel" aria-labelledby="attention-title">
          <div className="panel-heading compact-heading">
            <div>
              <span className="eyebrow">Ownership</span>
              <h2 id="attention-title">Needs attention</h2>
            </div>
            <span className="panel-count">{openTriage.length}</span>
          </div>
          <div className="attention-list">
            {openTriage.map((item) => {
              const owner = getMember(team, item.ownerId);
              return (
                <button key={item.id} className="attention-row" onClick={onNavigateTests}>
                  <span className={`severity-line severity-${item.severity}`} />
                  <span className="attention-copy">
                    <strong>{item.title}</strong>
                    <small>{item.classification} · seen {item.occurrenceCount}×</small>
                  </span>
                  {owner ? <span className="mini-avatar" title={owner.name}>{owner.initials}</span> : <span className="unassigned-label">Unassigned</span>}
                </button>
              );
            })}
          </div>
          <button className="panel-footer-action" onClick={onNavigateTests}>Open triage queue <ArrowRight size={13} /></button>
        </aside>

        <section className="panel health-panel" aria-labelledby="health-title">
          <div className="panel-heading compact-heading">
            <div>
              <span className="eyebrow">Latest evidence</span>
              <h2 id="health-title">Test health</h2>
            </div>
            <button className="button button-ghost" onClick={onNavigateTests}>View all <ArrowRight size={13} /></button>
          </div>
          <div className="health-table" role="table" aria-label="Tests needing attention">
            <div className="health-table-head" role="row">
              <span>Status</span><span>Test</span><span>Owner</span><span>History</span><span>Duration</span>
            </div>
            {attentionTests.map((test) => {
              const owner = getMember(team, test.ownerId);
              return (
                <button key={test.id} className={`health-row row-${test.currentStatus}`} role="row" onClick={() => onOpenTest(test)}>
                  <span role="cell"><StatusBadge status={test.currentStatus} size="sm" /></span>
                  <span className="health-test-name" role="cell"><code>{test.title}</code><small>{test.file}</small></span>
                  <span role="cell">{owner ? <span className="owner-chip"><i>{owner.initials}</i>{owner.name.split(" ")[0]}</span> : <span className="unassigned-label">Unassigned</span>}</span>
                  <span role="cell"><HistoryStrip history={test.history} /></span>
                  <span className="mono duration-cell" role="cell">{formatDuration(test.durationMs)}</span>
                </button>
              );
            })}
          </div>
        </section>

        <aside className="panel agent-panel" aria-labelledby="agent-title">
          <div className="agent-icon"><Bot size={18} /></div>
          <span className="ai-label"><Sparkles size={12} /> Pattern insight</span>
          <h2 id="agent-title">One failure explains 67% of today’s red tests.</h2>
          <p><code>getByRole('button', {'{ name: "Pay" }'})</code> changed after the checkout copy update.</p>
          <div className="confidence-row"><ShieldCheck size={14} /><span>86% confidence</span><small>Based on 6 traces</small></div>
          <button className="button button-secondary" onClick={() => attentionTests[0] && onOpenTest(attentionTests[0])}>
            Review evidence <ExternalLink size={13} />
          </button>
        </aside>
      </div>
    </div>
  );
}

function ProgressMetric({ label, tone, value }: { label: string; tone: "pass" | "brand" | "running"; value: number }) {
  return (
    <div className="progress-metric">
      <div><span>{label}</span><strong className="mono">{value}%</strong></div>
      <div className={`metric-track metric-${tone}`}><span style={{ width: `${value}%` }} /></div>
    </div>
  );
}

function KpiCard({
  detail,
  icon,
  label,
  onClick,
  tone,
  value,
}: {
  detail: string;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  tone: "pass" | "brand" | "fail" | "running";
  value: string;
}) {
  return (
    <button className={`kpi-card kpi-${tone}`} onClick={onClick}>
      <span className="kpi-icon">{icon}</span>
      <span className="kpi-copy"><small>{label}</small><strong>{value}</strong><span>{detail}</span></span>
      <ChevronRight size={15} />
    </button>
  );
}
