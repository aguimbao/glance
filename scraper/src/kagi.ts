export interface KagiStory {
  title: string;
  summary: string;
  url: string;
  sourceDomain: string;
  image: string | null;
  category: string;
}

interface KagiCache {
  fetchedAt: string;
  categoryName: string;
  count: number;
  stories: KagiStory[];
}

export let kagiBatch: string | null = null;
export const kagiCatMap = new Map<string, { uuid: string; name: string }>();
export const kagiCaches = new Map<string, KagiCache>();
export let kagiActive = "world";
export let kagiReady = false;

let kagiResolving = false;
const kagiFetching = new Set<string>();

export async function kagiResolve(): Promise<void> {
  if (kagiResolving) return;
  kagiResolving = true;
  try {
    const bRes = await fetch("https://news.kagi.com/api/batches/latest");
    if (!bRes.ok) throw new Error(`batches/latest ${bRes.status}`);
    kagiBatch = ((await bRes.json()) as { id: string }).id;
    const cRes = await fetch("https://news.kagi.com/api/batches/latest/categories");
    if (!cRes.ok) throw new Error(`categories ${cRes.status}`);
    const cats =
      (
        (await cRes.json()) as {
          categories?: { categoryId: string; id: string; categoryName: string }[];
        }
      ).categories ?? [];
    for (const c of cats) kagiCatMap.set(c.categoryId, { uuid: c.id, name: c.categoryName });
    kagiReady = true;
    console.log("kagi resolve: done");
  } catch {
    console.error("kagi resolve failed");
    kagiReady = true;
  } finally {
    kagiResolving = false;
  }
}

async function kagiFetchOne(
  slug: string,
): Promise<{ stories: KagiStory[]; categoryName: string } | null> {
  const meta = kagiCatMap.get(slug);
  if (!meta || !kagiBatch) return null;
  const r = await fetch(
    `https://news.kagi.com/api/batches/${kagiBatch}/categories/${meta.uuid}/stories`,
  );
  if (!r.ok) {
    if (r.status === 404) return { stories: [], categoryName: meta.name };
    throw new Error(`kagi ${slug} ${r.status}`);
  }
  const j = (await r.json()) as {
    stories?: {
      title: string;
      short_summary?: string;
      articles?: { link?: string; domain?: string }[];
      domains?: string[];
      primary_image?: { url?: string };
      category: string;
    }[];
  };
  const stories = (j.stories ?? []).slice(0, 30).map((s) => ({
    title: s.title,
    summary: (s.short_summary ?? "").replace(/\s+/g, " ").trim().slice(0, 240),
    url: s.articles?.[0]?.link ?? "",
    sourceDomain: s.articles?.[0]?.domain ?? (s.domains ?? [])[0] ?? "",
    image: s.primary_image?.url ?? null,
    category: s.category,
  }));
  return { stories, categoryName: meta.name };
}

export async function kagiEnsure(): Promise<void> {
  if (!kagiBatch) await kagiResolve();
  if (!kagiBatch || !kagiActive) return;
  const slug = kagiActive;
  if (kagiCaches.has(slug) || kagiFetching.has(slug)) return;
  kagiFetching.add(slug);
  try {
    const r = await kagiFetchOne(slug);
    if (r) {
      kagiCaches.set(slug, {
        fetchedAt: new Date().toISOString(),
        categoryName: r.categoryName,
        count: r.stories.length,
        stories: r.stories,
      });
    }
  } catch {
    console.error("kagi fetch failed");
  } finally {
    kagiFetching.delete(slug);
  }
}

export function kagiSelect(slug: string): boolean {
  if (!kagiCatMap.has(slug)) return false;
  kagiActive = slug;
  return true;
}

export async function kagiRefreshActive(): Promise<string | null> {
  if (!kagiBatch) await kagiResolve();
  if (!kagiActive) return null;
  kagiCaches.delete(kagiActive);
  kagiFetching.delete(kagiActive);
  const cat = kagiActive;
  void kagiEnsure();
  return cat;
}

export function kagiReset(): void {
  kagiCaches.clear();
  kagiBatch = null;
  kagiReady = false;
}
