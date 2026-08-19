# Flakey MVP

Flakey is a unified QA command center for automated and manual testing. This working MVP connects two loops that normally live in separate tools: **can we ship, and can we turn what a tester just did into trustworthy automation?**

## What works

- Three-step onboarding with an instant demo workspace or copyable Playwright setup path
- Test Studio: paste a URL, launch real Playwright Chromium, interact with the live screenshot frame, and record a readable action timeline
- Asynchronous OpenAI semantic enrichment for eligible recorded actions, with intent, journey stage, suggested outcome, visual fallback, and action risk kept separate from executable Playwright steps
- Best-practice locator candidates with uniqueness checks, explicit assertions, clean-context replay, and generated `@playwright/test` TypeScript
- In-app Saved flows library with durable recordings, semantic evidence, screenshots, and generated code that remains available to view or copy
- One-click conversion of a recorded browser flow into an editable manual test case
- Explainable release-readiness verdict with linked blockers and live CI progress
- Searchable, sortable automated test library with status and five-run history
- One-click evidence drawer with steps, screenshot, console, trace, locator suggestion, rerun, assignment, and Jira bug draft flows
- Guided manual test runner with autosaved step results, notes, attachments, session timer, and completion state
- Requirement → manual case → automated test → latest evidence traceability matrix
- Global `Cmd/Ctrl + K` command palette, responsive navigation, dark/light themes, keyboard flows, and local persistence

The dashboard intentionally uses coherent demo data and browser `localStorage`. Test Studio itself is real: a local Bun service owns an isolated Playwright `BrowserContext`, returns browser frames and evidence to the UI, and persists saved flows in a local SQLite database.

## Run locally

```bash
bun run setup
bun run dev
```

`bun run setup` installs both JavaScript dependencies and the matching Playwright Chromium build. It is only required the first time or after a Playwright upgrade.

Open `http://localhost:5173`. Choose **Test Studio**, then use **Demo shop** for a safe recorder check or paste an absolute `http://` / `https://` URL you control.

After recording, choose **Save flow** in Test Studio and give the flow a name. The recording then appears in the in-app **Saved flows** library with its actions, locator candidates, semantic enrichment, evidence, screenshots, and generated Playwright code. Code is viewed and copied inside Flakey; saving a flow does not download a file. Local development stores this library at `.flakey/studio.sqlite`.

Recorder clicks and non-sensitive fills also produce synchronized before/after screenshots, a semantic locator, and the target bounding box. Those cases feed the offline shadow evaluator so screenshot understanding is measured separately from DOM replay. See [the visual-understanding evaluation protocol](docs/visual-understanding-evaluation.md).

When the server has an `OPENAI_API_KEY`, a tester can opt in per Studio session to enrich eligible captures with the model selected by `OPENAI_ENRICHMENT_MODEL` (default `gpt-5.6`). Requests are server-side, use `store: false`, send target-focused crops with editable controls masked, never include fill values as text metadata, and do not replace locators or create assertions automatically. Sensitive fills are excluded. Nearby visible page content can still appear in a target crop, so only record approved test data. Never expose the key through a `VITE_` environment variable.

Saved flows can contain sensitive information visible in screenshots even when typed values are redacted. Use approved synthetic test data, delete recordings that should no longer be retained, and protect or remove the SQLite database when sharing or disposing of a workspace. The MVP does not yet apply an automatic retention period.

Production check:

```bash
bun run build
```

## Choose a runtime

For local hot reload:

```bash
bun run dev
```

Open `http://127.0.0.1:5173`. Only run one local dev stack at a time; Vite now uses strict port `5173` and the Studio API uses `8787`, so a duplicate start fails immediately instead of silently moving the UI to another port.

## Runtime boundary

This MVP supports a local runner and a trusted shared container runner. A fresh Playwright `BrowserContext` isolates each session; Compose adds process and filesystem controls but is not a hostile multi-tenant security boundary. It does not control an already signed-in personal browser tab, continuously stream video, upload secrets, or run arbitrary repository code. Those require the later browser-extension or provider-isolated sandbox phases described in [the canonical Test Studio specification](docs/test-studio-spec.md).

## Run the containerized Studio

Docker packages the UI gateway and browser runner as separate non-root services:

```bash
bun run docker:up:bg
```

Open `http://127.0.0.1:8080`. The Studio API remains internal to the Compose network. See [the container and sandbox architecture](docs/container-sandbox-architecture.md) for security controls, target routing, and the path to one ephemeral sandbox per session.

Containerized Saved flows persist in the Docker named volume `studio-data`, mounted at `/var/lib/flakey`. Stopping the stack keeps the library; deleting that volume removes its stored recordings and screenshots.

To replay the three onboarding screens without deleting the remembered workspace, open `http://127.0.0.1:8080/?onboarding=1`. Finishing the preview removes the query parameter and opens the command center normally.

To inspect or enter the running Docker environment:

```bash
bun run docker:ps
bun run docker:logs
bun run docker:shell:web
bun run docker:shell:runner
```

The shell commands enter as the same non-root users used by the app (`bun` in the gateway and `pwuser` in the runner). The container root filesystems are intentionally read-only. Type `exit` to leave a shell, and use `bun run docker:down` to stop the environment.

## Recommended next slice

1. Replace the demo questionnaire bank with versioned, approved company definitions and synthetic response profiles, including conditional and multi-page sections.
2. Add OpenAI Realtime voice as a short-lived command-input adapter; the model may select known IDs but never improvise questionnaire answers or direct browser clicks.
3. Add authenticated, team-scoped Saved flows with configurable retention policies and audit controls.
4. Add **Reproduce in sandbox** to a failed/flaky run and provision one short-lived, resource-bounded workload per reproduction.
5. Add timeline editing, richer assertions, trace capture, authentication setup fixtures, and governed Jira/Zephyr traceability.

Smart sharding, provider-isolated cloud sandboxes, a browser extension, bidirectional Zephyr sync, and autonomous AI actions stay outside this MVP until the core record/replay loop is validated with users.
