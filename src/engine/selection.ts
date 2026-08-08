import type { Player } from "../types/player.ts";
import type { Archetype } from "../types/archetype.ts";
import { POSITIONS, suitabilityFor, type Position, type Suitability } from "../types/archetype.ts";
import type { MatchTeam } from "./team.ts";
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
 * can always kick off with 22, same top-up spirit as pickBest22 — a topped-up
 * player has no real assigned slot, so (like an INT-slotted player) they
 * simply have no entry in `positions`, and `engine/involvement.ts` falls
 * back to their archetype's own implied zone for them, same as it always did
 * before `positions` existed.
 */
export function lineupToMatchTeam(clubName: string, lineup: Lineup, allClubPlayers: readonly Player[]): MatchTeam {
  const byId = new Map(allClubPlayers.map((p) => [p.PlayerID, p]));
  const picked: Player[] = [];
  const pickedIds = new Set<number>();
  const positions = new Map<number, Position>();
  lineup.forEach((id, i) => {
    if (id === null) return;
    const p = byId.get(id);
    if (p && !pickedIds.has(id)) {
      picked.push(p);
      pickedIds.add(id);
      positions.set(id, POSITIONS[i]);
    }
  });
  if (picked.length < 22) {
    const remaining = [...allClubPlayers].filter((p) => !pickedIds.has(p.PlayerID)).sort((a, b) => b.OVR - a.OVR);
    for (const p of remaining) {
      if (picked.length >= 22) break;
      picked.push(p);
      pickedIds.add(p.PlayerID);
    }
  }
  return { name: clubName, players: picked.slice(0, 22), positions };
}

/** Convenience: the existing pickBest22 stand-in, exposed here too so callers can offer "reset to auto-pick" without importing team.ts directly. */
export function bestAvailableTeam(clubName: string, allClubPlayers: readonly Player[]): MatchTeam {
  return pickBest22(clubName, [...allClubPlayers]);
}

export type { Position };
