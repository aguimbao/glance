import gplay from "google-play-scraper";
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
import type { Release, VersionEntry, WindowCache } from "./types.ts";

export const DEVIDS = csv("PLAYSTORE_DEV_IDS");
export const APP_IDS = csv("PLAYSTORE_APP_IDS");
const THROTTLE = 5;

const MONTHS: Record<string, number> = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};

export function parseReleased(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = /^([A-Z][a-z]{2})\s+(\d{1,2}),\s+(\d{4})$/.exec(s);
  if (!m) return null;
  const mo = MONTHS[m[1]];
  return mo === undefined ? null : Date.UTC(+m[3], mo, +m[2]);
}

export const psCaches: Record<number, WindowCache> = Object.fromEntries(
  WINDOWS.map((d) => [d, emptyCache(d)]),
);
export const psAppsCaches: Record<number, WindowCache> = Object.fromEntries(
  WINDOWS.map((d) => [d, emptyCache(d)]),
);

let psRefreshing = false;
let psAppsRefreshing = false;
export let psReady = false;
export let psAppsReady = false;

interface GplayApp {
  title: string;
  appId: string;
  icon: string;
  url: string;
  developer: string;
  released?: string;
  version?: string;
  updated?: number | string;
  recentChanges?: string;
}

export async function refreshPlayStore(): Promise<void> {
  if (psRefreshing || !DEVIDS.length) return;
  psRefreshing = true;
  try {
    const sodMs = sod().getTime();
    const nowMs = Date.now();
    const maxCutoff = nowMs - 365 * 86_400_000;

    const allReleases: Release[] = [];
    for (const devId of DEVIDS) {
      const apps = (await (gplay.developer as any)({
        devId,
        fullDetail: true,
        throttle: THROTTLE,
        num: 60,
      })) as GplayApp[];
      for (const a of apps) {
        const ts = parseReleased(a.released);
        if (ts === null || ts < maxCutoff) continue;
        if (allReleases.some((r) => r.appId === a.appId)) continue;
        allReleases.push({
          title: a.title,
          appId: a.appId,
          icon: a.icon,
          url: a.url,
          developer: a.developer,
          releasedAt: new Date(ts).toISOString(),
        });
      }
    }

    const fetchedAt = new Date().toISOString();
    for (const days of WINDOWS) {
      const cutoff = cutoffFor(days, sodMs, nowMs);
      const byDev = new Map<string, Release[]>();
      for (const r of allReleases) {
        if (Date.parse(r.releasedAt) < cutoff) continue;
        let list = byDev.get(r.developer);
        if (!list) {
          list = [];
          byDev.set(r.developer, list);
        }
        list.push(r);
      }
      const developers = [...byDev.entries()].map(([label, rels]) => ({
        label,
        releases: rels.sort((x, y) => Date.parse(y.releasedAt) - Date.parse(x.releasedAt)),
      }));
      const count = developers.reduce((n, d) => n + d.releases.length, 0);
      psCaches[days] = {
        fetchedAt,
        windowDays: days,
        count,
        currentWindow: psWindow,
        availableWindows: WINDOWS,
        groups: count ? [{ label: "Play Store", developers }] : [],
      };
    }
    console.log("play-store refresh: done");
  } catch {
    console.error("play-store refresh failed");
  } finally {
    psReady = true;
    psRefreshing = false;
  }
}

async function fetchAppVersion(appId: string): Promise<VersionEntry | null> {
  const a = (await (gplay.app as any)({ appId, lang: "en", country: "us" })) as GplayApp;
  const updated = typeof a.updated === "number" ? a.updated : null;
  if (updated === null) return null;
  return {
    repo: a.title,
    tagName: a.version ?? "",
    publishedAt: new Date(updated).toISOString(),
    description: stripHtml(a.recentChanges ?? "", 280),
    url: a.url,
    icon: a.icon,
    developer: a.developer,
    appId: a.appId,
  };
}

export async function refreshPlayStoreApps(): Promise<void> {
  if (psAppsRefreshing || !APP_IDS.length) return;
  psAppsRefreshing = true;
  try {
    const sodMs = sod().getTime();
    const nowMs = Date.now();
    const maxCutoff = nowMs - 365 * 86_400_000;

    const allEntries: VersionEntry[] = [];
    for (const appId of APP_IDS) {
      try {
        const e = await fetchAppVersion(appId);
        if (e && Date.parse(e.publishedAt) >= maxCutoff) allEntries.push(e);
      } catch {
        console.error("play-store app fetch error");
      }
      await sleep(200);
    }

    const fetchedAt = new Date().toISOString();
    for (const days of WINDOWS) {
      const cutoff = cutoffFor(days, sodMs, nowMs);
      const entries = allEntries
        .filter((e) => Date.parse(e.publishedAt) >= cutoff)
        .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
      psAppsCaches[days] = {
        fetchedAt,
        windowDays: days,
        count: entries.length,
        currentWindow: ghWindow,
        availableWindows: WINDOWS,
        groups: entries.length
          ? [{ label: "Play Store Apps", releases: entries.slice(0, 50) }]
          : [],
      };
    }
    console.log("play-store apps refresh: done");
  } catch {
    console.error("play-store apps refresh failed");
  } finally {
    psAppsReady = true;
    psAppsRefreshing = false;
  }
}
