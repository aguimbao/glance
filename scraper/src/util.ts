import { DAY_MS, WINDOWS, type WindowCache } from "./types.ts";

export { WINDOWS, DAY_MS };

export let psWindow: number = 0;
export let ghWindow: number = 0;

export function setPsWindow(days: number): void {
  psWindow = days;
}

export function setGhWindow(days: number): void {
  ghWindow = days;
}

export function isWindowDay(n: number): n is (typeof WINDOWS)[number] {
  return (WINDOWS as readonly number[]).includes(n);
}

export const REFRESH_MS = 3_600_000;

export function sod(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function cutoffFor(days: number, sodMs: number, nowMs: number): number {
  return days === 0 ? sodMs : nowMs - days * DAY_MS;
}

export function emptyCache(windowDays: number): WindowCache {
  return { fetchedAt: null, windowDays, count: 0, groups: [] };
}

export function csv(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function stripHtml(s: string, max: number): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
