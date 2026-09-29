import { WINDOWS, cutoffFor, csv, emptyCache, ghWindow, sod } from "./util.ts";
import type { VersionEntry, WindowCache } from "./types.ts";

export const GH_USERS = csv("GITHUB_USERS_WITH_STARS");
const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? "";
const MAX_STARRED = Number(process.env.GH_MAX_STARRED ?? 400);

const GH_HEADERS: Record<string, string> = {
  Accept: "application/vnd.github+json",
  "User-Agent": "glance-changelog",
};
if (GITHUB_TOKEN) GH_HEADERS.Authorization = `token ${GITHUB_TOKEN}`;

export const ghCaches: Record<number, WindowCache> = Object.fromEntries(
  WINDOWS.map((d) => [d, { ...emptyCache(d), users: GH_USERS }]),
);

let ghRefreshing = false;
export let ghReady = false;

interface GhRepo {
  full_name: string;
  pushed_at: string;
  owner?: { login?: string };
  html_url: string;
}

interface GhRelease {
  prerelease?: boolean;
  draft?: boolean;
  published_at?: string;
  created_at?: string;
  tag_name: string;
  name?: string;
  html_url: string;
  body?: string;
}

async function ghFetch<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: GH_HEADERS });
  if (!r.ok) {
    if (r.status === 404) return [] as unknown as T;
    if (r.status === 403 && r.headers.get("x-ratelimit-remaining") === "0") {
      throw new Error("GitHub rate limit hit (set GITHUB_TOKEN)");
    }
    throw new Error(`GitHub ${r.status}`);
  }
  return (await r.json()) as T;
}

async function ghStarred(user: string): Promise<GhRepo[]> {
  const repos: GhRepo[] = [];
  let page = 1;
  while (repos.length < MAX_STARRED) {
    const batch = await ghFetch<GhRepo[]>(
      `https://api.github.com/users/${user}/starred?per_page=100&page=${page}`,
    );
    if (!batch.length) break;
    repos.push(...batch);
    if (batch.length < 100) break;
    page++;
  }
  return repos;
}

async function ghNewVersions(repo: string, cutoff: number): Promise<VersionEntry[]> {
  const out: VersionEntry[] = [];
  const rels = await ghFetch<GhRelease[]>(
    `https://api.github.com/repos/${repo}/releases?per_page=10`,
  );
  for (const rel of rels) {
    if (rel.prerelease || rel.draft) continue;
    const pub = Date.parse(rel.published_at ?? rel.created_at ?? "");
    if (Number.isNaN(pub) || pub < cutoff) continue;
    out.push({
      repo,
      tagName: rel.tag_name,
      name: rel.name && rel.name !== rel.tag_name ? rel.name : "",
      publishedAt: new Date(pub).toISOString(),
      url: rel.html_url,
      description: (rel.body || "").replace(/\s+/g, " ").slice(0, 280),
    });
  }
  if (out.length || rels.length) return out;
  const tags = await ghFetch<{ name: string; commit?: { sha?: string } }[]>(
    `https://api.github.com/repos/${repo}/tags?per_page=5`,
  );
  for (const t of tags) {
    if (!t.commit?.sha) continue;
    const commit = await ghFetch<{
      commit?: { committer?: { date?: string }; author?: { date?: string } };
    }>(`https://api.github.com/repos/${repo}/commits/${t.commit.sha}`);
    const pub = Date.parse(commit.commit?.committer?.date ?? commit.commit?.author?.date ?? "");
    if (!pub || pub < cutoff) continue;
    out.push({
      repo,
      tagName: t.name,
      name: "",
      publishedAt: new Date(pub).toISOString(),
      url: `https://github.com/${repo}/releases/tag/${t.name}`,
      description: "",
    });
  }
  return out;
}

export async function refreshGithub(): Promise<void> {
  if (ghRefreshing || !GH_USERS.length) return;
  ghRefreshing = true;
  try {
    const sodMs = sod().getTime();
    const nowMs = Date.now();
    const maxCutoff = nowMs - 365 * 86_400_000;

    const userReleases = new Map<string, VersionEntry[]>();
    for (const user of GH_USERS) {
      const repos = await ghStarred(user);
      const active = repos.filter((r) => Date.parse(r.pushed_at) >= maxCutoff);
      const releases: VersionEntry[] = [];
      const CHUNK = 8;
      for (let i = 0; i < active.length; i += CHUNK) {
        const chunk = active.slice(i, i + CHUNK);
        const results = await Promise.all(
          chunk.map(async (repo) => {
            const list = await ghNewVersions(repo.full_name, maxCutoff);
            return list.map((v) => ({ ...v, owner: repo.owner?.login, repoUrl: repo.html_url }));
          }),
        );
        for (const list of results) releases.push(...list);
      }
      userReleases.set(user, releases);
    }

    const fetchedAt = new Date().toISOString();
    for (const days of WINDOWS) {
      const cutoff = cutoffFor(days, sodMs, nowMs);
      const groups: WindowCache["groups"] = [];
      for (const [user, releases] of userReleases.entries()) {
        const filtered = releases
          .filter((r) => Date.parse(r.publishedAt) >= cutoff)
          .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
        if (filtered.length) {
          groups.push({ label: `GITHUB — ${user}`, releases: filtered.slice(0, 50) });
        }
      }
      const count = groups.reduce((n, g) => n + (g.releases?.length ?? 0), 0);
      ghCaches[days] = {
        fetchedAt,
        users: GH_USERS,
        windowDays: days,
        count,
        currentWindow: ghWindow,
        availableWindows: WINDOWS,
        groups,
      };
    }
    console.log("github refresh: done");
  } catch {
    console.error("github refresh failed");
  } finally {
    ghReady = true;
    ghRefreshing = false;
  }
}
