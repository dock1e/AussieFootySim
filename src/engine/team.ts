import type { Player } from "../types/player.ts";
import type { Archetype, Position } from "../types/archetype.ts";
import { ARCHETYPE_LINE, type Line } from "../data/lines.ts";

export interface MatchTeam {
  name: string;
  players: Player[]; // the full matchday squad — 23 as of the 2026 rule change (18 on-field + 5 interchange), see types/archetype.ts's POSITIONS
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
  /**
   * PlayerIDs currently out on the ground — the other members of `players`
   * are on the interchange bench. Aug 2026, round 8 (Tyler: "the Interchange
   * players are currently on the field the whole time... we need to include a
   * provision for the interchange players"): a deliberately minimal
   * provision, not a rotation system — `engine/selection.ts`'s
   * `lineupToMatchTeam` sets this once, from whichever players a real
   * Selection Committee lineup put in the 18 real (non-`INT`) slots, and nothing
   * currently changes it over the course of a match, since no rotation
   * *strategy* exists yet (Tyler's own words: more direction on "tactics and
   * running patterns" is still to come). Optional and additive, same spirit as
   * `positions` above: undefined means "no on-ground/bench distinction known
   * for this team" (the plain `pickBest22` fallback, the balance simulator,
   * every existing test) and every consumer below treats that exactly like
   * today's pre-round-8 behaviour — everyone in `players` counts as on the
   * ground. See `onGroundPlayers` for the one shared place that distinction is
   * actually applied.
   */
  onGround?: Set<number>;
  /**
   * Aug 2026, round 48 — [[Interchange Rotation]]: PlayerID -> the real
   * ground positions that player is allowed to rotate into as part of an
   * interchange swap, for every player in `players` (not just whoever
   * started on `INT` — once a starter is rotated off by fitness, they need
   * their own eligibility set too, to be a valid candidate to rotate back
   * on later). Populated by `engine/selection.ts`'s `lineupToMatchTeam`:
   * `types/archetype.ts`'s `defaultEligiblePositions` unioned with the
   * player's own assigned slot (so a coach's unusual pick can always rotate
   * back to where they started, even if their archetype doesn't otherwise
   * favour it), then overridden per-player wherever the coach has explicitly
   * set one via Selection Committee (`useSelectionStore`'s eligibility
   * overrides). Optional and additive, same fallback spirit as `positions`/
   * `onGround` above: a team built without real per-slot position data
   * (`pickBest22`, the balance simulator, every pre-round-48 test) simply
   * has no entry here, and `match.ts`'s automatic-rotation step treats a
   * missing map as "no rotation strategy for this side" rather than erroring
   * — exactly like a missing `onGround` today means "no bench distinction."
   */
  interchangeEligibility?: Map<number, Set<Position>>;
}

/**
 * The subset of `team.players` currently out on the ground — every consumer
 * that picks *who's actually involved in live play* (match.ts's ruck/
 * clearance reps, involvement.ts's weightedPlayerChoice, ground.ts's dot
 * rendering) should read through this rather than `team.players` directly, so
 * the interchange bench can't leak into any of them. Falls back to the full
 * squad when `onGround` isn't set (see that field's own doc comment), and
 * defensively falls back again if `onGround` is somehow set but empty —
 * every real caller needs *some* non-empty player list to pick from, and an
 * empty bench-everyone state should never be able to crash a match.
 */
export function onGroundPlayers(team: MatchTeam): Player[] {
  if (!team.onGround) return team.players;
  const filtered = team.players.filter((p) => team.onGround!.has(p.PlayerID));
  return filtered.length > 0 ? filtered : team.players;
}

/**
 * The mirror image of `onGroundPlayers` — whoever's on the interchange bench
 * right now. Round 16 (Aug 2026), Tyler: "having our players on the bench
 * sitting there while they wait to come on" — until now `onGround`'s
 * complement was never actually read anywhere; a bench player simply never
 * appeared in `formationFor`'s output and there was no way to ask "who's
 * out" as a positive list. Returns `[]` (not the full squad) whenever
 * `onGround` is unset — for a team with no real on-ground/bench distinction
 * (`pickBest22`, the balance simulator, every pre-round-8 test) there's no
 * meaningful "bench" to show, and an empty list is exactly what a caller
 * building a UI strip wants: nothing rendered rather than every player
 * doubly listed as both on-ground *and* benched.
 */
export function benchPlayers(team: MatchTeam): Player[] {
  if (!team.onGround) return [];
  return team.players.filter((p) => !team.onGround!.has(p.PlayerID));
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
  // fields a full squad even if the line targets above don't divide evenly.
  // Aug 2026, round 8: cap raised 22 -> 23, matching the 2026 AFL rule change
  // to a 5-player interchange bench (types/archetype.ts's `POSITIONS`) —
  // `pickBest22` doesn't attempt its own on-ground/bench split (it has no
  // real per-slot position data to split by, unlike `lineupToMatchTeam`), so
  // it keeps its pre-existing name and behaviour otherwise unchanged, just
  // one more player. See `MatchTeam.onGround`'s own doc comment for what that
  // means for a team built this way.
  if (picked.length < 23) {
    const remaining = allClubPlayers
      .filter((p) => !pickedIds.has(p.PlayerID))
      .sort((a, b) => b.OVR - a.OVR);
    for (const p of remaining) {
      if (picked.length >= 23) break;
      picked.push(p);
      pickedIds.add(p.PlayerID);
    }
  }

  return { name: clubName, players: picked.slice(0, 23) };
}

/** The single highest-rated player on a team for a given rated-attribute composite — used to pick stoppage/ruck representatives. */
export function bestByRating(players: Player[], rate: (p: Player) => number): Player {
  if (players.length === 0) throw new Error("bestByRating: players must be non-empty");
  return players.reduce((best, p) => (rate(p) > rate(best) ? p : best), players[0]);
}
