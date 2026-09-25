import { create } from "zustand";

/**
 * Match Day v2 (`match-day-v2/02-implementation-spec.md` §3, critique D6): the full-time "From this
 * game · your list" items, handed to the Dashboard when the coach presses Continue so they show up in
 * the Record Watch feed there. Only the most recent game's items are kept — they're a "since your last
 * match" digest, not a history. Persisted to localStorage (wrapped in try/catch, like every other
 * browser-storage use in this app) so a reload between Continue and reading the Dashboard doesn't lose
 * them; nothing else depends on them surviving, so they're not part of the IndexedDB save.
 */

export type MatchStoryTag = "MILESTONE" | "CAREER BEST" | "DEVELOPMENT" | "WATCHLIST" | "INJURY";

export interface MatchStory {
  tag: MatchStoryTag;
  playerId: number;
  text: string;
  sub: string;
}

export interface MatchStoryDigest {
  /** e.g. "Melbourne 31 – 32 Collingwood". */
  matchLabel: string;
  stories: MatchStory[];
  at: number;
}

const KEY = "afs-match-stories-v1";

function load(): MatchStoryDigest | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as MatchStoryDigest) : null;
  } catch {
    return null;
  }
}

interface MatchStoryState {
  latest: MatchStoryDigest | null;
  publish: (digest: MatchStoryDigest) => void;
  clear: () => void;
}

export const useMatchStoryStore = create<MatchStoryState>((set) => ({
  latest: load(),
  publish: (digest) => {
    try {
      localStorage.setItem(KEY, JSON.stringify(digest));
    } catch {
      // Storage unavailable (private window etc.) — the in-memory copy still reaches the Dashboard.
    }
    set({ latest: digest });
  },
  clear: () => {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // ignore
    }
    set({ latest: null });
  },
}));
