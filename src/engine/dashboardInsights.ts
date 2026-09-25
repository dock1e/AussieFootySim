import type { Player } from "../types/player";
import { playerFullName } from "../types/player";
import type { Season } from "./season";
import type { SeasonArchiveEntry } from "./seasonSummary";
import { seasonPlayerTotals, seasonPlayerLast5Totals, toAverageMap, ALL_LEAGUE_STATS } from "./seasonSummary";
import { combinedRecordFor, writeupFor, ALL_RECORD_CATEGORIES, type RecordCategory, type RecordRow } from "./records";

/**
 * Round 115 — [[Club Theme System]] Dashboard rebuild. The brief's reference (`Club Theme System.dc.html`)
 * specs a "Record Watch" feed (players on your own list ranked by how significant their real-world
 * all-time-record standing is) and a "Development" board (young/recently-drafted players classified
 * BREAKOUT/NEEDS GAMES/STALLING/ON TRACK) — see that file's own `isDash` block. Neither mechanic existed
 * anywhere in this codebase before this round; both are built here as NEW, disclosed-heuristic engine
 * functions on top of already-real data (`engine/records.ts`'s all-time standings, `engine/seasonSummary.ts`'s
 * season/last-5 totals), not fabricated numbers. See each function's own doc comment for exactly what's
 * calibrated-not-specified, matching this project's established convention (disgruntlement thresholds,
 * scouting tiers, etc.) for exactly this kind of first-pass judgment call.
 */

/** How many Record Watch entries the Dashboard's own compact feed shows — the brief's mockup shows 6. */
export const RECORD_WATCH_LIMIT = 6;

/** Mirrors `Records.tsx`'s own `CATEGORY_LABEL`/`PlayerProfileModal.tsx`'s `RECORD_CATEGORY_LABEL` — see those files' own doc comments for why this isn't a shared import (Records.tsx is a page component, not a data module). */
const RECORD_CATEGORY_LABEL: Record<string, string> = {
  gamesPlayed: "Games Played",
  finalsAppearances: "Finals Appearances",
  ...Object.fromEntries(ALL_LEAGUE_STATS.map((s) => [s.key, s.label])),
};

export interface RecordWatchEntry {
  player: Player;
  category: RecordCategory;
  categoryLabel: string;
  row: RecordRow;
  /** A short, human write-up if `records.ts`'s own generator has one for this row; otherwise a plain fallback sentence built here. */
  text: string;
}

/**
 * League-wide Record Watch feed, filtered down to `myClub`'s own list — the brief's "ranked by
 * significance across the whole list" panel. Built as the OUTER loop over `ALL_RECORD_CATEGORIES`
 * (25 categories), each calling `combinedRecordFor` once at `topN=25` (the same "worth a write-up"
 * cutoff `bestAllTimeStandingFor` already uses elsewhere) and filtering to `myClub` rows — deliberately
 * NOT the other way around (loop players, call `bestAllTimeStandingFor` per player), which would be
 * ~40x more `combinedRecordFor` calls for the same result. "Significance" here is simply rank
 * (lower = more significant, i.e. closer to or already inside an all-time top-25) — a real, honest,
 * cheap-to-compute proxy, not a fabricated one, but a disclosed first pass: it doesn't yet weigh HOW
 * historically big a category is (e.g. games played vs. a rarer stat), a genuine follow-up refinement.
 */
export function recordWatchFeedFor(
  myClub: string,
  seasonArchives: readonly SeasonArchiveEntry[],
  liveSeason: Season | null,
  currentYear: number,
  limit = RECORD_WATCH_LIMIT,
): RecordWatchEntry[] {
  const entries: RecordWatchEntry[] = [];
  for (const category of ALL_RECORD_CATEGORIES) {
    const rows = combinedRecordFor(category, seasonArchives, liveSeason, 25);
    for (const row of rows) {
      if (!row.player || row.player.Team !== myClub) continue;
      const label = RECORD_CATEGORY_LABEL[category] ?? category;
      const generated = writeupFor(row, category, [...seasonArchives], liveSeason, currentYear);
      const text = generated ?? `${playerFullName(row.player)} sits ${row.rank}${ordinal(row.rank)} all-time in ${label.toLowerCase()} with ${Math.round(row.value)}.`;
      entries.push({ player: row.player, category, categoryLabel: label, row, text });
    }
  }
  // Lower rank = more significant. Ties broken by category order (ALL_RECORD_CATEGORIES' own
  // ordering, roughly "most storied stats first") so the feed is deterministic, not insertion-order
  // accidental.
  entries.sort((a, b) => a.row.rank - b.row.rank);
  return entries.slice(0, limit);
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return "th";
  switch (n % 10) {
    case 1: return "st";
    case 2: return "nd";
    case 3: return "rd";
    default: return "th";
  }
}

// --- Development board ------------------------------------------------------------------------

export type DevelopmentStatus = "BREAKOUT" | "NEEDS GAMES" | "STALLING" | "ON TRACK";

export interface DevelopmentEntry {
  player: Player;
  status: DevelopmentStatus;
  /** Recent-form fantasy-point delta (last-5 average minus season average) — the diverging bar's own value, clamped to [-8, 8] for display. */
  vsProjection: number;
  action: string;
}

const DEVELOPMENT_FORM_DELTA_THRESHOLD = 8; // fantasy points — calibrated-not-specified, see doc comment below
const DEVELOPMENT_MIN_GAMES_SHARE = 0.4; // fraction of the season played so far

/**
 * The brief's "Development" board: players 23-or-under (or drafted since 2024) on `myClub`, each
 * classified into one of 4 statuses and given a next-action line. Deliberately narrower than the
 * brief's own 5-status list (BREAKOUT / NEEDS GAMES / CEILING UP or DOWN / STALLING / ON TRACK) —
 * this codebase has no persisted per-season OVR/POT snapshot anywhere (`SeasonArchiveEntry` is
 * stats-only, confirmed against `engine/seasonSummary.ts` before building this), so a genuine
 * "ceiling went up/down since last check" signal doesn't exist yet and isn't fabricated here; CEILING
 * UP/DOWN is a real follow-up once a POT-history snapshot exists. What IS built is a real trend
 * signal already available today: last-5-round average Fantasy Points vs. this season's own average
 * (both already computed by `engine/seasonSummary.ts` for the League Leaders card) — a young player
 * running meaningfully hotter than their own season average reads BREAKOUT, meaningfully colder reads
 * STALLING, and a player who's barely played reads NEEDS GAMES before either of those (games-played
 * share is checked first, since a small-sample form swing on 1-2 games is noise, not a real signal).
 * The `DEVELOPMENT_FORM_DELTA_THRESHOLD`/`DEVELOPMENT_MIN_GAMES_SHARE` constants are disclosed,
 * calibrated-not-specified first-pass values, same convention as `disgruntlement.ts`'s own thresholds
 * — recalibrate once real playtesting shows how often each status actually fires.
 */
export function developmentBoardFor(
  players: readonly Player[],
  myClub: string,
  season: Season | null,
  sort: "movers" | "ceiling" | "youngest" = "movers",
  limit = 8,
): DevelopmentEntry[] {
  const eligible = players.filter((p) => p.Team === myClub && (p.Age <= 23 || p.draft_year >= 2024));
  const roundsPlayed = season ? season.played.length : 0;
  const seasonAvg = season ? toAverageMap(seasonPlayerTotals(season)) : new Map();
  const last5Avg = season ? toAverageMap(seasonPlayerLast5Totals(season)) : new Map();

  const entries: DevelopmentEntry[] = eligible.map((player) => {
    const seasonRow = seasonAvg.get(player.PlayerID);
    const last5Row = last5Avg.get(player.PlayerID);
    const gamesPlayed = seasonRow?.gamesPlayed ?? 0;
    const gamesShare = roundsPlayed > 0 ? gamesPlayed / roundsPlayed : 0;
    const vsProjectionRaw = seasonRow && last5Row ? last5Row.fantasyPoints - seasonRow.fantasyPoints : 0;
    const vsProjection = Math.max(-8, Math.min(8, vsProjectionRaw));

    let status: DevelopmentStatus;
    let action: string;
    if (roundsPlayed === 0 || gamesShare < DEVELOPMENT_MIN_GAMES_SHARE) {
      status = "NEEDS GAMES";
      action = "Push for more senior game time this year.";
    } else if (vsProjectionRaw >= DEVELOPMENT_FORM_DELTA_THRESHOLD) {
      status = "BREAKOUT";
      action = "Lock in a role — recent form is well above their own season average.";
    } else if (vsProjectionRaw <= -DEVELOPMENT_FORM_DELTA_THRESHOLD) {
      status = "STALLING";
      action = "Review workload and role — recent form has dipped well below their own average.";
    } else {
      status = "ON TRACK";
      action = "Keep developing at the current rate.";
    }

    return { player, status, vsProjection, action };
  });

  const sorted = [...entries];
  if (sort === "movers") sorted.sort((a, b) => Math.abs(b.vsProjection) - Math.abs(a.vsProjection));
  else if (sort === "ceiling") sorted.sort((a, b) => b.player.POT - a.player.POT);
  else sorted.sort((a, b) => a.player.Age - b.player.Age);

  return sorted.slice(0, limit);
}
