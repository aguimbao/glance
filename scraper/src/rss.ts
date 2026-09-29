import { XMLParser } from "fast-xml-parser";

export interface RssItem {
  title: string;
  link: string;
  publishedAt: number;
  publishedISO: string;
  feedName: string;
  tags: string[];
}

const RSS_SOURCES: { name: string; url: string }[] = ((): { name: string; url: string }[] => {
  try {
    return Object.entries(JSON.parse(process.env.RSS_FEEDS ?? "{}") as Record<string, string>).map(
      ([name, url]) => ({ name, url }),
    );
  } catch {
    console.error("RSS_FEEDS env: invalid JSON");
    return [];
  }
})();

export { RSS_SOURCES };

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  processEntities: { maxTotalExpansions: Infinity } as never,
});

function asArr<T>(x: T | T[] | undefined): T[] {
  if (x === undefined) return [];
  return Array.isArray(x) ? x : [x];
}

export let rssItems: RssItem[] = [];
export let rssFetchedAt: string | null = null;
let rssRefreshing = false;
export let rssFilterOpen = false;
export let rssSelectedFeeds: Set<string> | null = null;
export let rssSelectedTags: Set<string> | null = null;
export let rssIncludeUntagged = true;
export let rssReady = false;

export function rssAllTags(): string[] {
  const counts = new Map<string, number>();
  for (const it of rssItems) for (const t of it.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name]) => name);
}

function rssParseItems(text: string, feedName: string): RssItem[] {
  let root: any;
  try {
    root = xml.parse(text);
  } catch {
    return [];
  }
  const ch = root?.rss?.channel ?? root?.feed ?? {};
  const out: RssItem[] = [];
  for (const raw of asArr<any>(ch.item ?? ch.entry ?? [])) {
    let link = "";
    if (typeof raw.link === "string") {
      link = raw.link;
    } else if (raw.link) {
      const links = asArr(raw.link);
      const alt = links.find((l: any) => !l["@_rel"] || l["@_rel"] === "alternate") ?? links[0];
      link = typeof alt === "string" ? alt : (alt?.["@_href"] ?? alt?.["#text"] ?? "");
    } else if (raw.guid) {
      link = typeof raw.guid === "string" ? raw.guid : (raw.guid?.["#text"] ?? "");
    }
    const title = String(raw.title ?? "").trim();
    if (!title && !link) continue;
    const rawDate = raw.pubDate ?? raw.published ?? raw.updated ?? raw["dc:date"] ?? raw.date;
    const ts = rawDate ? Date.parse(String(rawDate)) : NaN;
    const ts2 = Number.isNaN(ts) ? Date.now() : ts;
    const tags = new Set<string>();
    for (const c of asArr(raw.category)) {
      const t = typeof c === "string" ? c : (c?.["@_term"] ?? c?.["#text"] ?? "");
      const tag = String(t).trim();
      if (tag) tags.add(tag);
    }
    out.push({
      title,
      link,
      publishedAt: ts2,
      publishedISO: new Date(ts2).toISOString(),
      feedName,
      tags: [...tags],
    });
  }
  return out;
}

export async function refreshRss(): Promise<void> {
  if (rssRefreshing || !RSS_SOURCES.length) {
    rssReady = true;
    return;
  }
  rssRefreshing = true;
  try {
    const results = await Promise.allSettled(
      RSS_SOURCES.map(async (s) => {
        const r = await fetch(s.url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; Glance)" },
          signal: AbortSignal.timeout(15000),
        });
        if (!r.ok) throw new Error(`${s.name}: ${r.status}`);
        return { name: s.name, text: await r.text() };
      }),
    );
    const all: RssItem[] = [];
    for (const [i, result] of results.entries()) {
      const s = RSS_SOURCES[i];
      if (result.status !== "fulfilled") {
        console.error("rss fetch error");
        continue;
      }
      const items = rssParseItems(result.value.text, s.name);
      if (!items.length) console.error("rss parse error");
      all.push(...items);
    }
    all.sort((a, b) => b.publishedAt - a.publishedAt);
    rssItems = all;
    rssFetchedAt = new Date().toISOString();
    const presentTags = new Set(all.flatMap((it) => it.tags));
    if (rssSelectedTags) {
      for (const t of rssSelectedTags) if (!presentTags.has(t)) rssSelectedTags.delete(t);
    }
    const presentFeeds = new Set(RSS_SOURCES.map((s) => s.name));
    if (rssSelectedFeeds) {
      for (const f of rssSelectedFeeds) if (!presentFeeds.has(f)) rssSelectedFeeds.delete(f);
    }
    console.log("rss refresh: done");
  } catch {
    console.error("rss refresh failed");
  } finally {
    rssReady = true;
    rssRefreshing = false;
  }
}

export function rssToggleFeed(name: string): void {
  rssFilterOpen = true;
  if (rssSelectedFeeds === null) {
    rssSelectedFeeds = new Set(RSS_SOURCES.map((s) => s.name));
    rssSelectedFeeds.delete(name);
  } else if (rssSelectedFeeds.has(name)) {
    rssSelectedFeeds.delete(name);
  } else {
    rssSelectedFeeds.add(name);
    if (rssSelectedFeeds.size === RSS_SOURCES.length) rssSelectedFeeds = null;
  }
}

export function rssToggleTag(name: string): void {
  rssFilterOpen = true;
  if (rssSelectedTags === null) {
    rssSelectedTags = new Set(rssAllTags());
    rssSelectedTags.delete(name);
  } else if (rssSelectedTags.has(name)) {
    rssSelectedTags.delete(name);
  } else {
    rssSelectedTags.add(name);
    if (rssSelectedTags.size === rssAllTags().length) rssSelectedTags = null;
  }
}

export function rssToggleAll(): void {
  rssFilterOpen = true;
  const feedsAll = rssSelectedFeeds === null || rssSelectedFeeds.size === RSS_SOURCES.length;
  const tagsAll = rssSelectedTags === null || rssSelectedTags.size === rssAllTags().length;
  if (feedsAll && tagsAll && rssIncludeUntagged) {
    rssSelectedFeeds = new Set();
    rssSelectedTags = new Set();
    rssIncludeUntagged = false;
  } else {
    rssSelectedFeeds = null;
    rssSelectedTags = null;
    rssIncludeUntagged = true;
  }
}

export function rssToggleOpen(): boolean {
  rssFilterOpen = !rssFilterOpen;
  return rssFilterOpen;
}

export function rssToggleUntagged(): boolean {
  rssFilterOpen = true;
  rssIncludeUntagged = !rssIncludeUntagged;
  return rssIncludeUntagged;
}

export function rssView(): Record<string, unknown> {
  let filtered = rssItems;
  if (rssSelectedFeeds !== null)
    filtered = filtered.filter((i) => rssSelectedFeeds!.has(i.feedName));
  if (!rssIncludeUntagged) filtered = filtered.filter((i) => i.tags.length > 0);
  if (rssSelectedTags !== null) {
    filtered = filtered.filter(
      (i) => i.tags.length === 0 || [...rssSelectedTags!].some((t) => i.tags.includes(t)),
    );
  }
  const items = filtered.slice(0, 50).map((i) => ({
    title: i.title,
    link: i.link,
    publishedAt: i.publishedISO,
    feedName: i.feedName,
    tagsLabel: i.tags.join(", "),
  }));
  const tags = rssAllTags();
  return {
    fetchedAt: rssFetchedAt,
    count: items.length,
    items,
    filterOpen: rssFilterOpen,
    includeUntagged: rssIncludeUntagged,
    selectedAll:
      (rssSelectedFeeds === null || rssSelectedFeeds.size === RSS_SOURCES.length) &&
      (rssSelectedTags === null || rssSelectedTags.size === tags.length) &&
      rssIncludeUntagged,
    feeds: RSS_SOURCES.map((s) => ({
      name: s.name,
      selected: rssSelectedFeeds === null || rssSelectedFeeds.has(s.name),
    })),
    tags: tags.map((t) => ({
      name: t,
      selected: rssSelectedTags === null || rssSelectedTags.has(t),
    })),
  };
}
