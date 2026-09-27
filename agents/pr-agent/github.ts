import { repository, required } from "./config";

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;
export class GitHubError extends Error {
  constructor(public status: number) { super(`GitHub request failed (HTTP ${status}). Check repository access or rate limits.`); }
}
export type PullRequest = {
  number: number; html_url: string; state: string; merged_at: string | null;
  head: { sha: string; ref: string }; base: { ref: string };
};
export type Review = { id: number; body: string | null; state: string; commit_id: string; user: { login: string; type: string } };
export type ReviewComment = {
  id: number; body: string; html_url: string; path: string; line: number | null;
  commit_id: string; pull_request_review_id: number; user: { login: string; type: string };
};

export class GitHub {
  private readonly root = `/repos/${repository.owner}/${repository.name}`;
  constructor(
    private readonly credential: () => PromiseLike<string> = async () => required("FLAKEY_GITHUB_TOKEN"),
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async request<T>(suffix: string, method = "GET", body?: unknown): Promise<T> {
    const response = await this.fetcher(`https://api.github.com${this.root}${suffix}`, {
      method, redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${await this.credential()}`, Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new GitHubError(response.status);
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }

  async list<T>(suffix: string): Promise<T[]> {
    const items: T[] = [];
    for (let page = 1; page <= 10; page++) {
      const batch = await this.request<T[]>(`${suffix}${suffix.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
      items.push(...batch);
      if (batch.length < 100) return items;
    }
    throw new Error("GitHub result exceeds the review limit; manual review is required.");
  }

  repo() { return this.request<{ default_branch: string }>(""); }
  commit(ref: string) { return this.request<{ sha: string; tree: { sha: string } }>(`/git/commits/${encodeURIComponent(ref)}`); }
  async branch(branch: string) {
    try { return await this.request<{ object: { sha: string } }>(`/git/ref/heads/${encodeURIComponent(branch)}`); }
    catch (error) { if (error instanceof GitHubError && error.status === 404) return undefined; throw error; }
  }
  prs(branch: string) {
    return this.list<PullRequest>(`/pulls?state=all&head=${encodeURIComponent(`${repository.owner}:${branch}`)}`);
  }
  pr(number: number) { return this.request<PullRequest>(`/pulls/${number}`); }

  async archive(sha: string): Promise<Uint8Array> {
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("Expected a pinned Git commit.");
    const redirect = await this.fetcher(`https://api.github.com${this.root}/tarball/${sha}`, {
      headers: { Authorization: `Bearer ${await this.credential()}` },
      redirect: "manual", signal: AbortSignal.timeout(30_000),
    });
    if (redirect.status !== 302) throw new GitHubError(redirect.status);
    const location = new URL(redirect.headers.get("location") ?? "");
    if (location.protocol !== "https:" || location.hostname !== "codeload.github.com") {
      throw new Error("Unexpected repository download destination.");
    }
    // GitHub's signed download URL needs no bearer credential.
    const response = await this.fetcher(location.href, { redirect: "error", signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new GitHubError(response.status);
    if (Number(response.headers.get("content-length")) > 30_000_000) throw new Error("Repository archive exceeds 30 MB.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length > 30_000_000) throw new Error("Repository archive exceeds 30 MB.");
    return bytes;
  }
}

export function isGreptile(user: { login: string; type: string }) {
  const allowed = (process.env.GREPTILE_BOT_LOGINS ?? "greptile-apps[bot],greptile[bot],greptileai[bot]")
    .split(",").map(login => login.trim().toLowerCase());
  return user.type === "Bot" && allowed.includes(user.login.toLowerCase());
}
