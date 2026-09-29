export const WINDOWS = [0, 1, 7, 30, 365] as const;
export type WindowDay = (typeof WINDOWS)[number];

export interface Release {
  title: string;
  appId: string;
  icon: string;
  url: string;
  developer: string;
  releasedAt: string;
  id?: string | number;
}

export interface DeveloperGroup {
  label: string;
  releases: Release[];
}

export interface StoreGroup {
  label: string;
  developers?: DeveloperGroup[];
  releases?: VersionEntry[];
}

export interface VersionEntry {
  repo: string;
  tagName: string;
  name?: string;
  publishedAt: string;
  description: string;
  url: string;
  icon?: string;
  developer?: string;
  appId?: string;
  owner?: string;
  repoUrl?: string;
}

export interface WindowCache {
  fetchedAt: string | null;
  windowDays: number;
  count: number;
  currentWindow?: number;
  availableWindows?: readonly number[];
  groups: StoreGroup[];
  users?: string[];
}

export const DAY_MS = 86_400_000;
