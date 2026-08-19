import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  ArrowRight,
  BookOpenCheck,
  Command,
  CornerDownLeft,
  LayoutDashboard,
  Link2,
  Moon,
  Search,
  Sun,
  TestTube2,
  WandSparkles,
  X,
} from "lucide-react";

import type { AutomatedTest } from "../types";
import type { AppView } from "./AppShell";
import StatusBadge from "./StatusBadge";

type CommandPaletteProps = {
  onClose: () => void;
  onNavigate: (view: AppView) => void;
  onOpenTest: (test: AutomatedTest) => void;
  onToggleTheme: () => void;
  tests: AutomatedTest[];
  theme: "dark" | "light";
};

const NAV_COMMANDS: Array<{ view: AppView; label: string; description: string; icon: typeof LayoutDashboard }> = [
  { view: "overview", label: "Release overview", description: "Readiness, blockers, and live CI", icon: LayoutDashboard },
  { view: "studio", label: "Test Studio", description: "Record a live browser and replay automation", icon: WandSparkles },
  { view: "tests", label: "Test library", description: "Automated tests and evidence", icon: TestTube2 },
  { view: "manual", label: "Manual runs", description: "Assigned cases and guided execution", icon: BookOpenCheck },
  { view: "traceability", label: "Traceability", description: "Stories linked to test proof", icon: Link2 },
];

export default function CommandPalette({ onClose, onNavigate, onOpenTest, onToggleTheme, tests, theme }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const normalizedQuery = query.trim().toLowerCase();

  useEffect(() => {
    inputRef.current?.focus();
    const listener = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [onClose]);

  const matchingCommands = useMemo(() => NAV_COMMANDS.filter((command) =>
    !normalizedQuery || `${command.label} ${command.description}`.toLowerCase().includes(normalizedQuery),
  ), [normalizedQuery]);

  const matchingTests = useMemo(() => tests.filter((test) =>
    !normalizedQuery || `${test.title} ${test.file} ${test.tags.join(" ")}`.toLowerCase().includes(normalizedQuery),
  ).slice(0, 5), [normalizedQuery, tests]);

  const trapFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button, input, [tabindex]:not([tabindex='-1'])"));
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
    <div className="command-layer" role="dialog" aria-modal="true" aria-label="Search and commands">
      <button className="command-scrim" onClick={onClose} aria-label="Close commands" />
      <section ref={cardRef} className="command-card animate-in" onKeyDown={trapFocus}>
        <div className="command-search-row">
          <Search size={18} />
          <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tests, releases, or jump anywhere…" />
          {query ? <button className="icon-button" onClick={() => setQuery("")} aria-label="Clear search"><X size={15} /></button> : <kbd>ESC</kbd>}
        </div>

        <div className="command-results">
          {matchingCommands.length ? (
            <div className="command-group">
              <span className="command-group-label">Jump to</span>
              {matchingCommands.map((command) => {
                const Icon = command.icon;
                return (
                  <button key={command.view} onClick={() => { onNavigate(command.view); onClose(); }}>
                    <span className="command-icon"><Icon size={16} /></span>
                    <span><strong>{command.label}</strong><small>{command.description}</small></span>
                    <ArrowRight size={14} />
                  </button>
                );
              })}
            </div>
          ) : null}

          {matchingTests.length ? (
            <div className="command-group">
              <span className="command-group-label">Tests</span>
              {matchingTests.map((test) => (
                <button key={test.id} onClick={() => { onOpenTest(test); onClose(); }}>
                  <StatusBadge status={test.currentStatus} size="sm" />
                  <span><strong className="mono">{test.title}</strong><small>{test.file}</small></span>
                  <CornerDownLeft size={14} />
                </button>
              ))}
            </div>
          ) : null}

          {!matchingCommands.length && !matchingTests.length ? (
            <div className="command-empty"><Search size={22} /><strong>No results for “{query}”</strong><span>Try a test name, file, or workspace.</span></div>
          ) : null}
        </div>

        <footer className="command-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <button onClick={() => { onToggleTheme(); onClose(); }}>{theme === "dark" ? <Sun size={13} /> : <Moon size={13} />} Switch to {theme === "dark" ? "light" : "dark"}</button>
          <span className="command-brand"><Command size={12} /> Flakey command center</span>
        </footer>
      </section>
    </div>
  );
}
