import type { Player } from "../types/player.ts";
import type { Archetype } from "../types/archetype.ts";
import type { MatchDayCoachRole } from "../types/coach.ts";
import { developmentRoleForArchetype } from "../types/coach.ts";
import { ASSISTANT_COACH_POOL } from "../data/assistantCoachPool.ts";
import type { Season } from "./season.ts";
import { seasonPlayerTotals, allTimePlayerTotals, LEADERBOARD_STAT_FIELDS, type SeasonArchiveEntry, type SeasonPlayerTotals, type LeagueStat } from "./seasonSummary.ts";
import { combinedRecordFor } from "./records.ts";

/**
 * Coach-Driven & Performance-Linked Player Development — [[Coach-Driven & Performance-Linked Player
 * Development]], round 91. Tyler: "Player growth should be positively influenced by not only coach
 * ratings, but also by awards (coaches votes, brownlow votes, breaking records be it personal bests,
 * club records, historical records)... We will need to make sure that this can be balanced though so
 * that they dont end up with having developed 12 'generational talent' level players."
 *
 * This file computes, once per off-season (`developmentMultipliersFor`, called from
 * `saveGame.ts`'s `runOffSeasonOnSave`), a per-player `developmentMultiplier` — a small, capped
 * scalar that `engine/progression.ts`'s `ageOnePlayer` multiplies ONLY into the improvement (`imp_`)
 * side of its existing formula, never the decline side, and which defaults to exactly `1` (today's
 * unmodified behaviour) for any player with no hired coach and an unremarkable season.
 *
 * See the design note's "Why this can't produce 12 Generational Talents" section for the full
 * argument. In short: `potentialTall`/`potentialMid` are never touched by anything in this file —
 * this only changes how reliably/quickly a player closes the gap to their OWN already-generated
 * ceiling, never raises that ceiling. `potentialHeadroom` (progression.ts) already shrinks to 0 near
 * that ceiling regardless of multiplier, and `recomputeOVR` re-scores the whole population against
 * itself every off-season, so OVR labels can't inflate league-wide even if raw attributes do. On top
 * of those structural limits, every component below is individually capped, and the combined result
 * is hard-clamped to `DEVELOPMENT_TUNING.MULTIPLIER_CAP`.
 */

// --- Tuning ------------------------------------------------------------------------------------
// See scripts/verify_round91_scratch.ts for the calibration run these were checked against —
// same "measure a real simulated run, don't just guess" discipline rounds 69/72/75/78/79 all used.

export const DEVELOPMENT_TUNING = {
  /** Club-wide, from the hired Development coach's own OVR/99 — every player at that club gets a share of this, regardless of archetype. */
  MAX_DEVELOPMENT_COACH_BONUS: 0.1,
  /** Per-unit, from the hired line coach matching THIS player's own archetype (developmentRoleForArchetype) — a forward gets nothing from a Defensive Line hire, etc. */
  MAX_LINE_COACH_BONUS: 0.1,
  /** Scales with combined coaches-votes + Brownlow-style-votes this season, against VOTES_FOR_MAX_BONUS. */
  MAX_VOTES_BONUS: 0.1,
  /** Career-best-season and all-time-record-broken share this one cap — breaking a record AND having a career-best year in the same season doesn't stack past it. */
  MAX_RECORDS_BONUS: 0.1,
  CAREER_BEST_SEASON_BONUS: 0.06,
  ALL_TIME_RECORD_BONUS: 0.1,
  /** Combined votes needed to earn the FULL votes bonus — a deliberately generous, "medal-contention-calibre season" anchor, not a real cited figure (same "deliberately roughed in" honesty PROGRESSION_SCALE/ageFactor already carry in progression.ts). */
  VOTES_FOR_MAX_BONUS: 120,
  /** A player needs at least this many games in a season before it can even be considered for "career-best" — keeps a short injury-affected stretch from registering as a fluke best. */
  MIN_GAMES_FOR_CAREER_BEST: 10,
  /** Hard outer clamp on the combined multiplier — defence in depth on top of the component caps above (which already sum to exactly this at their own maximums: 0.20 coach + 0.20 performance = 0.40 -> 1.40). */
  MULTIPLIER_CAP: 1.4,
} as const;

// --- Performance signal --------------------------------------------------------------------------

export interface SeasonPerformanceSignal {
  /** This season's fantasy-points-PER-GAME (not raw total, so more games played alone doesn't count) newly exceeds every one of this player's own prior archived seasons. Requires >= MIN_GAMES_FOR_CAREER_BEST this season AND at least one prior tracked season to compare against — a debut season is never automatically a "career best," there being no prior career yet to beat. */
  careerBestSeason: boolean;
  /** At least one tracked stat category's updated all-time total (existing archives + this season) newly clears the PRE-season leaderboard's own #1 for that category — see this file's own "club record" scope note below. */
  brokeAllTimeRecord: boolean;
  /** This player's own coaches-votes + Brownlow-style-votes total this season — brownlowVotes deliberately isn't part of the generic seasonSummary/RecordCategory pipeline (see engine/coachesVotes.ts's own doc comment), so it's aggregated locally here instead. */
  combinedVotesThisSeason: number;
}

/**
 * Every stat category this file checks for an all-time record break — the same 23 real
 * `RecordCategory` values Records.tsx displays, MINUS `finalsAppearances` (deliberately dropped: it
 * isn't a real tracked `SeasonPlayerTotals` field — `engine/records.ts`'s own `simStatValue` treats it
 * as a special case computed separately via `seasonFinalsAppearances`, and building that extra path
 * just for this growth signal isn't worth the complexity for one category out of 24). Derived from
 * `LEADERBOARD_STAT_FIELDS` (the one canonical list, `seasonSummary.ts`) rather than hand-typed, so a
 * future new stat is picked up here automatically, same as it already is everywhere else that reads
 * from that array.
 */
const RECORD_CHECK_CATEGORIES: readonly (LeagueStat | "gamesPlayed")[] = [...LEADERBOARD_STAT_FIELDS, "fantasyPoints", "gamesPlayed"];

function totalsValue(t: SeasonPlayerTotals, category: LeagueStat | "gamesPlayed"): number {
  return category === "gamesPlayed" ? t.gamesPlayed : t[category];
}

/**
 * Computes every player-who-played-this-season's `SeasonPerformanceSignal` in one pass over
 * `seasonArchives`/`season` — cheap (24 `combinedRecordFor` calls total, not per player; the
 * career-best check is one pass building each player's own prior-best, one more comparing against
 * this season). Called once per off-season from `developmentMultipliersFor` below.
 *
 * "Club record" is deliberately folded into the same all-time check as "historical record" rather
 * than built as a separate per-club leaderboard — `combinedRecordFor` has no club-scoping parameter
 * today, and adding one would be a real, separately-scoped Records-tab capability (a per-club records
 * page), not a small addition. See the design note's own "Records" section for the full reasoning.
 * In practice this also makes the all-time tier appropriately rare: a pre-season #1 is very often a
 * genuine real-world historical great whose career total a sim player has no realistic path to
 * threaten inside a normal save's lifetime.
 */
export function computeSeasonPerformanceSignals(season: Season, seasonArchives: readonly SeasonArchiveEntry[]): Map<number, SeasonPerformanceSignal> {
  const thisSeasonTotals = seasonPlayerTotals(season);
  const updatedAllTime = allTimePlayerTotals(seasonArchives, season);

  const priorBestFpg = new Map<number, number>();
  for (const archive of seasonArchives) {
    for (const t of archive.playerTotals) {
      if (t.gamesPlayed < DEVELOPMENT_TUNING.MIN_GAMES_FOR_CAREER_BEST) continue;
      const fpg = t.fantasyPoints / t.gamesPlayed;
      priorBestFpg.set(t.playerId, Math.max(priorBestFpg.get(t.playerId) ?? -Infinity, fpg));
    }
  }

  // Pre-season #1 per category — existing archives only, no live season mixed in yet.
  const preSeasonBest = new Map<LeagueStat | "gamesPlayed", number>();
  for (const category of RECORD_CHECK_CATEGORIES) {
    const top = combinedRecordFor(category, seasonArchives, null, 1);
    preSeasonBest.set(category, top[0]?.value ?? 0);
  }

  // Brownlow-style votes this season — see this function's own doc comment for why it's aggregated
  // locally rather than via seasonPlayerTotals.
  const brownlowTotals = new Map<number, number>();
  for (const m of season.played) {
    for (const [idStr, line] of Object.entries(m.result.boxScore)) {
      const id = Number(idStr);
      brownlowTotals.set(id, (brownlowTotals.get(id) ?? 0) + line.brownlowVotes);
    }
  }

  const result = new Map<number, SeasonPerformanceSignal>();
  for (const [playerId, totals] of thisSeasonTotals) {
    const priorBest = priorBestFpg.get(playerId);
    const thisFpg = totals.gamesPlayed > 0 ? totals.fantasyPoints / totals.gamesPlayed : 0;
    const careerBestSeason = totals.gamesPlayed >= DEVELOPMENT_TUNING.MIN_GAMES_FOR_CAREER_BEST && priorBest !== undefined && thisFpg > priorBest;

    let brokeAllTimeRecord = false;
    const updated = updatedAllTime.get(playerId);
    if (updated) {
      for (const category of RECORD_CHECK_CATEGORIES) {
        const threshold = preSeasonBest.get(category) ?? 0;
        if (threshold > 0 && totalsValue(updated, category) > threshold) {
          brokeAllTimeRecord = true;
          break;
        }
      }
    }

    result.set(playerId, {
      careerBestSeason,
      brokeAllTimeRecord,
      combinedVotesThisSeason: totals.coachesVotes + (brownlowTotals.get(playerId) ?? 0),
    });
  }
  return result;
}

// --- Coach contribution --------------------------------------------------------------------------

/**
 * Club-gated: `SaveGameData.lineCoaches`/`developmentCoach` only exist for the user's own coached
 * club (AI clubs have no tracked hires), so this returns exactly 0 for every other club's players —
 * a real, structural limit on how much of this mechanic any single save can ever direct (see the
 * design note's balance section, point 4). The Development coach's own share is NOT archetype-gated
 * (every player at the club gets it); the line coach's share IS, via `developmentRoleForArchetype`.
 */
export function coachContributionFor(
  archetype: Archetype,
  isMyClub: boolean,
  developmentCoachId: number | null,
  lineCoaches: Partial<Record<MatchDayCoachRole, number>>,
): number {
  if (!isMyClub) return 0;
  let contribution = 0;
  if (developmentCoachId !== null) {
    const coach = ASSISTANT_COACH_POOL.find((c) => c.id === developmentCoachId);
    if (coach) contribution += (coach.ratings.Development.ovr / 99) * DEVELOPMENT_TUNING.MAX_DEVELOPMENT_COACH_BONUS;
  }
  const role = developmentRoleForArchetype(archetype);
  const lineCoachId = lineCoaches[role];
  if (lineCoachId !== undefined) {
    const coach = ASSISTANT_COACH_POOL.find((c) => c.id === lineCoachId);
    if (coach) contribution += (coach.ratings[role].ovr / 99) * DEVELOPMENT_TUNING.MAX_LINE_COACH_BONUS;
  }
  return contribution;
}

/** The votes + records halves, each independently capped — see DEVELOPMENT_TUNING's own per-field doc comments. */
export function performanceContributionFor(signal: SeasonPerformanceSignal | undefined): number {
  if (!signal) return 0;
  const votesComponent = Math.min(1, signal.combinedVotesThisSeason / DEVELOPMENT_TUNING.VOTES_FOR_MAX_BONUS) * DEVELOPMENT_TUNING.MAX_VOTES_BONUS;
  const recordsRaw = (signal.careerBestSeason ? DEVELOPMENT_TUNING.CAREER_BEST_SEASON_BONUS : 0) + (signal.brokeAllTimeRecord ? DEVELOPMENT_TUNING.ALL_TIME_RECORD_BONUS : 0);
  const recordsComponent = Math.min(DEVELOPMENT_TUNING.MAX_RECORDS_BONUS, recordsRaw);
  return votesComponent + recordsComponent;
}

/** Combines both halves and clamps to `[1, MULTIPLIER_CAP]` — the one number `progression.ts`'s `ageOnePlayer` actually consumes. */
export function developmentMultiplierFor(coachContribution: number, performanceContribution: number): number {
  return Math.max(1, Math.min(DEVELOPMENT_TUNING.MULTIPLIER_CAP, 1 + coachContribution + performanceContribution));
}

/**
 * The one function `saveGame.ts`'s `runOffSeasonOnSave` actually calls: every player's own
 * `developmentMultiplier` for the off-season step about to run, from the season that just finished
 * (`null` season — no season played yet, e.g. a brand-new save — means every multiplier is exactly
 * `1`, i.e. today's unmodified behaviour).
 */
export function developmentMultipliersFor(
  players: readonly Player[],
  season: Season | null,
  seasonArchives: readonly SeasonArchiveEntry[],
  myClub: string,
  developmentCoachId: number | null,
  lineCoaches: Partial<Record<MatchDayCoachRole, number>>,
): Map<number, number> {
  const result = new Map<number, number>();
  if (!season) {
    // No season played yet (e.g. a brand-new save) -- every multiplier is exactly `1`, i.e. today's
    // unmodified behaviour, regardless of whether a coach is already hired. Deliberately short-
    // circuits BEFORE coachContributionFor: a coach's bonus reflects developing players through a
    // season just completed, and with no season yet to develop through, there's nothing for it to
    // apply to. (A coach hired ahead of the club's first season starts contributing from that
    // season's own off-season step onward, same as any other save.)
    for (const p of players) result.set(p.PlayerID, 1);
    return result;
  }
  const signals = computeSeasonPerformanceSignals(season, seasonArchives);
  for (const p of players) {
    const coachContribution = coachContributionFor(p.archetype as Archetype, p.Team === myClub, developmentCoachId, lineCoaches);
    const performanceContribution = performanceContributionFor(signals.get(p.PlayerID));
    result.set(p.PlayerID, developmentMultiplierFor(coachContribution, performanceContribution));
  }
  return result;
}
