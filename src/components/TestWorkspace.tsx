import { useMemo, useState, type KeyboardEvent } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpDown,
  BookOpenCheck,
  ChevronRight,
  Filter,
  FlaskConical,
  Plus,
  Search,
  SlidersHorizontal,
} from "lucide-react";

import type { AutomatedTest, StatusCounts, TeamMember, TestStatus } from "../types";
import HistoryStrip from "./HistoryStrip";
import StatusBadge from "./StatusBadge";

type StatusFilter = "all" | "failed" | "flaky" | "passed" | "quarantined";
type SortKey = "status" | "title" | "duration" | "flakiness" | "lastRun";

type TestWorkspaceProps = {
  onNavigateManual: () => void;
  onOpenTest: (test: AutomatedTest) => void;
  onToast: (message: string) => void;
  suiteCounts: StatusCounts;
  team: TeamMember[];
  tests: AutomatedTest[];
};

const FILTERS: Array<{ value: StatusFilter; label: string; status?: TestStatus }> = [
  { value: "all", label: "All tests" },
  { value: "failed", label: "Failed", status: "failed" },
  { value: "flaky", label: "Flaky", status: "flaky" },
  { value: "passed", label: "Passed", status: "passed" },
  { value: "quarantined", label: "Quarantined", status: "quarantined" },
];

const STATUS_ORDER: Record<TestStatus, number> = {
  failed: 0,
  blocked: 1,
  flaky: 2,
  quarantined: 3,
  running: 4,
  skipped: 5,
  passed: 6,
};

const formatDuration = (durationMs: number) =>
  durationMs < 1000 ? `${durationMs}ms` : `${(durationMs / 1000).toFixed(1)}s`;

const relativeTime = (isoDate: string) => {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(isoDate).getTime()) / 60_000));
  return minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
};

export default function TestWorkspace({ onNavigateManual, onOpenTest, onToast, suiteCounts, team, tests }: TestWorkspaceProps) {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("status");

  const visibleTests = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = tests.filter((test) => {
      const matchesFilter = filter === "all" || test.currentStatus === filter || (filter === "quarantined" && test.quarantined);
      const matchesQuery = !normalizedQuery || [test.title, test.file, test.suite, test.tags.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
      return matchesFilter && matchesQuery;
    });

    return [...filtered].sort((left, right) => {
      if (sortKey === "title") return left.title.localeCompare(right.title);
      if (sortKey === "duration") return right.durationMs - left.durationMs;
      if (sortKey === "flakiness") return right.flakinessRate - left.flakinessRate;
      if (sortKey === "lastRun") return right.lastRunAt.localeCompare(left.lastRunAt);
      return STATUS_ORDER[left.currentStatus] - STATUS_ORDER[right.currentStatus];
    });
  }, [filter, query, sortKey, tests]);

  const focusSiblingRow = (event: KeyboardEvent<HTMLButtonElement>, direction: number) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const rows = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(".test-row") ?? []);
    const currentIndex = rows.indexOf(event.currentTarget);
    rows[Math.max(0, Math.min(rows.length - 1, currentIndex + direction))]?.focus();
  };

  return (
    <div className="page tests-page animate-in">
      <header className="page-header">
        <div>
          <div className="eyebrow">Evidence-linked coverage</div>
          <div className="page-title-row"><h1>Test library</h1><span className="release-chip">{suiteCounts.total} automated</span></div>
          <p>Every signal, owner, and piece of evidence in one scan-friendly workspace.</p>
        </div>
        <div className="page-header-actions">
          <button className="button button-secondary" onClick={() => onToast("CSV export prepared for Payments v2.8.0")}>
            <ArrowDownToLine size={14} /> Export
          </button>
          <button className="button button-primary" onClick={onNavigateManual}>
            <Plus size={14} /> New manual case
          </button>
        </div>
      </header>

      <section className="library-summary" aria-label="Test health summary">
        <div><span className="summary-icon summary-icon-brand"><FlaskConical size={15} /></span><small>Total coverage</small><strong>{suiteCounts.total}</strong><em>+8 this sprint</em></div>
        <div><span className="summary-icon summary-icon-pass">✓</span><small>Healthy</small><strong>{suiteCounts.passed}</strong><em>Stable across 10 runs</em></div>
        <div><span className="summary-icon summary-icon-fail">✕</span><small>Failing</small><strong>{suiteCounts.failed}</strong><em>2 block this release</em></div>
        <div><span className="summary-icon summary-icon-flaky">⚡</span><small>Flaky</small><strong>{suiteCounts.flaky}</strong><em>4 need review</em></div>
      </section>

      <section className="panel test-table-panel" aria-label="Automated tests">
        <div className="library-tabs" role="tablist" aria-label="Test type">
          <button role="tab" aria-selected="true" className="is-active"><FlaskConical size={14} /> Automated <span>{suiteCounts.total}</span></button>
          <button role="tab" aria-selected="false" onClick={onNavigateManual}><BookOpenCheck size={14} /> Manual <span>26</span></button>
        </div>

        <div className="test-toolbar">
          <div className="filter-chips" aria-label="Status filters">
            {FILTERS.map((item) => (
              <button
                key={item.value}
                className={filter === item.value ? "is-active" : ""}
                onClick={() => setFilter(item.value)}
                aria-pressed={filter === item.value}
              >
                {item.status ? <StatusBadge status={item.status} size="sm" /> : null}
                {item.label}<span>{item.value === "all" ? suiteCounts.total : item.value === "quarantined" ? suiteCounts.quarantined : suiteCounts[item.value]}</span>
              </button>
            ))}
          </div>
          <div className="test-tools">
            <label className="table-search">
              <Search size={14} />
              <span className="sr-only">Search tests</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tests or files" />
              {query ? <kbd>Esc</kbd> : <kbd>/</kbd>}
            </label>
            <button className="icon-button toolbar-icon" aria-label="Advanced filters" title="Advanced filters"><SlidersHorizontal size={15} /></button>
          </div>
        </div>

        <div className="test-table" role="table" aria-rowcount={visibleTests.length + 1}>
          <div className="test-table-head" role="row">
            <SortButton label="Status" active={sortKey === "status"} onClick={() => setSortKey("status")} />
            <SortButton label="Test" active={sortKey === "title"} onClick={() => setSortKey("title")} />
            <span>Owner</span>
            <SortButton label="Duration" active={sortKey === "duration"} onClick={() => setSortKey("duration")} />
            <SortButton label="Flake" active={sortKey === "flakiness"} onClick={() => setSortKey("flakiness")} />
            <span>Recent history</span>
            <SortButton label="Last run" active={sortKey === "lastRun"} onClick={() => setSortKey("lastRun")} />
            <span><span className="sr-only">Open evidence</span></span>
          </div>

          <div className="test-table-body">
            {visibleTests.length ? visibleTests.map((test) => {
              const owner = team.find((member) => member.id === test.ownerId);
              return (
                <button
                  key={test.id}
                  className={`test-row row-${test.currentStatus}`}
                  role="row"
                  onClick={() => onOpenTest(test)}
                  onKeyDown={(event) => focusSiblingRow(event, event.key === "ArrowDown" ? 1 : -1)}
                >
                  <span role="cell"><StatusBadge status={test.currentStatus} size="sm" /></span>
                  <span className="test-identity" role="cell">
                    <code>{test.title}</code>
                    <small>{test.file}:{test.line} · {test.browser}</small>
                  </span>
                  <span role="cell">
                    {owner ? <span className="owner-chip"><i>{owner.initials}</i>{owner.name.split(" ")[0]}</span> : <span className="unassigned-label">Unassigned</span>}
                  </span>
                  <span className="mono duration-cell" role="cell">{formatDuration(test.durationMs)}</span>
                  <span className={`mono flake-cell ${test.flakinessRate > 5 ? "is-risky" : ""}`} role="cell">{test.flakinessRate.toFixed(1)}%</span>
                  <span role="cell"><HistoryStrip history={test.history} /></span>
                  <span className="last-run-cell" role="cell"><span>{relativeTime(test.lastRunAt)}</span><small><code>{test.branch}</code></small></span>
                  <span className="row-chevron" role="cell"><ChevronRight size={15} /></span>
                </button>
              );
            }) : (
              <div className="table-empty">
                <Filter size={20} />
                <strong>No tests match these filters</strong>
                <span>Clear the search or choose another status.</span>
                <button className="button button-secondary" onClick={() => { setFilter("all"); setQuery(""); }}>Clear filters</button>
              </div>
            )}
          </div>
        </div>

        <footer className="table-footer">
          <span>Showing {visibleTests.length} high-signal tests from {suiteCounts.total}</span>
          <span>Updated from run <code>#1842</code> · just now</span>
          <button onClick={() => onToast("All test history refreshed")}>Refresh history <ArrowRight size={12} /></button>
        </footer>
      </section>
    </div>
  );
}

function SortButton({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button className={active ? "is-active" : ""} onClick={onClick}>
      {label}<ArrowUpDown size={11} />
    </button>
  );
}
