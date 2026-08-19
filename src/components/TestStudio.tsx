import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Check,
  CheckCircle2,
  Circle,
  Code2,
  Copy,
  ChevronRight,
  Eye,
  FileText,
  FolderOpen,
  Globe2,
  Keyboard,
  LoaderCircle,
  Monitor,
  MousePointer2,
  Navigation,
  Play,
  Plus,
  Radio,
  ScrollText,
  Save,
  ShieldCheck,
  Sparkles,
  Square,
  Terminal,
  Trash2,
  Type,
  WifiOff,
  X,
  type LucideIcon,
} from "lucide-react";

import { studioApi, StudioApiError } from "../studio/api";
import type {
  StudioAction,
  StudioAssertion,
  StudioAssertionRequest,
  StudioEvidence,
  StudioInputRequest,
  StudioLocatorCandidate,
  StudioReplayResult,
  StudioSavedFlowSummary,
  StudioSemanticEnrichment,
  StudioSession,
  StudioVisualDataset,
  StudioVisualGroundTruthCase,
} from "../studio/types";
import type { ManualTestCase, ManualTestStep } from "../types";
import "../styles/studio.css";

export interface TestStudioProps {
  onCreateManualCase: (testCase: ManualTestCase) => void;
  onOpenSavedFlow: (flowId: string) => void;
  onWorkspaceModeChange?: (active: boolean) => void;
  onToast: (message: string) => void;
}

type AssertionChoice = StudioAssertion["kind"];
type EvidenceTab = "console" | "network";
type ConnectionState = "connecting" | "live" | "interrupted";

const ACTIVE_STUDIO_SESSION_KEY = "flakey:test-studio:active-session";

const EMPTY_EVIDENCE: StudioEvidence = {
  actionScreenshotIds: [],
  console: [],
  networkErrors: [],
  pageErrors: [],
};

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

function displayError(error: unknown) {
  if (error instanceof StudioApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Test Studio could not complete that action.";
}

function normalizeUrl(value: string) {
  let candidate: URL;
  try {
    candidate = new URL(value.trim());
  } catch {
    throw new Error("Enter a full URL beginning with http:// or https://.");
  }
  if (candidate.protocol !== "http:" && candidate.protocol !== "https:") {
    throw new Error("Use an absolute http:// or https:// URL.");
  }
  if (candidate.username || candidate.password) {
    throw new Error("URLs containing credentials are not allowed.");
  }
  return candidate.toString();
}

function formatDuration(durationMs: number) {
  if (durationMs < 1_000) return `${durationMs}ms`;
  return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
}

function formatSavedFlowDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}

function savedFlowHost(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

function defaultSavedFlowName(session: StudioSession) {
  const title = session.title.trim();
  return title ? `${title} flow` : `${savedFlowHost(session.initialUrl)} flow`;
}

function actionLocator(action: StudioAction): StudioLocatorCandidate | undefined {
  if (action.kind === "click" || action.kind === "fill") return action.locator;
  if (action.kind === "press") return action.locator;
  if (action.kind === "assertion" && action.assertion.kind === "elementVisible") {
    return action.assertion.locator;
  }
  return undefined;
}

function describeAssertion(assertion: StudioAssertion) {
  switch (assertion.kind) {
    case "urlContains":
      return `URL contains “${assertion.value}”`;
    case "textVisible":
      return `Text “${assertion.text}” is visible`;
    case "elementVisible":
      return `Element ${assertion.locator.selector} is visible`;
  }
}

function describeAction(action: StudioAction) {
  switch (action.kind) {
    case "navigate":
      return action.targetUrl;
    case "click":
      return action.label || "Click element";
    case "fill":
      return `${action.label || "Fill field"} · “${action.value}”`;
    case "press":
      return `${action.label || "Press key"} · ${action.key}`;
    case "scroll":
      return `Scroll ${Math.abs(action.deltaY)}px ${action.deltaY >= 0 ? "down" : "up"}`;
    case "assertion":
      return describeAssertion(action.assertion);
  }
}

function locatorQuality(locator: StudioLocatorCandidate) {
  if (locator.unique && locator.score >= 0.8) return { className: "high", label: "Stable" };
  if (locator.unique && locator.score >= 0.55) return { className: "medium", label: "Review" };
  return { className: "low", label: "Fragile" };
}

function semanticMeaning(
  action: StudioAction,
  visualCase?: StudioVisualGroundTruthCase,
  enrichment?: StudioSemanticEnrichment,
) {
  if (enrichment?.status === "ready" && enrichment.intent) return enrichment.intent;
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
      return `Send ${action.key} to ${action.label || "the active page control"}`;
    case "scroll":
      return action.deltaY >= 0
        ? "Reveal content further down the current page"
        : "Return to content higher on the current page";
    case "assertion":
      return `Verify that ${describeAssertion(action.assertion).toLowerCase()}`;
  }
}

function enrichmentStatus(enrichment?: StudioSemanticEnrichment) {
  switch (enrichment?.status) {
    case "queued":
      return { className: "queued", label: "Queued" };
    case "running":
      return { className: "running", label: "Understanding" };
    case "ready":
      return { className: "ready", label: "Enriched" };
    case "error":
      return { className: "error", label: "Model unavailable" };
    default:
      return null;
  }
}

function manualAction(action: Exclude<StudioAction, { kind: "assertion" }>) {
  switch (action.kind) {
    case "navigate":
      return `Open ${action.targetUrl}`;
    case "click":
      return action.label || `Select ${action.locator.selector}`;
    case "fill":
      return action.sensitive
        ? `${action.label || "Enter a value"} with a secure value`
        : `${action.label || "Enter a value"}: ${action.value}`;
    case "press":
      return `Press ${action.key}${action.label ? ` in ${action.label}` : ""}`;
    case "scroll":
      return action.deltaY >= 0 ? "Scroll down the page" : "Scroll up the page";
  }
}

function buildManualSteps(actions: StudioAction[]): ManualTestStep[] {
  const steps: ManualTestStep[] = [];

  for (const action of actions) {
    if (action.kind === "assertion") {
      const expectedResult = describeAssertion(action.assertion);
      const previous = steps.at(-1);
      if (previous) {
        previous.expectedResult = previous.expectedResult === "Review expected result"
          ? expectedResult
          : `${previous.expectedResult}; ${expectedResult}`;
      } else {
        steps.push({
          action: "Observe the current page state",
          expectedResult,
          id: `manual-${action.id}`,
          order: 1,
          required: true,
        });
      }
      continue;
    }

    steps.push({
      action: manualAction(action),
      expectedResult: "Review expected result",
      id: `manual-${action.id}`,
      order: steps.length + 1,
      required: true,
    });
  }

  return steps.length > 0
    ? steps
    : [{
        action: "Complete the recorded browser flow",
        expectedResult: "Review expected result",
        id: "manual-empty-step",
        order: 1,
        required: true,
      }];
}

export default function TestStudio({
  onCreateManualCase,
  onOpenSavedFlow,
  onWorkspaceModeChange,
  onToast,
}: TestStudioProps) {
  const [launchUrl, setLaunchUrl] = useState("");
  const [addressValue, setAddressValue] = useState("");
  const [session, setSession] = useState<StudioSession | null>(null);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<StudioEvidence>(EMPTY_EVIDENCE);
  const [visualDataset, setVisualDataset] = useState<StudioVisualDataset | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [assertionKind, setAssertionKind] = useState<AssertionChoice>("urlContains");
  const [assertionValue, setAssertionValue] = useState("");
  const [evidenceTab, setEvidenceTab] = useState<EvidenceTab>("console");
  const [replayResult, setReplayResult] = useState<StudioReplayResult | null>(null);
  const [generatedCode, setGeneratedCode] = useState("");
  const [codeLoading, setCodeLoading] = useState(false);
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [enrichmentOptIn, setEnrichmentOptIn] = useState(false);
  const [savedFlows, setSavedFlows] = useState<StudioSavedFlowSummary[]>([]);
  const [savedFlowsLoading, setSavedFlowsLoading] = useState(true);
  const [savedFlowsError, setSavedFlowsError] = useState<string | null>(null);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [closeDialogOpen, setCloseDialogOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveDescription, setSaveDescription] = useState("");
  const [activeSavedFlowId, setActiveSavedFlowId] = useState<string | null>(null);
  const [lastSavedRevision, setLastSavedRevision] = useState<string | null>(null);
  const frameObjectUrl = useRef<string | null>(null);
  const displayedFrameRevision = useRef(0);
  const frameShellRef = useRef<HTMLDivElement | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const inputQueue = useRef<Promise<void>>(Promise.resolve());
  const scrollBuffer = useRef({ deltaX: 0, deltaY: 0, timeout: 0 });
  const saveButtonRef = useRef<HTMLButtonElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  const actions = session?.actions ?? [];
  const isContainerRuntime = session?.runtime === "container";
  const hasAssertion = actions.some((action) => action.kind === "assertion");
  const frameIsCurrent = Boolean(
    frameUrl && session && displayedFrameRevision.current === session.frameRevision,
  );
  const actionRevision = JSON.stringify(actions);
  const recordingRevision = JSON.stringify({
    actions,
    evidence,
    finalUrl: session?.url ?? "",
    pageTitle: session?.title ?? "",
    semanticEnrichments: session?.semanticEnrichments ?? {},
    visualCases: visualDataset?.cases ?? [],
  });
  const hasUnsavedRecording = lastSavedRevision === null
    ? actions.length > 0
    : recordingRevision !== lastSavedRevision;
  const demoUrl = typeof window === "undefined"
    ? "/demo-shop.html"
    : `${window.location.origin}/demo-shop.html`;

  const lastLocator = useMemo(() => {
    for (let index = actions.length - 1; index >= 0; index -= 1) {
      const locator = actionLocator(actions[index]);
      if (locator) return locator;
    }
    return undefined;
  }, [actions]);

  const visualCasesByAction = useMemo(
    () => new Map(
      (visualDataset?.cases ?? []).map((visualCase) => [visualCase.actionId, visualCase]),
    ),
    [visualDataset],
  );
  const semanticEnrichments = session?.semanticEnrichments ?? {};
  const enrichmentCounts = useMemo(() => {
    const enrichments = Object.values(semanticEnrichments)
      .filter((item): item is StudioSemanticEnrichment => Boolean(item));
    return {
      error: enrichments.filter((item) => item.status === "error").length,
      processing: enrichments.filter((item) =>
        item.status === "queued" || item.status === "running"
      ).length,
      ready: enrichments.filter((item) => item.status === "ready").length,
    };
  }, [semanticEnrichments]);
  const enrichmentSummary = [
    enrichmentCounts.ready > 0 ? `${enrichmentCounts.ready} GPT enriched` : "",
    enrichmentCounts.processing > 0 ? `${enrichmentCounts.processing} interpreting` : "",
    enrichmentCounts.error > 0
      ? `${enrichmentCounts.error} ${enrichmentCounts.error === 1 ? "model failure" : "model failures"}`
      : "",
  ].filter(Boolean).join(" · ");

  useEffect(() => {
    setSelectedActionId(actions.at(-1)?.id ?? null);
  }, [actions.at(-1)?.id]);

  useEffect(() => {
    onWorkspaceModeChange?.(Boolean(session?.id));
  }, [onWorkspaceModeChange, session?.id]);

  useEffect(() => () => {
    onWorkspaceModeChange?.(false);
  }, [onWorkspaceModeChange]);

  useEffect(() => {
    sessionIdRef.current = session?.id ?? null;
    if (session?.id) {
      window.sessionStorage.setItem(ACTIVE_STUDIO_SESSION_KEY, session.id);
    }
  }, [session?.id]);

  useEffect(() => {
    const storedSessionId = window.sessionStorage.getItem(ACTIVE_STUDIO_SESSION_KEY);
    if (!storedSessionId) return;

    const controller = new AbortController();
    setBusyAction("recover");
    setConnectionState("connecting");
    void studioApi.getSession(storedSessionId, controller.signal)
      .then((recoveredSession) => {
        setSession(recoveredSession);
        setEvidence(recoveredSession.evidence);
        setAddressValue(recoveredSession.url);
        onToast("Recovered your active Test Studio recording");
      })
      .catch((recoveryError) => {
        if (recoveryError instanceof DOMException && recoveryError.name === "AbortError") return;
        window.sessionStorage.removeItem(ACTIVE_STUDIO_SESSION_KEY);
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusyAction(null);
      });
    return () => controller.abort();
  }, []);

  const refreshSavedFlows = useCallback(async (signal?: AbortSignal) => {
    setSavedFlowsLoading(true);
    try {
      const response = await studioApi.listSavedFlows(signal);
      setSavedFlows(response.flows);
      setSavedFlowsError(null);
    } catch (savedFlowError) {
      if (!(savedFlowError instanceof DOMException && savedFlowError.name === "AbortError")) {
        setSavedFlowsError(displayError(savedFlowError));
      }
    } finally {
      if (!signal?.aborted) setSavedFlowsLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refreshSavedFlows(controller.signal);
    return () => controller.abort();
  }, [refreshSavedFlows]);

  useEffect(() => {
    if (!hasUnsavedRecording) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasUnsavedRecording]);

  useEffect(() => {
    const sessionId = session?.id;
    if (!sessionId) {
      setVisualDataset(null);
      return;
    }

    const controller = new AbortController();
    void studioApi.getVisualDataset(sessionId, controller.signal)
      .then(setVisualDataset)
      .catch((datasetError) => {
        if (!(datasetError instanceof DOMException && datasetError.name === "AbortError")) {
          setVisualDataset(null);
        }
      });
    return () => controller.abort();
  }, [actionRevision, session?.id]);

  useEffect(() => {
    if (session?.url) setAddressValue(session.url);
  }, [session?.url]);

  useEffect(() => () => {
    if (frameObjectUrl.current) URL.revokeObjectURL(frameObjectUrl.current);
    if (scrollBuffer.current.timeout) window.clearTimeout(scrollBuffer.current.timeout);
    sessionIdRef.current = null;
  }, []);

  useEffect(() => {
    const sessionId = session?.id;
    if (!sessionId) return;

    let disposed = false;
    let pollTimeout = 0;
    const controller = new AbortController();

    const poll = async () => {
      try {
        const frame = await studioApi.getFrame(sessionId, controller.signal);
        const [nextSession, nextEvidence] = await Promise.all([
          studioApi.getSession(sessionId, controller.signal),
          studioApi.getEvidence(sessionId, controller.signal),
        ]);
        if (disposed) return;

        const nextFrameUrl = URL.createObjectURL(frame.blob);
        if (frameObjectUrl.current) URL.revokeObjectURL(frameObjectUrl.current);
        frameObjectUrl.current = nextFrameUrl;
        displayedFrameRevision.current = frame.frameRevision;
        setFrameUrl(nextFrameUrl);
        setSession(nextSession);
        setEvidence(nextEvidence);
        setConnectionState(
          frame.frameRevision === nextSession.frameRevision ? "live" : "connecting",
        );
      } catch (pollError) {
        if (disposed || (pollError instanceof DOMException && pollError.name === "AbortError")) return;
        setConnectionState("interrupted");
      } finally {
        if (!disposed) pollTimeout = window.setTimeout(poll, 700);
      }
    };

    void poll();
    return () => {
      disposed = true;
      controller.abort();
      window.clearTimeout(pollTimeout);
    };
  }, [session?.id]);

  useEffect(() => {
    if (!session || actions.length === 0) {
      setGeneratedCode("");
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setCodeLoading(true);
      try {
        const response = await studioApi.getCode(session.id, controller.signal);
        setGeneratedCode(response.code);
      } catch (codeError) {
        if (!(codeError instanceof DOMException && codeError.name === "AbortError")) {
          setGeneratedCode("");
        }
      } finally {
        setCodeLoading(false);
      }
    }, 280);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [actionRevision, actions.length, session?.id]);

  const replaceSession = useCallback((nextSession: StudioSession) => {
    setSession((current) => current?.id === nextSession.id ? nextSession : current);
    setEvidence(nextSession.evidence);
  }, []);

  const launchBrowser = useCallback(async (target: string) => {
    setBusyAction("launch");
    setError(null);
    setConnectionState("connecting");

    try {
      const normalized = normalizeUrl(target);
      const nextSession = await studioApi.createSession({
        semanticEnrichment: enrichmentOptIn,
        url: normalized,
      });
      setSession(nextSession);
      setEvidence(nextSession.evidence);
      setVisualDataset(null);
      setLaunchUrl(normalized);
      setAddressValue(nextSession.url);
      setReplayResult(null);
      setSelectedActionId(null);
      setActiveSavedFlowId(null);
      setLastSavedRevision(null);
      setSaveName("");
      setSaveDescription("");
      setSaveDialogOpen(false);
      setCloseDialogOpen(false);
      onToast(nextSession.semanticEnrichmentEnabled
        ? "Browser ready — GPT-5.6 enrichment is on for this session"
        : nextSession.runtime === "container"
          ? "Browser runner container ready — start recording when you are set"
          : "Local browser ready — start recording when you are set");
    } catch (launchError) {
      setError(displayError(launchError));
    } finally {
      setBusyAction(null);
    }
  }, [enrichmentOptIn, onToast]);

  const handleLaunch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void launchBrowser(launchUrl);
  };

  const queueBrowserInput = useCallback((input: StudioInputRequest) => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;

    inputQueue.current = inputQueue.current
      .catch(() => undefined)
      .then(async () => {
        const response = await studioApi.sendInput(sessionId, input);
        replaceSession(response.session);
        if (response.action) setReplayResult(null);
      })
      .catch((inputError) => setError(displayError(inputError)));
  }, [replaceSession]);

  const handleNavigate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session) return;
    setBusyAction("navigate");
    setError(null);

    try {
      const url = normalizeUrl(addressValue);
      const response = await studioApi.sendInput(session.id, { kind: "navigate", url });
      replaceSession(response.session);
      if (response.action) setReplayResult(null);
    } catch (navigationError) {
      setError(displayError(navigationError));
    } finally {
      setBusyAction(null);
    }
  };

  const handleFrameClick = (event: ReactMouseEvent<HTMLImageElement>) => {
    if (!session || !frameUrl || !frameIsCurrent) return;
    frameShellRef.current?.focus({ preventScroll: true });
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.round(((event.clientX - bounds.left) / bounds.width) * session.viewport.width);
    const y = Math.round(((event.clientY - bounds.top) / bounds.height) * session.viewport.height);
    queueBrowserInput({
      frameRevision: displayedFrameRevision.current,
      kind: "click",
      viewport: session.viewport,
      x,
      y,
    });
  };

  const handleFrameKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!session || event.nativeEvent.isComposing) return;
    event.preventDefault();

    const isPlainText = event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey;
    if (isPlainText) {
      queueBrowserInput({ kind: "text", text: event.key });
      return;
    }

    const modifiers = [
      event.metaKey ? "Meta" : "",
      event.ctrlKey ? "Control" : "",
      event.altKey ? "Alt" : "",
      event.shiftKey ? "Shift" : "",
    ].filter(Boolean);
    queueBrowserInput({ kind: "key", key: [...modifiers, event.key].join("+") });
  };

  const handleFrameWheel = useCallback((event: WheelEvent) => {
    if (!session) return;
    event.preventDefault();
    event.stopPropagation();
    if (!frameIsCurrent) return;
    const deltaScale = event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? session.viewport.height
        : 1;
    scrollBuffer.current.deltaX += event.deltaX * deltaScale;
    scrollBuffer.current.deltaY += event.deltaY * deltaScale;

    if (scrollBuffer.current.timeout) return;
    scrollBuffer.current.timeout = window.setTimeout(() => {
      const { deltaX, deltaY } = scrollBuffer.current;
      scrollBuffer.current = { deltaX: 0, deltaY: 0, timeout: 0 };
      queueBrowserInput({
        deltaX,
        deltaY,
        frameRevision: displayedFrameRevision.current,
        kind: "scroll",
        viewport: session.viewport,
      });
    }, 90);
  }, [frameIsCurrent, queueBrowserInput, session]);

  useEffect(() => {
    const frameShell = frameShellRef.current;
    if (!frameShell || !session) return;

    frameShell.addEventListener("wheel", handleFrameWheel, { passive: false });
    return () => frameShell.removeEventListener("wheel", handleFrameWheel);
  }, [handleFrameWheel, session?.id]);

  const handleEvidenceTabKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextTab = event.key === "ArrowLeft" || event.key === "Home" ? "console" : "network";
    setEvidenceTab(nextTab);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLButtonElement>(`#studio-${nextTab}-tab`)?.focus();
    });
  };

  const toggleRecording = async () => {
    if (!session) return;
    const recording = !session.recording;
    setBusyAction("recording");
    setError(null);

    try {
      const response = await studioApi.setRecording(session.id, { recording });
      replaceSession(response.session);
      onToast(recording ? "Recording started" : "Recording paused — timeline preserved");
    } catch (recordingError) {
      setError(displayError(recordingError));
    } finally {
      setBusyAction(null);
    }
  };

  const clearLiveSession = () => {
    sessionIdRef.current = null;
    window.sessionStorage.removeItem(ACTIVE_STUDIO_SESSION_KEY);
    setSession(null);
    setEvidence(EMPTY_EVIDENCE);
    setVisualDataset(null);
    setReplayResult(null);
    setGeneratedCode("");
    setSelectedActionId(null);
    setActiveSavedFlowId(null);
    setLastSavedRevision(null);
    setSaveDialogOpen(false);
    setCloseDialogOpen(false);
    if (frameObjectUrl.current) URL.revokeObjectURL(frameObjectUrl.current);
    frameObjectUrl.current = null;
    displayedFrameRevision.current = 0;
    setFrameUrl(null);
  };

  const closeSession = async () => {
    if (!session) return;
    const sessionId = session.id;
    setBusyAction("close");
    setError(null);

    try {
      await studioApi.closeSession(sessionId);
      clearLiveSession();
      onToast(isContainerRuntime ? "Browser runner session closed" : "Local browser session closed");
    } catch (closeError) {
      setError(displayError(closeError));
    } finally {
      setBusyAction(null);
    }
  };

  const closeSaveDialog = () => {
    setSaveDialogOpen(false);
    window.requestAnimationFrame(() => saveButtonRef.current?.focus());
  };

  const openSaveDialog = () => {
    if (!session || actions.length === 0) return;
    setError(null);
    const existing = activeSavedFlowId
      ? savedFlows.find((flow) => flow.id === activeSavedFlowId)
      : undefined;
    setSaveName(existing?.name ?? (saveName || defaultSavedFlowName(session)));
    setSaveDescription(existing?.description ?? saveDescription);
    setCloseDialogOpen(false);
    setSaveDialogOpen(true);
  };

  const handleDialogKeyDown = (
    event: ReactKeyboardEvent<HTMLElement>,
    onDismiss: () => void,
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onDismiss();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
    )];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable.at(-1) ?? first;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const saveFlow = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session || actions.length === 0 || enrichmentCounts.processing > 0) return;
    setBusyAction("save");
    setError(null);
    try {
      let currentSession = session;
      if (currentSession.recording) {
        const stopped = await studioApi.setRecording(currentSession.id, { recording: false });
        currentSession = stopped.session;
        replaceSession(currentSession);
      }
      const savedFlow = await studioApi.saveSessionAsFlow(currentSession.id, {
        name: saveName,
        description: saveDescription.trim() || undefined,
        flowId: activeSavedFlowId ?? undefined,
      });
      setActiveSavedFlowId(savedFlow.id);
      setLastSavedRevision(recordingRevision);
      setSaveName(savedFlow.name);
      setSaveDescription(savedFlow.description ?? "");
      setSaveDialogOpen(false);
      await refreshSavedFlows();
      onToast(activeSavedFlowId
        ? "Saved flow updated in Flakey"
        : "Flow saved in Flakey — choose View saved to inspect it");
    } catch (saveError) {
      setError(displayError(saveError));
    } finally {
      setBusyAction(null);
    }
  };

  const viewActiveSavedFlow = async () => {
    if (!session || !activeSavedFlowId || hasUnsavedRecording) return;
    setBusyAction("view-saved");
    setError(null);
    try {
      await studioApi.getSavedFlow(activeSavedFlowId);
      await studioApi.closeSession(session.id);
      clearLiveSession();
      onOpenSavedFlow(activeSavedFlowId);
      onToast("Opened the saved recording inside Flakey");
    } catch (viewError) {
      setError(displayError(viewError));
    } finally {
      setBusyAction(null);
    }
  };

  const requestCloseSession = () => {
    if (hasUnsavedRecording) {
      setCloseDialogOpen(true);
      return;
    }
    void closeSession();
  };

  const closeCloseDialog = () => {
    setCloseDialogOpen(false);
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());
  };

  const deleteAction = async (actionId: string) => {
    if (!session) return;
    setBusyAction(`delete:${actionId}`);
    setError(null);

    try {
      const response = await studioApi.deleteAction(session.id, actionId);
      replaceSession(response.session);
      if (selectedActionId === actionId) {
        setSelectedActionId(response.session.actions.at(-1)?.id ?? null);
      }
      setReplayResult(null);
      onToast("Step removed from the timeline");
    } catch (deleteError) {
      setError(displayError(deleteError));
    } finally {
      setBusyAction(null);
    }
  };

  const addAssertion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session) return;

    let assertion: StudioAssertionRequest;
    if (assertionKind === "elementVisible") {
      if (!lastLocator) {
        setError("Interact with an element first, then add a last-element assertion.");
        return;
      }
      assertion = { kind: "elementVisible", locator: lastLocator };
    } else if (assertionKind === "urlContains") {
      if (!assertionValue.trim()) {
        setError("Enter the URL text you expect.");
        return;
      }
      assertion = { kind: "urlContains", value: assertionValue.trim() };
    } else {
      if (!assertionValue.trim()) {
        setError("Enter the text that should be visible.");
        return;
      }
      assertion = { kind: "textVisible", text: assertionValue.trim() };
    }

    setBusyAction("assertion");
    setError(null);
    try {
      const response = await studioApi.addAssertion(session.id, assertion);
      replaceSession(response.session);
      setAssertionValue("");
      setReplayResult(null);
      onToast("Assertion added to the recorded flow");
    } catch (assertionError) {
      setError(displayError(assertionError));
    } finally {
      setBusyAction(null);
    }
  };

  const replay = async () => {
    if (!session || !hasAssertion) return;
    setBusyAction("replay");
    setReplayResult(null);
    setError(null);
    try {
      const result = await studioApi.replay(session.id);
      setReplayResult(result);
      onToast(result.status === "passed"
        ? "Fresh-browser replay passed"
        : "Replay failed — inspect the failed step and recording evidence");
    } catch (replayError) {
      setError(displayError(replayError));
    } finally {
      setBusyAction(null);
    }
  };

  const copyCode = async () => {
    if (!generatedCode) return;
    try {
      await navigator.clipboard.writeText(generatedCode);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = generatedCode;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    onToast("Playwright spec copied");
  };

  const copySessionId = async () => {
    if (!session) return;
    try {
      await navigator.clipboard.writeText(session.id);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = session.id;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.append(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    onToast("Studio run ID copied");
  };

  const convertToManualCase = () => {
    if (!session) return;
    const now = new Date().toISOString();
    const testCase: ManualTestCase = {
      automatedTestIds: [],
      description: `Drafted from Test Studio session ${session.id}. Review expected results before activation.`,
      estimatedDurationMinutes: Math.max(2, Math.ceil(actions.length / 2)),
      id: `manual-studio-${session.id}`,
      key: `STUDIO-${session.id.slice(-6).toUpperCase()}`,
      lastUpdatedAt: now,
      lifecycle: "draft",
      ownerId: "current-user",
      preconditions: [
        `Open ${session.initialUrl}`,
        `Use Chromium in a fresh ${isContainerRuntime ? "runner container" : "local browser context"}`,
      ],
      priority: "medium",
      releaseIds: [],
      requirementIds: [],
      steps: buildManualSteps(actions),
      tags: ["test-studio", "recorded"],
      title: session.title ? `${session.title} recorded flow` : "Recorded browser flow",
    };
    onCreateManualCase(testCase);
  };

  if (!session) {
    return (
      <section className="test-studio studio-launch animate-in" aria-labelledby="studio-launch-heading">
        <div className="studio-launch-copy">
          <span className="studio-local-badge"><Monitor size={14} aria-hidden="true" /> Real browser Studio</span>
          <p className="eyebrow eyebrow-accent">Test Studio</p>
          <h1 id="studio-launch-heading">Turn a real browser flow into a test.</h1>
          <p className="studio-launch-lede">
            Paste a URL, use the page naturally, then replay the exact semantic steps in a fresh Chromium context.
          </p>

          <form className="studio-launch-form" onSubmit={handleLaunch}>
            <label className="field-label" htmlFor="studio-launch-url">Page to test</label>
            <div className="studio-launch-input-row">
              <span className="studio-input-icon" aria-hidden="true"><Globe2 size={17} /></span>
              <input
                aria-describedby={error ? "studio-launch-error" : "studio-launch-hint"}
                autoComplete="url"
                className="text-input input-large"
                id="studio-launch-url"
                onChange={(event) => setLaunchUrl(event.target.value)}
                placeholder="https://staging.example.com/checkout"
                required
                type="url"
                value={launchUrl}
              />
              <button className="button button-primary button-large" disabled={busyAction === "launch"} type="submit">
                {busyAction === "launch" ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}
                Launch browser
              </button>
            </div>
            <p id="studio-launch-hint">Only explicit http:// and https:// targets are opened.</p>
            <label className="studio-enrichment-choice">
              <input
                checked={enrichmentOptIn}
                onChange={(event) => setEnrichmentOptIn(event.target.checked)}
                type="checkbox"
              />
              <span>
                <strong><Sparkles aria-hidden="true" size={12} /> Use GPT-5.6 semantic enrichment</strong>
                <small>Sends target-focused, masked recorder screenshots to OpenAI for this session. Use approved test data only.</small>
              </span>
            </label>
          </form>

          <div className="studio-demo-row">
            <span>Try a safe target:</span>
            <button className="button button-secondary" disabled={busyAction === "launch"} onClick={() => {
              setLaunchUrl(demoUrl);
              void launchBrowser(demoUrl);
            }} type="button">
              <MousePointer2 size={15} /> Use demo shop
            </button>
          </div>

          {error ? <div className="studio-alert" id="studio-launch-error" role="alert"><AlertTriangle size={16} />{error}</div> : null}

          <div className="studio-launch-proof" aria-label="Test Studio capabilities">
            <span><ShieldCheck size={16} /> Fresh browser context</span>
            <span><Eye size={16} /> Inspectable locators</span>
            <span><Code2 size={16} /> Playwright-ready output</span>
          </div>
        </div>

        {savedFlowsLoading || savedFlows.length > 0 || savedFlowsError ? (
          <section
            aria-busy={savedFlowsLoading}
            aria-labelledby="studio-saved-flows-heading"
            className="studio-saved-library"
          >
            <header>
              <span className="studio-saved-library-icon"><FolderOpen size={18} /></span>
              <div>
                <p className="eyebrow eyebrow-accent">Your workspace</p>
                <h2 id="studio-saved-flows-heading">Saved flows</h2>
                <span>{savedFlows.length} {savedFlows.length === 1 ? "recording" : "recordings"} kept inside Flakey</span>
              </div>
            </header>
            {savedFlowsError ? (
              <div className="studio-saved-library-error" role="alert">
                <AlertTriangle size={15} />
                <span>{savedFlowsError}</span>
                <button onClick={() => void refreshSavedFlows()} type="button">Try again</button>
              </div>
            ) : null}
            {savedFlowsLoading && savedFlows.length === 0 ? (
              <div className="studio-saved-library-loading">
                <LoaderCircle className="spin" size={20} />
                Loading saved flows…
              </div>
            ) : (
              <div className="studio-saved-flow-list">
                {savedFlows.map((flow) => (
                  <button
                    className="studio-saved-flow-card"
                    key={flow.id}
                    onClick={() => onOpenSavedFlow(flow.id)}
                    type="button"
                  >
                    <span className="studio-saved-flow-card-icon">
                      <FileText size={15} />
                    </span>
                    <span className="studio-saved-flow-card-copy">
                      <strong>{flow.name}</strong>
                      <small>{savedFlowHost(flow.initialUrl)}</small>
                      <span>
                        {flow.actionCount} {flow.actionCount === 1 ? "step" : "steps"}
                        <i aria-hidden="true" />
                        {flow.enrichedActionCount} enriched
                        <i aria-hidden="true" />
                        <time dateTime={flow.updatedAt}>{formatSavedFlowDate(flow.updatedAt)}</time>
                      </span>
                    </span>
                    <ChevronRight aria-hidden="true" size={16} />
                  </button>
                ))}
              </div>
            )}
          </section>
        ) : (
          <div className="studio-launch-preview" aria-hidden="true">
            <div className="studio-preview-window">
              <div className="studio-preview-chrome"><i /><i /><i /><span>demo-shop.local/checkout</span></div>
              <div className="studio-preview-page">
                <div className="studio-preview-hero"><span /><strong>Make room<br />for good work.</strong></div>
                <div className="studio-preview-products"><span /><span /><span /></div>
                <div className="studio-preview-cursor"><MousePointer2 size={19} /></div>
              </div>
            </div>
            <div className="studio-preview-timeline">
              <div><CheckCircle2 size={15} /><span><strong>Click “Add to bag”</strong><small>getByRole('button')</small></span></div>
              <div><CheckCircle2 size={15} /><span><strong>Fill email address</strong><small>getByLabel('Email')</small></span></div>
              <div><BadgeCheck size={15} /><span><strong>Bag count is visible</strong><small>1 unique match</small></span></div>
            </div>
          </div>
        )}
      </section>
    );
  }

  return (
    <section className="test-studio studio-session animate-in" aria-labelledby="studio-session-heading">
      <header className="studio-heading">
        <div>
          <p className="eyebrow eyebrow-accent">Test Studio</p>
          <h1 id="studio-session-heading">Record the flow. Prove it works.</h1>
          <p>Every action stays inspectable before it becomes automation.</p>
        </div>
        <div className="studio-heading-status" aria-live="polite">
          <span className={`studio-connection studio-connection--${connectionState}`}>
            {connectionState === "live" ? <Radio size={13} /> : connectionState === "interrupted" ? <WifiOff size={13} /> : <LoaderCircle className="spin" size={13} />}
            {connectionState === "live" ? "Frame live" : connectionState === "interrupted" ? "Reconnecting" : "Connecting"}
          </span>
          <span className="studio-local-browser-label"><Monitor size={14} /> {isContainerRuntime ? "Runner container" : "Local browser"} · Fresh Chromium context</span>
          {session.semanticEnrichmentEnabled ? <span className="studio-ai-session-label"><Sparkles aria-hidden="true" size={13} /> GPT-5.6 enrichment on</span> : null}
        </div>
      </header>

      {error ? <div className="studio-alert" role="alert"><AlertTriangle size={16} />{error}<button aria-label="Dismiss Test Studio error" onClick={() => setError(null)} type="button"><X size={14} /></button></div> : null}

      <div className="studio-toolbar" aria-label="Browser session controls">
        <form className="studio-address-form" onSubmit={handleNavigate}>
          <Globe2 size={15} aria-hidden="true" />
          <label className="sr-only" htmlFor="studio-address">Browser address</label>
          <input id="studio-address" onChange={(event) => setAddressValue(event.target.value)} spellCheck="false" type="url" value={addressValue} />
          <button aria-label="Navigate browser runner" disabled={busyAction === "navigate"} type="submit">
            {busyAction === "navigate" ? <LoaderCircle className="spin" size={15} /> : <Navigation size={15} />}
          </button>
        </form>
        <div className="studio-toolbar-actions">
          <button
            aria-label="Copy Studio run ID for visual evaluation"
            className="studio-session-id-button"
            onClick={() => void copySessionId()}
            title={session.id}
            type="button"
          >
            <Copy size={14} /> Run ID
          </button>
          <button
            aria-label={activeSavedFlowId && !hasUnsavedRecording
              ? "View saved recording inside Flakey"
              : "Save recording inside Flakey"}
            className={`studio-save-button ${activeSavedFlowId && !hasUnsavedRecording ? "is-saved" : ""}`}
            disabled={actions.length === 0 || busyAction === "save" || busyAction === "view-saved"}
            onClick={activeSavedFlowId && !hasUnsavedRecording
              ? () => void viewActiveSavedFlow()
              : openSaveDialog}
            ref={saveButtonRef}
            type="button"
          >
            {busyAction === "save" || busyAction === "view-saved"
              ? <LoaderCircle className="spin" size={14} />
              : activeSavedFlowId && !hasUnsavedRecording
                ? <FolderOpen size={14} />
                : <Save size={14} />}
            {activeSavedFlowId
              ? hasUnsavedRecording ? "Save changes" : "View saved"
              : "Save flow"}
          </button>
          <button
            aria-pressed={session.recording}
            className={`studio-record-button ${session.recording ? "is-recording" : ""}`}
            disabled={busyAction === "recording"}
            onClick={() => void toggleRecording()}
            type="button"
          >
            {busyAction === "recording" ? <LoaderCircle className="spin" size={15} /> : session.recording ? <Square size={13} /> : <Circle size={13} />}
            {session.recording ? "Stop recording" : "Start recording"}
          </button>
          <button
            className="studio-close-button"
            disabled={busyAction === "close"}
            onClick={requestCloseSession}
            ref={closeButtonRef}
            type="button"
          >
            <X size={15} /> Close browser
          </button>
        </div>
      </div>

      <div className="studio-workbench">
        <section className="studio-browser-panel" aria-labelledby="browser-frame-heading">
          <div className="studio-panel-heading">
            <div><span className="studio-panel-icon"><Monitor size={15} /></span><div><h2 id="browser-frame-heading">{isContainerRuntime ? "Browser sandbox" : "Local browser"}</h2><p>{session.title || "Loading page title…"}</p></div></div>
            <span className="studio-browser-honesty">{isContainerRuntime ? "Container-isolated · trusted targets only" : "On this machine · not a cloud sandbox"}</span>
          </div>
          <div
            aria-describedby="studio-frame-help"
            aria-label={`Interact with browser runner at ${session.url}`}
            className="studio-frame-shell"
            onKeyDown={handleFrameKeyDown}
            ref={frameShellRef}
            role="application"
            tabIndex={0}
          >
            <div className="studio-browser-chrome">
              <span className="studio-browser-dots" aria-hidden="true"><i /><i /><i /></span>
              <span className="studio-frame-url mono">{session.url}</span>
              <span className="studio-viewport mono">Frame r{displayedFrameRevision.current || "…"} · {session.viewport.width}×{session.viewport.height}</span>
            </div>
            <div className="studio-frame-stage">
              {frameUrl ? (
                <img
                  alt={`Live screenshot of ${session.title || session.url}`}
                  draggable="false"
                  onClick={handleFrameClick}
                  onPointerDown={() => frameShellRef.current?.focus({ preventScroll: true })}
                  src={frameUrl}
                />
              ) : (
                <div className="studio-frame-loading"><LoaderCircle className="spin" size={22} /><span>Waiting for the first browser frame…</span></div>
              )}
              {frameUrl && !frameIsCurrent ? <span className="studio-frame-sync-overlay"><LoaderCircle className="spin" size={13} /> Syncing latest frame</span> : null}
              {session.recording ? <span className="studio-recording-overlay"><span className="running-dot" /> Recording</span> : null}
            </div>
          </div>
          <p className="studio-frame-help" id="studio-frame-help"><MousePointer2 size={13} /> Click, type, or scroll here. Scrolling stays inside the recorded page while the Studio remains fixed.</p>
        </section>

        <div className="studio-inspector-column">
          <aside className="studio-timeline-panel" aria-labelledby="studio-timeline-heading">
          <div className="studio-panel-heading studio-timeline-heading">
            <div><span className="studio-panel-icon"><ScrollText size={15} /></span><div><h2 id="studio-timeline-heading">Capture inspector</h2><p>{actions.length} semantic {actions.length === 1 ? "step" : "steps"} · {visualDataset?.cases.length ?? 0} visual {(visualDataset?.cases.length ?? 0) === 1 ? "capture" : "captures"}{enrichmentSummary ? ` · ${enrichmentSummary}` : ""}</p></div></div>
            {session.recording ? <span className="studio-mini-status"><span className="running-dot" /> Listening</span> : null}
          </div>

          <div className="studio-timeline-scroll">
            {actions.length === 0 ? (
              <div className="studio-timeline-empty"><MousePointer2 size={22} /><strong>No captures yet</strong><p>Start recording, then interact with the browser. Each meaningful action will show its intent, locator evidence, and synchronized frames here.</p></div>
            ) : (
              <ol className="studio-timeline-list">
                {actions.map((action, index) => {
                  const Icon = ACTION_ICONS[action.kind];
                  const locator = actionLocator(action);
                  const quality = locator ? locatorQuality(locator) : null;
                  const visualCase = visualCasesByAction.get(action.id);
                  const enrichment = semanticEnrichments[action.id];
                  const modelStatus = enrichmentStatus(enrichment);
                  const selected = action.id === selectedActionId;
                  const candidateCount = action.kind === "click" || action.kind === "fill"
                    ? action.locatorCandidates.length
                    : locator ? 1 : 0;
                  return (
                    <li className={`studio-step ${selected ? "is-selected" : ""}`} key={action.id}>
                      <div className="studio-step-rail"><span>{index + 1}</span><i /></div>
                      <article>
                        <div className="studio-step-heading">
                          <button
                            aria-expanded={selected}
                            className="studio-step-summary"
                            onClick={() => setSelectedActionId(selected ? null : action.id)}
                            type="button"
                          >
                            <span className="studio-step-topline">
                              <span className="studio-step-kind"><Icon size={13} />{ACTION_LABELS[action.kind]}</span>
                              {modelStatus ? (
                                <span className={`studio-step-model-status is-${modelStatus.className}`}>
                                  {modelStatus.className === "queued" || modelStatus.className === "running"
                                    ? <LoaderCircle aria-hidden="true" className="spin" size={10} />
                                    : modelStatus.className === "ready"
                                      ? <Sparkles aria-hidden="true" size={10} />
                                      : <AlertTriangle aria-hidden="true" size={10} />}
                                  {modelStatus.label}
                                </span>
                              ) : null}
                            </span>
                            <span className="studio-step-description">{describeAction(action)}</span>
                          </button>
                          <button aria-label={`Delete step ${index + 1}: ${action.label}`} className="studio-step-delete" disabled={busyAction === `delete:${action.id}`} onClick={() => void deleteAction(action.id)} title="Delete step" type="button">
                            {busyAction === `delete:${action.id}` ? <LoaderCircle className="spin" size={13} /> : <Trash2 size={13} />}
                          </button>
                        </div>
                        {selected ? (
                          <div className="studio-step-details">
                            <div
                              aria-atomic="true"
                              aria-busy={enrichment?.status === "queued" || enrichment?.status === "running"}
                              aria-live="polite"
                              className={`studio-semantic-capture is-${enrichment?.status ?? "recorded"}`}
                              role="status"
                            >
                              <div className="studio-semantic-heading">
                                <span>
                                  {enrichment?.status === "ready"
                                    ? <Sparkles aria-hidden="true" size={12} />
                                    : <Eye aria-hidden="true" size={12} />}
                                  {enrichment?.status === "ready" ? `${enrichment.model} meaning` : "Recorder meaning"}
                                </span>
                                {modelStatus ? <strong className={`is-${modelStatus.className}`}>{modelStatus.label}</strong> : null}
                              </div>
                              <p>{semanticMeaning(action, visualCase, enrichment)}</p>
                              {enrichment?.status === "ready" ? (
                                <>
                                  <small>
                                    {enrichment.targetRole ? `Target: ${enrichment.targetRole}` : "Model-enriched browser intent"}
                                    {typeof enrichment.confidence === "number"
                                      ? ` · Model-estimated confidence ${Math.round(enrichment.confidence * 100)}%`
                                      : ""}
                                  </small>
                                  <dl className="studio-semantic-details">
                                    <div><dt>Journey stage</dt><dd>{enrichment.journeyStage}</dd></div>
                                    <div><dt>Suggested check</dt><dd>{enrichment.expectedOutcome}</dd></div>
                                    <div><dt>Visual fallback</dt><dd>{enrichment.visualFallback}</dd></div>
                                  </dl>
                                  <div className="studio-semantic-safety">
                                    <span>Risk: {enrichment.actionRisk ?? "unknown"}</span>
                                    {enrichment.requiresConfirmation ? <span><ShieldCheck size={10} /> Confirmation recommended</span> : null}
                                  </div>
                                </>
                              ) : enrichment?.status === "queued" || enrichment?.status === "running" ? (
                                <small className="studio-semantic-progress"><LoaderCircle aria-hidden="true" className="spin" size={10} /> OpenAI is interpreting screenshots and locator context.</small>
                              ) : enrichment?.status === "error" ? (
                                <small className="studio-semantic-error"><AlertTriangle aria-hidden="true" size={10} /> {enrichment.error}</small>
                              ) : (
                                <small>
                                  {visualCase?.targetLabel
                                    ? `Target: ${visualCase.targetLabel}`
                                    : "Deterministic recorder intent"}
                                </small>
                              )}
                            </div>
                            {locator && quality ? (
                              <div className="studio-locator">
                                <div className="studio-locator-topline"><span>Playwright locator</span><span className={`studio-locator-quality studio-locator-quality--${quality.className}`}><i />{quality.label} · {Math.round(locator.score * 100)}%</span></div>
                                <code>{locator.selector}</code>
                                <div className="studio-locator-meta"><span className={locator.unique ? "is-unique" : "needs-review"}>{locator.unique ? <Check size={11} /> : <AlertTriangle size={11} />}{locator.unique ? "Unique · 1 match" : `${locator.matchCount} matches`}</span><span>{candidateCount} {candidateCount === 1 ? "candidate" : "candidates"} · {locator.strategy}</span></div>
                              </div>
                            ) : null}
                            {action.kind === "fill" && action.sensitive ? (
                              <div className="studio-sensitive-capture"><ShieldCheck size={13} /> Visual evidence withheld for sensitive input.</div>
                            ) : action.screenshotAvailable ? (
                              <div className={`studio-step-evidence ${visualCase?.beforeScreenshotAvailable ? "" : "is-single"}`}>
                                {visualCase?.beforeScreenshotAvailable ? (
                                  <figure>
                                    <figcaption>Before</figcaption>
                                    <img
                                      alt={`Browser frame before step ${index + 1}`}
                                      loading="lazy"
                                      src={studioApi.actionScreenshotUrl(session.id, action.id, visualCase.createdAt, "before")}
                                    />
                                  </figure>
                                ) : null}
                                <figure>
                                  <figcaption>After</figcaption>
                                  <img
                                    alt={`Browser frame after step ${index + 1}`}
                                    loading="lazy"
                                    src={studioApi.actionScreenshotUrl(session.id, action.id, visualCase?.createdAt ?? action.createdAt)}
                                  />
                                </figure>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </article>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          <form className="studio-assertion-composer" onSubmit={addAssertion}>
            <div className="studio-composer-heading"><BadgeCheck size={15} /><div><strong>Add assertion</strong><span>Make the expected result explicit.</span></div></div>
            <label className="sr-only" htmlFor="studio-assertion-kind">Assertion type</label>
            <select className="select-input" id="studio-assertion-kind" onChange={(event) => setAssertionKind(event.target.value as AssertionChoice)} value={assertionKind}>
              <option value="urlContains">URL contains</option>
              <option value="textVisible">Text is visible</option>
              <option disabled={!lastLocator} value="elementVisible">Last element is visible</option>
            </select>
            {assertionKind === "elementVisible" ? (
              <code className="studio-assertion-target">{lastLocator?.selector ?? "Interact with an element first"}</code>
            ) : (
              <label>
                <span className="sr-only">{assertionKind === "urlContains" ? "Expected URL text" : "Expected visible text"}</span>
                <input className="text-input" onChange={(event) => setAssertionValue(event.target.value)} placeholder={assertionKind === "urlContains" ? "/order-confirmed" : "Order confirmed"} value={assertionValue} />
              </label>
            )}
            <button className="button button-secondary" disabled={busyAction === "assertion" || (assertionKind === "elementVisible" && !lastLocator)} type="submit">
              {busyAction === "assertion" ? <LoaderCircle className="spin" size={14} /> : <Plus size={14} />} Add to timeline
            </button>
          </form>
          </aside>

          <div className="studio-output-grid">
            <section className="studio-output-card studio-evidence-card" aria-labelledby="studio-evidence-heading">
          <div className="studio-output-heading"><div><span className="studio-panel-icon"><Terminal size={15} /></span><div><h2 id="studio-evidence-heading">Browser evidence</h2><p>Safe console and failed-request metadata</p></div></div></div>
          <div className="studio-tabs" role="tablist" aria-label="Browser evidence" onKeyDown={handleEvidenceTabKeyDown}>
            <button aria-controls="studio-console-panel" aria-selected={evidenceTab === "console"} id="studio-console-tab" onClick={() => setEvidenceTab("console")} role="tab" tabIndex={evidenceTab === "console" ? 0 : -1} type="button">Console <span>{evidence.console.length + evidence.pageErrors.length}</span></button>
            <button aria-controls="studio-network-panel" aria-selected={evidenceTab === "network"} id="studio-network-tab" onClick={() => setEvidenceTab("network")} role="tab" tabIndex={evidenceTab === "network" ? 0 : -1} type="button">Network <span>{evidence.networkErrors.length}</span></button>
          </div>
          {evidenceTab === "console" ? (
            <div aria-labelledby="studio-console-tab" className="studio-evidence-list" id="studio-console-panel" role="tabpanel">
              {evidence.pageErrors.map((entry) => <div className="studio-evidence-entry is-error" key={entry.id}><AlertTriangle size={13} /><div><strong>Page error</strong><code>{entry.message}</code></div></div>)}
              {evidence.console.map((entry) => <div className={`studio-evidence-entry is-${entry.level}`} key={entry.id}><Terminal size={13} /><div><strong>{entry.level}</strong><code>{entry.text}</code></div></div>)}
              {evidence.console.length + evidence.pageErrors.length === 0 ? <div className="studio-output-empty"><CheckCircle2 size={18} /><span>No console or page errors captured.</span></div> : null}
            </div>
          ) : (
            <div aria-labelledby="studio-network-tab" className="studio-evidence-list" id="studio-network-panel" role="tabpanel">
              {evidence.networkErrors.map((entry) => <div className="studio-evidence-entry is-error" key={entry.id}><WifiOff size={13} /><div><strong>{entry.method} · {entry.resourceType}</strong><code>{entry.url}</code><span>{entry.errorText}</span></div></div>)}
              {evidence.networkErrors.length === 0 ? <div className="studio-output-empty"><CheckCircle2 size={18} /><span>No failed requests captured.</span></div> : null}
            </div>
          )}
            </section>

            <section className="studio-output-card studio-replay-card" aria-labelledby="studio-replay-heading">
          <div className="studio-output-heading"><div><span className="studio-panel-icon"><Play size={15} /></span><div><h2 id="studio-replay-heading">Fresh-browser replay</h2><p>Runs semantic steps in a new context</p></div></div><button className="button button-primary" disabled={!hasAssertion || busyAction === "replay"} onClick={() => void replay()} title={!hasAssertion ? "Add at least one assertion before replay" : undefined} type="button">{busyAction === "replay" ? <LoaderCircle className="spin" size={14} /> : <Play size={14} />} Replay in fresh browser</button></div>
          {replayResult ? (
            <div className="studio-replay-result" aria-live="polite">
              <div className={`studio-replay-summary is-${replayResult.status}`}>{replayResult.status === "passed" ? <CheckCircle2 size={20} /> : <AlertTriangle size={20} />}<div><strong>{replayResult.status === "passed" ? "Replay passed" : "Replay failed"}</strong><span>{formatDuration(replayResult.durationMs)} · {replayResult.finalUrl}</span></div></div>
              <ol>{replayResult.steps.map((step) => <li className={`is-${step.status}`} key={`${step.actionId}-${step.index}`}>{step.status === "passed" ? <Check size={13} /> : <X size={13} />}<span><strong>{step.label}</strong>{step.error ? <small>{step.error}</small> : null}</span><code>{formatDuration(step.durationMs)}</code></li>)}</ol>
            </div>
          ) : (
            <div className="studio-replay-empty"><ShieldCheck size={22} /><div><strong>Prove the flow is reusable</strong><p>Add at least one assertion, then replay in a fresh context. Cookies and local storage are never silently cloned.</p></div></div>
          )}
            </section>

            <section className="studio-output-card studio-code-card" aria-labelledby="studio-code-heading">
          <div className="studio-output-heading"><div><span className="studio-panel-icon"><Code2 size={15} /></span><div><h2 id="studio-code-heading">Generated Playwright</h2><p>Stored inside Flakey when you save the flow</p></div></div><div className="studio-code-actions"><button aria-label="Copy generated Playwright code" className="button button-secondary" disabled={!generatedCode} onClick={() => void copyCode()} type="button"><Copy size={14} /> Copy</button></div></div>
          <div className="studio-code-preview">
            {codeLoading ? <div className="studio-code-loading"><LoaderCircle className="spin" size={18} /> Generating from timeline…</div> : generatedCode ? <pre><code>{generatedCode}</code></pre> : <div className="studio-output-empty"><Code2 size={20} /><span>Recorded actions will appear here as runnable Playwright code.</span></div>}
          </div>
          <div className="studio-convert-row"><div><FileText size={17} /><span><strong>Prefer a human test?</strong><small>Assertions become expected results; gaps stay marked for review.</small></span></div><button className="button button-secondary" disabled={actions.length === 0} onClick={convertToManualCase} type="button"><FileText size={14} /> Convert to manual case</button></div>
            </section>
          </div>
        </div>
      </div>

      {saveDialogOpen ? (
        <div className="studio-dialog-backdrop">
          <form
            aria-busy={busyAction === "save"}
            aria-describedby="studio-save-dialog-description"
            aria-labelledby="studio-save-dialog-heading"
            aria-modal="true"
            className="studio-dialog"
            onKeyDown={(event) => handleDialogKeyDown(event, closeSaveDialog)}
            onSubmit={saveFlow}
            role="dialog"
          >
            <header>
              <span><Save aria-hidden="true" size={17} /></span>
              <div>
                <p className="eyebrow eyebrow-accent">Flakey workspace</p>
                <h2 id="studio-save-dialog-heading">
                  {activeSavedFlowId ? "Save recording changes" : "Save this recording"}
                </h2>
              </div>
            </header>
            <p id="studio-save-dialog-description">
              Keeps the current {actions.length} {actions.length === 1 ? "step" : "steps"}, locators,
              semantic meaning, screenshots, evidence, and Playwright code inside Flakey.
            </p>
            <label className="field-label" htmlFor="studio-save-name">Flow name</label>
            <input
              autoComplete="off"
              autoFocus
              className="text-input"
              id="studio-save-name"
              maxLength={100}
              onChange={(event) => setSaveName(event.target.value)}
              required
              value={saveName}
            />
            <label className="field-label" htmlFor="studio-save-description">Description <span>Optional</span></label>
            <textarea
              className="text-input"
              id="studio-save-description"
              maxLength={500}
              onChange={(event) => setSaveDescription(event.target.value)}
              placeholder="What this flow covers or which variation it represents"
              rows={3}
              value={saveDescription}
            />
            {enrichmentCounts.processing > 0 ? (
              <div className="studio-dialog-progress" role="status">
                <LoaderCircle aria-hidden="true" className="spin" size={14} />
                Finishing {enrichmentCounts.processing} semantic {enrichmentCounts.processing === 1 ? "capture" : "captures"} before saving…
              </div>
            ) : null}
            {error ? <div className="studio-dialog-error" role="alert"><AlertTriangle size={14} />{error}</div> : null}
            <div className="studio-dialog-note"><ShieldCheck size={13} /> Saved on this Flakey instance. Protected typed values are redacted, screenshots after protected inputs are withheld, and cookies are not stored.</div>
            <footer>
              <button className="button button-secondary" disabled={busyAction === "save"} onClick={closeSaveDialog} type="button">Cancel</button>
              <button
                className="button button-primary"
                disabled={!saveName.trim() || enrichmentCounts.processing > 0 || busyAction === "save"}
                type="submit"
              >
                {busyAction === "save" ? <LoaderCircle className="spin" size={14} /> : <Save size={14} />}
                {activeSavedFlowId ? "Save changes" : "Save flow"}
              </button>
            </footer>
          </form>
        </div>
      ) : null}

      {closeDialogOpen ? (
        <div className="studio-dialog-backdrop">
          <section
            aria-describedby="studio-close-dialog-description"
            aria-labelledby="studio-close-dialog-heading"
            aria-modal="true"
            className="studio-dialog studio-close-dialog"
            onKeyDown={(event) => handleDialogKeyDown(event, closeCloseDialog)}
            role="dialog"
          >
            <header>
              <span className="is-warning"><AlertTriangle aria-hidden="true" size={17} /></span>
              <div>
                <p className="eyebrow">Unsaved recording</p>
                <h2 id="studio-close-dialog-heading">Keep this flow before closing?</h2>
              </div>
            </header>
            <p id="studio-close-dialog-description">
              Closing the browser now will discard changes that have not been saved inside Flakey.
            </p>
            <footer>
              <button autoFocus className="button button-secondary" onClick={closeCloseDialog} type="button">Continue recording</button>
              <button className="button studio-button-danger" onClick={() => {
                setCloseDialogOpen(false);
                void closeSession();
              }} type="button">Close without saving</button>
              <button className="button button-primary" onClick={openSaveDialog} type="button"><Save size={14} /> Save flow</button>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}
