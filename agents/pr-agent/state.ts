export type Change = { path: string; mode: "100644" | "100755"; content: string | null };
export type Task = {
  key: string;
  branch: string;
  baseBranch: string;
  parentSha: string;
  parentTree: string;
  localBase: string;
  prNumber?: number;
  prUrl?: string;
  reviewRounds: number;
  reviewHead?: string;
  verification?: { digest: string; logs: { command: string; output: string }[] };
  awaitingReview?: boolean;
  approval?: { head: string; base: string; userId: string; eventId: string };
  merged?: { head: string; commit: string };
};
