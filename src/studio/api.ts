import {
  STUDIO_API_BASE,
  type QuestionnaireCatalog,
  type QuestionnaireCommandRequest,
  type QuestionnaireExecutionRequest,
  type QuestionnaireExecutionResult,
  type QuestionnaireRunPlan,
  type StudioAssertionRequest,
  type StudioCodeResponse,
  type StudioCreateSessionRequest,
  type StudioDeleteResponse,
  type StudioErrorResponse,
  type StudioEvidence,
  type StudioFrameResponse,
  type StudioInputRequest,
  type StudioMutationResponse,
  type StudioRecordingRequest,
  type StudioReplayResult,
  type StudioSavedFlow,
  type StudioSavedFlowListResponse,
  type StudioSaveFlowRequest,
  type StudioSession,
  type StudioSessionId,
  type StudioVisualDataset,
} from "./types";

export class StudioApiError extends Error {
  code?: string;
  status: number;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "StudioApiError";
    this.status = status;
    this.code = code;
  }
}

function sessionPath(sessionId: StudioSessionId, suffix = "") {
  return `${STUDIO_API_BASE}/sessions/${encodeURIComponent(sessionId)}${suffix}`;
}

function flowPath(flowId: string, suffix = "") {
  return `${STUDIO_API_BASE}/flows/${encodeURIComponent(flowId)}${suffix}`;
}

async function parseApiError(response: Response) {
  const payload = await response.json().catch(() => null) as StudioErrorResponse | null;
  return new StudioApiError(
    payload?.error ?? `Test Studio request failed (${response.status})`,
    response.status,
    payload?.code,
  );
}

async function requestJson<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, {
      cache: "no-store",
      ...init,
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new StudioApiError(
      "The local browser runner is unavailable. Start it and try again.",
      0,
      "RUNNER_UNAVAILABLE",
    );
  }

  if (!response.ok) throw await parseApiError(response);
  return await response.json() as T;
}

async function requestImage(path: string, signal?: AbortSignal): Promise<StudioFrameResponse> {
  let response: Response;

  try {
    response = await fetch(path, {
      cache: "no-store",
      headers: { Accept: "image/jpeg" },
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new StudioApiError(
      "The latest browser frame could not be loaded.",
      0,
      "FRAME_UNAVAILABLE",
    );
  }

  if (!response.ok) throw await parseApiError(response);
  const frameRevision = Number(response.headers.get("X-Flakey-Frame-Revision"));
  if (!Number.isSafeInteger(frameRevision) || frameRevision < 1) {
    throw new StudioApiError("The browser frame did not include a valid revision.", 502, "INVALID_FRAME");
  }
  return { blob: await response.blob(), frameRevision };
}

export const studioApi = {
  listSavedFlows(signal?: AbortSignal): Promise<StudioSavedFlowListResponse> {
    return requestJson(`${STUDIO_API_BASE}/flows`, { signal });
  },

  getSavedFlow(flowId: string, signal?: AbortSignal): Promise<StudioSavedFlow> {
    return requestJson(flowPath(flowId), { signal });
  },

  saveSessionAsFlow(
    sessionId: StudioSessionId,
    request: StudioSaveFlowRequest,
    signal?: AbortSignal,
  ): Promise<StudioSavedFlow> {
    return requestJson(sessionPath(sessionId, "/save"), {
      body: JSON.stringify(request),
      method: "POST",
      signal,
    });
  },

  deleteSavedFlow(flowId: string, signal?: AbortSignal): Promise<StudioDeleteResponse> {
    return requestJson(flowPath(flowId), { method: "DELETE", signal });
  },

  getQuestionnaireCatalog(signal?: AbortSignal): Promise<QuestionnaireCatalog> {
    return requestJson(`${STUDIO_API_BASE}/questionnaires`, { signal });
  },

  createSession(
    request: StudioCreateSessionRequest,
    signal?: AbortSignal,
  ): Promise<StudioSession> {
    return requestJson(`${STUDIO_API_BASE}/sessions`, {
      body: JSON.stringify(request),
      method: "POST",
      signal,
    });
  },

  getSession(sessionId: StudioSessionId, signal?: AbortSignal): Promise<StudioSession> {
    return requestJson(sessionPath(sessionId), { signal });
  },

  closeSession(
    sessionId: StudioSessionId,
    signal?: AbortSignal,
  ): Promise<StudioDeleteResponse> {
    return requestJson(sessionPath(sessionId), { method: "DELETE", signal });
  },

  getFrame(sessionId: StudioSessionId, signal?: AbortSignal): Promise<StudioFrameResponse> {
    return requestImage(sessionPath(sessionId, "/frame"), signal);
  },

  sendInput(
    sessionId: StudioSessionId,
    input: StudioInputRequest,
    signal?: AbortSignal,
  ): Promise<StudioMutationResponse> {
    return requestJson(sessionPath(sessionId, "/input"), {
      body: JSON.stringify(input),
      method: "POST",
      signal,
    });
  },

  setRecording(
    sessionId: StudioSessionId,
    request: StudioRecordingRequest,
    signal?: AbortSignal,
  ): Promise<StudioMutationResponse> {
    return requestJson(sessionPath(sessionId, "/recording"), {
      body: JSON.stringify(request),
      method: "POST",
      signal,
    });
  },

  addAssertion(
    sessionId: StudioSessionId,
    assertion: StudioAssertionRequest,
    signal?: AbortSignal,
  ): Promise<StudioMutationResponse> {
    return requestJson(sessionPath(sessionId, "/assertions"), {
      body: JSON.stringify(assertion),
      method: "POST",
      signal,
    });
  },

  deleteAction(
    sessionId: StudioSessionId,
    actionId: string,
    signal?: AbortSignal,
  ): Promise<StudioMutationResponse> {
    return requestJson(
      sessionPath(sessionId, `/actions/${encodeURIComponent(actionId)}`),
      { method: "DELETE", signal },
    );
  },

  getEvidence(sessionId: StudioSessionId, signal?: AbortSignal): Promise<StudioEvidence> {
    return requestJson(sessionPath(sessionId, "/evidence"), { signal });
  },

  getVisualDataset(sessionId: StudioSessionId, signal?: AbortSignal): Promise<StudioVisualDataset> {
    return requestJson(sessionPath(sessionId, "/visual-dataset"), { signal });
  },

  replay(sessionId: StudioSessionId, signal?: AbortSignal): Promise<StudioReplayResult> {
    return requestJson(sessionPath(sessionId, "/replay"), {
      method: "POST",
      signal,
    });
  },

  getCode(sessionId: StudioSessionId, signal?: AbortSignal): Promise<StudioCodeResponse> {
    return requestJson(sessionPath(sessionId, "/code"), { signal });
  },

  planQuestionnaire(
    sessionId: StudioSessionId,
    request: QuestionnaireCommandRequest,
    signal?: AbortSignal,
  ): Promise<QuestionnaireRunPlan> {
    return requestJson(sessionPath(sessionId, "/questionnaire/plan"), {
      body: JSON.stringify(request),
      method: "POST",
      signal,
    });
  },

  executeQuestionnaire(
    sessionId: StudioSessionId,
    request: QuestionnaireExecutionRequest,
    signal?: AbortSignal,
  ): Promise<QuestionnaireExecutionResult> {
    return requestJson(sessionPath(sessionId, "/questionnaire/execute"), {
      body: JSON.stringify(request),
      method: "POST",
      signal,
    });
  },

  actionScreenshotUrl(
    sessionId: StudioSessionId,
    actionId: string,
    revision?: string,
    phase: "before" | "after" = "after",
  ) {
    const base = sessionPath(
      sessionId,
      `/actions/${encodeURIComponent(actionId)}/screenshot`,
    );
    const parameters = new URLSearchParams();
    if (revision) parameters.set("v", revision);
    if (phase === "before") parameters.set("phase", phase);
    const query = parameters.toString();
    return query ? `${base}?${query}` : base;
  },

  savedFlowScreenshotUrl(
    flowId: string,
    actionId: string,
    phase: "before" | "after" = "after",
    revision?: string,
  ) {
    const base = flowPath(
      flowId,
      `/actions/${encodeURIComponent(actionId)}/screenshot`,
    );
    const parameters = new URLSearchParams();
    if (phase === "before") parameters.set("phase", phase);
    if (revision) parameters.set("v", revision);
    const query = parameters.toString();
    return query ? `${base}?${query}` : base;
  },
};
