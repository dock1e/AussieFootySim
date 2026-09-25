import type { Player } from "../types/player.ts";
import type { Archetype } from "../types/archetype.ts";
import { POSITIONS, suitabilityFor, defaultEligiblePositions, type Position, type Suitability } from "../types/archetype.ts";
import type { Cover, MatchTeam } from "./team.ts";
import { pickBest22 } from "./team.ts";

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
  for (const position of POSITIONS) {
    let best: Player | null = null;
    let bestScore = -1;
    for (const p of players) {
      if (used.has(p.PlayerID)) continue;
      const tier = SUITABILITY_RANK[suitabilityFor(p.archetype as Archetype, position)];
      const score = tier * 1000 + p.OVR;
      if (score > bestScore) {
        best = p;
        bestScore = score;
      }
    }
    if (best) {
      lineup.push(best.PlayerID);
      used.add(best.PlayerID);
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
  /** Round 130 — the coach's per-player covers (see `MatchTeam.covers`). Only entries whose players are all in this 23 are kept. */
  covers?: Record<number, Cover | null>,
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
  return { name: clubName, players: squad, positions, onGround, interchangeEligibility, covers: coverMap };
}

/** Convenience: the existing pickBest22 stand-in, exposed here too so callers can offer "reset to auto-pick" without importing team.ts directly. */
export function bestAvailableTeam(clubName: string, allClubPlayers: readonly Player[]): MatchTeam {
  return pickBest22(clubName, [...allClubPlayers]);
}

export type { Position };

// --- Round 130: per-player covers (Match Day flow v2) --------------------------------------------

/** Positions where a player with no relief is flagged as a fatigue risk (and which default covers go to first). */
export const RELIEF_POSITIONS: readonly Position[] = ["R", "RR", "ROV", "C", "W", "HFF", "HBF"];
const DEFAULT_COVER_ORDER: readonly Position[] = ["R", "RR", "ROV", "C", "W", "HFF", "HBF", "FP"];
const MAX_DEFAULT_COVERS_PER_BENCH = 3;

/** Keeps only covers that still make sense for `lineup`: the rester is on the ground; `by` is on the bench (swap), or on the ground with `fill` on the bench (chain). */
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
    if (onBench(c.by)) out[rester] = { by: c.by };
    else if (onField(c.by) && c.by !== rester && c.fill !== undefined && onBench(c.fill)) out[rester] = { by: c.by, fill: c.fill };
  }
  return out;
}

/**
 * Covers for a club that hasn't set any yet — and the migration from the old per-position rotations:
 * each bench player covers starters in the positions he was cleared for (`eligibility`, else his
 * archetype default), best fit first, at most three each, ruck and midfield first. A ruck with no
 * bench cover gets a chain instead: an on-field teammate suited to the ruck moves across (van Rooyen
 * from the forward pocket) and a bench player fills his spot.
 */
export function defaultCovers(lineup: Lineup, players: readonly Player[], eligibility?: Record<number, Position[]>): Record<number, Cover | null> {
  const byId = new Map(players.map((p) => [p.PlayerID, p]));
  const bench: Player[] = [];
  const starters: { p: Player; pos: Position }[] = [];
  lineup.forEach((id, i) => {
    const p = id !== null ? byId.get(id) : undefined;
    if (!p) return;
    if (POSITIONS[i] === "INT") bench.push(p);
    else starters.push({ p, pos: POSITIONS[i] });
  });
  const eligibleFor = (b: Player) => eligibility?.[b.PlayerID] ?? defaultEligiblePositions(b.archetype as Archetype);
  const load = new Map<number, number>();
  const rank = (p: Player, pos: Position) => SUITABILITY_RANK[suitabilityFor(p.archetype as Archetype, pos)];
  const bestBench = (pos: Position) =>
    bench
      .filter((b) => eligibleFor(b).includes(pos) && (load.get(b.PlayerID) ?? 0) < MAX_DEFAULT_COVERS_PER_BENCH)
      .sort((a, b) => rank(b, pos) - rank(a, pos) || (load.get(a.PlayerID) ?? 0) - (load.get(b.PlayerID) ?? 0) || b.OVR - a.OVR)[0];
  const out: Record<number, Cover | null> = {};
  const movers = new Set<number>();
  const ordered = [...starters]
    .filter((s) => DEFAULT_COVER_ORDER.includes(s.pos))
    .sort((a, b) => DEFAULT_COVER_ORDER.indexOf(a.pos) - DEFAULT_COVER_ORDER.indexOf(b.pos));
  for (const { p, pos } of ordered) {
    if (movers.has(p.PlayerID)) continue; // already moving across to cover the ruck — he isn't also rested
    const b = bestBench(pos);
    if (b) {
      out[p.PlayerID] = { by: b.PlayerID };
      load.set(b.PlayerID, (load.get(b.PlayerID) ?? 0) + 1);
      continue;
    }
    if (pos !== "R") continue;
    const mover = starters
      .filter((s) => s.p.PlayerID !== p.PlayerID && s.pos !== "R" && !movers.has(s.p.PlayerID) && rank(s.p, "R") >= 2)
      .sort((a, b) => rank(b.p, "R") - rank(a.p, "R") || b.p.OVR - a.p.OVR)[0];
    const fill = mover ? bestBench(mover.pos) : undefined;
    if (mover && fill) {
      out[p.PlayerID] = { by: mover.p.PlayerID, fill: fill.PlayerID };
      movers.add(mover.p.PlayerID);
      load.set(fill.PlayerID, (load.get(fill.PlayerID) ?? 0) + 1);
    }
  }
  return out;
}
