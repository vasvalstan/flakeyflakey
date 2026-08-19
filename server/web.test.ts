import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWebHandler, resolveStaticPath } from "./web";

describe("web gateway", () => {
  let root = "";

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "flakey-web-"));
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "index.html"), "<!doctype html><title>Flakey</title>");
    await writeFile(join(root, "assets", "app-AbCd1234.js"), "console.log('ok')");
  });

  afterAll(async () => {
    await rm(root, { force: true, recursive: true });
  });

  test("serves health, immutable assets, and the SPA fallback", async () => {
    const handle = createWebHandler({ root });

    const health = await handle(new Request("http://web.test/healthz"));
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, service: "flakey-web" });
    expect(health.headers.get("cache-control")).toBe("no-store");

    const asset = await handle(new Request("http://web.test/assets/app-AbCd1234.js"));
    expect(asset.status).toBe(200);
    expect(await asset.text()).toBe("console.log('ok')");
    expect(asset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(asset.headers.get("x-content-type-options")).toBe("nosniff");

    const navigation = await handle(
      new Request("http://web.test/test-runs/123", { headers: { accept: "text/html" } }),
    );
    expect(navigation.status).toBe(200);
    expect(await navigation.text()).toContain("<title>Flakey</title>");
    expect(navigation.headers.get("cache-control")).toBe("no-cache, must-revalidate");

    const missingAsset = await handle(new Request("http://web.test/assets/missing.js"));
    expect(missingAsset.status).toBe(404);
  });

  test("rejects encoded traversal and invalid URL escapes", async () => {
    expect(resolveStaticPath(root, "/..%2Foutside.txt")).toBeNull();
    expect(resolveStaticPath(root, "/%E0%A4%A")).toBeNull();

    const handle = createWebHandler({ root });
    const response = await handle(new Request("http://web.test/..%2Foutside.txt"));
    expect(response.status).toBe(400);
  });

  test("streams runner frames and preserves the frame revision header", async () => {
    const frame = new Uint8Array([0xff, 0xd8, 0x01, 0x02, 0xff, 0xd9]);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input) => {
      const url = new URL(input instanceof Request ? input.url : input);
      expect(url.pathname).toBe("/api/studio/sessions/session-1/frame");
      expect(url.searchParams.get("revision")).toBe("7");
      return new Response(frame, {
        headers: {
          "content-type": "image/jpeg",
          "x-flakey-frame-revision": "7",
        },
      });
    }) as typeof fetch;

    try {
      const handle = createWebHandler({ root, runnerUrl: "http://studio-runner:8787" });
      const response = await handle(
        new Request("http://web.test/api/studio/sessions/session-1/frame?revision=7"),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/jpeg");
      expect(response.headers.get("x-flakey-frame-revision")).toBe("7");
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(frame);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("returns stable JSON when the runner is unavailable", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() => Promise.reject(new TypeError("connection refused"))) as unknown as typeof fetch;

    try {
      const handle = createWebHandler({ root, runnerUrl: "http://studio-runner:8787" });
      const response = await handle(new Request("http://web.test/api/studio/health"));
      expect(response.status).toBe(503);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(await response.json()).toEqual({
        error: "Studio runner is unavailable",
        code: "RUNNER_UNAVAILABLE",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("rejects mismatched Host and Origin values when a public origin is configured", async () => {
    const handle = createWebHandler({
      root,
      publicOrigin: "http://127.0.0.1:8080",
      internalOrigin: "http://web:8080",
    });

    const wrongHost = await handle(new Request("http://attacker.test/"));
    expect(wrongHost.status).toBe(421);

    const wrongOrigin = await handle(new Request("http://127.0.0.1:8080/", {
      headers: { origin: "https://attacker.test" },
    }));
    expect(wrongOrigin.status).toBe(403);

    const allowed = await handle(new Request("http://127.0.0.1:8080/healthz", {
      headers: { origin: "http://127.0.0.1:8080" },
    }));
    expect(allowed.status).toBe(200);

    const internal = await handle(new Request("http://web:8080/index.html"));
    expect(internal.status).toBe(200);
  });

  test("accepts a configured public host behind TLS termination", async () => {
    const handle = createWebHandler({
      root,
      publicOrigin: "https://flakey.example.test",
      internalOrigin: "http://web:8080",
    });

    const response = await handle(new Request("http://flakey.example.test/index.html", {
      headers: { origin: "https://flakey.example.test" },
    }));
    expect(response.status).toBe(200);
  });
});
