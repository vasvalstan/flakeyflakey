import { useCallback, useEffect, useMemo, useState } from "react";

import AppShell, { type AppView } from "./components/AppShell";
import CommandPalette from "./components/CommandPalette";
import EvidenceDrawer from "./components/EvidenceDrawer";
import ManualWorkspace from "./components/ManualWorkspace";
import Onboarding from "./components/Onboarding";
import Overview from "./components/Overview";
import SavedFlowPage from "./components/SavedFlowPage";
import TestStudio from "./components/TestStudio";
import TestWorkspace from "./components/TestWorkspace";
import Toast from "./components/Toast";
import TraceabilityWorkspace from "./components/TraceabilityWorkspace";
import {
  automatedTests,
  automationRuns,
  currentProject,
  currentRelease,
  evidenceItems,
  manualExecutions as seededManualExecutions,
  manualTestCases,
  requirements,
  teamMembers,
  testRunResults,
  triageItems,
} from "./data/demo";
import type { AutomatedTest, AutomationRun, ManualExecution, ManualTestCase } from "./types";

type AppRoute = {
  activeView: AppView;
  savedFlowId: string | null;
};

type FlakeyHistoryState = {
  flakeyRoute?: "view" | "saved-flow";
  flakeyView?: AppView;
  from?: "/studio";
};

const APP_VIEWS: AppView[] = ["overview", "studio", "tests", "manual", "traceability"];
const SAVED_FLOW_PATH = /^\/studio\/flows\/([A-Za-z0-9-]{1,80})\/?$/;

function readAppRoute(): AppRoute {
  const savedFlowMatch = SAVED_FLOW_PATH.exec(window.location.pathname);
  if (savedFlowMatch) {
    return { activeView: "studio", savedFlowId: savedFlowMatch[1] };
  }

  if (/^\/studio\/?$/.test(window.location.pathname)) {
    return { activeView: "studio", savedFlowId: null };
  }

  const historyView = (window.history.state as FlakeyHistoryState | null)?.flakeyView;
  return {
    activeView: historyView && APP_VIEWS.includes(historyView) ? historyView : "overview",
    savedFlowId: null,
  };
}

function appHref(pathname: string) {
  const url = new URL(window.location.href);
  url.pathname = pathname;
  return `${url.pathname}${url.search}${url.hash}`;
}

const STORAGE_KEYS = {
  onboarded: "flakey:mvp:onboarded",
  projectName: "flakey:mvp:project-name",
  releaseName: "flakey:mvp:release-name",
  theme: "flakey:mvp:theme",
  manualExecutions: "flakey:mvp:manual-executions",
  manualCases: "flakey:mvp:manual-cases",
};

function readStoredValue<T>(key: string, fallback: T): T {
  try {
    const stored = window.localStorage.getItem(key);
    return stored ? JSON.parse(stored) as T : fallback;
  } catch {
    return fallback;
  }
}

function onboardingPreviewRequested(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("onboarding") === "1";
  } catch {
    return false;
  }
}

const liveRun: AutomationRun = {
  ...automationRuns[0],
  id: "run-1843-live",
  sequence: 1843,
  name: "release/4.18 · final smoke gate",
  status: "running",
  startedAt: "2026-07-16T11:02:12.000Z",
  completedAt: undefined,
  durationMs: 376_000,
  progressPercent: 86,
  counts: {
    passed: 126,
    failed: 1,
    flaky: 2,
    skipped: 0,
    running: 24,
    quarantined: 0,
    blocked: 0,
    total: 153,
  },
  commit: {
    sha: "af9c02d4462f149103969f9cb0d8aae8158c762a",
    shortSha: "af9c02d",
    message: "fix: recover challenge state after redirect",
    author: "Elena García",
  },
};

export default function App() {
  const [onboarded, setOnboarded] = useState(() =>
    onboardingPreviewRequested() ? false : readStoredValue(STORAGE_KEYS.onboarded, false)
  );
  const [projectName, setProjectName] = useState(() => readStoredValue(STORAGE_KEYS.projectName, currentProject.name));
  const [releaseName, setReleaseName] = useState(() => readStoredValue(STORAGE_KEYS.releaseName, currentRelease.name));
  const [theme, setTheme] = useState<"dark" | "light">(() => readStoredValue(STORAGE_KEYS.theme, "dark"));
  const [route, setRoute] = useState<AppRoute>(readAppRoute);
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [studioWorkspaceActive, setStudioWorkspaceActive] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [selectedTest, setSelectedTest] = useState<AutomatedTest | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [manualExecutions, setManualExecutions] = useState<ManualExecution[]>(() =>
    readStoredValue(STORAGE_KEYS.manualExecutions, seededManualExecutions),
  );
  const [manualCases, setManualCases] = useState<ManualTestCase[]>(() =>
    readStoredValue(STORAGE_KEYS.manualCases, [...manualTestCases]),
  );

  const runs = useMemo(() => [liveRun, ...automationRuns], []);
  const displayRelease = useMemo(() => ({ ...currentRelease, name: releaseName }), [releaseName]);
  const selectedResult = selectedTest
    ? testRunResults.find((result) => result.automatedTestId === selectedTest.id)
    : undefined;
  const selectedEvidence = selectedResult
    ? evidenceItems.filter((item) => (selectedResult.evidenceIds as readonly string[]).includes(item.id))
    : [];
  const manualCompletion = manualExecutions.find((execution) => execution.manualCaseId === "manual-case-3ds")?.status === "passed"
    ? 88
    : 84;
  const { activeView, savedFlowId } = route;

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(STORAGE_KEYS.theme, JSON.stringify(theme));
  }, [theme]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.manualExecutions, JSON.stringify(manualExecutions));
  }, [manualExecutions]);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEYS.manualCases, JSON.stringify(manualCases));
  }, [manualCases]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    const handlePopState = () => {
      setRoute(readAppRoute());
      setSelectedTest(null);
      setMobileNavOpen(false);
      setStudioWorkspaceActive(false);
      window.scrollTo({ top: 0 });
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const openCommand = useCallback(() => setCommandOpen(true), []);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openCommand();
      }
      if (event.key === "Escape" && selectedTest) setSelectedTest(null);
      if (event.key === "Escape" && mobileNavOpen) setMobileNavOpen(false);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [mobileNavOpen, openCommand, selectedTest]);

  const toggleTheme = () => setTheme((current) => current === "dark" ? "light" : "dark");
  const navigate = (view: AppView) => {
    const nextRoute = { activeView: view, savedFlowId: null };
    const nextPath = view === "studio" ? "/studio" : "/";
    window.history.pushState(
      { flakeyRoute: "view", flakeyView: view } satisfies FlakeyHistoryState,
      "",
      appHref(nextPath),
    );
    setRoute(nextRoute);
    setSelectedTest(null);
    setMobileNavOpen(false);
    setStudioWorkspaceActive(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const openSavedFlow = (flowId: string) => {
    window.history.pushState(
      {
        flakeyRoute: "saved-flow",
        flakeyView: "studio",
        from: "/studio",
      } satisfies FlakeyHistoryState,
      "",
      appHref(`/studio/flows/${encodeURIComponent(flowId)}`),
    );
    setRoute({ activeView: "studio", savedFlowId: flowId });
    setStudioWorkspaceActive(false);
    window.scrollTo({ top: 0 });
  };
  const returnToStudio = () => {
    const historyState = window.history.state as FlakeyHistoryState | null;
    if (
      SAVED_FLOW_PATH.test(window.location.pathname)
      && historyState?.flakeyRoute === "saved-flow"
      && historyState.from === "/studio"
    ) {
      window.history.back();
      return;
    }

    window.history.replaceState(
      { flakeyRoute: "view", flakeyView: "studio" } satisfies FlakeyHistoryState,
      "",
      appHref("/studio"),
    );
    setRoute({ activeView: "studio", savedFlowId: null });
    window.scrollTo({ top: 0 });
  };
  const returnToStudioAfterDelete = () => {
    window.history.replaceState(
      { flakeyRoute: "view", flakeyView: "studio" } satisfies FlakeyHistoryState,
      "",
      appHref("/studio"),
    );
    setRoute({ activeView: "studio", savedFlowId: null });
    window.scrollTo({ top: 0 });
  };
  const showToast = (message: string) => setToast(message);
  const handleOnboardingComplete = (name: string, firstRelease: string) => {
    setProjectName(name);
    setReleaseName(firstRelease);
    setOnboarded(true);
    window.localStorage.setItem(STORAGE_KEYS.projectName, JSON.stringify(name));
    window.localStorage.setItem(STORAGE_KEYS.releaseName, JSON.stringify(firstRelease));
    window.localStorage.setItem(STORAGE_KEYS.onboarded, JSON.stringify(true));
    if (onboardingPreviewRequested()) {
      const url = new URL(window.location.href);
      url.searchParams.delete("onboarding");
      window.history.replaceState(
        window.history.state,
        "",
        `${url.pathname}${url.search}${url.hash}`,
      );
    }
    showToast("Demo workspace ready — every number links to evidence");
  };
  const handleExecutionChange = (updated: ManualExecution) => {
    setManualExecutions((current) => {
      const exists = current.some((execution) => execution.id === updated.id);
      return exists
        ? current.map((execution) => execution.id === updated.id ? updated : execution)
        : [...current, updated];
    });
  };
  const handleCreateManualCase = (testCase: ManualTestCase) => {
    setManualCases((current) => [testCase, ...current.filter((item) => item.id !== testCase.id)]);
    navigate("manual");
    showToast(`${testCase.key} created from the recorded browser session`);
  };

  if (!onboarded) {
    return <Onboarding onComplete={handleOnboardingComplete} />;
  }

  if (savedFlowId) {
    return (
      <>
        <SavedFlowPage
          flowId={savedFlowId}
          onBack={returnToStudio}
          onDeleted={returnToStudioAfterDelete}
          onToast={showToast}
        />
        {toast ? <Toast message={toast} onDismiss={() => setToast(null)} /> : null}
      </>
    );
  }

  return (
    <>
      <AppShell
        activeView={activeView}
        collapsed={navCollapsed}
        mobileOpen={mobileNavOpen}
        onCommandOpen={openCommand}
        onNavigate={navigate}
        onToggleCollapsed={() => setNavCollapsed((current) => !current)}
        onToggleMobile={() => setMobileNavOpen((current) => {
          if (!current) setNavCollapsed(false);
          return !current;
        })}
        onToggleTheme={toggleTheme}
        onToast={showToast}
        projectName={projectName}
        releaseName={releaseName}
        studioWorkspaceActive={activeView === "studio" && studioWorkspaceActive}
        theme={theme}
      >
        {activeView === "overview" ? (
          <Overview
            automatedTests={automatedTests}
            manualCompletion={manualCompletion}
            onNavigateManual={() => navigate("manual")}
            onNavigateTests={() => navigate("tests")}
            onOpenTest={setSelectedTest}
            onToast={showToast}
            release={displayRelease}
            runs={runs}
            team={teamMembers}
            triage={triageItems}
          />
        ) : null}
        {activeView === "tests" ? (
          <TestWorkspace
            onNavigateManual={() => navigate("manual")}
            onOpenTest={setSelectedTest}
            onToast={showToast}
            suiteCounts={currentRelease.readiness.automation}
            team={teamMembers}
            tests={automatedTests}
          />
        ) : null}
        {activeView === "studio" ? (
          <TestStudio
            onCreateManualCase={handleCreateManualCase}
            onOpenSavedFlow={openSavedFlow}
            onWorkspaceModeChange={setStudioWorkspaceActive}
            onToast={showToast}
          />
        ) : null}
        {activeView === "manual" ? (
          <ManualWorkspace
            cases={manualCases}
            executions={manualExecutions}
            onExecutionChange={handleExecutionChange}
            onToast={showToast}
            releaseName={releaseName}
            team={teamMembers}
          />
        ) : null}
        {activeView === "traceability" ? (
          <TraceabilityWorkspace
            automatedTests={automatedTests}
            manualCases={manualCases}
            onOpenTest={setSelectedTest}
            onToast={showToast}
            requirements={requirements}
          />
        ) : null}
      </AppShell>

      {selectedTest ? (
        <EvidenceDrawer
          evidence={selectedEvidence}
          onClose={() => setSelectedTest(null)}
          onToast={showToast}
          result={selectedResult}
          team={teamMembers}
          test={selectedTest}
        />
      ) : null}

      {commandOpen ? (
        <CommandPalette
          onClose={() => setCommandOpen(false)}
          onNavigate={navigate}
          onOpenTest={setSelectedTest}
          onToggleTheme={toggleTheme}
          tests={automatedTests}
          theme={theme}
        />
      ) : null}

      {toast ? <Toast message={toast} onDismiss={() => setToast(null)} /> : null}
    </>
  );
}
