import type { Player } from "../types/player.ts";
import type { Archetype } from "../types/archetype.ts";
import { POSITIONS, suitabilityFor, defaultEligiblePositions, type Position, type Suitability } from "../types/archetype.ts";
import type { Cover, MatchTeam } from "./team.ts";
import { pickBest22 } from "./team.ts";
import { specialistGroups, type RestPolicy, type RotationGroup } from "./rotation.ts";

const BENCH_COVERAGE_BONUS = 5;

/**
 * Selection Committee — Engine.md/User Interface.md's ground-diagram team
 * editor, Configuration.md "Positions": the real 18-slot + 4-interchange
 * structure (`POSITIONS`), each slot fillable by any club player, guided by
 * `suitabilityFor` (already built in Phase 0 — see types/archetype.ts).
 *
 * Scoped down from the full spec on purpose: this ships as a flat 22-row
 * list editor, not the ground-diagram drag-and-drop visual User Interface.md
 * describes — same "function now, polish later" trade-off the rest of this
 * project makes explicit. The engine doesn't consume *which* slot a player
 * fills anyway (match.ts only cares who's in the 22 — see ROADMAP.md gap
 * #9), so a list editor produces exactly the same match-simulation input a
 * ground diagram would, just without the visual.
 *
 * A `Lineup` is a 22-length array parallel to `POSITIONS` — `lineup[i]` is
 * the PlayerID (or null if empty) assigned to `POSITIONS[i]`. A plain array
 * rather than a Position-keyed map because several labels repeat (`BP`
 * appears twice, `INT` four times) and need independent slots.
 */
export type Lineup = (number | null)[];

export function emptyLineup(): Lineup {
  return POSITIONS.map(() => null);
}

/** Exported for reuse by `engine/involvement.ts` — the same Very/Somewhat/Barely/Not tiering doubles as the numeric weight a position-suitable player gets favoured with when match.ts picks who's actually involved in a live event (see ROADMAP.md "Phase 8"), not just how good an auto-fill placement is. */
export const SUITABILITY_RANK: Record<Suitability, number> = {
  "Very suitable": 3,
  "Somewhat suitable": 2,
  "Barely suitable": 1,
  "Not suitable": 0,
};

/**
 * Greedy auto-fill: walks `POSITIONS` in order, at each slot taking the
 * best-remaining-suitability player (ties broken by OVR) from whoever's
 * left. A real optimal assignment is a bipartite-matching problem; this is
 * the same "good enough, honestly labelled" simplification `pickBest22`
 * already makes for the no-Selection-Committee case, just suitability-aware
 * instead of pure OVR — mirrors the reference site's own "Assistant
 * auto-fill" feature confirmed during the Aug 2026 live play-through.
 */
export function autoFillLineup(players: readonly Player[]): Lineup {
  const used = new Set<number>();
  const lineup: Lineup = [];
  // ROADMAP #16 — the bench is picked to cover different rotation groups, not just the next five by
  // OVR: each group a candidate would add to the bench's coverage is worth a few OVR points.
  const benchCovers = new Set<RotationGroup>();
  for (const position of POSITIONS) {
    let best: Player | null = null;
    let bestScore = -1;
    for (const p of players) {
      if (used.has(p.PlayerID)) continue;
      const tier = SUITABILITY_RANK[suitabilityFor(p.archetype as Archetype, position)];
      const coverage = position === "INT" ? Math.min(2, specialistGroups(p).filter((g) => !benchCovers.has(g)).length) * BENCH_COVERAGE_BONUS : 0;
      const score = tier * 1000 + p.OVR + coverage;
      if (score > bestScore) {
        best = p;
        bestScore = score;
      }
    }
    if (best) {
      lineup.push(best.PlayerID);
      used.add(best.PlayerID);
      if (position === "INT") for (const g of specialistGroups(best)) benchCovers.add(g);
    } else {
      lineup.push(null);
    }
  }
  return lineup;
}

export function isLineupComplete(lineup: Lineup): boolean {
  return lineup.length === POSITIONS.length && lineup.every((id) => id !== null);
}

export function lineupPlayerIds(lineup: Lineup): number[] {
  return lineup.filter((id): id is number => id !== null);
}

/**
 * Turns a completed lineup into the MatchTeam shape match.ts consumes.
 * Falls back to best-available top-up for any still-empty slots so a match
 * can always kick off with a full squad, same top-up spirit as pickBest22 —
 * a topped-up player has no real assigned slot, so (like an INT-slotted
 * player) they simply have no entry in `positions`, and
 * `engine/involvement.ts` falls back to their archetype's own implied zone
 * for them, same as it always did before `positions` existed.
 *
 * Aug 2026, round 8: cap raised 22 -> 23 (`POSITIONS` now has 5 `INT` slots,
 * matching the 2026 AFL rule change — see that constant's own doc comment).
 * Also now populates `MatchTeam.onGround`: every player who landed a real,
 * named on-field slot (i.e. `POSITIONS[i] !== "INT"`) is on the ground; a
 * player who landed an `INT` slot is on the bench. A top-up player (the loop
 * below, only reached when the lineup itself had empty slots) is counted as
 * on-ground — they're standing in for a real position that would otherwise be
 * empty, the same reasoning that already puts them in `players` at all rather
 * than leaving the team short.
 *
 * Aug 2026, round 48 — [[Interchange Rotation]]: also populates
 * `MatchTeam.interchangeEligibility` for every picked player (not just the 5
 * who started on `INT` — see that field's own doc comment for why a starter
 * needs one too). `eligibilityOverrides` is the coach's own saved per-player
 * edits from Selection Committee (`useSelectionStore`, keyed by PlayerID);
 * anyone not present there — which is everyone, until a coach actually opens
 * the new eligibility editor — gets `defaultEligiblePositions(archetype)`
 * unioned with their own assigned slot, so a coach who never touches this
 * screen still gets a fully-formed, sensible eligibility map, not an empty
 * one (same "a coach who touches nothing still gets a real plan" precedent
 * `sanitizePlan` already established for tactics). A top-up player (no real
 * assigned slot) gets the archetype default with nothing to union in, same
 * as their `positions` entry being absent too.
 */
export function lineupToMatchTeam(
  clubName: string,
  lineup: Lineup,
  allClubPlayers: readonly Player[],
  eligibilityOverrides?: Record<number, Position[]>,
  /** Round 130 — the coach's pinned relievers (see `MatchTeam.covers`). Only entries whose players are all in this 23 are kept. */
  covers?: Record<number, Cover | null>,
  /** ROADMAP #16 — the coach's per-player rest policies (see `MatchTeam.restPolicy`). */
  restPolicy?: Record<number, RestPolicy>,
): MatchTeam {
  const byId = new Map(allClubPlayers.map((p) => [p.PlayerID, p]));
  const picked: Player[] = [];
  const pickedIds = new Set<number>();
  const positions = new Map<number, Position>();
  const onGround = new Set<number>();
  lineup.forEach((id, i) => {
    if (id === null) return;
    const p = byId.get(id);
    if (p && !pickedIds.has(id)) {
      picked.push(p);
      pickedIds.add(id);
      positions.set(id, POSITIONS[i]);
      if (POSITIONS[i] !== "INT") onGround.add(id);
    }
  });
  if (picked.length < 23) {
    const remaining = [...allClubPlayers].filter((p) => !pickedIds.has(p.PlayerID)).sort((a, b) => b.OVR - a.OVR);
    for (const p of remaining) {
      if (picked.length >= 23) break;
      picked.push(p);
      pickedIds.add(p.PlayerID);
      onGround.add(p.PlayerID);
    }
  }
  const interchangeEligibility = new Map<number, Set<Position>>();
  for (const p of picked) {
    const override = eligibilityOverrides?.[p.PlayerID];
    const assigned = positions.get(p.PlayerID);
    // Round 128 (Match Day flow, Rotations step): an override is the coach's explicit pairing list,
    // so an empty one now means "rotates into nothing" rather than "use the default". A player's own
    // on-ground slot is always added back, so someone moved from the bench into the 18 can still
    // return to his own position after a rest.
    if (override) {
      interchangeEligibility.set(p.PlayerID, new Set(assigned && assigned !== "INT" ? [...override, assigned] : override));
      continue;
    }
    const defaults = defaultEligiblePositions(p.archetype as Archetype);
    interchangeEligibility.set(p.PlayerID, new Set(assigned ? [...defaults, assigned] : defaults));
  }
  const squad = picked.slice(0, 23);
  let coverMap: Map<number, Cover> | undefined;
  if (covers) {
    const inSquad = new Set(squad.map((p) => p.PlayerID));
    coverMap = new Map();
    for (const [id, c] of Object.entries(covers)) {
      if (!c || !inSquad.has(Number(id)) || !inSquad.has(c.by) || (c.fill !== undefined && !inSquad.has(c.fill))) continue;
      coverMap.set(Number(id), c);
    }
  }
  const policyMap = restPolicy ? new Map(Object.entries(restPolicy).map(([id, p]) => [Number(id), p])) : undefined;
  return { name: clubName, players: squad, positions, onGround, interchangeEligibility, covers: coverMap, restPolicy: policyMap };
}

/**
 * Oct 2026 — [[Injuries]]. `team` with any `unavailable` (injured) players taken out and their slots
 * filled from the rest of the club's list, best suitability then OVR — the same rule `autoFillLineup`
 * uses. Everyone else keeps his selected slot, and the coach's pins and rest policies carry over.
 * Returns `team` itself when nobody in it is unavailable.
 */
export function withAvailablePlayers(team: MatchTeam, clubPlayers: readonly Player[], unavailable: ReadonlySet<number>): MatchTeam {
  if (!team.players.some((p) => unavailable.has(p.PlayerID))) return team;
  const inTeam = new Set(team.players.map((p) => p.PlayerID));
  if (!team.positions) {
    // No slot data (a `pickBest22` team): swap each injured man for the best available by OVR, nobody else changes.
    const spares = clubPlayers.filter((p) => !inTeam.has(p.PlayerID) && !unavailable.has(p.PlayerID) && !p.delisted).sort((a, b) => b.OVR - a.OVR);
    return { ...team, players: team.players.map((p) => (unavailable.has(p.PlayerID) ? (spares.shift() ?? p) : p)).filter((p) => !unavailable.has(p.PlayerID)) };
  }
  const lineup: Lineup = emptyLineup();
  const unplaced: number[] = [];
  for (const p of team.players) {
    if (unavailable.has(p.PlayerID)) continue;
    const pos: Position | undefined = team.positions.get(p.PlayerID);
    const i = pos ? POSITIONS.findIndex((x, idx) => x === pos && lineup[idx] === null) : -1;
    if (i >= 0) lineup[i] = p.PlayerID;
    else unplaced.push(p.PlayerID);
  }
  // A selected player with no slot of his own (a top-up) stays in the 23 rather than being dropped.
  for (const id of unplaced) {
    const i = lineup.findIndex((x, idx) => x === null && POSITIONS[idx] === "INT");
    const j = i >= 0 ? i : lineup.findIndex((x) => x === null);
    if (j >= 0) lineup[j] = id;
  }
  const used = new Set(lineupPlayerIds(lineup));
  lineup.forEach((id, i) => {
    if (id !== null) return;
    let best: Player | null = null;
    let bestScore = -1;
    for (const p of clubPlayers) {
      if (used.has(p.PlayerID) || unavailable.has(p.PlayerID) || p.delisted) continue;
      const score = SUITABILITY_RANK[suitabilityFor(p.archetype as Archetype, POSITIONS[i])] * 1000 + p.OVR;
      if (score > bestScore) {
        best = p;
        bestScore = score;
      }
    }
    if (best) {
      lineup[i] = best.PlayerID;
      used.add(best.PlayerID);
    }
  });
  const eligibility: Record<number, Position[]> = {};
  for (const [id, set] of team.interchangeEligibility ?? []) if (used.has(id)) eligibility[id] = [...set];
  const covers: Record<number, Cover> = {};
  for (const [id, c] of team.covers ?? []) covers[id] = c;
  const restPolicy: Record<number, RestPolicy> = {};
  for (const [id, r] of team.restPolicy ?? []) restPolicy[id] = r;
  return lineupToMatchTeam(team.name, lineup, clubPlayers, eligibility, covers, restPolicy);
}

/** Convenience: the existing pickBest22 stand-in, exposed here too so callers can offer "reset to auto-pick" without importing team.ts directly. */
export function bestAvailableTeam(clubName: string, allClubPlayers: readonly Player[]): MatchTeam {
  return pickBest22(clubName, [...allClubPlayers]);
}

export type { Position };

// --- Pinned relievers (round 130's covers, ROADMAP #16) --------------------------------------------

/**
 * Keeps only pins that still make sense for `lineup` — the rester is on the ground and his reliever on
 * the bench — normalised to `{ by: benchId }` (a round-130 chain becomes a pin on its `fill`; the
 * goal-reset re-sort now moves a teammate across by itself).
 */
export function validCovers(lineup: Lineup, covers: Record<number, Cover | null>): Record<number, Cover> {
  const slotOf = new Map<number, number>();
  lineup.forEach((id, i) => {
    if (id !== null) slotOf.set(id, i);
  });
  const onField = (id: number) => slotOf.has(id) && POSITIONS[slotOf.get(id)!] !== "INT";
  const onBench = (id: number) => slotOf.has(id) && POSITIONS[slotOf.get(id)!] === "INT";
  const out: Record<number, Cover> = {};
  for (const [r, c] of Object.entries(covers)) {
    const rester = Number(r);
    if (!c || !onField(rester)) continue;
    const by = c.fill ?? c.by;
    if (onBench(by)) out[rester] = { by };
  }
  return out;
}
