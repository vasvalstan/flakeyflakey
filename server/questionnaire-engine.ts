import type {
  QuestionnaireCatalog,
  QuestionnairePlanStep,
  QuestionnaireRunPlan,
} from "../src/studio/types";

export const MAX_QUESTIONNAIRE_COMMAND_LENGTH = 1_000;

export const QUESTIONNAIRE_SAFETY_NOTICE =
  "Synthetic questionnaire profiles are QA fixtures for approved test environments only. "
  + "They do not assess, diagnose, score, or infer any person's clinical state and must never replace real responses.";

export interface QuestionnaireResponseOption {
  readonly id: string;
  readonly label: string;
  readonly aliases: readonly string[];
  readonly score: number;
}

export interface QuestionnaireQuestionDefinition {
  readonly id: string;
  readonly prompt: string;
  readonly aliases: readonly string[];
  readonly options: readonly QuestionnaireResponseOption[];
}

export interface QuestionnaireProfileDefinition {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly synthetic: true;
  readonly aliases: readonly string[];
  readonly answers: Readonly<Record<string, string>>;
}

export interface QuestionnaireDefinition {
  readonly id: string;
  readonly title: string;
  readonly version: string;
  readonly description: string;
  readonly aliases: readonly string[];
  readonly questions: readonly QuestionnaireQuestionDefinition[];
  readonly profiles: readonly QuestionnaireProfileDefinition[];
}

const RESPONSE_OPTIONS: readonly QuestionnaireResponseOption[] = Object.freeze([
  Object.freeze({
    id: "not-at-all",
    label: "Not at all",
    aliases: Object.freeze(["Not at all", "0 - Not at all"]),
    score: 0,
  }),
  Object.freeze({
    id: "several-days",
    label: "Several days",
    aliases: Object.freeze(["Several days", "1 - Several days"]),
    score: 1,
  }),
  Object.freeze({
    id: "more-than-half-the-days",
    label: "More than half the days",
    aliases: Object.freeze(["More than half the days", "2 - More than half the days"]),
    score: 2,
  }),
  Object.freeze({
    id: "nearly-every-day",
    label: "Nearly every day",
    aliases: Object.freeze(["Nearly every day", "3 - Nearly every day"]),
    score: 3,
  }),
]);

function question(
  id: string,
  prompt: string,
  aliases: readonly string[],
): QuestionnaireQuestionDefinition {
  return Object.freeze({
    id,
    prompt,
    aliases: Object.freeze([...aliases]),
    options: RESPONSE_OPTIONS,
  });
}

const SHARED_QUESTIONS: readonly QuestionnaireQuestionDefinition[] = Object.freeze([
  question(
    "phq-1",
    "Little interest or pleasure in doing things",
    ["Little interest or pleasure"],
  ),
  question(
    "phq-2",
    "Feeling down, depressed, or hopeless",
    ["Feeling down or hopeless"],
  ),
  question(
    "phq-3",
    "Trouble falling or staying asleep, or sleeping too much",
    ["Trouble sleeping", "Sleeping too much"],
  ),
  question(
    "phq-4",
    "Feeling tired or having little energy",
    ["Feeling tired", "Little energy"],
  ),
  question(
    "phq-5",
    "Poor appetite or overeating",
    ["Poor appetite", "Overeating"],
  ),
  question(
    "phq-6",
    "Feeling bad about yourself — or that you are a failure or have let yourself or your family down",
    ["Feeling bad about yourself", "Feeling like a failure"],
  ),
  question(
    "phq-7",
    "Trouble concentrating on things, such as reading the newspaper or watching television",
    ["Trouble concentrating"],
  ),
  question(
    "phq-8",
    "Moving or speaking so slowly that other people could have noticed, or being so fidgety or restless that you have been moving around a lot more than usual",
    ["Moving or speaking slowly", "Being fidgety or restless"],
  ),
]);

const PHQ_9_QUESTION = question(
  "phq-9",
  "Thoughts that you would be better off dead or of hurting yourself in some way",
  ["Thoughts of being better off dead", "Thoughts of hurting yourself"],
);

function profile(
  id: string,
  label: string,
  description: string,
  aliases: readonly string[],
  answers: Readonly<Record<string, string>>,
): QuestionnaireProfileDefinition {
  return Object.freeze({
    id,
    label,
    description,
    synthetic: true,
    aliases: Object.freeze([...aliases]),
    answers: Object.freeze({ ...answers }),
  });
}

const PHQ_8_PROFILES: readonly QuestionnaireProfileDefinition[] = Object.freeze([
  profile(
    "minimal",
    "Minimal synthetic",
    "QA fixture selecting “Not at all” for every question.",
    ["minimal", "least severe", "not at all", "none"],
    {
      "phq-1": "not-at-all",
      "phq-2": "not-at-all",
      "phq-3": "not-at-all",
      "phq-4": "not-at-all",
      "phq-5": "not-at-all",
      "phq-6": "not-at-all",
      "phq-7": "not-at-all",
      "phq-8": "not-at-all",
    },
  ),
  profile(
    "mild",
    "Mild synthetic",
    "QA fixture selecting “Several days” for every question.",
    ["mild", "less severe", "several days"],
    {
      "phq-1": "several-days",
      "phq-2": "several-days",
      "phq-3": "several-days",
      "phq-4": "several-days",
      "phq-5": "several-days",
      "phq-6": "several-days",
      "phq-7": "several-days",
      "phq-8": "several-days",
    },
  ),
  profile(
    "severe",
    "Severe synthetic",
    "QA fixture selecting “Nearly every day” for every question.",
    ["severe", "most severe", "nearly every day", "maximum"],
    {
      "phq-1": "nearly-every-day",
      "phq-2": "nearly-every-day",
      "phq-3": "nearly-every-day",
      "phq-4": "nearly-every-day",
      "phq-5": "nearly-every-day",
      "phq-6": "nearly-every-day",
      "phq-7": "nearly-every-day",
      "phq-8": "nearly-every-day",
    },
  ),
]);

const PHQ_9_PROFILES: readonly QuestionnaireProfileDefinition[] = Object.freeze([
  profile(
    "minimal",
    "Minimal synthetic",
    "QA fixture selecting “Not at all” for every question.",
    ["minimal", "least severe", "not at all", "none"],
    {
      "phq-1": "not-at-all",
      "phq-2": "not-at-all",
      "phq-3": "not-at-all",
      "phq-4": "not-at-all",
      "phq-5": "not-at-all",
      "phq-6": "not-at-all",
      "phq-7": "not-at-all",
      "phq-8": "not-at-all",
      "phq-9": "not-at-all",
    },
  ),
  profile(
    "mild",
    "Mild synthetic",
    "QA fixture selecting “Several days” for every question.",
    ["mild", "less severe", "several days"],
    {
      "phq-1": "several-days",
      "phq-2": "several-days",
      "phq-3": "several-days",
      "phq-4": "several-days",
      "phq-5": "several-days",
      "phq-6": "several-days",
      "phq-7": "several-days",
      "phq-8": "several-days",
      "phq-9": "several-days",
    },
  ),
  profile(
    "severe",
    "Severe synthetic",
    "QA fixture selecting “Nearly every day” for every question.",
    ["severe", "most severe", "nearly every day", "maximum"],
    {
      "phq-1": "nearly-every-day",
      "phq-2": "nearly-every-day",
      "phq-3": "nearly-every-day",
      "phq-4": "nearly-every-day",
      "phq-5": "nearly-every-day",
      "phq-6": "nearly-every-day",
      "phq-7": "nearly-every-day",
      "phq-8": "nearly-every-day",
      "phq-9": "nearly-every-day",
    },
  ),
]);

function definition(
  value: QuestionnaireDefinition,
): QuestionnaireDefinition {
  return Object.freeze({
    ...value,
    aliases: Object.freeze([...value.aliases]),
    questions: Object.freeze([...value.questions]),
    profiles: Object.freeze([...value.profiles]),
  });
}

const QUESTIONNAIRE_DEFINITIONS: readonly QuestionnaireDefinition[] = Object.freeze([
  definition({
    id: "phq-8",
    title: "PHQ-8 Demo",
    version: "demo-1",
    description: "Eight-question deterministic QA fixture in the PHQ demo family.",
    aliases: ["phq-8", "phq 8", "phq8", "patient health questionnaire 8"],
    questions: SHARED_QUESTIONS,
    profiles: PHQ_8_PROFILES,
  }),
  definition({
    id: "phq-9",
    title: "PHQ-9 Demo",
    version: "demo-1",
    description: "Nine-question deterministic QA fixture in the PHQ demo family.",
    aliases: ["phq-9", "phq 9", "phq9", "patient health questionnaire 9"],
    questions: [...SHARED_QUESTIONS, PHQ_9_QUESTION],
    profiles: PHQ_9_PROFILES,
  }),
]);

const DEFINITIONS_BY_ID = new Map(
  QUESTIONNAIRE_DEFINITIONS.map((item) => [item.id, item] as const),
);

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type AliasOwner = {
  readonly id: string;
  readonly aliases: readonly string[];
};

type AliasOccurrence = {
  readonly ownerId: string;
  readonly start: number;
  readonly end: number;
};

function phraseOccurrences(text: string, phrase: string): Array<{ start: number; end: number }> {
  const occurrences: Array<{ start: number; end: number }> = [];
  if (!phrase) return occurrences;
  let searchFrom = 0;
  while (searchFrom <= text.length - phrase.length) {
    const start = text.indexOf(phrase, searchFrom);
    if (start < 0) break;
    const end = start + phrase.length;
    const beginsAtBoundary = start === 0 || text[start - 1] === " ";
    const endsAtBoundary = end === text.length || text[end] === " ";
    if (beginsAtBoundary && endsAtBoundary) occurrences.push({ start, end });
    searchFrom = start + 1;
  }
  return occurrences;
}

/**
 * Resolve aliases without treating a shorter phrase inside a longer alias as
 * a second intent. For example, "less severe" means the mild fixture and does
 * not also match the shorter severe alias.
 */
function matchingOwnerIds(text: string, owners: readonly AliasOwner[]): string[] {
  const occurrences: AliasOccurrence[] = [];
  for (const owner of owners) {
    for (const alias of owner.aliases) {
      const normalizedAlias = normalize(alias);
      for (const occurrence of phraseOccurrences(text, normalizedAlias)) {
        occurrences.push({ ownerId: owner.id, ...occurrence });
      }
    }
  }
  occurrences.sort((left, right) => (right.end - right.start) - (left.end - left.start));

  const accepted: AliasOccurrence[] = [];
  for (const occurrence of occurrences) {
    const contained = accepted.some((existing) =>
      existing.start <= occurrence.start && existing.end >= occurrence.end
    );
    if (!contained) accepted.push(occurrence);
  }
  return [...new Set(accepted.map((occurrence) => occurrence.ownerId))];
}

function containsPhrase(text: string, phrase: string): boolean {
  return phraseOccurrences(text, normalize(phrase)).length > 0;
}

function createPlanBase(
  command: string,
  pageUrl: string,
  submitRequested: boolean,
): Pick<
  QuestionnaireRunPlan,
  "id" | "command" | "pageUrl" | "createdAt" | "source" | "mode" | "submitRequested"
> {
  return {
    id: crypto.randomUUID(),
    command,
    pageUrl,
    createdAt: new Date().toISOString(),
    source: "deterministic-parser",
    mode: submitRequested ? "submit" : "fill-only",
    submitRequested,
  };
}

function answerSteps(
  definitionValue: QuestionnaireDefinition,
  profileValue: QuestionnaireProfileDefinition,
): { steps: QuestionnairePlanStep[]; blockers: string[] } {
  const steps: QuestionnairePlanStep[] = [];
  const blockers: string[] = [];
  for (const [index, currentQuestion] of definitionValue.questions.entries()) {
    const answerId = profileValue.answers[currentQuestion.id];
    const option = currentQuestion.options.find((item) => item.id === answerId);
    if (!answerId || !option) {
      blockers.push(
        `Profile “${profileValue.label}” has no approved response for “${currentQuestion.prompt}”.`,
      );
      continue;
    }
    steps.push({
      index,
      questionId: currentQuestion.id,
      prompt: currentQuestion.prompt,
      answerId: option.id,
      answerLabel: option.label,
    });
  }
  return { steps, blockers };
}

export function getQuestionnaireDefinition(
  questionnaireId: string,
): QuestionnaireDefinition | undefined {
  return DEFINITIONS_BY_ID.get(normalize(questionnaireId).replace(" ", "-"));
}

export function getQuestionnaireCatalog(): QuestionnaireCatalog {
  return {
    safetyNotice: QUESTIONNAIRE_SAFETY_NOTICE,
    questionnaires: QUESTIONNAIRE_DEFINITIONS.map((item) => ({
      id: item.id,
      title: item.title,
      version: item.version,
      description: item.description,
      questionCount: item.questions.length,
      profiles: item.profiles.map((profileValue) => ({
        id: profileValue.id,
        label: profileValue.label,
        description: profileValue.description,
        synthetic: true,
        aliases: [...profileValue.aliases],
      })),
    })),
  };
}

export function compileQuestionnaireCommand(
  command: string,
  pageUrl: string,
  detectedQuestionnaireIds: readonly string[] = [],
): QuestionnaireRunPlan {
  const trimmedCommand = command.trim();
  if (trimmedCommand.length > MAX_QUESTIONNAIRE_COMMAND_LENGTH) {
    return {
      ...createPlanBase(
        trimmedCommand.slice(0, MAX_QUESTIONNAIRE_COMMAND_LENGTH),
        pageUrl,
        false,
      ),
      status: "blocked",
      steps: [],
      warnings: [QUESTIONNAIRE_SAFETY_NOTICE],
      blockers: [
        `Command is too long. Keep it to ${MAX_QUESTIONNAIRE_COMMAND_LENGTH} characters or fewer.`,
      ],
    };
  }

  const normalizedCommand = normalize(trimmedCommand);
  const fillOnlyOverride = [
    "do not submit",
    "dont submit",
    "without submitting",
    "fill only",
    "do not send",
    "dont send",
  ].some((phrase) => containsPhrase(normalizedCommand, phrase));
  const submitRequested = !fillOnlyOverride && containsPhrase(normalizedCommand, "submit");
  const base = createPlanBase(trimmedCommand, pageUrl, submitRequested);
  const blockers: string[] = [];
  const warnings = [QUESTIONNAIRE_SAFETY_NOTICE];

  if (!trimmedCommand) {
    blockers.push("Enter a command and choose one of the approved synthetic profiles: minimal, mild, or severe.");
  }

  const questionnaireMatches = matchingOwnerIds(
    normalizedCommand,
    QUESTIONNAIRE_DEFINITIONS,
  );
  let selectedDefinition: QuestionnaireDefinition | undefined;
  if (questionnaireMatches.length > 1) {
    blockers.push(
      `The command names multiple questionnaires (${questionnaireMatches.join(", ")}). Choose exactly one.`,
    );
  } else if (questionnaireMatches.length === 1) {
    selectedDefinition = DEFINITIONS_BY_ID.get(questionnaireMatches[0]);
  } else {
    const uniqueDetectedIds = [...new Set(
      detectedQuestionnaireIds.map((item) => item.trim().toLowerCase()).filter(Boolean),
    )];
    if (uniqueDetectedIds.length === 1) {
      selectedDefinition = DEFINITIONS_BY_ID.get(uniqueDetectedIds[0]);
      if (selectedDefinition) {
        warnings.push(
          `Questionnaire selected from the single detected page match: ${selectedDefinition.title}.`,
        );
      } else {
        blockers.push(
          `The detected questionnaire “${uniqueDetectedIds[0]}” is not supported. Choose PHQ-8 or PHQ-9 Demo.`,
        );
      }
    } else if (uniqueDetectedIds.length > 1) {
      blockers.push(
        `The page matches multiple questionnaires (${uniqueDetectedIds.join(", ")}). Name PHQ-8 or PHQ-9 explicitly.`,
      );
    } else {
      blockers.push("No questionnaire was selected. Name PHQ-8 or PHQ-9 Demo.");
    }
  }

  let selectedProfile: QuestionnaireProfileDefinition | undefined;
  if (selectedDefinition) {
    const profileMatches = matchingOwnerIds(normalizedCommand, selectedDefinition.profiles);
    if (profileMatches.length > 1) {
      blockers.push(
        `The command names multiple profiles (${profileMatches.join(", ")}). Choose minimal, mild, or severe.`,
      );
    } else if (profileMatches.length === 1) {
      selectedProfile = selectedDefinition.profiles.find(
        (profileValue) => profileValue.id === profileMatches[0],
      );
    } else {
      blockers.push(
        "No approved synthetic profile was selected. Choose minimal, mild, or severe.",
      );
    }
  }

  let steps: QuestionnairePlanStep[] = [];
  if (selectedDefinition && selectedProfile) {
    const mapped = answerSteps(selectedDefinition, selectedProfile);
    steps = mapped.steps;
    blockers.push(...mapped.blockers);
  }

  if (fillOnlyOverride || !submitRequested) {
    warnings.push("Fill-only mode is active; this plan will not submit the questionnaire.");
  } else {
    warnings.push("Submission requires explicit confirmation immediately before the submit action.");
  }

  return {
    ...base,
    status: blockers.length > 0
      ? "blocked"
      : submitRequested
        ? "needs-confirmation"
        : "ready",
    questionnaireId: selectedDefinition?.id,
    questionnaireTitle: selectedDefinition?.title,
    questionnaireVersion: selectedDefinition?.version,
    profileId: selectedProfile?.id,
    profileLabel: selectedProfile?.label,
    steps: blockers.length > 0 ? [] : steps,
    warnings,
    blockers,
  };
}
