import express, { type Request, type Response } from "express";
import gplay from "google-play-scraper";
import {
  APP_IDS,
  DEVIDS,
  psAppsCaches,
  psCaches,
  psAppsReady,
  psReady,
  refreshPlayStore,
  refreshPlayStoreApps,
} from "./playstore.ts";
import {
  FX_APP_IDS,
  FX_DEV_IDS,
  fxAppsCaches,
  fxAppsReady,
  fxDevCaches,
  fxDevReady,
  refreshFirefoxApps,
  refreshFirefoxDev,
} from "./firefox.ts";
import { GH_USERS, ghCaches, ghReady, refreshGithub } from "./github.ts";
import {
  CAL_SOURCES,
  calReady,
  calView,
  gotoCalRef,
  refreshCalendars,
  setCalMode,
  shiftCalRef,
  shiftMenuYear,
  toggleCalFilter,
  toggleCalFilterAll,
  toggleCalFilterGroup,
  toggleCalFilterOpen,
  type CalMode,
} from "./calendar.ts";
import {
  RSS_SOURCES,
  rssReady,
  rssToggleAll,
  rssToggleFeed,
  rssToggleOpen,
  rssToggleTag,
  rssToggleUntagged,
  rssView,
  refreshRss,
} from "./rss.ts";
import {
  kagiActive,
  kagiBatch,
  kagiCaches,
  kagiCatMap,
  kagiEnsure,
  kagiReady,
  kagiRefreshActive,
  kagiReset,
  kagiResolve,
  kagiSelect,
} from "./kagi.ts";
import {
  REFRESH_MS,
  WINDOWS,
  emptyCache,
  ghWindow,
  isWindowDay,
  psWindow,
  setGhWindow,
  setPsWindow,
} from "./util.ts";

const app = express();

const handle =
  (fn: (req: Request) => Promise<unknown>) =>
  async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await fn(req));
    } catch (e) {
      res.status(500).json({ error: String(e) });
    }
  };

const q = (req: Request, key: string, fallback = ""): string => {
  const v = req.query[key];
  return typeof v === "string" ? v : fallback;
};

app.get(
  "/app",
  handle((req) =>
    (gplay.app as any)({
      appId: q(req, "appId"),
      lang: q(req, "lang", "en"),
      country: q(req, "country", "us"),
    }),
  ),
);
app.get(
  "/search",
  handle((req) =>
    (gplay.search as any)({
      term: q(req, "term"),
      num: Number(q(req, "num", "10")),
      lang: q(req, "lang", "en"),
      country: q(req, "country", "us"),
      price: q(req, "price", "all"),
    }),
  ),
);
app.get(
  "/reviews",
  handle((req) =>
    (gplay.reviews as any)({
      appId: q(req, "appId"),
      lang: q(req, "lang", "en"),
      country: q(req, "country", "us"),
      sort: req.query.sort
        ? (gplay as any).sort[req.query.sort as string]
        : (gplay as any).sort.NEWEST,
      num: Number(q(req, "num", "5")),
    }),
  ),
);

const ready = (): boolean =>
  (DEVIDS.length ? psReady : true) &&
  (APP_IDS.length ? psAppsReady : true) &&
  (GH_USERS.length ? ghReady : true) &&
  (FX_DEV_IDS.length ? fxDevReady : true) &&
  (FX_APP_IDS.length ? fxAppsReady : true) &&
  (CAL_SOURCES.length ? calReady : true) &&
  (RSS_SOURCES.length ? rssReady : true) &&
  (kagiBatch || kagiCatMap.size ? kagiReady : true);

const CORS = { "Access-Control-Allow-Origin": "*" };
for (const p of [
  "/window",
  "/refreshnow",
  "/calendar/select",
  "/calendar/prev",
  "/calendar/next",
  "/calendar/goto",
  "/calendar/menu-year",
  "/calendar/filter",
  "/calendar/filter-group",
  "/calendar/filter-all",
  "/calendar/filter-toggle",
  "/rss/filter-feed",
  "/rss/filter-tag",
  "/rss/filter-all",
  "/rss/filter-toggle",
  "/rss/filter-untagged",
]) {
  app.options(p, (_req, res) => res.set(CORS).end());
}

app.get("/releases", (_req, res) => {
  const w = psWindow;
  const ps = psCaches[w] ?? emptyCache(w);
  const fx = fxDevCaches[w] ?? emptyCache(w);
  const groups = [...(ps.groups ?? []), ...(fx.groups ?? [])];
  const count = groups.reduce(
    (n, g) => n + (g.developers ?? []).reduce((m, d) => m + d.releases.length, 0),
    0,
  );
  const fetched = [ps.fetchedAt, fx.fetchedAt].filter(Boolean).sort().pop();
  res.json({
    fetchedAt: fetched,
    windowDays: w,
    currentWindow: w,
    availableWindows: WINDOWS,
    count,
    groups,
  });
});

app.get("/calendar/select", (req, res) => {
  const mode = q(req, "mode");
  if (!["day", "week", "month", "year"].includes(mode))
    return res.status(400).set(CORS).json({ error: "bad mode" });
  setCalMode(mode as CalMode);
  res.set(CORS).json({ ok: true, mode });
});
app.get("/calendar/prev", (_req, res) => {
  shiftCalRef(-1);
  res.set(CORS).json({ ok: true });
});
app.get("/calendar/next", (_req, res) => {
  shiftCalRef(1);
  res.set(CORS).json({ ok: true });
});
app.get("/calendar/goto", (req, res) => {
  if (!gotoCalRef(q(req, "date"))) return res.status(400).set(CORS).json({ error: "bad date" });
  res.set(CORS).json({ ok: true, date: q(req, "date") });
});
app.get("/calendar/menu-year", (req, res) => {
  const step = Number(q(req, "step", "1")) || 1;
  const dir = q(req, "dir");
  const year = dir === "prev" || dir === "next" ? undefined : Number(q(req, "year")) || undefined;
  const y = shiftMenuYear(dir === "prev" ? "prev" : dir === "next" ? "next" : null, step, year);
  res.set(CORS).json({ ok: true, year: y });
});
app.get("/calendar/filter", (req, res) => {
  toggleCalFilter(q(req, "value"));
  res.set(CORS).json({ ok: true });
});
app.get("/calendar/filter-group", (req, res) => {
  toggleCalFilterGroup(q(req, "value"));
  res.set(CORS).json({ ok: true });
});
app.get("/calendar/filter-all", (_req, res) => {
  toggleCalFilterAll();
  res.set(CORS).json({ ok: true });
});
app.get("/calendar/filter-toggle", (_req, res) => {
  const open = toggleCalFilterOpen();
  res.set(CORS).json({ ok: true, open });
});
app.get("/calendar", (_req, res) => {
  res.json(calView());
});

app.get("/rss/filter-feed", (req, res) => {
  rssToggleFeed(q(req, "value"));
  res.set(CORS).json({ ok: true });
});
app.get("/rss/filter-tag", (req, res) => {
  rssToggleTag(q(req, "value"));
  res.set(CORS).json({ ok: true });
});
app.get("/rss/filter-all", (_req, res) => {
  rssToggleAll();
  res.set(CORS).json({ ok: true });
});
app.get("/rss/filter-toggle", (_req, res) => {
  const open = rssToggleOpen();
  res.set(CORS).json({ ok: true, open });
});
app.get("/rss/filter-untagged", (_req, res) => {
  rssToggleUntagged();
  res.set(CORS).json({ ok: true });
});
app.get("/rss", (_req, res) => {
  res.json(rssView());
});

app.get("/kagi/select", (req, res) => {
  const cat = q(req, "cat");
  if (!kagiSelect(cat)) return res.status(400).set(CORS).json({ error: "bad cat" });
  res.set(CORS).json({ ok: true, cat });
});
app.get("/kagi/refresh", async (_req, res) => {
  const cat = await kagiRefreshActive();
  if (!cat) return res.set(CORS).json({ ok: false, error: "no active category" });
  res.set(CORS).json({ ok: true, cat });
});
app.get("/kagi", async (_req, res) => {
  if (!kagiBatch) await kagiResolve();
  await kagiEnsure();
  const slug = kagiActive;
  const c = slug ? kagiCaches.get(slug) : null;
  res.json({
    fetchedAt: c?.fetchedAt ?? null,
    categories: [...kagiCatMap.entries()]
      .map(([s, m]) => ({ slug: s, name: m.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    activeCategory: slug,
    categoryName: c?.categoryName ?? null,
    count: c?.count ?? 0,
    stories: c?.stories ?? [],
  });
});

app.get("/changelog", (_req, res) => {
  const w = ghWindow;
  const gh = ghCaches[w] ?? emptyCache(w);
  const pa = psAppsCaches[w] ?? emptyCache(w);
  const fx = fxAppsCaches[w] ?? emptyCache(w);
  const fetched = [gh.fetchedAt, pa.fetchedAt, fx.fetchedAt].filter(Boolean).sort().pop();
  res.json({
    fetchedAt: fetched,
    users: GH_USERS,
    appIds: APP_IDS,
    windowDays: w,
    currentWindow: w,
    availableWindows: WINDOWS,
    count: (gh.count ?? 0) + (pa.count ?? 0) + (fx.count ?? 0),
    groups: [...(gh.groups ?? []), ...(pa.groups ?? []), ...(fx.groups ?? [])],
  });
});

app.get("/window", (req, res) => {
  const days = Number(q(req, "days"));
  if (!isWindowDay(days)) return res.status(400).set(CORS).json({ error: "bad days" });
  if (q(req, "source") === "gh") {
    setGhWindow(days);
    for (const d of WINDOWS) {
      if (ghCaches[d]) ghCaches[d].currentWindow = days;
      if (psAppsCaches[d]) psAppsCaches[d].currentWindow = days;
      if (fxAppsCaches[d]) fxAppsCaches[d].currentWindow = days;
    }
  } else {
    setPsWindow(days);
    for (const d of WINDOWS) {
      if (psCaches[d]) psCaches[d].currentWindow = days;
      if (fxDevCaches[d]) fxDevCaches[d].currentWindow = days;
    }
  }
  res.set(CORS).json({ ok: true, source: q(req, "source"), days });
});

app.get("/refreshnow", (_req, res) => {
  res.set(CORS).json({ ok: true });
  void refreshPlayStore();
  void refreshPlayStoreApps();
  void refreshGithub();
  void refreshCalendars();
  void refreshRss();
  void refreshFirefoxDev();
  void refreshFirefoxApps();
  kagiReset();
  void kagiResolve();
});

app.get("/healthz", (_req, res) => (ready() ? res.end() : res.status(503).end()));

void refreshPlayStore();
void refreshPlayStoreApps();
void refreshGithub();
void refreshCalendars();
void refreshRss();
void kagiResolve();
void refreshFirefoxDev();
void refreshFirefoxApps();

if (REFRESH_MS > 0) {
  setInterval(() => void refreshPlayStore(), REFRESH_MS);
  setInterval(() => void refreshPlayStoreApps(), REFRESH_MS);
  setInterval(() => void refreshGithub(), REFRESH_MS);
  setInterval(() => void refreshCalendars(), REFRESH_MS);
  setInterval(() => void refreshRss(), REFRESH_MS);
  setInterval(() => void refreshFirefoxDev(), REFRESH_MS);
  setInterval(() => void refreshFirefoxApps(), REFRESH_MS);
  setInterval(() => {
    kagiReset();
    void kagiResolve();
  }, REFRESH_MS);
}

const port = process.env.PORT ?? 3000;
app.listen(port, () => console.log(`scrapper on :${port}`));
