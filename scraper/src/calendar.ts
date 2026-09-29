import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseICS } = require("node-ical") as {
  parseICS: (text: string) => Record<string, Record<string, unknown>>;
};

export type CalMode = "day" | "week" | "month" | "year";

export interface CalSource {
  group: string;
  name: string;
  url: string;
}

interface CalEvent {
  title: string;
  start: number;
  allDay: boolean;
  description: string;
  location: string;
  group: string;
  calName: string;
}

const CAL_GROUPS = ((): Record<string, Record<string, string>> => {
  try {
    return JSON.parse(process.env.CALENDARS ?? "{}") as Record<string, Record<string, string>>;
  } catch {
    console.error("CALENDARS env: invalid JSON");
    return {};
  }
})();

export const CAL_SOURCES: CalSource[] = [];
for (const [group, cals] of Object.entries(CAL_GROUPS)) {
  for (const [name, url] of Object.entries(cals)) CAL_SOURCES.push({ group, name, url });
}

export let calAllEvents: CalEvent[] = [];
export let calFetchedAt: string | null = null;
export let calMode: CalMode = "day";
export let calRef = new Date();
let calRefreshing = false;
export let calMenuYear = new Date().getFullYear();
export let calFilterOpen = false;
export let calSelected: Set<string> | null = null;
export let calReady = false;

export function setCalMode(mode: CalMode): void {
  calMode = mode;
  const now = new Date();
  if (mode === "week") {
    const dow = now.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    calRef = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diff);
  } else if (mode === "month") {
    calRef = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (mode === "year") {
    calRef = new Date(now.getFullYear(), 0, 1);
  } else {
    calRef = now;
  }
}

export function shiftCalRef(dir: 1 | -1): void {
  const d = new Date(calRef);
  if (calMode === "day") d.setDate(d.getDate() + dir);
  else if (calMode === "week") d.setDate(d.getDate() + 7 * dir);
  else if (calMode === "month") d.setMonth(d.getMonth() + dir);
  else d.setFullYear(d.getFullYear() + dir);
  calRef = d;
}

export function gotoCalRef(date: string): boolean {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  calRef = d;
  return true;
}

export function shiftMenuYear(dir: "prev" | "next" | null, step: number, year?: number): number {
  if (dir === "prev") calMenuYear -= step;
  else if (dir === "next") calMenuYear += step;
  else if (year) calMenuYear = year;
  return calMenuYear;
}

export function toggleCalFilter(name: string): void {
  calFilterOpen = true;
  const allNames = CAL_SOURCES.map((s) => s.name);
  if (calSelected === null) {
    calSelected = new Set(allNames);
    calSelected.delete(name);
  } else if (calSelected.has(name)) {
    calSelected.delete(name);
  } else {
    calSelected.add(name);
  }
  if (calSelected && calSelected.size === allNames.length) calSelected = null;
}

export function toggleCalFilterGroup(groupName: string): void {
  calFilterOpen = true;
  const allNames = CAL_SOURCES.map((s) => s.name);
  const groupCals = CAL_SOURCES.filter((s) => s.group === groupName).map((s) => s.name);
  if (calSelected === null) {
    calSelected = new Set(allNames);
    for (const c of groupCals) calSelected.delete(c);
  } else {
    const allOn = groupCals.every((c) => calSelected!.has(c));
    if (allOn) {
      for (const c of groupCals) calSelected.delete(c);
    } else {
      for (const c of groupCals) calSelected.add(c);
    }
  }
  if (calSelected && calSelected.size === allNames.length) calSelected = null;
}

export function toggleCalFilterAll(): void {
  calSelected = calSelected === null ? new Set<string>() : null;
  calFilterOpen = true;
}

export function toggleCalFilterOpen(): boolean {
  calFilterOpen = !calFilterOpen;
  return calFilterOpen;
}

export function monthWeeks(
  year: number,
  month: number,
): { label: string; date: string; inMonth: boolean }[] {
  const lastDay = new Date(year, month + 1, 0);
  const dow = new Date(year, month, 1).getDay();
  const daysToMonday = dow === 0 ? 6 : dow - 1;
  const weeks: { label: string; date: string; inMonth: boolean }[] = [];
  let monday = new Date(year, month, 1 - daysToMonday);
  while (monday <= lastDay) {
    const sunday = new Date(monday.getTime() + 6 * 86_400_000);
    const monLabel = monday.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const sunLabel = sunday.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    weeks.push({
      label: `${monLabel} – ${sunLabel}`,
      date: monday.toISOString().slice(0, 10),
      inMonth: monday.getMonth() === month || sunday.getMonth() === month,
    });
    monday = new Date(monday.getTime() + 7 * 86_400_000);
  }
  return weeks;
}

function calPeriod(): { start: Date; end: Date; label: string } {
  const d = new Date(calRef);
  if (calMode === "day") {
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const end = new Date(start.getTime() + 86_400_000 - 1);
    return {
      start,
      end,
      label: start.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      }),
    };
  }
  if (calMode === "week") {
    const dow = d.getDay();
    const diff = dow === 0 ? -6 : 1 - dow;
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
    const end = new Date(start.getTime() + 7 * 86_400_000 - 1);
    const sl = start.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const el = end.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return { start, end, label: `${sl} – ${el}` };
  }
  if (calMode === "month") {
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
    return {
      start,
      end,
      label: start.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    };
  }
  const start = new Date(d.getFullYear(), 0, 1);
  const end = new Date(d.getFullYear(), 11, 31, 23, 59, 59, 999);
  return { start, end, label: String(d.getFullYear()) };
}

function icalVal(v: unknown): string {
  if (typeof v === "object" && v !== null) return String((v as { val?: unknown }).val ?? "");
  return String(v ?? "");
}

export async function refreshCalendars(): Promise<void> {
  if (calRefreshing || !CAL_SOURCES.length) return;
  calRefreshing = true;
  try {
    const feeds = await Promise.allSettled(
      CAL_SOURCES.map(async (s) => {
        const r = await fetch(s.url, { signal: AbortSignal.timeout(15000) });
        if (!r.ok) throw new Error(`${s.name}: ${r.status}`);
        return { ...s, text: await r.text() };
      }),
    );
    const all: CalEvent[] = [];
    for (const [i, result] of feeds.entries()) {
      const s = CAL_SOURCES[i];
      if (result.status !== "fulfilled") {
        console.error("calendar fetch error");
        continue;
      }
      try {
        const parsed = parseICS(result.value.text);
        for (const ev of Object.values(parsed)) {
          if (ev.type !== "VEVENT" || !ev.start) continue;
          const rawStart = ev.start as Date | string | number;
          const start = rawStart instanceof Date ? rawStart : new Date(rawStart);
          if (Number.isNaN(start.getTime())) continue;
          const title = icalVal(ev.summary).trim();
          if (!title) continue;
          all.push({
            title,
            start: start.getTime(),
            allDay: ev.datetype === "date",
            description: icalVal(ev.description)
              .replace(/\\n/g, " ")
              .replace(/\s+/g, " ")
              .trim()
              .slice(0, 200),
            location: icalVal(ev.location).trim(),
            group: s.group,
            calName: s.name,
          });
        }
      } catch {
        console.error("calendar parse error");
      }
    }
    calAllEvents = all;
    calFetchedAt = new Date().toISOString();
    console.log("calendar refresh: done");
  } catch {
    console.error("calendar refresh failed");
  } finally {
    calReady = true;
    calRefreshing = false;
  }
}

function sodMs(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function calView(): Record<string, unknown> {
  const { start, end, label } = calPeriod();
  const inPeriod = calAllEvents.filter(
    (e) => e.start >= start.getTime() && e.start <= end.getTime(),
  );
  const filtered =
    calSelected === null ? inPeriod : inPeriod.filter((e) => calSelected!.has(e.calName));
  const base = sodMs();
  const byDay = new Map<string, CalEvent[]>();
  for (const e of filtered) {
    const d = new Date(e.start);
    const dk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const list = byDay.get(dk) ?? [];
    list.push(e);
    byDay.set(dk, list);
  }
  const dayGroups = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dk, evts]) => {
      const dayDate = new Date(`${dk}T00:00:00`);
      const d = Math.floor((dayDate.getTime() - base) / 86_400_000);
      return {
        dateLabel: dayDate.toLocaleDateString("en-US", {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
        daysLabel:
          d === 0
            ? "Today"
            : d === 1
              ? "Tomorrow"
              : d === -1
                ? "Yesterday"
                : d > 0
                  ? `in ${d}d`
                  : `${-d}d ago`,
        events: evts
          .sort((a, b) => {
            if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
            return a.start - b.start;
          })
          .map((e) => ({
            title: e.title,
            group: e.group,
            calendar: e.calName,
            timeLabel: e.allDay
              ? ""
              : new Date(e.start).toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                }),
            allDay: e.allDay,
            location: e.location,
          })),
      };
    });
  const count = dayGroups.reduce((n, g) => n + g.events.length, 0);

  const menuYear = calMenuYear;
  let menuYears: { year: string; date: string }[] = [];
  let menuRangeLabel = "";
  const menuMonths: {
    label: string;
    value: number;
    date: string;
    weeks: ReturnType<typeof monthWeeks> | null;
  }[] = [];
  if (calMode === "year") {
    const rs = Math.floor(menuYear / 20) * 20;
    menuRangeLabel = `${rs}–${rs + 20}`;
    menuYears = Array.from({ length: 20 }, (_, i) => {
      const y = rs + i;
      return { year: String(y), date: `${y}-01-01` };
    });
  }
  if (calMode !== "year") {
    const monthNames = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    for (let m = 0; m < 12; m++) {
      const mm = String(m + 1).padStart(2, "0");
      menuMonths.push({
        label: monthNames[m],
        value: m,
        date: `${menuYear}-${mm}-01`,
        weeks: calMode === "week" ? monthWeeks(menuYear, m) : null,
      });
    }
  }

  const now = new Date();
  const fmtD = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const dow = now.getDay();
  const wdiff = dow === 0 ? -6 : 1 - dow;
  const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + wdiff);
  const nextMonday = new Date(thisMonday.getTime() + 7 * 86_400_000);

  const filterGroups: {
    value: string;
    label: string;
    calendars: { value: string; label: string; selected: boolean }[];
    selected: boolean;
  }[] = [];
  const groupMap = new Map<
    string,
    {
      value: string;
      label: string;
      calendars: { value: string; label: string; selected: boolean }[];
      selected: boolean;
    }
  >();
  for (const s of CAL_SOURCES) {
    if (!groupMap.has(s.group)) {
      groupMap.set(s.group, { value: s.group, label: s.group, calendars: [], selected: true });
    }
    const sel = calSelected === null || calSelected.has(s.name);
    const g = groupMap.get(s.group)!;
    g.calendars.push({ value: s.name, label: s.name, selected: sel });
    if (!sel) g.selected = false;
  }
  for (const g of groupMap.values()) filterGroups.push(g);

  return {
    mode: calMode,
    periodLabel: label,
    periodDate: calRef.toISOString().slice(0, 10),
    fetchedAt: calFetchedAt,
    count,
    dayGroups,
    selectedAll: calSelected === null,
    filterOpen: calFilterOpen,
    filterGroups,
    menuYear,
    menuYears,
    menuRangeLabel,
    menuMonths,
    menuAutoMonth: calMenuYear === calRef.getFullYear() ? calRef.getMonth() : -1,
    selectedMonth: calRef.getMonth(),
    selectedYear: calRef.getFullYear(),
    qToday: fmtD(now),
    qTomorrow: fmtD(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)),
    qThisWeek: fmtD(thisMonday),
    qNextWeek: fmtD(nextMonday),
    qThisMonth: fmtD(new Date(now.getFullYear(), now.getMonth(), 1)),
    qNextMonth: fmtD(new Date(now.getFullYear(), now.getMonth() + 1, 1)),
    qThisYear: fmtD(new Date(now.getFullYear(), 0, 1)),
    qNextYear: fmtD(new Date(now.getFullYear() + 1, 0, 1)),
  };
}
