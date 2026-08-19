# Flakey Test Studio — Canonical Product and Technical Specification

Status: implementation specification + shipped-slice ledger  
Current target: local MVP  
Last updated: 2026-07-18

This document narrows and clarifies the broader browser-companion and sandbox ideas in `currents-dev-feature-extraction.md`. When the two documents differ for Test Studio, this document is authoritative.

Normative terms use **MUST**, **SHOULD**, and **MAY** in their usual product-specification sense.

## 1. Product promise

**Paste a URL, perform a real user flow, and turn it into trustworthy QA evidence and reusable tests without leaving Flakey.**

Test Studio joins manual and automated QA in one short loop:

1. Launch a real browser at a target URL.
2. Interact with the page through a live screenshot frame.
3. Record meaningful actions and evidence.
4. Add explicit assertions.
5. Edit the resulting human-readable timeline.
6. replay the semantic steps in a fresh browser context.
7. Export runnable Playwright code, a manual test case, or a bug draft with traceability.

The experience should feel approachable to a manual tester and remain technically credible to an automation engineer. Flakey must show what it recorded, which locator it selected, whether that locator is unique, and exactly what a replay proved.

## 2. Current implementation decision

The current implementation target is a **real local Playwright browser process controlled by Flakey, with screenshot-frame interaction in the Test Studio UI**.

It is explicitly **not**:

- a provider-isolated cloud sandbox;
- a browser extension controlling the tester's existing tab;
- a WebRTC video stream;
- deterministic video playback;
- deterministic replay of raw mouse and keyboard events;
- an AI agent operating through Playwright MCP.

In the local MVP, “replay” means that Flakey takes the edited semantic timeline and executes its Playwright actions and assertions in a **new `BrowserContext`**. It does not mean replaying a video or blindly reproducing recorded coordinates.

The local browser runner provides browser-context isolation only. It does not provide an OS, container, kernel, network, or tenant security boundary and MUST NOT be described as a production-grade sandbox.

### 2.1 Phase 1a — first working vertical slice

The first working slice proves the complete product loop with deliberately narrow controls:

- launch an explicit absolute URL in local Playwright Chromium;
- interact through a polled screenshot frame with click, text, key, scroll, and explicit navigation input;
- start and stop recording of semantic navigation, click, fill, key, scroll, and assertion steps;
- inspect ranked locator candidates, uniqueness, match count, and the selected locator;
- attach action screenshots plus sanitized console, page-error, and failed-request evidence;
- add URL-contains, text-visible, and last-element-visible assertions;
- delete timeline steps;
- replay the semantic timeline in a new `BrowserContext` without copied storage state;
- copy or download generated `@playwright/test` TypeScript;
- convert the same timeline into a native editable manual-case draft.

The following local-MVP requirements are specified below but remain subsequent increments: double-click and specialized check/select controls; browser back/forward/reload/dialog controls; immutable raw-event storage and timeline revisions; label/value/locator editing, reordering, disabling, grouping, waits, and undo; the full assertion matrix; trace files and explicit screenshots; replay streaming; bug-draft output; authentication setup fixtures; and durable server-side session/artifact storage.

The browser extension, provider-isolated cloud sandbox, repository/PR writes, Jira/Zephyr writes, and Playwright MCP agent flow are later phases and are not part of the local MVP.

### 2.2 Phase 1b — containerized Studio foundation

The next implementation slice packages Studio as two services:

1. A public **web gateway** serves the built Flakey UI and forwards only `/api/studio/**` to the runner.
2. An internal **Playwright runner** owns Chromium, browser contexts, session memory, screenshots, replay, and code generation. Its port is not published to the host.

The Compose deployment MUST:

- pin Bun and the official Playwright image to exact versions matching the application lockfile;
- run both processes as non-root users;
- run the browser with Playwright's Chromium seccomp profile, all Linux capabilities dropped, and `no-new-privileges` enabled;
- use an init process, bounded CPU, memory, process count, temporary writable storage, and dedicated shared memory;
- keep container root filesystems read-only;
- expose only the web gateway on loopback by default;
- include health checks and dependency-aware startup;
- translate the public Flakey origin to the internal web service origin so the bundled demo and generated code retain user-facing URLs;
- preserve the same stale-frame, secret-redaction, evidence, replay, and code-generation behavior as the local runtime.

Phase 1b improves portability, repeatability, and process isolation. It still runs up to five browser contexts inside one trusted runner container and therefore MUST NOT be marketed as a multi-tenant production sandbox. The supported target policy remains customer-controlled development, preview, and staging applications.

The detailed topology, controls, runbook, and promotion criteria are in `container-sandbox-architecture.md`.

### 2.3 Recorder-first, domain-neutral boundary

Test Studio intentionally starts with the real target URL and does not expose questionnaire-specific assistants, PHQ presets, synthetic severity profiles, or a domain-specific learning bank in the product UI.

- the tester launches an allowed portal URL and records the real journey;
- clicks, fills, navigation, keyboard actions, and assertions enter one inspectable semantic timeline;
- locator ranking, screenshots, browser evidence, replay, and generated Playwright remain domain-neutral;
- future agent and voice layers must consume these recorded journeys through reviewed, bounded tools rather than introduce a hard-coded questionnaire workflow;
- company-specific variants and reusable flow knowledge will be designed from actual recordings before a product-facing learning bank is introduced.

Synthetic questionnaire pages may remain as internal recorder and visual-evaluation fixtures, but they are not a supported product workflow and MUST NOT appear as a Test Studio section or launcher.

Visual understanding is measured independently from deterministic DOM replay. Eligible recorded actions retain a masked before image, target geometry/semantics, and after image; model proposals run in non-executing shadow mode until they satisfy the protocol in [`visual-understanding-evaluation.md`](visual-understanding-evaluation.md).

### 2.4 Phase 1c — ephemeral reproduction sandboxes

The next user-facing sandbox milestone replaces the shared runner with one short-lived workload per Studio or reproduction session. An orchestrator creates the workload from a pinned image digest and records the source commit, environment, browser build, resource policy, and timeline revision.

Each workload MUST have:

- a unique workload identity and signed, expiring control channel;
- strict TTL, idle timeout, CPU, memory, process, and storage quotas;
- explicit egress policy and an auditable allowlist for customer staging domains;
- encrypted, opt-in secret injection with values excluded from artifacts and generated code;
- separate recording and replay contexts;
- durable evidence uploaded to object storage through short-lived credentials;
- heartbeat, cancellation, cleanup, and orphan-reaper behavior;
- an immutable audit trail of who launched, controlled, replayed, exported, and terminated it.

The first Phase 1c product flow is **Reproduce in sandbox** from a failed or flaky test, pinned to its original image/commit/environment. It is not a general CI replacement or cross-device cloud. Strong isolation for less-trusted code or arbitrary public targets SHOULD use a provider boundary such as a microVM, gVisor, or equivalent rather than treating an ordinary Docker container as a tenant security boundary.

## 3. Personas and jobs

### 3.1 Manual QA tester

- Launch a staging or local build without opening an IDE.
- Record a clear set of reproduction or verification steps.
- Add expected results as assertions.
- Save screenshots, console failures, and failed-request evidence.
- Convert the session to a reusable manual case or a complete bug draft.

### 3.2 Automation engineer / SDET

- Inspect the locator selected for every interaction.
- Replace an ambiguous locator before generation.
- replay the flow in a clean context and diagnose the failing step.
- Export maintainable `@playwright/test` TypeScript.
- Link the automated test to its manual case, requirement, and issue.

### 3.3 QA lead

- Establish that a manual flow has reproducible evidence.
- See whether the generated automation passes in a fresh context.
- Preserve the chain from requirement to manual evidence to automated evidence to defect.
- Review rather than trust opaque generated output.

### 3.4 Developer / issue owner

- Receive a bug with URL, environment, steps, expected/actual behavior, and evidence already attached or linked.
- Open the exact failed replay step and generated test without reconstructing context from chat or CI logs.

## 4. End-to-end user flow

### 4.1 Paste-URL launch

1. The user opens Test Studio and pastes an absolute `http://` or `https://` URL.
2. Flakey normalizes the URL, validates its scheme and host policy, and shows the resolved target before launch.
3. The user selects **Launch browser**.
4. The local runner starts Playwright Chromium and creates a fresh browser context with the configured viewport.
5. The session moves through `launching` → `ready`, or to `failed` with a specific recovery action.
6. The first screenshot frame appears with the current page URL and title.
7. Redirects update the displayed address. Each redirect MUST be checked against the same URL policy as the original URL.

Local MVP defaults:

- Browser: Playwright Chromium.
- Viewport: `1280 × 720` CSS pixels.
- Context: incognito-style fresh `BrowserContext`.
- Transport: local HTTP plus WebSocket or bounded screenshot polling.
- Target: explicit user-entered URL; no search-engine interpretation.
- Allowed schemes: `http` and `https` only.

The target page MUST NOT be embedded as an iframe. The screenshot-frame approach avoids target `X-Frame-Options`/CSP restrictions and makes coordinate handling and evidence capture explicit.

### 4.2 Live browser interaction

The UI displays the most recent browser screenshot with its viewport dimensions and monotonically increasing `frameRevision`.

The local MVP MUST support:

- click and double-click;
- text entry into the focused editable element;
- keyboard presses, including Enter, Tab, Escape, and modifier combinations supported by Playwright;
- check/uncheck and select-option behavior where the target element is identifiable;
- vertical and horizontal scroll;
- back, forward, reload, and explicit navigation;
- opening and closing browser dialogs through a deliberate UI response;
- page loading, error, and disconnected-runner states.

Click coordinates MUST be sent with the screenshot's `frameRevision` and viewport dimensions. The runner maps displayed coordinates back to browser CSS pixels. If the frame is stale or its dimensions no longer match, the runner MUST reject the action and request a fresh frame rather than click an uncertain location.

After a meaningful interaction or page state change, Flakey requests a new screenshot. Frame updates MUST not change the containing layout size.

The screenshot is an interaction surface, not a live video claim. Pointer movement alone does not need to produce frames. Continuous animation may appear as sampled states.

### 4.3 Recording actions and evidence

Recording is an explicit session state. A user launches the browser first, then chooses **Start recording**. Stopping recording does not close the browser.

Flakey stores two related streams:

1. An append-only raw capture log for audit and debugging.
2. An editable semantic timeline used for replay and code generation.

The semantic recorder MUST recognize, where applicable:

- `navigate`;
- `click` and `doubleClick`;
- `fill` rather than one event per keystroke;
- `press`;
- `check` / `uncheck`;
- `selectOption`;
- `upload` as a metadata-only step in the MVP;
- explicit `waitForURL` or `waitForVisible` steps added by the user;
- assertions;
- human-authored notes or step-group labels.

Mouse movement is never a semantic step. Scroll is retained in the raw log and evidence state but SHOULD be omitted from generated automation because Playwright locators scroll into view automatically. It may become a semantic step only when the user explicitly marks scrolling as behavior under test.

Each semantic action stores:

- stable step ID and sequence;
- capture timestamp;
- action kind and safe action parameters;
- URL and page title before the action;
- source `frameRevision`;
- DOM/accessibility information for the target;
- ranked locator candidates and selected locator;
- uniqueness and stability results;
- before/after evidence references where captured;
- raw-event references;
- editable human label;
- enabled/disabled state.

Evidence captured by the local MVP SHOULD include:

- screenshots before failures and after important actions;
- an explicit user-triggered screenshot;
- browser console warnings and errors;
- uncaught page errors;
- failed request metadata: sanitized URL, method, status/failure reason, and duration;
- Playwright trace output for a stopped recording or replay when tracing is enabled;
- browser name, viewport, target URL, local session ID, and timestamps.

The MVP does not record continuous video. It does not store response bodies, request bodies, cookies, authorization headers, or full HAR files.

### 4.4 Locator generation, ranking, and uniqueness

For every element-targeted action or assertion, the runner inspects the live DOM and accessibility information at interaction time. It creates candidates in this preferred order:

1. `getByRole(role, { name })` with an accessible name.
2. `getByLabel(label)` for associated form controls.
3. `getByTestId(value)` using the project's configured test-ID attribute.
4. A stable `getByAltText`, `getByPlaceholder`, or exact `getByText` locator where semantically appropriate.
5. A stable attribute locator.
6. A structural CSS locator as a clearly marked fallback.

Within a tier, candidates are ranked by:

- exact uniqueness in the current document or relevant frame;
- semantic meaning;
- absence of generated IDs, hashes, GUID-like fragments, or dynamic class names;
- resistance to nearby copy/layout changes;
- brevity and readability;
- successful re-evaluation after the action and on the next stable frame.

For each candidate, Flakey MUST evaluate `locator.count()` in the relevant page or frame:

- `1` match: unique;
- `0` matches: invalid/stale;
- more than `1`: ambiguous.

The selected candidate MUST be shown in the timeline with a stability label and match count. Flakey MUST NOT silently add `.nth()` merely to make an ambiguous locator pass. A positional fallback requires an explicit warning and user acceptance.

Users MAY replace the selected locator with another generated candidate or an edited locator. Edited locators MUST be validated against the current page before replay.

Iframe and shadow-root targets MUST carry enough scope information for replay. If the MVP cannot produce a reliable scoped locator, it marks the step **Needs review** rather than inventing a fragile selector.

### 4.5 Assertion authoring

Assertions are deliberate test intent, not automatically inferred from every visual change.

The user enters **Add assertion** mode, selects a target in the screenshot, chooses an assertion, reviews the observed value, and edits the expected value before saving.

Element assertion types for the local MVP:

- visible / hidden;
- contains text / exact text;
- has value;
- checked / unchecked;
- enabled / disabled;
- has count.

Page assertion types for the local MVP:

- URL equals or matches a user-edited pattern;
- title contains or equals text.

An assertion timeline step stores:

- assertion kind;
- target locator when element-based;
- expected value;
- observed value at authoring time;
- timeout;
- enabled state;
- evidence reference;
- user-authored expected-result wording for manual-case conversion.

Default expected values MAY come from the live page but MUST remain visibly editable. Secret-looking observed values MUST be redacted and MUST NOT become assertion literals.

Visual pixel comparisons, accessibility-tree audits, API assertions, soft assertions, and custom JavaScript predicates are outside the local MVP.

### 4.6 Editable timeline

The semantic timeline is the source of truth for replay, code generation, and manual-case conversion.

The user MUST be able to:

- edit the human-readable label;
- edit safe input and expected values;
- choose a different validated locator candidate;
- add an assertion, explicit wait, note, or step-group label;
- disable or delete a step;
- reorder steps;
- undo the most recent destructive timeline edit;
- see which steps need review;
- see associated screenshots and errors without leaving the timeline.

Reordering can invalidate later state. Flakey MUST mark the session as requiring a new replay after any behavior-changing edit. It SHOULD warn when a navigation or prerequisite action is moved after a dependent assertion.

Raw capture records remain immutable. Edits create a new timeline revision so a replay and generated artifact can cite the exact revision they used.

### 4.7 Fresh-context automation replay

When the user selects **Run automation**, Flakey:

1. Freezes the current timeline revision.
2. Creates a new Playwright `BrowserContext` with the same browser and viewport.
3. Does not silently copy cookies, local storage, session storage, or in-memory state from the recording context.
4. Navigates to the session's initial URL.
5. Executes enabled semantic actions and assertions in order using the selected locators.
6. Streams step status and updated screenshot frames to the UI.
7. Stops on the first failed required step in the MVP.
8. Captures failure screenshot, console/page errors, failed-request metadata, and trace when enabled.
9. Preserves the original recording evidence separately from replay evidence.

An explicit authentication setup may be added later. If local auth state is supported, it MUST be opt-in, visibly identified, locally stored, and referenced as setup—not silently cloned from the recording context. Generated code must reference environment variables or a setup fixture rather than embed credentials.

Replay executes semantic Playwright actions, not raw coordinates. A replay result is evidence that the edited flow worked or failed in that new context at that time; it is not proof of deterministic behavior across all environments.

### 4.8 Generated Playwright code

Flakey generates TypeScript for `@playwright/test` from the same frozen timeline revision used by replay.

Generated code MUST:

- import `test` and `expect` from `@playwright/test`;
- create one clearly named test for the captured flow;
- use the selected locator for each action/assertion;
- use Playwright's semantic operations (`click`, `fill`, `check`, `selectOption`, `press`);
- use web-first `expect` assertions;
- retain user-defined step groups as `test.step` blocks where useful;
- include the starting URL without embedding secrets;
- replace sensitive values with named environment variables or explicit TODO placeholders;
- mark ambiguous/unsupported steps with a visible `TODO` comment;
- be formatted and syntactically valid TypeScript;
- cite the source session and timeline revision in a short generated comment.

The local MVP supports copy-to-clipboard and `.spec.ts` download. It does not choose an existing page-object file, modify a repository, create a branch, open a pull request, or auto-merge generated code.

### 4.9 Convert to a manual test case

The user can convert the edited timeline into a native Flakey manual-case draft.

Conversion rules:

- test name → case title;
- launch URL, environment, test data, and login needs → preconditions;
- action steps → manual actions written in plain language;
- assertions → expected results;
- notes and step groups → section context;
- source URL and browser → environment metadata;
- captured evidence → linked session evidence, not copied into every step;
- source session and timeline revision → traceability links.

The draft remains editable before save. Steps without assertions receive an empty expected-result field marked for review; Flakey MUST NOT fabricate expected behavior.

The local MVP saves or exports a native Flakey draft. Direct Zephyr creation is a later connector feature.

### 4.10 Bug and traceability outputs

The user can generate a bug draft from either the recording or a failed fresh-context replay.

The bug draft includes:

- concise editable summary;
- actual behavior and failed assertion/error;
- expected behavior from the assertion or user input;
- numbered reproduction steps from the active timeline revision;
- first and last relevant URL;
- environment, browser, viewport, timestamps, and replay ID;
- selected screenshots;
- sanitized console/page errors and failed-request summary;
- trace artifact when available;
- generated Playwright spec reference;
- linked requirement/story, manual case, and automated-test identifiers when known.

The canonical traceability chain is:

`requirement/story → manual case → Studio session + timeline revision → generated automated test → replay result → bug`

The local MVP can copy a Markdown bug report and export structured JSON. It may save the bug as a native Flakey triage item. It does not promise a live Jira write or Zephyr execution update.

Cloud production may use Atlassian Rovo MCP/API for Jira and SmartBear MCP/API for Zephyr, subject to verified read/write scope. Jira bugs should attach small safe artifacts and link to signed Flakey evidence for larger traces/videos. Zephyr should remain the external manual-case/cycle system of record when connected.

## 5. Browser mechanisms: clear boundaries

| Mechanism | Intended user/job | Browser and UI | Authentication state | Current status |
|---|---|---|---|---|
| Local Playwright browser runner | Human recording, replay, and code generation during MVP development | Real local Chromium process; screenshot frames and controls in Flakey | Fresh context; direct local network access; no silent session cloning | **Implemented — Phase 1a** |
| Containerized Compose Studio | Reproducible trusted development/staging Studio | Same screenshot/control UI; Chromium runs in an internal non-root runner container behind the web gateway | Fresh context; explicit public/internal URL mapping; no silent session cloning | **Implemented and verified — Phase 1b foundation** |
| Manifest V3 extension | Everyday manual tester using an existing authenticated browser | Tester interacts with the real Chrome/Edge tab; extension records and inspects | Existing cookies, SSO, and browser state | Future; not part of local MVP |
| Hosted provider sandbox | One-click reproduction and later cloud Test Studio | Browser runs in an isolated provider container/microVM and is streamed to Flakey | Must re-establish auth or use approved setup; internal targets need a tunnel | Future production mode; not the current runner |
| Playwright MCP / test agents | Agent exploration, locator extraction, test drafting, and healing suggestions | Agent drives browser through accessibility snapshots; no human screenshot viewer requirement | Agent/browser-session specific | Future agent interface; not the human live-browser mechanism |

### 5.1 Extension boundary

The extension is the eventual human companion when using the tester's own logged-in tab matters more than a controlled fresh environment. It will require configured-domain permissions, persistent recording state, redaction, and optional CDP access for console/network capture. It is not required to prove the Test Studio workflow locally.

### 5.2 Local runner boundary

The local runner launches Playwright on the same machine as the application service. It can naturally reach `localhost`, VPN-only staging sites, and the user's normal network path. A malicious target page still runs browser code on that machine, so the runner must use a dedicated context, restrict downloads, and clean up promptly.

“Local sandbox” is acceptable shorthand in UI copy only if accompanied by “local browser context.” Engineering and security documentation MUST NOT imply container or kernel isolation.

### 5.3 Hosted sandbox boundary

A production hosted runner requires a purpose-built provider or equivalent isolated runtime, per-session resource limits, network egress policy, artifact storage, authentication, tenant separation, and an encrypted outbound tunnel for private environments. It should initially support **reproduce this failed run**, not attempt to replace CI or become a device farm.

### 5.4 Playwright MCP boundary

Playwright MCP can later reuse the locator, assertion, timeline, and code-generation services. It can plan/explore a target and propose healing. It does not replace the human extension, evidence ingestion, hosted execution isolation, or screenshot-frame UI.

## 6. Development MVP and cloud production boundaries

| Concern | Development MVP (local or Compose) | Cloud production |
|---|---|---|
| Execution | Local Playwright Chromium or one trusted shared Compose runner | Provider-isolated container/microVM per session |
| Isolation | Fresh `BrowserContext`; Compose adds process/filesystem controls but shares one runner, kernel, and network | Tenant, process/kernel, filesystem, and network isolation |
| Users | One trusted local user/workspace | Multi-user organizations with RBAC and audit log |
| Platform authentication | Not required for loopback-only development | SSO/social login, scoped session tokens, CSRF protection |
| Target network | Local machine/VPN, host gateway, or trusted development/staging targets | Controlled egress; private targets through outbound tunnel |
| Domain policy | Explicit local configuration; safe defaults | Mandatory project allowlist and redirect enforcement |
| Secrets | Runtime only; environment variables; never persisted in timeline | Secret manager, scoped injection, rotation, audit |
| Artifacts | Local temporary/project data with explicit cleanup | Object storage, encryption, signed URLs, retention policy |
| Metadata | In-memory or local persistence | Durable database with tenant ownership on every row |
| Frame transport | Loopback HTTP/WebSocket or polling | Authenticated encrypted stream with backpressure |
| Scaling | Up to five contexts in one runner; idle and absolute cleanup | Job queue, quotas, concurrency, autoscaling, TTL cleanup |
| Integrations | Copy/download/native drafts | Jira/Zephyr/Git provider connections with verified scopes |
| Browser coverage | Chromium only | Chromium first; Firefox/WebKit by demonstrated demand |

The development MVP MUST remain honest in its UI. Local mode may say **Local browser**; Compose mode may say **Runner container** and **trusted targets only**. Both may say **Fresh context** and **Run automation**. Neither may say **secure cloud sandbox**, **isolated VM**, **device cloud**, or **deterministic replay**.

## 7. Security, privacy, and safety

### 7.1 URL and network policy

- Accept only absolute `http` and `https` URLs.
- Reject `file:`, `javascript:`, `data:`, browser-internal, extension, and custom schemes.
- Reject embedded credentials in URLs.
- Revalidate every redirect and popup target.
- Production MUST enforce a per-project domain allowlist, including explicit wildcard semantics.
- Local MVP SHOULD support an explicit user-owned allowlist and SHOULD default to `localhost`, loopback, and configured development/staging hosts.
- Link-local cloud metadata endpoints and known metadata hostnames MUST remain blocked even locally.
- Production MUST protect against DNS rebinding and resolved-IP changes.
- Production MUST block private/link-local networks unless traffic uses an approved customer tunnel.
- Popups, downloads, clipboard access, geolocation, camera, microphone, and notifications are denied by default and require a deliberate product decision.

### 7.2 Redaction

The recorder MUST never persist:

- values entered into password fields;
- `Authorization`, `Cookie`, `Set-Cookie`, proxy-authentication, or token headers;
- request or response bodies in the MVP;
- raw browser storage state;
- query parameters configured as sensitive;
- values matching configured token/API-key patterns.

Sensitive text entry appears in the timeline as a named placeholder such as `${PAYMENT_TEST_PASSWORD}`. The actual value may be held in memory only for the active interaction and MUST be discarded when the action completes.

Console messages, URLs, and failure metadata pass through redaction before storage. Redaction rules and a visible **Redacted** marker are preferable to silently removing the entire event.

Screenshots can contain personal or sensitive information and cannot be reliably protected by string redaction alone. The UI MUST warn users, restrict capture to approved targets, support screenshot deletion before export, and keep local artifacts local in the MVP.

### 7.3 Browser-process safety

- Use a dedicated browser context per Studio session and a new one per replay.
- Close contexts on explicit stop, timeout, runner disconnect, or application shutdown.
- Disable or quarantine downloads in the MVP.
- Bound page, navigation, action, and overall session timeouts.
- Bound screenshot dimensions, frequency, and retained artifact count.
- Do not execute arbitrary user-provided JavaScript or arbitrary generated Playwright files inside the MVP runner.
- replay only the validated semantic action model.
- Treat target content, page titles, console messages, DOM text, and generated issue content as untrusted data.

## 8. Canonical data model

All timestamps are ISO-8601. Durations are milliseconds. IDs are stable opaque strings.

### 8.1 `StudioSession`

- `id`
- `projectId?`
- `mode`: `local-playwright` for the MVP
- `status`: `idle | launching | ready | recording | replaying | stopped | failed`
- `initialUrl`
- `currentUrl`
- `pageTitle`
- `browser`: name/version
- `viewport`: width/height/deviceScaleFactor
- `allowlistDecision`
- `recordingState`: `off | recording | paused`
- `activeTimelineRevision`
- `latestFrameRevision`
- `createdAt`, `startedAt`, `stoppedAt?`, `lastActivityAt`
- `error?`: stable code, safe message, recovery hint

### 8.2 `BrowserFrame`

- `sessionId`
- `revision`: monotonically increasing integer
- `capturedAt`
- `pageUrl`
- `viewportWidth`, `viewportHeight`
- `imageMimeType`
- `imageBytes` or short-lived local URL
- `loadingState`

Frames are ephemeral interaction state. They are not automatically retained as evidence.

### 8.3 `CapturedEvent`

Append-only raw event:

- `id`, `sessionId`, `timestamp`
- `kind`
- `frameRevision?`
- sanitized input payload
- page URL/title
- raw target snapshot reference
- redaction markers

### 8.4 `TimelineRevision` and `TimelineStep`

`TimelineRevision` stores `id`, `sessionId`, `version`, `createdAt`, `sourceRevisionId?`, and ordered step IDs.

`TimelineStep` stores:

- `id`, `revisionId`, `sequence`
- `kind`: `action | assertion | wait | note | group`
- `actionKind?`
- human `label`
- safe `parameters`
- `locatorCandidates[]`
- `selectedLocatorId?`
- `assertion?`
- `rawEventIds[]`
- `beforeEvidenceId?`, `afterEvidenceId?`
- `enabled`
- `reviewState`: `ready | needs-review | unsupported`
- `createdAt`, `updatedAt`

### 8.5 `LocatorCandidate`

- `id`
- `engine`: `role | label | test-id | text | alt | placeholder | attribute | css`
- `playwrightExpression`
- structured locator arguments
- `matchCount`
- `unique`
- `stability`: `high | medium | low`
- `score`
- `warnings[]`
- `frameScope?`
- `evaluatedAt`

### 8.6 `AssertionSpec`

- `kind`
- `locatorCandidateId?`
- `expected`
- `observedAtAuthoring`
- `timeoutMs`
- `manualExpectedResult`

### 8.7 `EvidenceArtifact`

- `id`, `sessionId`, `replayRunId?`, `timelineStepId?`
- `kind`: `screenshot | trace | console | page-error | network-failure | log`
- safe title/filename/MIME type/size
- local path or production object key
- redaction status
- `createdAt`
- retention/deletion state

### 8.8 `ReplayRun` and `ReplayStepResult`

`ReplayRun` stores session ID, frozen timeline revision, fresh-context identifier, status, start/end/duration, browser/viewport, and result counts.

Each `ReplayStepResult` stores step ID, `running | passed | failed | skipped`, start/end/duration, selected locator, match count, safe error, and evidence IDs.

### 8.9 Generated outputs

- `GeneratedSpec`: session ID, timeline revision, filename, code, validation status, createdAt.
- `ManualCaseDraft`: source IDs, title, description, preconditions, ordered action/expected-result steps, tags, evidence links.
- `BugDraft`: source IDs, title, expected/actual, reproduction steps, environment, evidence links, traceability links.
- `TraceabilityLink`: typed `fromType/fromId` and `toType/toId`, relationship, source, createdAt.

## 9. Local API contract

This is a logical API contract; the local implementation may combine calls while preserving the same semantics.

### 9.1 Session lifecycle

- `POST /api/studio/sessions` — body: `{ url, viewport? }`; validates policy and launches a session.
- `GET /api/studio/sessions/:sessionId` — returns safe session state.
- `DELETE /api/studio/sessions/:sessionId` — closes context, process resources, and ephemeral frames.
- `WS /api/studio/sessions/:sessionId/stream` — emits binary/safe frame updates, page status, URL/title, recording events, and replay step status. Bounded HTTP polling is an acceptable local fallback.

### 9.2 Browser interaction

- `POST /api/studio/sessions/:sessionId/interactions`

Interaction body is a discriminated union:

```ts
type StudioInteraction =
  | { kind: "click" | "double-click"; x: number; y: number; frameRevision: number; button?: "left" | "right" }
  | { kind: "type"; text: string; sensitive?: boolean }
  | { kind: "press"; key: string }
  | { kind: "scroll"; deltaX: number; deltaY: number; frameRevision: number }
  | { kind: "navigate"; url: string }
  | { kind: "back" | "forward" | "reload" };
```

Responses include accepted/rejected state, new frame expectation, and recorded semantic-step ID when recording is active. Sensitive interaction values MUST NOT be echoed.

### 9.3 Inspection and assertions

- `POST /api/studio/sessions/:sessionId/inspect` — body: `{ x, y, frameRevision }`; returns safe target metadata and ranked locator candidates.
- `POST /api/studio/sessions/:sessionId/assertions` — creates an assertion timeline step from a validated target and assertion specification.
- `POST /api/studio/sessions/:sessionId/locators/validate` — re-evaluates an edited locator and returns match count/stability warnings.

### 9.4 Recording and timeline

- `POST /api/studio/sessions/:sessionId/recording/start`
- `POST /api/studio/sessions/:sessionId/recording/pause`
- `POST /api/studio/sessions/:sessionId/recording/stop`
- `GET /api/studio/sessions/:sessionId/timeline`
- `PATCH /api/studio/sessions/:sessionId/timeline/steps/:stepId`
- `POST /api/studio/sessions/:sessionId/timeline/reorder` — body contains the complete ordered enabled/disabled step ID list and expected source revision.
- `POST /api/studio/sessions/:sessionId/timeline/undo`

Timeline mutations return a new revision number and conflict if the caller edits a stale revision.

### 9.5 Replay and outputs

- `POST /api/studio/sessions/:sessionId/replays` — body: `{ timelineRevision }`.
- `GET /api/studio/replays/:replayId`
- `POST /api/studio/replays/:replayId/cancel`
- `POST /api/studio/sessions/:sessionId/generate/playwright`
- `POST /api/studio/sessions/:sessionId/generate/manual-case`
- `POST /api/studio/sessions/:sessionId/generate/bug`

All API errors use `{ code, message, recovery?, field? }`. Messages must be safe for display and must not include browser storage, credentials, headers, or unsanitized page content.

## 10. Acceptance criteria for the local MVP

### 10.1 Launch and live interaction

- A user can paste a valid local, development, or allowlisted staging `http(s)` URL and see a real Chromium-rendered screenshot in Test Studio.
- Invalid schemes, embedded credentials, blocked hosts, redirect violations, DNS failures, TLS failures, and navigation timeouts produce distinct actionable errors.
- A normal local target reaches the first ready frame within 10 seconds on a warmed development machine.
- Click, type, key press, select/check, scroll, back, forward, reload, and navigate alter the real page as expected.
- Every coordinate interaction includes a frame revision; a deliberately stale-frame request is rejected without clicking.
- A new frame is visible within one second after a settled interaction under normal local conditions.
- Closing a session releases its browser context and temporary frame resources.

### 10.2 Recording and evidence

- Starting recording changes visible state and subsequent supported interactions appear as semantic timeline steps.
- Typing into one field becomes one editable `fill` step rather than one step per key.
- Password input and configured secret-looking values never appear in timeline JSON, logs, API responses, generated code, or bug output.
- Console warnings/errors, page errors, and failed-request metadata are associated with the correct session time range.
- A user can capture and later delete a screenshot evidence item.
- Stopping recording preserves the timeline and leaves the browser usable.

### 10.3 Locators and assertions

- Every element action has at least one locator candidate or is visibly marked unsupported.
- The selected locator shows its Playwright expression, exact current match count, and stability label.
- A locator with more than one match cannot be labeled unique.
- Generated `.nth()` or structural CSS is never silently selected when a unique semantic locator exists.
- A user can select an element from the screenshot and add each supported element assertion.
- A user can add URL and title assertions without an element target.
- Edited expected values and assertion timeouts persist in the active timeline revision.

### 10.4 Timeline and replay

- The user can edit, disable/delete, reorder, and undo a timeline step.
- Any behavior-changing edit creates a new revision and marks earlier replay evidence stale.
- **Run automation** always creates a new browser context and records a distinct replay ID.
- A cookie or local-storage marker created only in the recording context is absent in the replay context unless an explicit auth setup is configured.
- Replay streams per-step running/pass/fail/skipped status and stops on the first required failure.
- A replay failure includes the failed step, safe error, screenshot, and available console/network/trace evidence.
- Recording evidence and replay evidence remain separately identifiable.

### 10.5 Generated outputs

- Generated Playwright TypeScript parses, uses the selected locators/assertions, and contains no persisted secret values.
- Copy and `.spec.ts` download produce the exact code shown in the UI.
- A generated manual case contains editable preconditions and ordered action/expected-result pairs; missing expected results are marked for review rather than invented.
- A generated bug draft contains steps, expected/actual behavior, environment, browser, source/replay IDs, and selected evidence.
- Generated spec, manual case, replay, bug, and session retain explicit traceability IDs and timeline revision.

### 10.6 Product honesty and accessibility

- UI copy calls the current mechanism a local browser/fresh context and never claims provider isolation or deterministic playback.
- Status is always presented with a label/icon as well as color.
- Browser controls, timeline actions, recording state, and assertion authoring are keyboard reachable with visible focus.
- Frame loading and replay updates use polite live-region announcements without layout shift.

## 11. Explicitly out of scope for the local MVP

- Provider-isolated cloud containers, microVMs, VMs, or real devices.
- Multi-tenant execution of arbitrary customer test repositories or arbitrary Playwright code.
- Replacing CI, smart sharding, cross-browser device grids, or parallel orchestration.
- Continuous video capture, WebRTC streaming, or deterministic video/raw-event playback.
- A Manifest V3 browser extension or control of the user's existing Chrome profile.
- Playwright MCP, autonomous planner/generator/healer agents, or general-purpose natural-language browser control. The implemented questionnaire command compiler is a narrow ID-based exception and cannot improvise browser actions or response values.
- Silent locator self-healing or automatic repository changes.
- GitHub App installation, page-object AST insertion, branch creation, PR creation, or auto-merge.
- Live Jira/Zephyr writes, Jira attachment upload, or Zephyr execution synchronization.
- Full request/response bodies, unredacted HAR capture, cookie export, or production session cloning.
- Firefox, WebKit, Safari packaging, mobile emulation matrices, or visual-regression assertions.
- Collaborative simultaneous control, enterprise RBAC/SSO/SCIM, billing, quotas, or compliance claims.
- Production artifact retention and audit guarantees.

## 12. Phased roadmap

### Phase 1a — Local Test Studio vertical slice (implemented)

- Paste and validate a URL.
- Launch real local Playwright Chromium.
- Interact through revisioned screenshot frames.
- Start/stop semantic recording.
- Capture safe screenshots, console/page errors, and failed-request metadata.
- Rank locators and report exact uniqueness.
- Add supported assertions.
- Replay in a fresh browser context.
- Generate Playwright TypeScript.
- Convert the same timeline into a local manual-case draft.

Exit condition met: one user can take a small local/staging flow from URL to passing fresh-context replay, generated Playwright, and a manual-case draft.

### Phase 1b — Containerized Studio foundation (implemented and verified)

- Serve the production UI through a non-root web gateway and proxy only `/api/studio/**`.
- Keep the Playwright runner internal, non-root, read-only, resource-bounded, and protected by the versioned Chromium seccomp profile.
- Pin Bun, Playwright, and browser images to exact compatible versions.
- Translate public loopback URLs to the internal web origin without leaking container hostnames into timelines, evidence, replay results, or generated code.
- Prove Chromium readiness before dependent startup and reap abandoned shared-runner contexts.
- Preserve recording, unique semantic locators, assertions, fresh-context replay, generated TypeScript, manual conversion, redaction, and stale-frame rejection.

Exit condition met: the clean Compose build becomes healthy and the demo flow passes end to end through the gateway while the runner remains unpublished. Detailed evidence is in `container-sandbox-architecture.md`.

### Domain-specific assistant experiment (removed from product)

The experimental questionnaire assistant and PHQ demo launcher were removed from Test Studio. They prescribed a domain model before the company flow had been recorded and validated. The supported product surface remains the URL-first recorder; any future agent behavior must be derived from recorded journeys and introduced behind explicit review and approval boundaries.

### Phase 2 — Durable evidence and observability bridge

- Durable local/server metadata persistence.
- Trace packaging, artifact lifecycle, and retention controls.
- Import completed Playwright runs from CI.
- Link Studio-generated tests to run history, flakiness, and release readiness.
- Improve iframe/shadow-DOM locator support and auth setup fixtures.
- Add structured native manual-case and triage workflows.

### Phase 3 — External workflow integrations and human extension

- Verify Jira/Zephyr connector read/write and attachment limits.
- Create/link Jira bug drafts and log Zephyr executions with user confirmation.
- Keep the requirement → case → Studio session → spec → run → bug chain synchronized.
- Build the Chromium extension for real authenticated-tab manual recording.
- Share locator, redaction, evidence, and code-generation services between the extension and local/hosted runner.

### Phase 4 — Hosted production execution

- Add organization authentication, RBAC, audit, quotas, and billing controls.
- Run sessions in provider-isolated containers/microVMs with TTL cleanup.
- Add mandatory domain allowlists, controlled egress, secret injection, and private-network tunnel support.
- Store artifacts in encrypted object storage with signed URLs and retention policy.
- Stream the hosted browser to the dashboard.
- Begin with one-click reproduction of failed/flaky CI runs pinned to image, commit, and environment.

### Phase 5 — Agent assistance and evidence-grounded healing

- Expose Studio/observability through MCP.
- Use Playwright MCP/test agents for exploration and draft generation.
- Compare selector failures with trace DOM snapshots and current DOM.
- Offer ranked locator repairs with evidence, confidence, and human accept/reject.
- Generate reviewed PR drafts; never silently merge or silently mutate tests.

## 13. Success measure for the first slice

The first slice succeeds when a tester can complete this loop without an IDE:

> Paste URL → launch real browser → record actions → add an assertion → edit the timeline → run it in a fresh context → export Playwright code → create a manual case or evidence-complete bug draft.

Every output must remain inspectable and linked to the exact timeline revision that produced it. That inspectability—not hidden automation—is the foundation for both simplicity and power.
