# Flakey Studio Container and Sandbox Architecture

Status: Phase 1b implemented and verified  
Last updated: 2026-07-16

## Outcome

Phase 1b makes the existing Test Studio reproducible with Docker while preserving its complete browser → recording → assertion → fresh-context replay → automation/manual conversion loop.

It is the foundation for the larger product feature described in `currents-dev-feature-extraction.md`: an engineer can open a failed test in an interactive environment pinned to the failure instead of waiting for another CI run.

## Current topology

```text
User browser
    │ http://127.0.0.1:8080
    ▼
┌──────────────────────────────┐
│ web                          │
│ static Flakey UI             │
│ same-origin Studio API proxy │
└──────────────┬───────────────┘
               │ private Compose network
               ▼
┌──────────────────────────────┐
│ studio-runner                │
│ Bun Studio API               │
│ Playwright Chromium          │
│ sessions + replay contexts   │
└──────────────────────────────┘
```

Only `web:8080` is published, and it binds to host loopback by default. The runner's `8787` port is visible only to Compose services.

The demo URL remains `http://127.0.0.1:8080/demo-shop.html` in the UI, timeline, manual case, and generated Playwright code. Inside the runner it is translated to `http://web:8080/demo-shop.html`; this avoids the common container bug where loopback points back to the runner itself.

## Run it

```bash
bun run docker:up:bg
```

Open `http://127.0.0.1:8080`, then choose **Test Studio → Use demo shop**.

Useful commands:

```bash
bun run docker:logs
bun run docker:ps
bun run docker:shell:web
bun run docker:shell:runner
bun run docker:check
bun run docker:down
```

The two shell commands enter the running services as their normal non-root users. Use the web shell to inspect the compiled UI/gateway and the runner shell to inspect Playwright, Chromium, environment variables, or network resolution. Both root filesystems are read-only by design; type `exit` to leave.

To change the published port, keep the public origin aligned:

```bash
FLAKEY_PORT=9090 \
FLAKEY_PUBLIC_ORIGIN=http://127.0.0.1:9090 \
docker compose up --build
```

## Security and reliability controls

The runner uses the exact official Playwright image version corresponding to `@playwright/test` in `bun.lock`. It runs as `pwuser`, with the official Playwright seccomp profile, no added Linux capabilities, `no-new-privileges`, a read-only root filesystem, bounded temporary storage, a 1 GiB `/dev/shm`, and CPU/memory/PID limits.

The web service runs as the non-root `bun` user with the same read-only and capability restrictions. It exposes a small static-file surface and forwards only `/api/studio/**`.

Both services have health checks, an init process for child cleanup, graceful application shutdown, and no persistent container volume. Runner readiness launches Chromium before the service is marked healthy. Abandoned browser contexts close after 30 minutes without API activity or after a two-hour absolute lifetime. Studio secrets remain memory-only and disappear when the session or runner stops.

These controls reduce blast radius; they do not turn Compose into a hostile multi-tenant execution boundary. Phase 1b permits trusted customer development, preview, and staging targets. Production hosting needs Phase 1c workload isolation and network policy.

## Local and private targets

The bundled demo uses explicit public/internal origin translation. A separate application running on the Docker host can be reached from the runner through `host.docker.internal`, which Compose maps to the host gateway on Linux as well as Docker Desktop.

The product should later hide that implementation detail behind a target resolver. For private staging systems, the intended production design is a customer-side outbound tunnel with workspace/domain allowlists—not inbound firewall exceptions.

## Phase 1c promotion path

The shared runner becomes a control plane that provisions one ephemeral workload per session:

1. Resolve the source test, image digest, commit, environment, and browser version.
2. Issue a short-lived workload identity and encrypted setup secrets.
3. Create a resource-limited container or stronger microVM-backed sandbox.
4. Attach the screenshot/control stream to the Test Studio session.
5. Upload evidence through expiring object-storage credentials.
6. Terminate on close, idle timeout, absolute TTL, or policy violation.
7. Run an orphan reaper and retain the immutable session audit record.

The first product entry point is **Reproduce in sandbox** on a failed or flaky run. Full CI replacement, arbitrary repository execution, physical devices, and production browsing remain later decisions.

## Acceptance criteria

- `docker compose config --quiet` succeeds.
- Both services become healthy from a clean build.
- The runner has no published host port and reports `container-playwright` health.
- The browser session reports runtime `container` in the UI.
- The bundled demo launches while the UI and generated code retain the public URL.
- Recording, locator uniqueness, assertions, fresh-context replay, generated TypeScript, and manual conversion behave exactly as in local mode.
- A stale frame is still rejected without executing the coordinate action.
- `docker compose down` removes the services without leaving Chromium processes.

## Verification record — 2026-07-16

- A clean multi-architecture build completed with Bun `1.3.12` and Playwright `1.61.1` on the matching official Chromium image.
- Both services became healthy; runner readiness launched Chromium `149.0.7827.0` before the web service started.
- The runner had no published port. Live inspection confirmed non-root users, read-only roots, all capabilities dropped, `no-new-privileges`, the Chromium seccomp profile, and configured memory/PID limits.
- The public demo recorded two unique role-based locators, two URL assertions (including the public origin), and a visible-text assertion.
- Fresh-context replay passed all six semantic steps and returned only the public `127.0.0.1` URL; generated TypeScript contained no Compose hostname.
- A stale coordinate input returned `409 STALE_FRAME` and did not mutate the six-step timeline.
- The container UI showed a live frame with zero initial console and network errors.
- `bun test` passed 8 tests / 42 assertions, the production TypeScript/Vite build passed, and `docker compose config --quiet` passed.
