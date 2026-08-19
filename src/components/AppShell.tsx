import type { ReactNode } from "react";
import {
  BookOpenCheck,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  Command,
  LayoutDashboard,
  Link2,
  Moon,
  PanelLeft,
  Search,
  Settings,
  Sun,
  TestTube2,
  WandSparkles,
  X,
} from "lucide-react";

import BrandMark from "./BrandMark";

export type AppView = "overview" | "studio" | "tests" | "manual" | "traceability";

type AppShellProps = {
  activeView: AppView;
  children: ReactNode;
  collapsed: boolean;
  onCommandOpen: () => void;
  mobileOpen: boolean;
  onNavigate: (view: AppView) => void;
  onToggleMobile: () => void;
  onToggleCollapsed: () => void;
  onToggleTheme: () => void;
  onToast: (message: string) => void;
  projectName: string;
  releaseName: string;
  studioWorkspaceActive: boolean;
  theme: "dark" | "light";
};

const NAV_ITEMS: Array<{
  value: AppView;
  label: string;
  shortLabel: string;
  icon: typeof LayoutDashboard;
  badge?: string;
}> = [
  { value: "overview", label: "Release overview", shortLabel: "Overview", icon: LayoutDashboard },
  { value: "studio", label: "Test Studio", shortLabel: "Studio", icon: WandSparkles, badge: "NEW" },
  { value: "tests", label: "Test library", shortLabel: "Tests", icon: TestTube2, badge: "153" },
  { value: "manual", label: "Manual runs", shortLabel: "Manual", icon: BookOpenCheck, badge: "3" },
  { value: "traceability", label: "Traceability", shortLabel: "Coverage", icon: Link2 },
];

export default function AppShell({
  activeView,
  children,
  collapsed,
  onCommandOpen,
  mobileOpen,
  onNavigate,
  onToggleMobile,
  onToggleCollapsed,
  onToggleTheme,
  onToast,
  projectName,
  releaseName,
  studioWorkspaceActive,
  theme,
}: AppShellProps) {
  return (
    <div className={`app-shell ${collapsed ? "nav-is-collapsed" : ""} ${mobileOpen ? "mobile-nav-is-open" : ""} ${studioWorkspaceActive ? "studio-workspace-active" : ""}`}>
      <a className="skip-link" href="#main-content">Skip to content</a>
      {mobileOpen ? <button className="mobile-nav-scrim" onClick={onToggleMobile} aria-label="Close navigation" /> : null}
      <aside className="side-rail" aria-label="Main navigation">
        <div className="side-rail-brand">
          <BrandMark showWordmark={!collapsed} />
          <button
            className="icon-button collapse-button"
            onClick={mobileOpen ? onToggleMobile : onToggleCollapsed}
            aria-label={mobileOpen ? "Close navigation" : collapsed ? "Expand navigation" : "Collapse navigation"}
          >
            {mobileOpen ? <X size={16} /> : collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
          </button>
        </div>

        <button className="project-switcher" aria-label="Switch project" onClick={() => onToast("Project switching is ready for the first connected workspace") }>
          <span className="project-avatar">AC</span>
          {!collapsed ? (
            <>
              <span className="project-copy">
                <strong>{projectName}</strong>
                <small>Production QA</small>
              </span>
              <ChevronDown size={14} />
            </>
          ) : null}
        </button>

        <nav className="side-nav">
          <span className="nav-section-label">{collapsed ? "" : "Workspace"}</span>
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.value}
                className={`nav-item ${activeView === item.value ? "is-active" : ""}`}
                onClick={() => onNavigate(item.value)}
                aria-current={activeView === item.value ? "page" : undefined}
                title={collapsed ? item.label : undefined}
              >
                <Icon size={17} aria-hidden="true" />
                {!collapsed ? <span>{item.label}</span> : null}
                {!collapsed && item.badge ? <small>{item.badge}</small> : null}
              </button>
            );
          })}
        </nav>

        <div className="side-rail-bottom">
          <button className="nav-item" title={collapsed ? "Settings" : undefined} onClick={() => onToast("Settings will hold reporter keys, environments, and integrations") }>
            <Settings size={17} />
            {!collapsed ? <span>Settings</span> : null}
          </button>
          {!collapsed ? (
            <div className="workspace-plan">
              <span className="spark-symbol">✦</span>
              <div><strong>14-day trial</strong><small>9 days remaining</small></div>
              <button onClick={() => onToast("You’re exploring the full MVP feature set")}>View plan</button>
            </div>
          ) : null}
          <button className="profile-row" aria-label="Open account menu" onClick={() => onToast("Workspace profile opened for Vas Valstan") }>
            <span className="avatar">VM</span>
            {!collapsed ? <span><strong>Vas Valstan</strong><small>Workspace owner</small></span> : null}
            {!collapsed ? <ChevronDown size={14} /> : null}
          </button>
        </div>
      </aside>

      <div className="app-stage">
        <header className="top-bar">
          <div className="mobile-brand"><BrandMark showWordmark /></div>
          <button className="mobile-menu icon-button" onClick={onToggleMobile} aria-label="Toggle navigation">
            <PanelLeft size={18} />
          </button>
          <div className="release-context">
            <span className="context-label">Release</span>
            <button onClick={() => onToast(`${releaseName} is the active release`) }>
              {releaseName} · 4.18.0 <ChevronDown size={14} />
            </button>
          </div>
          <div className="top-bar-actions">
            <div className="live-run-pill" aria-live="polite">
              <span className="running-dot" />
              <span className="live-full">CI run #1843</span>
              <strong>86%</strong>
            </div>
            <button className="command-trigger" onClick={onCommandOpen} aria-label="Open search and commands">
              <Search size={15} />
              <span>Search tests, runs, stories…</span>
              <kbd><Command size={11} /> K</kbd>
            </button>
            <button className="icon-button theme-button" onClick={onToggleTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
              {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            </button>
          </div>
        </header>

        <main id="main-content" className="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
