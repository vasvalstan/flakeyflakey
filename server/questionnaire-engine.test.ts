import { describe, expect, test } from "bun:test";

import {
  MAX_QUESTIONNAIRE_COMMAND_LENGTH,
  QUESTIONNAIRE_SAFETY_NOTICE,
  compileQuestionnaireCommand,
  getQuestionnaireCatalog,
  getQuestionnaireDefinition,
} from "./questionnaire-engine";

const PAGE_URL = "https://portal.example.test/questionnaire";

describe("questionnaire engine", () => {
  test("publishes a versioned, explicitly synthetic and safety-labelled catalog", () => {
    const catalog = getQuestionnaireCatalog();

    expect(catalog.safetyNotice).toBe(QUESTIONNAIRE_SAFETY_NOTICE);
    expect(catalog.safetyNotice).toContain("QA fixtures");
    expect(catalog.safetyNotice).toContain("do not assess");
    expect(catalog.questionnaires.map((item) => item.id)).toEqual(["phq-8", "phq-9"]);
    expect(catalog.questionnaires.map((item) => item.version)).toEqual(["demo-1", "demo-1"]);
    for (const questionnaire of catalog.questionnaires) {
      expect(questionnaire.profiles.map((profile) => profile.id)).toEqual([
        "minimal",
        "mild",
        "severe",
      ]);
      expect(questionnaire.profiles.every((profile) => profile.synthetic)).toBe(true);
    }
  });

  test("exposes read-only definitions with canonical questions and response options", () => {
    const phq8 = getQuestionnaireDefinition("phq-8");
    const phq9 = getQuestionnaireDefinition("PHQ-9");

    expect(phq8?.questions).toHaveLength(8);
    expect(phq9?.questions).toHaveLength(9);
    expect(phq8?.questions[0]?.id).toBe("phq-1");
    expect(phq9?.questions[8]?.id).toBe("phq-9");
    expect(phq8?.questions[0]?.options.map((option) => option.id)).toEqual([
      "not-at-all",
      "several-days",
      "more-than-half-the-days",
      "nearly-every-day",
    ]);
    expect(Object.isFrozen(phq8)).toBe(true);
    expect(Object.isFrozen(phq8?.questions)).toBe(true);
  });

  test("compiles an explicit questionnaire and profile into a complete fill-only plan", () => {
    const plan = compileQuestionnaireCommand(
      "Complete PHQ-8 using the mild profile",
      PAGE_URL,
    );

    expect(plan.status).toBe("ready");
    expect(plan.mode).toBe("fill-only");
    expect(plan.submitRequested).toBe(false);
    expect(plan.questionnaireId).toBe("phq-8");
    expect(plan.profileId).toBe("mild");
    expect(plan.steps).toHaveLength(8);
    expect(plan.steps.every((step) => step.answerId === "several-days")).toBe(true);
    expect(plan.blockers).toEqual([]);
  });

  test("uses exactly one detected questionnaire when the command omits it", () => {
    const plan = compileQuestionnaireCommand(
      "Use the minimal profile and fill only",
      PAGE_URL,
      ["phq-9"],
    );

    expect(plan.status).toBe("ready");
    expect(plan.questionnaireId).toBe("phq-9");
    expect(plan.profileId).toBe("minimal");
    expect(plan.steps).toHaveLength(9);
    expect(plan.warnings.some((warning) => warning.includes("single detected page match"))).toBe(true);
  });

  test("defaults to no submission", () => {
    const plan = compileQuestionnaireCommand("Run PHQ9 with the severe fixture", PAGE_URL);

    expect(plan.status).toBe("ready");
    expect(plan.mode).toBe("fill-only");
    expect(plan.submitRequested).toBe(false);
  });

  test("do not submit overrides the submit keyword", () => {
    const plan = compileQuestionnaireCommand(
      "Complete PHQ-9 with the mild profile and do not submit",
      PAGE_URL,
    );

    expect(plan.status).toBe("ready");
    expect(plan.mode).toBe("fill-only");
    expect(plan.submitRequested).toBe(false);
  });

  test("fill only overrides an otherwise explicit submit request", () => {
    const plan = compileQuestionnaireCommand(
      "Submit PHQ-8 using the severe profile, but fill only",
      PAGE_URL,
    );

    expect(plan.status).toBe("ready");
    expect(plan.mode).toBe("fill-only");
    expect(plan.submitRequested).toBe(false);
  });

  test("an explicit submit request always requires confirmation", () => {
    const plan = compileQuestionnaireCommand(
      "Complete and submit PHQ-8 with the minimal profile",
      PAGE_URL,
    );

    expect(plan.status).toBe("needs-confirmation");
    expect(plan.mode).toBe("submit");
    expect(plan.submitRequested).toBe(true);
    expect(plan.warnings.some((warning) => warning.includes("explicit confirmation"))).toBe(true);
  });

  test("blocks an unknown or missing questionnaire with actionable guidance", () => {
    const unknown = compileQuestionnaireCommand(
      "Complete GAD-7 using the mild profile",
      PAGE_URL,
    );
    const unsupportedDetected = compileQuestionnaireCommand(
      "Use the mild profile",
      PAGE_URL,
      ["gad-7"],
    );

    expect(unknown.status).toBe("blocked");
    expect(unknown.steps).toEqual([]);
    expect(unknown.blockers.join(" ")).toContain("PHQ-8 or PHQ-9");
    expect(unsupportedDetected.status).toBe("blocked");
    expect(unsupportedDetected.blockers.join(" ")).toContain("not supported");
  });

  test("blocks ambiguous questionnaire or profile requests", () => {
    const questionnaire = compileQuestionnaireCommand(
      "Complete PHQ-8 and PHQ-9 with the mild profile",
      PAGE_URL,
    );
    const profile = compileQuestionnaireCommand(
      "Complete PHQ-8 with both minimal and mild profiles",
      PAGE_URL,
    );
    const detected = compileQuestionnaireCommand(
      "Use the mild profile",
      PAGE_URL,
      ["phq-8", "phq-9"],
    );

    expect(questionnaire.status).toBe("blocked");
    expect(questionnaire.blockers.join(" ")).toContain("multiple questionnaires");
    expect(profile.status).toBe("blocked");
    expect(profile.blockers.join(" ")).toContain("multiple profiles");
    expect(detected.status).toBe("blocked");
    expect(detected.blockers.join(" ")).toContain("multiple questionnaires");
  });

  test("blocks a missing or unapproved profile rather than guessing", () => {
    const missing = compileQuestionnaireCommand("Complete PHQ-8", PAGE_URL);
    const unknown = compileQuestionnaireCommand(
      "Complete PHQ-9 using a moderate profile",
      PAGE_URL,
    );

    expect(missing.status).toBe("blocked");
    expect(unknown.status).toBe("blocked");
    expect(missing.blockers.join(" ")).toContain("minimal, mild, or severe");
    expect(unknown.blockers.join(" ")).toContain("minimal, mild, or severe");
    expect(missing.steps).toEqual([]);
    expect(unknown.steps).toEqual([]);
  });

  test("materializes every approved profile mapping for every question", () => {
    const expectedAnswerByProfile = {
      minimal: "not-at-all",
      mild: "several-days",
      severe: "nearly-every-day",
    } as const;

    for (const questionnaireId of ["phq-8", "phq-9"] as const) {
      const expectedCount = questionnaireId === "phq-8" ? 8 : 9;
      for (const [profileId, expectedAnswer] of Object.entries(expectedAnswerByProfile)) {
        const plan = compileQuestionnaireCommand(
          `Complete ${questionnaireId} using the ${profileId} profile`,
          PAGE_URL,
        );

        expect(plan.status).toBe("ready");
        expect(plan.steps).toHaveLength(expectedCount);
        expect(plan.steps.map((step) => step.index)).toEqual(
          Array.from({ length: expectedCount }, (_, index) => index),
        );
        expect(plan.steps.every((step) => step.answerId === expectedAnswer)).toBe(true);
        expect(new Set(plan.steps.map((step) => step.questionId)).size).toBe(expectedCount);
      }
    }
  });

  test("recognizes profile aliases without confusing less severe with severe", () => {
    const mild = compileQuestionnaireCommand(
      "Complete PHQ-8 with the less severe answers",
      PAGE_URL,
    );
    const severe = compileQuestionnaireCommand(
      "Complete PHQ-8 with the most severe answers",
      PAGE_URL,
    );

    expect(mild.status).toBe("ready");
    expect(mild.profileId).toBe("mild");
    expect(severe.status).toBe("ready");
    expect(severe.profileId).toBe("severe");
  });

  test("bounds command length before parsing", () => {
    const command = `Complete PHQ-8 with mild ${"x".repeat(MAX_QUESTIONNAIRE_COMMAND_LENGTH)}`;
    const plan = compileQuestionnaireCommand(command, PAGE_URL);

    expect(plan.status).toBe("blocked");
    expect(plan.command.length).toBe(MAX_QUESTIONNAIRE_COMMAND_LENGTH);
    expect(plan.steps).toEqual([]);
    expect(plan.blockers.join(" ")).toContain("too long");
  });
});
