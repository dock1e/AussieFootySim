import type { Player } from "../types/player.ts";
import type { Archetype, Position } from "../types/archetype.ts";
import { ARCHETYPE_LINE, type Line } from "../data/lines.ts";

export interface MatchTeam {
  name: string;
  players: Player[]; // exactly 22, the simulated match-day list
  /**
   * PlayerID -> the real on-field slot (FB, CHF, whatever) that player is
   * assigned to, when known — see `engine/selection.ts`'s `lineupToMatchTeam`
   * (populated from a real Lineup) and `autoFillLineup` (the suitability-aware
   * auto-pick, now used for AI-controlled clubs too, not just a human coach's
   * Selection Committee — see ROADMAP.md "Phase 8"). Optional and additive:
   * `pickBest22` below still doesn't populate it, so any existing caller that
   * only ever produced a bare `{name, players}` (the balance simulator,
   * scratch scripts, tests) keeps working byte-identically. `engine/match.ts`
   * treats a missing map, or a player missing from it, exactly like a missing
   * `Position` for `engine/involvement.ts`'s weighting — falls back to the
   * player's archetype-implied zone rather than erroring.
   */
  positions?: Map<number, Position>;
}

/**
 * There's no Selection Committee / lineup system yet (see ROADMAP.md Phase
 * 3), so match simulation needs *some* way to turn a ~35-46 player club
 * list into a 22-player match squad. This is a deliberately simple stand-in
 * for that: take the best-by-OVR players from each line, roughly
 * proportioned to the real 18-slot breakdown (Configuration.md
 * "Positions": 6 defence slots, ~7 midfield-ish, ~7 forward-ish, 2 ruck,
 * before interchange) — NOT a real position-suitability pick. Revisit once
 * the actual Selection Committee screen exists.
 */
/** Exported for reuse by listNeeds.ts's "best-23 quality" starter quota — see its own doc comment for why the same on-field split doubles as a roster-diagnosis number. */
export const LINE_TARGETS: Record<Line, number> = {
  Defence: 6,
  Midfield: 7,
  Forwards: 7,
  Ruck: 2,
};

export function pickBest22(clubName: string, allClubPlayers: Player[]): MatchTeam {
  const byLine = new Map<Line, Player[]>();
  for (const line of Object.keys(LINE_TARGETS) as Line[]) {
    byLine.set(
      line,
      allClubPlayers
        .filter((p) => ARCHETYPE_LINE[p.archetype as Archetype] === line)
        .sort((a, b) => b.OVR - a.OVR),
    );
  }

  const picked: Player[] = [];
  const pickedIds = new Set<number>();
  for (const line of Object.keys(LINE_TARGETS) as Line[]) {
    const target = LINE_TARGETS[line];
    const pool = byLine.get(line) ?? [];
    for (const p of pool.slice(0, target)) {
      picked.push(p);
      pickedIds.add(p.PlayerID);
    }
  }

  // Under-strength lines (a club genuinely thin at Ruck, say) get topped up
  // by best-available OVR from the rest of the list, so every team still
  // fields 22 even if the line targets above don't divide evenly.
  if (picked.length < 22) {
    const remaining = allClubPlayers
      .filter((p) => !pickedIds.has(p.PlayerID))
      .sort((a, b) => b.OVR - a.OVR);
    for (const p of remaining) {
      if (picked.length >= 22) break;
      picked.push(p);
      pickedIds.add(p.PlayerID);
    }
  }

  return { name: clubName, players: picked.slice(0, 22) };
}

/** The single highest-rated player on a team for a given rated-attribute composite — used to pick stoppage/ruck representatives. */
export function bestByRating(players: Player[], rate: (p: Player) => number): Player {
  if (players.length === 0) throw new Error("bestByRating: players must be non-empty");
  return players.reduce((best, p) => (rate(p) > rate(best) ? p : best), players[0]);
}
