import type { Real2026SeasonStats } from "./real2026SeasonStats.ts";
import raw from "./sources/realCareerHistory.json" with { type: "json" };

/**
 * Round C148 — [[End-of-2026 Player Database Refresh]] Step 3 follow-up (Tyler's own flagged
 * "no real decline" problem in the Round C147 Top 50 grading: Cripps/Oliver-style real players who
 * genuinely peaked-and-declined read as monotonically rising because `ovrRawComposite` only ever
 * saw ONE real season — see `progression.ts`/`attributeGeneration.ts`'s own doc comments, neither
 * carried any season-to-season memory before this round).
 *
 * `data/sources/realCareerHistory.json` — a real, multi-season per-player stat pull (afltables.com
 * career tables, same 23-column shape `real2026SeasonStats.ts` already uses, one row per real
 * season instead of only 2026), keyed by `realFullName`. 668 of the 825 players in today's database
 * have at least one real season on file here; 490 have 3 or more. This is DIFFERENT data from
 * `real2026SeasonStats.ts` (which is 2026-only, 594 players, already committed) — the two are
 * cross-referenced by `recencyForm.ts`, not merged into one file, since `real2026SeasonStats.ts`'s
 * own 2026 row remains the authoritative "this round's real season" source and this file is
 * additive history layered on top.
 *
 * `None`/missing real values were coerced to `0` before this file was committed (a real season with
 * e.g. no recorded hitouts reads as 0 hitouts, same convention `real2026SeasonStats.ts` itself
 * already uses for every stat column).
 */
export interface CareerSeasonRow extends Real2026SeasonStats {
  year: number;
}

type RawRow = Omit<Real2026SeasonStats, "realFullName"> & { year: number };

const RAW: Record<string, RawRow[]> = raw as Record<string, RawRow[]>;

let cache: Map<string, CareerSeasonRow[]> | null = null;

function allRows(): Map<string, CareerSeasonRow[]> {
  if (cache) return cache;
  cache = new Map();
  for (const [name, rows] of Object.entries(RAW)) {
    cache.set(
      name,
      rows.map((r) => ({ ...r, realFullName: name })).sort((a, b) => a.year - b.year),
    );
  }
  return cache;
}

/** Every real season on file for a player, ascending by year. `[]` if this player has no real multi-season history captured (157 of the 825 players — see this file's own doc comment). */
export function careerHistoryFor(realFullName: string): CareerSeasonRow[] {
  return allRows().get(realFullName) ?? [];
}
