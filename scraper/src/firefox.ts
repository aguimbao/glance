import {
  ghWindow,
  psWindow,
  WINDOWS,
  cutoffFor,
  csv,
  emptyCache,
  sleep,
  sod,
  stripHtml,
} from "./util.ts";
import type { Release, WindowCache } from "./types.ts";

export const FX_DEV_IDS = csv("FIREFOX_DEV_IDS");
export const FX_APP_IDS = csv("FIREFOX_APP_IDS");

const UA = { "User-Agent": "glance-changelog" };

function fxPick(m: unknown): string {
  if (m == null) return "";
  if (typeof m === "string") return m;
  const rec = m as Record<string, string>;
  return rec["en-US"] ?? Object.values(rec)[0] ?? "";
}

export const fxDevCaches: Record<number, WindowCache> = Object.fromEntries(
  WINDOWS.map((d) => [d, emptyCache(d)]),
);
export const fxAppsCaches: Record<number, WindowCache> = Object.fromEntries(
  WINDOWS.map((d) => [d, emptyCache(d)]),
);

let fxDevRefreshing = false;
let fxAppsRefreshing = false;
export let fxDevReady = false;
export let fxAppsReady = false;

interface AmoAuthor {
  name?: string;
}

interface AmoAddon {
  id: number | string;
  slug: string;
  name: unknown;
  icon_url: string;
  url: string;
  created: string;
  authors?: AmoAuthor[];
  current_version?: {
    version?: string;
    release_notes?: unknown;
    file?: { created?: string };
  };
}

async function fxDetail(id: string): Promise<AmoAddon> {
  const r = await fetch(`https://addons.mozilla.org/api/v5/addons/addon/${id}/`, { headers: UA });
  if (!r.ok) throw new Error(`AMO ${id} ${r.status}`);
  return (await r.json()) as AmoAddon;
}

async function fxAuthor(author: string): Promise<AmoAddon[]> {
  const out: AmoAddon[] = [];
  let url: string | null =
    `https://addons.mozilla.org/api/v5/addons/search/?author=${encodeURIComponent(author)}&page_size=50`;
  while (url) {
    const r = await fetch(url, { headers: UA });
    if (!r.ok) throw new Error(`AMO search ${author} ${r.status}`);
    const j = (await r.json()) as { results?: AmoAddon[]; next?: string | null };
    out.push(...(j.results ?? []));
    url = j.next ?? null;
  }
  return out;
}

export async function refreshFirefoxDev(): Promise<void> {
  if (fxDevRefreshing || !FX_DEV_IDS.length) return;
  fxDevRefreshing = true;
  try {
    const sodMs = sod().getTime();
    const nowMs = Date.now();
    const maxCutoff = nowMs - 365 * 86_400_000;

    const byAuthor = new Map<string, Release[]>();
    for (const author of FX_DEV_IDS) {
      for (const a of await fxAuthor(author)) {
        const ts = Date.parse(a.created);
        if (Number.isNaN(ts) || ts < maxCutoff) continue;
        let rels = byAuthor.get(author);
        if (!rels) {
          rels = [];
          byAuthor.set(author, rels);
        }
        if (rels.some((r) => r.id === a.id)) continue;
        rels.push({
          title: fxPick(a.name),
          appId: a.slug,
          icon: a.icon_url,
          url: a.url,
          developer: a.authors?.[0]?.name ?? author,
          releasedAt: new Date(ts).toISOString(),
          id: a.id,
        });
      }
      await sleep(200);
    }

    const fetchedAt = new Date().toISOString();
    for (const days of WINDOWS) {
      const cutoff = cutoffFor(days, sodMs, nowMs);
      const developers = [...byAuthor.entries()].map(([label, rels]) => ({
        label,
        releases: rels
          .filter((r) => Date.parse(r.releasedAt) >= cutoff)
          .sort((x, y) => Date.parse(y.releasedAt) - Date.parse(x.releasedAt)),
      }));
      const count = developers.reduce((n, d) => n + d.releases.length, 0);
      fxDevCaches[days] = {
        fetchedAt,
        windowDays: days,
        count,
        currentWindow: psWindow,
        availableWindows: WINDOWS,
        groups: count ? [{ label: "Firefox AMO", developers }] : [],
      };
    }
    console.log("firefox dev refresh: done");
  } catch {
    console.error("firefox dev refresh failed");
  } finally {
    fxDevReady = true;
    fxDevRefreshing = false;
  }
}

export async function refreshFirefoxApps(): Promise<void> {
  if (fxAppsRefreshing || !FX_APP_IDS.length) return;
  fxAppsRefreshing = true;
  try {
    const sodMs = sod().getTime();
    const nowMs = Date.now();
    const maxCutoff = nowMs - 365 * 86_400_000;

    const allEntries: NonNullable<WindowCache["groups"][number]["releases"]> = [];
    for (const id of FX_APP_IDS) {
      try {
        const a = await fxDetail(id);
        const ts = Date.parse(a.current_version?.file?.created ?? "");
        if (!ts || ts < maxCutoff) continue;
        allEntries.push({
          repo: fxPick(a.name),
          tagName: a.current_version?.version ?? "",
          publishedAt: new Date(ts).toISOString(),
          description: stripHtml(fxPick(a.current_version?.release_notes), 280),
          url: a.url,
          icon: a.icon_url,
          developer: a.authors?.[0]?.name ?? "",
          appId: a.slug,
        });
      } catch {
        console.error("firefox app fetch error");
      }
      await sleep(200);
    }

    const fetchedAt = new Date().toISOString();
    for (const days of WINDOWS) {
      const cutoff = cutoffFor(days, sodMs, nowMs);
      const entries = allEntries
        .filter((e) => Date.parse(e.publishedAt) >= cutoff)
        .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
      fxAppsCaches[days] = {
        fetchedAt,
        windowDays: days,
        count: entries.length,
        currentWindow: ghWindow,
        availableWindows: WINDOWS,
        groups: entries.length
          ? [{ label: "Firefox AMO Apps", releases: entries.slice(0, 50) }]
          : [],
      };
    }
    console.log("firefox apps refresh: done");
  } catch {
    console.error("firefox apps refresh failed");
  } finally {
    fxAppsReady = true;
    fxAppsRefreshing = false;
  }
}
