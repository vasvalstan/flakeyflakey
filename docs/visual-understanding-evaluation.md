# Test Studio Visual Understanding Evaluation

Status: implemented; first live synthetic shadow baseline complete  
Last updated: 2026-07-18

## What this test is proving

The existing recorder and replay suite proves that Test Studio can resolve DOM/accessibility semantics, record Playwright actions, and replay those actions deterministically. That is necessary, but it does **not** by itself prove visual understanding.

Warmwind-style visual capability is evaluated separately. The recorder acts as the oracle:

```text
human or approved plan
        │
        ▼
recorded action ── screenshot before + target box + semantic locator
        │
        ├── deterministic Playwright replay
        ├── vision-only shadow evaluation
        └── hybrid vision + DOM closed-loop evaluation
```

This separation lets us measure exactly what the visual model adds instead of calling a DOM locator a visual result.

## Ground truth captured from a recording

Each eligible click or fill produces a visual case containing:

- the screenshot immediately before the action;
- the intent that led to the action;
- action kind;
- target semantic label and selected locator;
- target bounding box in the recorded viewport;
- screenshot immediately after the action;
- page URL, action/session IDs, source, and frame revision;
- whether either screenshot is available.

Sensitive inputs are excluded from the visual dataset. Screenshot masking remains active, and secret values never enter prompts, exported metadata, or evaluation output.

The before screenshot and target geometry must describe the same browser revision. A screenshot captured after the click is not valid localization ground truth.

## Three evaluation tracks

### 1. Deterministic baseline

The current DOM/accessibility executor runs the recorded or compiled plan in a fresh browser. This measures whether the journey and locator model are correct.

### 2. Vision-only shadow mode

The visual predictor receives only:

- screenshot before;
- one bounded intent, such as `Choose “Several days” for question 4`;
- the viewport size;
- the allowed action schema.

It returns an action kind, target box, confidence, and either a proposal or an abstention. The proposal is **never executed**. It is compared with recorder ground truth using:

- exact action-kind accuracy;
- target intersection-over-union (IoU);
- target hit rate at IoU ≥ 0.50;
- target-center distance and hit rate within 32 CSS pixels;
- abstention rate;
- unsafe-proposal rate.

This is the clean test of screenshot understanding.

### 3. Hybrid closed loop

After shadow performance is acceptable, the production candidate receives the screenshot plus bounded DOM/accessibility evidence. It proposes a semantic target; the deterministic resolver validates uniqueness and performs the Playwright action. The browser is observed again after every step.

Closed-loop metrics are:

- required-step success rate;
- complete-journey success rate;
- recovery and abstention rate;
- human interventions per journey;
- wrong-page or wrong-control mutations;
- submission-policy violations;
- p50/p95 perception latency and visual calls per completed step.

The model never sends raw mouse events directly to the runner. Ambiguous targets stop or request review. Submission remains a separately confirmed deterministic action.

## Twenty-recording evaluation protocol

Do not randomly split individual screenshots from similar sessions; that leaks near-identical pages into the test set. Split complete sessions and journey variants:

- 12 reference sessions to derive the reusable workflow/questionnaire bank;
- 4 development sessions for prompt and resolver tuning;
- 4 held-out sessions that are not inspected during tuning.

The held-out set should include meaningful 10–20% differences:

- PHQ-8 versus PHQ-9 or another approved questionnaire version;
- reordered response options;
- small copy changes and additional help text;
- an omitted or conditional section;
- validation banners and disabled controls;
- changed CSS/layout with unchanged semantics;
- viewport and scroll-position differences;
- one deliberately ambiguous or missing target where abstention is correct.

Report metrics for reference and held-out sessions separately. The gap between them is the practical generalization measure.

## Running a live shadow evaluation

Keep the Studio session open after recording so its in-memory visual dataset and masked screenshots remain available. Copy its **Run ID** from the Studio toolbar, then run:

```bash
OPENAI_API_KEY=... bun run visual:eval -- \
  --session <studio-session-id> \
  --confirm-external-upload
```

Optional flags are `--base-url`, `--model`, and `--max-cases`. The confirmation is mandatory because input masking protects known secret fields but a screenshot can still contain visible personal or health information. The command reads only the dataset and before-screenshot endpoints, evaluates cases sequentially, never forwards predictions to an execution endpoint, and prints aggregate metrics without screenshots, URLs, prompts, or model evidence.

The visual dataset is currently session-scoped and in memory. It must be evaluated before that Studio session closes. A durable, access-controlled, retention-governed corpus is required before the twenty-recording protocol can become a repeatable company benchmark.

## First live synthetic baseline

On 2026-07-18, the complete PHQ-8 demo journey was evaluated with `gpt-5.6` using eight masked before-action screenshots and the reviewed mild synthetic profile. Submission remained disabled.

- 8 of 8 model requests succeeded;
- 8 of 8 action kinds matched;
- 8 of 8 predicted target centres were within 32 CSS pixels;
- 8 of 8 target boxes reached IoU ≥ 0.50;
- mean IoU was 0.9768;
- there were no abstentions, unsafe proposals, or model/API failures;
- the same eight recorded actions passed a fresh-browser Playwright replay.

The first attempt exposed an oracle defect rather than a model defect: the recorder measured each visually hidden 1×1 radio input while GPT-5.6 correctly boxed its visible answer card. Ground-truth capture now resolves the visible interaction surface associated with tiny or transparent controls and clips it to the screenshot viewport. Regression tests require meaningful visible dimensions, viewport containment, synchronized images, stable semantic locators, and successful replay.

This is an engineering smoke baseline on one synthetic, repeated-layout journey. It is not a held-out generalization result and must not be represented as accuracy on company portals or production questionnaires.

## Initial promotion gates

Before any visual proposal can execute outside a disposable test environment:

- zero submission-policy violations;
- zero unmasked sensitive fields or secret values in evaluation artifacts;
- no action when the required target is missing or ambiguous;
- held-out target-hit and journey-success thresholds agreed from the first baseline;
- every low-confidence or policy-sensitive proposal abstains or asks for review;
- the hybrid result must beat or complement the deterministic baseline on the variants it is intended to solve.

Exact accuracy thresholds should be set from the first company-portal dataset rather than invented from the demo fixture. Safety gates are not negotiable.

## Voice is tested separately

Voice is an intent input, not the visual executor. Its evaluation has two stages:

1. speech-to-structured-command accuracy for questionnaire ID, profile ID, overrides, and submit policy;
2. the same plan review, visual shadow evaluation, and deterministic execution used by typed commands.

Raw audio does not need to be retained by default. A transcript or structured command can be attached to the visual ground-truth case when the tester has approved that retention.

## Current boundary

The repository contains the deterministic recorder/executor, synchronized visual-case capture, offline metrics, and a GPT-5.6 Responses API shadow adapter. Any new live score requires `OPENAI_API_KEY` and explicit approval to send masked screenshots outside the local runner. Until a multi-session held-out run is completed, the synthetic baseline must not be reported as production visual-understanding accuracy.
