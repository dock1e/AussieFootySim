import type { Player } from "../types/player.ts";
import type { Archetype } from "../types/archetype.ts";
import type { MatchDayCoachRole } from "../types/coach.ts";
import { developmentRoleForArchetype } from "../types/coach.ts";
import { ASSISTANT_COACH_POOL } from "../data/assistantCoachPool.ts";
import { CLUBS } from "../types/club.ts";
import type { Season } from "./season.ts";
import { seasonPlayerTotals, allTimePlayerTotals, LEADERBOARD_STAT_FIELDS, type SeasonArchiveEntry, type SeasonPlayerTotals, type LeagueStat } from "./seasonSummary.ts";
import { combinedRecordFor } from "./records.ts";
import type { SeasonAwards } from "./awards.ts";

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
 *
 * **Round 93 — the design note's own "Round 93" addendum.** Tyler, again: "we will need to make sure
 * there are mechanisms to balance our players." Two further, independent safeguards on top of the
 * four above, both scoped to the performance half only — see `performanceScarcityScales`/
 * `eliteTaperFor` below for the full reasoning: league-wide scarcity (only so many players per season
 * can bank a "breakout season" bonus at full value) and elite tapering (even among those who do, it
 * counts for proportionally less the closer a player already is to the top of the pack).
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
  /** Career-best-season, all-time-record-broken, AND (round 94) post-season awards all share this one cap — a player who both breaks a record and wins Norm Smith in the same season doesn't stack past it. */
  MAX_RECORDS_BONUS: 0.1,
  CAREER_BEST_SEASON_BONUS: 0.06,
  ALL_TIME_RECORD_BONUS: 0.1,
  /**
   * Round 94, [[Season Grading, Post-Season Awards, and Player History]] — the post-season-awards
   * component's own scale, folded into the SAME `MAX_RECORDS_BONUS` bucket as a third addend rather
   * than a new independent cap. Deliberately NOT a new bucket: doing so would push the theoretical
   * combined max to 1.5 (0.2 coach + 0.3 performance), overshooting `MULTIPLIER_CAP`'s carefully
   * calibrated 1.4 and everything round 93's elite-taper/scarcity safeguards assumed about it. Sharing
   * the bucket means a big-award season simply saturates the same 0.1 ceiling careerBestSeason/
   * brokeAllTimeRecord already share — `MULTIPLIER_CAP` needs no change at all.
   *
   * Also, deliberately: Brownlow Medal and the AussieFootySim Champion Player Award are NOT weighted
   * here at all, even though `engine/awards.ts` computes both. Winning either is, BY DEFINITION,
   * already the single highest `combinedVotesThisSeason` value league-wide (they're crowned FROM that
   * exact tally) — giving them a second, separate bonus here would score the identical signal twice.
   * Only awards NOT already captured by the existing votes signal (Norm Smith, Finals MVP,
   * All-Australian, Best & Fairest) earn a weight below.
   */
  MAX_AWARDS_BONUS: 0.1,
  /** Combined votes needed to earn the FULL votes bonus — a deliberately generous, "medal-contention-calibre season" anchor, not a real cited figure (same "deliberately roughed in" honesty PROGRESSION_SCALE/ageFactor already carry in progression.ts). */
  VOTES_FOR_MAX_BONUS: 120,
  /** A player needs at least this many games in a season before it can even be considered for "career-best" — keeps a short injury-affected stretch from registering as a fluke best. */
  MIN_GAMES_FOR_CAREER_BEST: 10,
  /**
   * Hard outer clamp on the combined multiplier — defence in depth on top of the component caps
   * above (which already sum to exactly this at their own maximums: 0.20 coach + 0.20 performance =
   * 0.40 -> 1.40). Round 93 note: this exact 1.40 ceiling is still reachable, but only by a player who
   * is BOTH inside that season's performance-bonus scarcity cutoff AND not yet elite by current OVR —
   * see `performanceScarcityScales`/`eliteTaperFor` below. An already-elite player at the taper floor
   * tops out lower (around 1.30 at full coach + max-but-floored performance), by design.
   */
  MULTIPLIER_CAP: 1.4,
  /**
   * Round 93 — league-wide scarcity on the PERFORMANCE half only (see `performanceScarcityScales`).
   * Full-credit slots league-wide per season, expressed per-club so the cutoff scales automatically if
   * the league grows/shrinks (e.g. a future Tasmania admission) rather than needing a manual retune.
   */
  PERFORMANCE_BONUS_FULL_CREDIT_PER_CLUB: 1.5,
  /** Flat scale applied to a player's raw performance contribution once they fall outside that season's scarcity cutoff — never zeroed out (a solid season still counts for something), just meaningfully reduced. */
  BEYOND_CUTOFF_SCALE: 0.6,
  /** Round 93 — elite tapering on the PERFORMANCE half only (see `eliteTaperFor`). Full effect at/below this current OVR. */
  ELITE_TAPER_START_OVR: 75,
  /** Reduced-floor effect at/above this current OVR — chosen well below OVR's own 99 ceiling so it bites for genuine stars, not just the population's own top sliver. */
  ELITE_TAPER_END_OVR: 92,
  /** The reduced multiplier an already-elite player's performance contribution is tapered down to at/above ELITE_TAPER_END_OVR — a floor, not a wall, so a genuine career year for an established star still counts for something. */
  ELITE_TAPER_FLOOR: 0.5,
} as const;

// --- Performance signal --------------------------------------------------------------------------

/**
 * Round 94 — which of the 4 votes-independent post-season awards (see `MAX_AWARDS_BONUS`'s own doc
 * comment for why Brownlow/Champion Player are excluded) this player won this season, per
 * `engine/awards.ts`'s `SeasonAwards`. `allAustralianSquadOnly` is true only for a Squad selection
 * that did NOT also make the final Team — the Team is a strict subset of the Squad, so a Team
 * selection already implies Squad selection and shouldn't separately earn the lesser weight too.
 */
export interface AwardsWonThisSeason {
  normSmith: boolean;
  finalsMvp: boolean;
  allAustralianTeam: boolean;
  allAustralianSquadOnly: boolean;
  bestAndFairest: boolean;
}

const NO_AWARDS_WON: AwardsWonThisSeason = { normSmith: false, finalsMvp: false, allAustralianTeam: false, allAustralianSquadOnly: false, bestAndFairest: false };

export interface SeasonPerformanceSignal {
  /** This season's fantasy-points-PER-GAME (not raw total, so more games played alone doesn't count) newly exceeds every one of this player's own prior archived seasons. Requires >= MIN_GAMES_FOR_CAREER_BEST this season AND at least one prior tracked season to compare against — a debut season is never automatically a "career best," there being no prior career yet to beat. */
  careerBestSeason: boolean;
  /** At least one tracked stat category's updated all-time total (existing archives + this season) newly clears the PRE-season leaderboard's own #1 for that category — see this file's own "club record" scope note below. */
  brokeAllTimeRecord: boolean;
  /** This player's own coaches-votes + Brownlow-style-votes total this season — brownlowVotes deliberately isn't part of the generic seasonSummary/RecordCategory pipeline (see engine/coachesVotes.ts's own doc comment), so it's aggregated locally here instead. */
  combinedVotesThisSeason: number;
  /** Round 94 — every votes-independent post-season award this player won this season. All-false (`NO_AWARDS_WON`) when `computeSeasonPerformanceSignals` is called with no `awards` (e.g. an older call site, or a season that never reached finals for the finals-only awards). */
  awardsWon: AwardsWonThisSeason;
}

/** Round 94 — raw per-award weights, deliberately NOT already scaled into `MAX_AWARDS_BONUS`'s 0-0.1 range (that scaling happens once, in `performanceContributionFor`) — see the design note's own "folding into player progression" section. Norm Smith and Finals MVP are weighted highest (a single-match/single-series MVP is genuinely rarer air than a whole-season top-22 selection); Best & Fairest is per-CLUB rather than league-wide, hence the lowest weight of the three non-AA awards. */
export const AWARD_WEIGHTS = {
  NORM_SMITH: 1.0,
  FINALS_MVP: 1.0,
  ALL_AUSTRALIAN_TEAM: 0.6,
  ALL_AUSTRALIAN_SQUAD_ONLY: 0.3,
  BEST_AND_FAIREST: 0.5,
} as const;

/** A player who wins ALL of Norm Smith + Finals MVP + AA Team + Best & Fairest in the same season (Norm Smith and Finals MVP can't both fire for the same player in the same season in practice — Norm Smith requires playing the GF, which is already counted inside that season's Finals MVP tally — but nothing here assumes that) would raw-sum to 1.0+1.0+0.6+0.5 = 3.1; this caps the raw total BEFORE it's scaled into `MAX_AWARDS_BONUS`, so `awardsRawUnitsFor` alone can never imply "more award than is actually possible to have won." */
const MAX_AWARD_UNITS = 1.5;

/** Sums `AWARD_WEIGHTS` for every flag set on `awardsWon`, capped at `MAX_AWARD_UNITS`. Pure — the actual scaling into a development-multiplier bonus happens in `performanceContributionFor`, not here, so this function stays reusable for a future "how decorated was this season" display without dragging development-tuning constants along with it. */
export function awardsRawUnitsFor(awardsWon: AwardsWonThisSeason): number {
  const raw =
    (awardsWon.normSmith ? AWARD_WEIGHTS.NORM_SMITH : 0) +
    (awardsWon.finalsMvp ? AWARD_WEIGHTS.FINALS_MVP : 0) +
    (awardsWon.allAustralianTeam ? AWARD_WEIGHTS.ALL_AUSTRALIAN_TEAM : 0) +
    (awardsWon.allAustralianSquadOnly ? AWARD_WEIGHTS.ALL_AUSTRALIAN_SQUAD_ONLY : 0) +
    (awardsWon.bestAndFairest ? AWARD_WEIGHTS.BEST_AND_FAIREST : 0);
  return Math.min(MAX_AWARD_UNITS, raw);
}

function awardsWonFor(playerId: number, awards: SeasonAwards | null): AwardsWonThisSeason {
  if (!awards) return NO_AWARDS_WON;
  const inTeam = awards.allAustralianTeam.includes(playerId);
  const inSquad = awards.allAustralianSquad.includes(playerId);
  return {
    normSmith: awards.normSmith?.playerId === playerId,
    finalsMvp: awards.finalsMvp?.playerIds.includes(playerId) ?? false,
    allAustralianTeam: inTeam,
    allAustralianSquadOnly: inSquad && !inTeam,
    bestAndFairest: Object.values(awards.bestAndFairest).some((w) => w.playerIds.includes(playerId)),
  };
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
 *
 * Round 94: takes the already-computed `awards` for the season that just finished (or `null`, e.g.
 * an older call site, or the one-off "no season yet" case `developmentMultipliersFor` short-circuits
 * before ever reaching here) — this file never computes awards itself, `engine/awards.ts`'s
 * `computeSeasonAwards` (called once from `saveGame.ts`'s `runOffSeasonOnSave`, the same moment this
 * function is called) stays the single source of truth for who won what.
 */
export function computeSeasonPerformanceSignals(season: Season, seasonArchives: readonly SeasonArchiveEntry[], awards: SeasonAwards | null = null): Map<number, SeasonPerformanceSignal> {
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
      awardsWon: awardsWonFor(playerId, awards),
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

/**
 * The votes + records halves, each independently capped — see DEVELOPMENT_TUNING's own per-field doc
 * comments. Round 94: the records half now has a third addend, `awardsComponent` — Norm Smith/Finals
 * MVP/All-Australian/Best & Fairest, scaled by `MAX_AWARDS_BONUS` — but it still shares the same
 * `MAX_RECORDS_BONUS` outer cap as `careerBestSeason`/`brokeAllTimeRecord`, so `MULTIPLIER_CAP` itself
 * needs no change (see `MAX_AWARDS_BONUS`'s own doc comment).
 */
export function performanceContributionFor(signal: SeasonPerformanceSignal | undefined): number {
  if (!signal) return 0;
  const votesComponent = Math.min(1, signal.combinedVotesThisSeason / DEVELOPMENT_TUNING.VOTES_FOR_MAX_BONUS) * DEVELOPMENT_TUNING.MAX_VOTES_BONUS;
  const awardsComponent = Math.min(1, awardsRawUnitsFor(signal.awardsWon) / MAX_AWARD_UNITS) * DEVELOPMENT_TUNING.MAX_AWARDS_BONUS;
  const recordsRaw = (signal.careerBestSeason ? DEVELOPMENT_TUNING.CAREER_BEST_SEASON_BONUS : 0) + (signal.brokeAllTimeRecord ? DEVELOPMENT_TUNING.ALL_TIME_RECORD_BONUS : 0) + awardsComponent;
  const recordsComponent = Math.min(DEVELOPMENT_TUNING.MAX_RECORDS_BONUS, recordsRaw);
  return votesComponent + recordsComponent;
}

// --- Round 93: two further balance safeguards, both on the performance half only ----------------
//
// Tyler, again: "we will need to make sure there are mechanisms to balance our players." Round 91's
// own 4 structural limits (this file's top doc comment) already make it IMPOSSIBLE for this mechanic
// to manufacture a Generational Talent — POT is never touched, full stop. What they don't address is
// narrower but real: nothing before this round stopped the mechanic being a pure rich-get-richer
// engine among players who all have genuine headroom left. An already-elite star and a rising
// mid-tier player got the identical bonus for the identical vote/record signal, and there was no
// limit on how many players league-wide could simultaneously bank a "breakout season" bonus at full
// value. Both safeguards below apply ONLY to the performance contribution (votes/records) — the coach
// contribution is untouched, since round 91 already tightly club-and-archetype-gates it, and Tyler's
// own concern both times has specifically been about performance ("the better the player
// performs..."), not coaching investment.
//
// Considered and deliberately NOT built: a "diminishing returns for a repeat performer across
// consecutive seasons" mechanism (my own first instinct reading Tyler's ask again). Checked against
// round 91's own calibration first — `verify_round91_scratch.ts` already stress-tested exactly this
// worst case (one hero player fed a medal-calibre vote total AND a fresh all-time record EVERY season
// for 5 straight seasons) and found `potentialHeadroom`'s existing shrink-near-ceiling behaviour
// already defeats it: a repeatedly-boosted player just reaches their ceiling and then has nothing left
// for the multiplier to accelerate. A separate season-counting decay would have been solving an
// already-solved problem. The elite taper below achieves the same practical effect more honestly: a
// player who keeps cashing in repeat bonuses will quickly BECOME high-OVR, at which point this taper
// naturally starts discounting them anyway — without needing a second, redundant tracking mechanism.

/**
 * League-wide scarcity: ranks every player with a nonzero raw performance contribution this season,
 * highest first, and returns `1` (full credit) for the top `CLUBS.length * PERFORMANCE_BONUS_FULL_CREDIT_PER_CLUB`
 * (rounded) of them, `BEYOND_CUTOFF_SCALE` for everyone else. Models real-world awards/records scarcity
 * directly — only so many players can have a genuine breakout season in the same year, league-wide,
 * mirroring how few players ever poll heavily in the same Brownlow count or break a record in the same
 * season for real. A flat step rather than a smooth per-rank decay: simple to reason about and
 * calibrate, and the step itself is gentle (100% -> 60%, never to 0) rather than a cliff — this is a
 * soft, disclosed nudge toward scarcity, not a hard quota that locks anyone out.
 */
export function performanceScarcityScales(rawPerformanceByPlayer: ReadonlyMap<number, number>): Map<number, number> {
  const fullCreditCount = Math.round(CLUBS.length * DEVELOPMENT_TUNING.PERFORMANCE_BONUS_FULL_CREDIT_PER_CLUB);
  const ranked = [...rawPerformanceByPlayer.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const result = new Map<number, number>();
  ranked.forEach(([playerId], rank) => {
    result.set(playerId, rank < fullCreditCount ? 1 : DEVELOPMENT_TUNING.BEYOND_CUTOFF_SCALE);
  });
  return result;
}

/**
 * Elite tapering: full effect (`1`) at/below `ELITE_TAPER_START_OVR`, linearly shrinking to
 * `ELITE_TAPER_FLOOR` at/above `ELITE_TAPER_END_OVR`, interpolated in between. Reads the player's
 * CURRENT `OVR` — the value going into this off-season, before this year's growth is applied — so
 * there's no chicken-and-egg with the very growth step this multiplier feeds. Net effect: the
 * performance half of this mechanic now does more of its work for players still climbing the pecking
 * order, and progressively less for players already at the top of it, without ever fully switching off
 * for a genuine star's genuine big season.
 */
export function eliteTaperFor(currentOVR: number): number {
  const { ELITE_TAPER_START_OVR, ELITE_TAPER_END_OVR, ELITE_TAPER_FLOOR } = DEVELOPMENT_TUNING;
  if (currentOVR <= ELITE_TAPER_START_OVR) return 1;
  if (currentOVR >= ELITE_TAPER_END_OVR) return ELITE_TAPER_FLOOR;
  const t = (currentOVR - ELITE_TAPER_START_OVR) / (ELITE_TAPER_END_OVR - ELITE_TAPER_START_OVR);
  return 1 - t * (1 - ELITE_TAPER_FLOOR);
}

/** Combines both halves and clamps to `[1, MULTIPLIER_CAP]` — the one number `progression.ts`'s `ageOnePlayer` actually consumes. Takes the performance contribution AFTER round 93's scarcity/taper safeguards have already been applied to it (see `developmentMultipliersFor`) — this function itself stays a simple, pure combinator, same as round 91 left it. */
export function developmentMultiplierFor(coachContribution: number, performanceContribution: number): number {
  return Math.max(1, Math.min(DEVELOPMENT_TUNING.MULTIPLIER_CAP, 1 + coachContribution + performanceContribution));
}

/**
 * The one function `saveGame.ts`'s `runOffSeasonOnSave` actually calls: every player's own
 * `developmentMultiplier` for the off-season step about to run, from the season that just finished
 * (`null` season — no season played yet, e.g. a brand-new save — means every multiplier is exactly
 * `1`, i.e. today's unmodified behaviour).
 *
 * Round 94: takes the same season's already-computed `awards` (or `null`) and threads it straight
 * through to `computeSeasonPerformanceSignals` — see that function's own doc comment. Defaults to
 * `null` so every pre-round-94 call site (a verify script, say) keeps compiling and behaving exactly
 * as before, just with every player's `awardsWon` reading all-false.
 */
export function developmentMultipliersFor(
  players: readonly Player[],
  season: Season | null,
  seasonArchives: readonly SeasonArchiveEntry[],
  myClub: string,
  developmentCoachId: number | null,
  lineCoaches: Partial<Record<MatchDayCoachRole, number>>,
  awards: SeasonAwards | null = null,
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
  const signals = computeSeasonPerformanceSignals(season, seasonArchives, awards);

  // Round 93 — the raw (pre-safeguard) performance contribution has to be known for EVERY player
  // before any of them can be ranked, so this is a separate pass ahead of the main loop below.
  const rawPerformanceByPlayer = new Map<number, number>();
  for (const p of players) rawPerformanceByPlayer.set(p.PlayerID, performanceContributionFor(signals.get(p.PlayerID)));
  const scarcityScales = performanceScarcityScales(rawPerformanceByPlayer);

  for (const p of players) {
    const coachContribution = coachContributionFor(p.archetype as Archetype, p.Team === myClub, developmentCoachId, lineCoaches);
    const rawPerformance = rawPerformanceByPlayer.get(p.PlayerID) ?? 0;
    // Round 93 — both safeguards are multiplicative on the same raw value, applied before it ever
    // reaches developmentMultiplierFor: scarcity first (did this season's performance even crack the
    // league-wide full-credit cutoff), then elite tapering (does it matter less because this player's
    // already one of the league's best). Order between the two doesn't matter mathematically
    // (multiplication commutes) — written scarcity-then-taper because that's the order Tyler's own
    // concern raised them in conversation.
    const performanceContribution = rawPerformance * (scarcityScales.get(p.PlayerID) ?? 1) * eliteTaperFor(p.OVR);
    result.set(p.PlayerID, developmentMultiplierFor(coachContribution, performanceContribution));
  }
  return result;
}
