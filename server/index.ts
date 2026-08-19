import { join } from "node:path";

import { StudioService, StudioServiceError } from "./studio-service";
import { OPENAI_SEMANTIC_ENRICHMENT_DEFAULT_MODEL } from "./openai-semantic-enrichment";
import { SavedFlowStore } from "./saved-flow-store";

const openAIApiKey = Bun.env.OPENAI_API_KEY?.trim() ?? "";
const semanticEnrichmentModel = Bun.env.OPENAI_ENRICHMENT_MODEL?.trim()
  || OPENAI_SEMANTIC_ENRICHMENT_DEFAULT_MODEL;
const studioDataDirectory = Bun.env.STUDIO_DATA_DIR?.trim() || ".flakey";
const savedFlowStore = new SavedFlowStore(join(studioDataDirectory, "studio.sqlite"));
const service = new StudioService({
  savedFlowStore,
  semanticEnrichment: openAIApiKey
    ? {
        apiKey: openAIApiKey,
        model: semanticEnrichmentModel,
      }
    : undefined,
});
const apiBase = "/api/studio";
const port = Number(Bun.env.STUDIO_PORT ?? 8787);
const hostname = Bun.env.STUDIO_HOST ?? "127.0.0.1";
const runtime = Bun.env.STUDIO_RUNTIME === "container" ? "container-playwright" : "local-playwright";

const jsonHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

async function body(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length > 100_000) throw new StudioServiceError("Request body is too large", 413, "BODY_TOO_LARGE");
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
    return value as Record<string, unknown>;
  } catch {
    throw new StudioServiceError("Request body must be a JSON object", 400, "INVALID_JSON");
  }
}

async function route(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(apiBase)) return json({ error: "Not found", code: "NOT_FOUND" }, 404);
  const segments = url.pathname.slice(apiBase.length).split("/").filter(Boolean).map(decodeURIComponent);

  if (request.method === "GET" && segments.length === 1 && segments[0] === "health") {
    return json({
      ok: true,
      runtime,
      viewport: { width: 1280, height: 720 },
      semanticEnrichment: {
        enabled: Boolean(openAIApiKey),
        model: semanticEnrichmentModel,
      },
      ...await service.readiness(),
    });
  }

  if (request.method === "POST" && segments.length === 1 && segments[0] === "sessions") {
    const input = await body(request);
    return json(await service.createSession(input.url, input.semanticEnrichment), 201);
  }

  if (request.method === "GET" && segments.length === 1 && segments[0] === "questionnaires") {
    return json(service.questionnaireCatalog());
  }

  if (segments[0] === "flows") {
    if (segments.length === 1 && request.method === "GET") {
      return json({ flows: service.listSavedFlows() });
    }
    if (segments.length === 2 && request.method === "GET") {
      return json(service.getSavedFlow(segments[1]));
    }
    if (segments.length === 2 && request.method === "DELETE") {
      service.deleteSavedFlow(segments[1]);
      return json({ ok: true });
    }
    if (
      segments.length === 5
      && segments[2] === "actions"
      && segments[4] === "screenshot"
      && request.method === "GET"
    ) {
      const phase = url.searchParams.get("phase") ?? "after";
      if (phase !== "before" && phase !== "after") {
        throw new StudioServiceError(
          "Screenshot phase must be before or after",
          400,
          "INVALID_SCREENSHOT_PHASE",
        );
      }
      const source = service.savedFlowScreenshot(segments[1], segments[3], phase);
      const image = new Uint8Array(source.byteLength);
      image.set(source);
      return new Response(image.buffer, {
        headers: {
          "cache-control": "private, no-store",
          "content-type": "image/jpeg",
          "x-content-type-options": "nosniff",
        },
      });
    }
    return json({ error: "Not found", code: "NOT_FOUND" }, 404);
  }

  if (segments[0] !== "sessions" || !segments[1]) {
    return json({ error: "Not found", code: "NOT_FOUND" }, 404);
  }
  const sessionId = segments[1];

  if (segments.length === 2 && request.method === "GET") return json(await service.getSession(sessionId));
  if (segments.length === 2 && request.method === "DELETE") {
    await service.deleteSession(sessionId);
    return json({ ok: true });
  }

  if (segments.length === 3 && segments[2] === "frame" && request.method === "GET") {
    const frame = await service.currentFrame(sessionId);
    const image = new Uint8Array(frame.image.byteLength);
    image.set(frame.image);
    return new Response(image.buffer, {
      headers: {
        "cache-control": "no-store",
        "content-type": "image/jpeg",
        "x-content-type-options": "nosniff",
        "X-Flakey-Frame-Revision": String(frame.frameRevision),
      },
    });
  }

  if (segments.length === 3 && segments[2] === "input" && request.method === "POST") {
    return json(await service.input(sessionId, await body(request) as never));
  }

  if (segments.length === 3 && segments[2] === "recording" && request.method === "POST") {
    const input = await body(request);
    return json(await service.setRecording(sessionId, input.recording));
  }

  if (segments.length === 3 && segments[2] === "save" && request.method === "POST") {
    return json(await service.saveFlow(sessionId, await body(request)), 201);
  }

  if (segments.length === 3 && segments[2] === "assertions" && request.method === "POST") {
    return json(await service.addAssertion(sessionId, await body(request) as never), 201);
  }

  if (segments.length === 3 && segments[2] === "evidence" && request.method === "GET") {
    return json(service.evidence(sessionId));
  }

  if (segments.length === 3 && segments[2] === "visual-dataset" && request.method === "GET") {
    return json(service.visualDataset(sessionId));
  }

  if (segments.length === 3 && segments[2] === "replay" && request.method === "POST") {
    return json(await service.replay(sessionId));
  }

  if (segments.length === 3 && segments[2] === "code" && request.method === "GET") {
    return json({ code: service.generateCode(sessionId) });
  }

  if (segments.length === 4 && segments[2] === "questionnaire" && segments[3] === "plan" && request.method === "POST") {
    const input = await body(request);
    return json(await service.planQuestionnaire(sessionId, input.command), 201);
  }

  if (segments.length === 4 && segments[2] === "questionnaire" && segments[3] === "execute" && request.method === "POST") {
    return json(await service.executeQuestionnaire(sessionId, await body(request) as never));
  }

  if (segments.length === 4 && segments[2] === "actions" && request.method === "DELETE") {
    return json({ session: await service.deleteAction(sessionId, segments[3]) });
  }

  if (segments.length === 5 && segments[2] === "actions" && segments[4] === "screenshot" && request.method === "GET") {
    const phase = url.searchParams.get("phase") ?? "after";
    if (phase !== "before" && phase !== "after") {
      throw new StudioServiceError("Screenshot phase must be before or after", 400, "INVALID_SCREENSHOT_PHASE");
    }
    const source = service.actionScreenshot(sessionId, segments[3], phase);
    const image = new Uint8Array(source.byteLength);
    image.set(source);
    return new Response(image.buffer, {
      headers: {
        "cache-control": "private, no-store",
        "content-type": "image/jpeg",
        "x-content-type-options": "nosniff",
      },
    });
  }

  return json({ error: "Not found", code: "NOT_FOUND" }, 404);
}

const server = Bun.serve({
  hostname,
  port,
  fetch(request) {
    return route(request).catch((error: unknown) => {
      if (error instanceof StudioServiceError) return json({ error: error.message, code: error.code }, error.status);
      console.error("Studio service failed with an unexpected internal error type", error instanceof Error ? error.name : typeof error);
      return json({ error: "Studio service failed", code: "INTERNAL_ERROR" }, 500);
    });
  },
});

console.log(`Flakey Studio API listening on ${server.url}`);

let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  server.stop(true);
  await service.close();
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown().finally(() => process.exit(0));
  });
}

process.on("beforeExit", () => {
  void shutdown();
});
