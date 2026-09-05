import type { Player } from "../types/player.ts";
import type { Archetype } from "../types/archetype.ts";
import { suitabilityFor } from "../types/archetype.ts";
import { getPlayersByClub } from "../data/loadPlayers.ts";
import { clubById } from "../types/club.ts";
import type { MatchTeam } from "./team.ts";
import type { LadderRow } from "./ladder.ts";
import { seedMorale } from "./morale.ts";
import { mulberry32 } from "./rng.ts";

/**
 * Disgruntlement — [[Coaching Legacy and Career Personalization]]'s "the new
 * mechanic Tyler actually asked for": "players can become disgruntled for
 * being played out of position, not getting enough games, being pushed to
 * play harder when the team morale is low... those disgruntled players can
 * be fed into a potential trade pool and be developed alongside our draft
 * pool." Round 74's own governing instruction supplied the calibration
 * anchor: "Only ~40 players per year are traded, so being disgruntled should
 * be quite uncommon," pointing at the "AFL Trade Whispers" sheet in the
 * uploaded "AFL 2026 Players DB" workbook as real evidence.
 *
 * That sheet's `Player Sentiment / Status` column gives a real, measured
 * target: across 2022-2026, "Disgruntled / Seeking Out" is 14 unique players
 * over 5 years (~2.8/yr); combined with the closely-related "Playing Time /
 * Role Frustration" bucket (37 rows), the two together run heavier in the
 * 2022-2023 rebuild-chaos years (15, 22/yr) and settle to ~6/yr in the more
 * stable 2024-2026 seasons. This mechanic is tuned (see CALIBRATION below)
 * to land a fresh save's first season in roughly that same 5-10-newly-
 * disgruntled-players range, comfortably under the ~40-trades/year anchor.
 *
 * SCOPE (Part 1 of 2, same disclosed split as engine/draftPicks.ts):
 * this file builds the real trigger layer and the persisted pool. It does
 * NOT wire the pool into engine/trade.ts's live offer/negotiation machinery
 * (a disgruntled player doesn't yet make AI clubs more willing to sell them,
 * or make the player themselves request a trade) — deferred for the exact
 * same reason draft-pick trading was: round 72 carefully calibrated real-
 * world trade FREQUENCY, and wiring a brand-new "willing seller" signal into
 * that same acceptance logic in the same pass makes any resulting drift
 * impossible to attribute to one change or the other. It also does not build
 * the "Trade Whispers narrative layer" (ROADMAP backlog #47/Status #49) that
 * would turn a disgruntled flag into templated prose — that is its own,
 * separately-scoped item, deliberately left for later so this pass stays
 * about the mechanic being real and correctly calibrated, not about copy.
 *
 * DATA MODEL: mirrors engine/progression.ts's `Season.condition` precedent
 * exactly, for the same reason — `Player.morale` is (per morale.ts's own
 * doc comment) "not yet in players_master.csv... a pure in-engine runtime
 * concept... until the real Event system... starts reading/writing this for
 * real." This IS that first real write, deliberately scoped to disgruntlement
 * only (not a general Event system) and, like condition, carried live on
 * `Season` rather than mutating `Player` objects in place: `effectiveMorale`
 * below is the `liveCondition`-style reconciliation point, and
 * `Season.disgruntlement` round-trips through save/load exactly like
 * `Season.condition` does (see saveGame.ts's `SerializedSeason`).
 *
 * THE THREE FACTORS, exactly as Tyler named them:
 *  - Out of position: this round's real `MatchTeam.positions` assignment
 *    (from a completed Selection Committee lineup, or `autoFillLineup` for
 *    every AI club — both suitability-aware, see engine/selection.ts) reads
 *    "Barely suitable" or "Not suitable" for the player's own archetype.
 *  - Not getting enough games: the player ranks in their OWN club's top 23
 *    by OVR (i.e. would reasonably expect to be picked) but was not named in
 *    this round's actual 23-man `MatchTeam.players`. Deliberately relative
 *    to the player's own list, not a fixed OVR cutoff — this engine has no
 *    concept of a player's own self-perceived stature to compare against
 *    otherwise, and "would make my own club's best 23 but got left out" is a
 *    real, defensible grievance regardless of what that OVR number actually
 *    is. A depth player who genuinely isn't top-23 quality sitting out is
 *    not modelled as a grievance at all — realistic, and keeps the base rate
 *    low by construction (most rounds, most clubs' actual pick matches their
 *    own top-23-by-OVR closely, since both `autoFillLineup` and a sensible
 *    human coach mostly pick good players).
 *  - Team morale low: no club-level morale field exists anywhere in this
 *    engine yet (checked: only `Player.morale` does). Read literally,
 *    "team morale" has no real signal to attach to; read as Tyler's own
 *    surrounding sentence frames it ("being PUSHED to play harder WHEN team
 *    morale is low"), it's an amplifier on the other two grievances rather
 *    than an independent third gate — a struggling team makes an existing
 *    out-of-position or benched grievance sting more, it doesn't invent a
 *    grievance out of nothing for a player who's otherwise fine. Modelled
 *    that way: `STRUGGLING_LADDER_FRACTION` of the ladder (bottom third),
 *    from `LADDER_GRACE_ROUNDS` onward (so a still-scoreless round 1-4
 *    table doesn't misread as "struggling"), multiplies whatever points the
 *    other two factors already produced this round. A disclosed proxy for a
 *    team-morale field that doesn't exist, same treatment this project gave
 *    the DVI curve — a genuine, real-anchored stand-in, not a literal field.
 *
 * ACCUMULATION: a single scalar `discontent` per player (not three separate
 * thresholds) — recoverable, not just monotonic: a clean round (no factors
 * firing) drains it, so one bad week doesn't quietly doom a player 20 rounds
 * later. Crossing `DISCONTENT_THRESHOLD` makes a player ELIGIBLE to flip to
 * disgruntled; whether they actually do that round is a seeded per-player
 * roll (`P_FLIP_WHEN_ELIGIBLE`), matching how every other real-feeling
 * outcome in this engine resolves (contest.ts's own threshold+roll pattern)
 * rather than a hard, perfectly-uniform cliff. A disgruntled player who then
 * drains back to at most half `DISCONTENT_THRESHOLD` (their role/form/club
 * meaningfully improved) resolves back to content — see `resolveDraftOrder`-
 * style precedent of "the mechanic can undo itself," not a one-way flag.
 *
 * CALIBRATION: see verify_round75_scratch.ts for the kept, real measured run
 * these constants were tuned against — a real, full 23-round home-and-away
 * season (real players.json, real 18 clubs, real autoFillLineup +
 * simulateRound). Across 3 different seeds it landed at 8, 8, and 9
 * newly-disgruntled players for the season — consistently inside the
 * ~5-10/season real target above, and comfortably under the ~40-trades/year
 * anchor. The dominant real driver measured this way is `low_game_time`.
 * `out_of_position` measured at a flat 0.0% across a full season with the
 * real Sep 2026 roster/archetype data — `autoFillLineup`'s suitability-first
 * greedy fill, combined with rosters deep and varied enough (35-54 players)
 * to fill all 23 real slots at Very/Somewhat suitable, means it currently
 * never fires. Not a bug: real AFL players mostly ARE in their right
 * position, so a dormant-most-of-the-time factor is the honest outcome, not
 * a forced one — and the mechanism is already in place for whenever roster
 * composition or a future feature (e.g. a human coach deliberately misusing
 * Selection Committee) makes it fire. Finals are deliberately NOT included
 * (`runFinals` never calls `nextDisgruntlementState`) — Tyler's own framing
 * is "mid-season," and home-and-away is where a club actually has a stable
 * enough lineup pattern for "out of position for weeks" or "can't get a
 * game" to mean anything.
 */

export type DisgruntlementFactor = "out_of_position" | "low_game_time" | "club_struggling";

export interface DisgruntlementState {
  /** Recoverable running score — see doc comment above. Never negative. */
  discontent: number;
  disgruntled: boolean;
  /** Round this player most recently flipped to disgruntled, or null if currently content. Not reset to null on resolution's own round — see `resolveDisgruntlement` below for the exact moment it clears. */
  disgruntledSinceRound: number | null;
  /** Whichever factor(s) actually fired the most recent round discontent moved — for a future Trade Whispers-style write-up layer to key off, not itself prose. Empty on a fully clean/reset player. */
  lastFactors: DisgruntlementFactor[];
  /** Cumulative live morale adjustment from this mechanic, always <= 0. Added to `player.morale ?? seedMorale(player)` by `effectiveMorale` below — never written back onto the `Player` object itself, same reasoning `Season.condition` gives for not touching `Player.condition`. */
  moraleDelta: number;
}

function emptyState(): DisgruntlementState {
  return { discontent: 0, disgruntled: false, disgruntledSinceRound: null, lastFactors: [], moraleDelta: 0 };
}

// --- Tuned constants — see scripts/verify_round75_scratch.ts for the measured calibration run. ---
const POINTS_OUT_OF_POSITION = 2;
const POINTS_LOW_GAME_TIME = 2;
/** "Pushed to play harder when team morale is low" — amplifies whatever the two factors above already produced this round; never fires on its own. */
const STRUGGLING_CLUB_MULTIPLIER = 1.5;
/** Bottom third of an 18-club ladder = bottom 6. */
const STRUGGLING_LADDER_FRACTION = 1 / 3;
/** Rounds 1-4 don't count toward "struggling" — too little separation on the ladder to mean anything yet. */
const LADDER_GRACE_ROUNDS = 4;
/** A clean round (no factors firing) drains this much discontent. */
const RECOVERY_PER_CLEAN_ROUND = 1;
/** Discontent needed before a player is even eligible to flip. */
const DISCONTENT_THRESHOLD = 10;
/**
 * Per-round probability an eligible player actually flips, once over
 * threshold — the main calibration lever alongside the threshold itself.
 * Measured against real data via scripts/calibrate_disgruntlement_scratch.ts
 * (not shipped — see verify_round75_scratch.ts for the kept, final check):
 * with the real Sep 2026 player pool, `season.ts`'s existing "teams are
 * picked once and held fixed for the season" simplification (its own gap
 * #16) means the ~34 players league-wide (~4.5% of 751) who are top-23-by-
 * OVR at their own club but didn't make the suitability-aware pick are
 * genuinely STUCK in that state for the whole season, not fluctuating round
 * to round — so this is effectively "P per remaining round, compounded over
 * ~18 rounds of permanent exposure," not a fresh independent roll each week.
 * 0.12 (a plausible-looking per-round number in isolation) compounds to a
 * ~90%+ chance across a season, which measured out to 30-31 newly-
 * disgruntled players across 3 seeds — 3-6x Tyler's real ~5-10/season
 * target. 0.015 compounds to ~24% of that same stuck pool, landing at 8, 8,
 * and 9 across the same 3 seeds — the kept value.
 */
const P_FLIP_WHEN_ELIGIBLE = 0.015;
/** How far `effectiveMorale` drops once disgruntled — comfortably past `interestScore`'s own `mor < 66` "Low morale at current club" read, so a disgruntled player already reads as rival-interesting even before any dedicated trade.ts wiring exists. */
const MORALE_HIT = 18;

function isStrugglingClub(clubId: number, round: number, ladder: readonly LadderRow[]): boolean {
  if (round <= LADDER_GRACE_ROUNDS || ladder.length === 0) return false;
  const cutoff = Math.floor(ladder.length * (1 - STRUGGLING_LADDER_FRACTION));
  const idx = ladder.findIndex((r) => r.clubId === clubId);
  return idx >= cutoff;
}

function top23ByOVR(roster: readonly Player[]): Set<number> {
  return new Set(
    [...roster]
      .sort((a, b) => b.OVR - a.OVR)
      .slice(0, 23)
      .map((p) => p.PlayerID),
  );
}

function rollFor(seasonSeed: number, round: number, playerId: number): number {
  // Distinct multiplier from season.ts's own matchSeed (seed + round*1000 + index) so a
  // per-player roll never accidentally lands on the same stream as a per-match one.
  return mulberry32(seasonSeed + round * 7919 + playerId * 104729)();
}

/**
 * One round's disgruntlement update for every non-delisted player at every
 * club in `teams` — mirrors `nextConditionMap`'s exact shape and calling
 * convention (see season.ts). `ladder` should be the ALREADY-updated ladder
 * for this round (simulateRound computes it before this call), since
 * "is my club struggling" should reflect the result that just happened.
 */
export function nextDisgruntlementState(
  prev: ReadonlyMap<number, DisgruntlementState>,
  round: number,
  teams: ReadonlyMap<number, MatchTeam>,
  ladder: readonly LadderRow[],
  seasonSeed: number,
): Map<number, DisgruntlementState> {
  const next = new Map(prev);
  for (const [clubId, team] of teams) {
    const club = clubById(clubId);
    if (!club) continue;
    const roster = getPlayersByClub(club.name);
    const eligibleByOVR = top23ByOVR(roster);
    const dressedIds = new Set(team.players.map((p) => p.PlayerID));
    const struggling = isStrugglingClub(clubId, round, ladder);

    for (const player of roster) {
      const id = player.PlayerID;
      const prevState = prev.get(id) ?? emptyState();

      const assignedPos = team.positions?.get(id);
      const outOfPosition = assignedPos !== undefined && !["Very suitable", "Somewhat suitable"].includes(suitabilityFor(player.archetype as Archetype, assignedPos));
      const lowGameTime = eligibleByOVR.has(id) && !dressedIds.has(id);

      const factors: DisgruntlementFactor[] = [];
      let points = 0;
      if (outOfPosition) {
        points += POINTS_OUT_OF_POSITION;
        factors.push("out_of_position");
      }
      if (lowGameTime) {
        points += POINTS_LOW_GAME_TIME;
        factors.push("low_game_time");
      }
      if (points > 0 && struggling) {
        points = Math.round(points * STRUGGLING_CLUB_MULTIPLIER);
        factors.push("club_struggling");
      }

      const discontent = points > 0 ? prevState.discontent + points : Math.max(0, prevState.discontent - RECOVERY_PER_CLEAN_ROUND);

      let state: DisgruntlementState = { ...prevState, discontent, lastFactors: points > 0 ? factors : prevState.lastFactors };

      if (!prevState.disgruntled && discontent >= DISCONTENT_THRESHOLD && rollFor(seasonSeed, round, id) < P_FLIP_WHEN_ELIGIBLE) {
        state = { ...state, disgruntled: true, disgruntledSinceRound: round, moraleDelta: -MORALE_HIT, lastFactors: factors };
      } else if (prevState.disgruntled && discontent <= DISCONTENT_THRESHOLD / 2) {
        // Resolved: role/form/club meaningfully improved for a sustained stretch (needs
        // several genuinely clean rounds, not just one — RECOVERY_PER_CLEAN_ROUND is slow
        // by design, same "grudges fade slowly" reasoning real interpersonal friction has).
        // Half the threshold, not all the way back to 0 — see this file's own doc comment on
        // why 0 is realistically unreachable for the dominant current trigger (a player stuck
        // outside their club's own frozen-for-the-season lineup, per season.ts's gap #16,
        // never gets a single clean round to drain from, so requiring 0 would make resolution
        // dead code for exactly the players who make up most of this mechanic's real signal).
        state = { ...state, disgruntled: false, moraleDelta: 0 };
      }

      if (state.discontent !== 0 || state.disgruntled || state.moraleDelta !== 0 || state.lastFactors.length > 0) {
        next.set(id, state);
      } else {
        next.delete(id); // fully neutral again — same "missing = fresh" convention as Season.condition
      }
    }
  }
  return next;
}

/** `liveCondition`-style reconciliation: prefers the season-live morale (baseline + this mechanic's delta) and falls back to the static seed for any player untouched by disgruntlement, or when no season is in progress. Never writes back to the `Player` object — see this file's own doc comment. */
export function effectiveMorale(player: Pick<Player, "PlayerID" | "morale">, disgruntlement?: ReadonlyMap<number, DisgruntlementState>): number {
  const base = player.morale ?? seedMorale(player);
  const delta = disgruntlement?.get(player.PlayerID)?.moraleDelta ?? 0;
  return Math.max(0, Math.min(100, base + delta));
}

/** The "potential trade pool" Tyler asked for — every currently-disgruntled PlayerID, most-recently-disgruntled first. Deliberately just IDs (not a richer view type): every existing screen that wants full player detail already has a `getPlayerById`-style lookup pattern (see PlayerLink/PlayerProfile), so this stays a thin, composable list rather than inventing a parallel player-summary shape. */
export function disgruntledPlayerPool(disgruntlement: ReadonlyMap<number, DisgruntlementState>): number[] {
  return [...disgruntlement.entries()]
    .filter(([, s]) => s.disgruntled)
    .sort((a, b) => (b[1].disgruntledSinceRound ?? 0) - (a[1].disgruntledSinceRound ?? 0))
    .map(([id]) => id);
}

export const DISGRUNTLEMENT_TUNING = {
  POINTS_OUT_OF_POSITION,
  POINTS_LOW_GAME_TIME,
  STRUGGLING_CLUB_MULTIPLIER,
  STRUGGLING_LADDER_FRACTION,
  LADDER_GRACE_ROUNDS,
  RECOVERY_PER_CLEAN_ROUND,
  DISCONTENT_THRESHOLD,
  P_FLIP_WHEN_ELIGIBLE,
  MORALE_HIT,
} as const;
