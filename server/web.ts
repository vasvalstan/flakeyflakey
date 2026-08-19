import { realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const STUDIO_API_PATH = "/api/studio";
const DEFAULT_RUNNER_URL = "http://127.0.0.1:8787";
const DEFAULT_WEB_PORT = 8080;

const hopByHopHeaders = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const securityHeaders: Readonly<Record<string, string>> = {
  "content-security-policy": [
    "default-src 'self'",
    "base-uri 'self'",
    "connect-src 'self'",
    "font-src 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
  ].join("; "),
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), geolocation=(), microphone=()",
  "referrer-policy": "same-origin",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

export interface WebGatewayOptions {
  root: string;
  runnerUrl?: string;
  publicOrigin?: string;
  internalOrigin?: string;
}

function headersWithSecurity(initial?: HeadersInit): Headers {
  const headers = new Headers(initial);
  for (const [name, value] of Object.entries(securityHeaders)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return headers;
}

function json(data: unknown, status = 200, initial?: HeadersInit): Response {
  const headers = headersWithSecurity(initial);
  headers.set("cache-control", "no-store");
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { status, headers });
}

function text(message: string, status: number, method = "GET"): Response {
  const headers = headersWithSecurity({
    "cache-control": "no-store",
    "content-type": "text/plain; charset=utf-8",
  });
  return new Response(method === "HEAD" ? null : message, { status, headers });
}

function isContainedBy(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== ".." && !isAbsolute(child));
}

/** Resolve one URL pathname inside a static root, rejecting encoded traversal and separators. */
export function resolveStaticPath(root: string, pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const candidate = resolve(root, decoded.replace(/^\/+/, ""));
  return isContainedBy(root, candidate) ? candidate : null;
}

function normalizeRunnerUrl(value: string): URL {
  const url = new URL(value);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("STUDIO_RUNNER_URL must be an HTTP(S) URL without credentials");
  }
  return url;
}

function normalizeAllowedOrigin(value: string, name: "WEB_PUBLIC_ORIGIN" | "WEB_INTERNAL_ORIGIN"): URL {
  const url = new URL(value);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error(`${name} must be an HTTP(S) origin without credentials`);
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${name} must not contain a path, query, or fragment`);
  }
  return new URL(url.origin);
}

function isStudioApiPath(pathname: string): boolean {
  return pathname === STUDIO_API_PATH || pathname.startsWith(`${STUDIO_API_PATH}/`);
}

function proxyRequestHeaders(request: Request, publicUrl: URL): Headers {
  const headers = new Headers(request.headers);
  for (const name of hopByHopHeaders) headers.delete(name);
  headers.delete("host");
  headers.set("accept-encoding", "identity");
  headers.set("x-forwarded-host", publicUrl.host);
  headers.set("x-forwarded-proto", publicUrl.protocol.slice(0, -1));
  return headers;
}

function proxyResponseHeaders(upstream: Headers): Headers {
  const headers = new Headers(upstream);
  for (const name of hopByHopHeaders) headers.delete(name);
  headers.set("cache-control", "no-store");
  return headersWithSecurity(headers);
}

async function proxyToRunner(request: Request, runnerUrl: URL): Promise<Response> {
  const publicUrl = new URL(request.url);
  const target = new URL(`${publicUrl.pathname}${publicUrl.search}`, runnerUrl);

  try {
    const response = await fetch(target, {
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      headers: proxyRequestHeaders(request, publicUrl),
      method: request.method,
      redirect: "manual",
      signal: request.signal,
    });

    return new Response(request.method === "HEAD" ? null : response.body, {
      headers: proxyResponseHeaders(response.headers),
      status: response.status,
      statusText: response.statusText,
    });
  } catch {
    return json(
      { error: "Studio runner is unavailable", code: "RUNNER_UNAVAILABLE" },
      503,
      { "retry-after": "1" },
    );
  }
}

function cacheControlFor(pathname: string): string {
  if (extname(pathname).toLowerCase() === ".html") return "no-cache, must-revalidate";
  if (/^\/assets\/.+-[A-Za-z0-9_-]{6,}\.[^/]+$/.test(pathname)) {
    return "public, max-age=31536000, immutable";
  }
  return "public, max-age=3600";
}

async function existingFile(rootRealPath: string, candidate: string): Promise<string | null> {
  try {
    const actualPath = await realpath(candidate);
    if (!isContainedBy(rootRealPath, actualPath)) return null;
    const info = await stat(actualPath);
    return info.isFile() ? actualPath : null;
  } catch {
    return null;
  }
}

function serveFile(path: string, requestMethod: string, requestPathname: string): Response {
  const file = Bun.file(path);
  const headers = headersWithSecurity({
    "cache-control": cacheControlFor(requestPathname),
    "content-length": String(file.size),
    "content-type": file.type || "application/octet-stream",
  });
  return new Response(requestMethod === "HEAD" ? null : file, { headers });
}

/** Build a request handler without opening a port, so the gateway remains easy to test. */
export function createWebHandler(options: WebGatewayOptions): (request: Request) => Promise<Response> {
  const root = resolve(options.root);
  const rootRealPath = realpath(root).catch(() => root);
  const runnerUrl = normalizeRunnerUrl(options.runnerUrl ?? DEFAULT_RUNNER_URL);
  const allowedOrigins = new Set([
    options.publicOrigin ? normalizeAllowedOrigin(options.publicOrigin, "WEB_PUBLIC_ORIGIN").origin : undefined,
    options.internalOrigin ? normalizeAllowedOrigin(options.internalOrigin, "WEB_INTERNAL_ORIGIN").origin : undefined,
  ].filter((origin): origin is string => Boolean(origin)));
  const allowedHosts = new Set([...allowedOrigins].map((origin) => new URL(origin).host));

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const isHealthRequest = url.pathname === "/healthz";

    // A hosting edge may terminate TLS before forwarding plain HTTP to Bun. The
    // request authority must still match configuration; browser Origin headers
    // remain subject to the exact scheme-aware check below.
    if (!isHealthRequest && allowedHosts.size > 0 && !allowedHosts.has(url.host)) {
      return text("Misdirected request", 421, request.method);
    }
    const requestOrigin = request.headers.get("origin");
    if (!isHealthRequest && requestOrigin && allowedOrigins.size > 0 && !allowedOrigins.has(requestOrigin)) {
      return text("Forbidden", 403, request.method);
    }

    if (isHealthRequest) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return text("Method not allowed", 405, request.method);
      }
      const response = json({ ok: true, service: "flakey-web" });
      return request.method === "HEAD"
        ? new Response(null, { status: response.status, headers: response.headers })
        : response;
    }

    if (isStudioApiPath(url.pathname)) return proxyToRunner(request, runnerUrl);

    if (request.method !== "GET" && request.method !== "HEAD") {
      return text("Method not allowed", 405, request.method);
    }

    const candidate = resolveStaticPath(root, url.pathname);
    if (!candidate) return text("Bad request", 400, request.method);

    const realRoot = await rootRealPath;
    const filePath = await existingFile(realRoot, candidate);
    if (filePath) return serveFile(filePath, request.method, url.pathname);

    const acceptsHtml = request.headers.get("accept")?.includes("text/html") ?? false;
    if (acceptsHtml || extname(url.pathname) === "") {
      const indexPath = await existingFile(realRoot, resolve(root, "index.html"));
      if (indexPath) return serveFile(indexPath, request.method, "/index.html");
    }

    return text("Not found", 404, request.method);
  };
}

function configuredPort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_WEB_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("WEB_PORT must be an integer between 1 and 65535");
  }
  return port;
}

if (import.meta.main) {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  const root = resolve(Bun.env.WEB_ROOT ?? resolve(moduleDirectory, "../dist"));
  const hostname = Bun.env.WEB_HOST ?? "0.0.0.0";
  const port = configuredPort(Bun.env.WEB_PORT);
  const fetch = createWebHandler({
    root,
    runnerUrl: Bun.env.STUDIO_RUNNER_URL,
    publicOrigin: Bun.env.WEB_PUBLIC_ORIGIN,
    internalOrigin: Bun.env.WEB_INTERNAL_ORIGIN,
  });

  const server = Bun.serve({ fetch, hostname, port });
  console.log(`Flakey web gateway listening on ${server.url} (root: ${root})`);

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      server.stop(true);
      process.exit(0);
    });
  }
}
