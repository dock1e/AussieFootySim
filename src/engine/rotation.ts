import type { Player } from "../types/player.ts";
import { defaultEligiblePositions, suitabilityFor, type Archetype, type Position } from "../types/archetype.ts";

/**
 * Oct 2026, ROADMAP #16 — [[Interchange Rotation]] v3: rotation groups and the goal-reset rotation.
 *
 * Tyler: "I want the AI to do 99% of the heavy lifting with the player just able to groom or customize
 * those decisions." And: after a goal "2-4 players interchange, and as the new players come onto the
 * field they reset the ground to the '6-6-6' starting positions" — that reset is the primary moment
 * rotations happen.
 *
 * Replaces round 130's fixed one-to-one covers. A bench player belongs to every rotation group his
 * eligible positions touch; at a reset the tiredest on-ground players come off and the fresh bench
 * players who keep the team's shape best come on. The 18 on the ground are then re-sorted across the
 * 18 slots (an optimal assignment), so a returning tall defender takes the tired full back's spot
 * rather than bumping the small defender who covered his back pocket. Coach overrides: a bench
 * player's groups (stored as eligibility), a per-player rest policy, and optional pinned relievers
 * (round 130's covers, now a preference rather than a rule).
 *
 * Pure functions only — `match.ts` owns when this runs and logs what it decides.
 */

export type RotationGroup = "KeyDefence" | "Defence" | "Midfield" | "Ruck" | "Forward" | "KeyForward";

export const ROTATION_GROUPS: readonly { key: RotationGroup; label: string; short: string; positions: readonly Position[] }[] = [
  { key: "KeyDefence", label: "Key defence", short: "Key def", positions: ["FB", "CHB"] },
  { key: "Defence", label: "General defence", short: "Def", positions: ["BP", "HBF"] },
  { key: "Midfield", label: "Midfield", short: "Mid", positions: ["C", "W", "RR", "ROV"] },
  { key: "Ruck", label: "Ruck", short: "Ruck", positions: ["R"] },
  { key: "Forward", label: "General forward", short: "Fwd", positions: ["HFF", "FP"] },
  { key: "KeyForward", label: "Key forward", short: "Key fwd", positions: ["CHF", "FF"] },
];

const GROUP_BY_KEY = new Map(ROTATION_GROUPS.map((g) => [g.key, g]));

export function groupOfPosition(pos: Position): RotationGroup | undefined {
  return ROTATION_GROUPS.find((g) => g.positions.includes(pos))?.key;
}

export function positionsOfGroups(groups: readonly RotationGroup[]): Position[] {
  return groups.flatMap((g) => [...(GROUP_BY_KEY.get(g)?.positions ?? [])]);
}

export function groupLabel(g: RotationGroup): string {
  return GROUP_BY_KEY.get(g)?.label ?? g;
}

export function groupShort(g: RotationGroup): string {
  return GROUP_BY_KEY.get(g)?.short ?? g;
}

/** Every group at least one of `eligible` falls in, in `ROTATION_GROUPS` order. */
export function groupsCovered(eligible: Iterable<Position>): RotationGroup[] {
  const set = new Set(eligible);
  return ROTATION_GROUPS.filter((g) => g.positions.some((p) => set.has(p))).map((g) => g.key);
}

/** Groups a player is a genuine specialist for (Very suitable somewhere in the group) — what a balanced bench is judged on. */
export function specialistGroups(p: Player): RotationGroup[] {
  return ROTATION_GROUPS.filter((g) => g.positions.some((pos) => fitRank(p, pos) === 3)).map((g) => g.key);
}

const RANK: Record<string, number> = { "Very suitable": 3, "Somewhat suitable": 2, "Barely suitable": 1, "Not suitable": 0 };

export function fitRank(p: Player, pos: Position): number {
  return RANK[suitabilityFor(p.archetype as Archetype, pos)];
}

// --- Rest policy --------------------------------------------------------------------------------------

export type RestPolicy = "more" | "normal" | "less" | "never";

export const REST_POLICIES: readonly { key: RestPolicy; label: string; blurb: string }[] = [
  { key: "more", label: "Rest more", blurb: "Comes off earlier and more often. Fresher, less time on ground." },
  { key: "normal", label: "Normal", blurb: "Rotates when the bench has fresher legs who fit." },
  { key: "less", label: "Rest less", blurb: "Plays deeper into his tank before coming off." },
  { key: "never", label: "Never rests", blurb: "Stays on all game unless you make a change at a break." },
];

/** How far a rest policy moves the fitness a player must drop below before he's taken off. */
export function restThresholdOffset(policy: RestPolicy | undefined): number {
  return policy === "more" ? 8 : policy === "less" ? -10 : 0;
}

// --- Workload -----------------------------------------------------------------------------------------

/**
 * Relative running load per position — scales on-ground fitness drain so midfielders rotate most and
 * key-position players least, the real AFL time-on-ground pattern (mids ~75-80%, key defenders and key
 * forwards ~90%+). Averages ~1.0 across the 18 slots so team-wide drain stays where it was.
 */
export const POSITION_WORKLOAD: Record<Position, number> = {
  FB: 0.7,
  CHB: 0.8,
  BP: 0.9,
  HBF: 1.05,
  W: 1.3,
  C: 1.35,
  R: 1.3,
  RR: 1.35,
  ROV: 1.35,
  HFF: 1.05,
  CHF: 0.8,
  FF: 0.7,
  FP: 0.9,
  INT: 0,
};

// --- Shape: the best assignment of 18 players to 18 slots --------------------------------------------

/** The 18 on-ground slots, as a multiset (BP/HBF/W/HFF/FP twice). */
export const GROUND_SLOTS: readonly Position[] = ["FB", "BP", "BP", "HBF", "HBF", "CHB", "W", "C", "W", "R", "RR", "ROV", "HFF", "HFF", "CHF", "FF", "FP", "FP"];

const STAY_BONUS = 9; // keep a player where he is unless a move gains a full suitability tier somewhere
const HOME_BONUS = 4; // and lean toward the slot the coach picked him in
const INELIGIBLE_PENALTY = 15;

export interface ShapeInput {
  players: readonly Player[];
  /** Where each player is right now (absent = coming on). */
  current: ReadonlyMap<number, Position>;
  /** The coach's selected slot for each player (absent/INT = picked on the bench). */
  home: ReadonlyMap<number, Position>;
  eligibility?: ReadonlyMap<number, ReadonlySet<Position>>;
}

export interface Shape {
  positions: Map<number, Position>;
  score: number;
  /** Players in a Barely/Not suitable slot. */
  poorFits: number;
}

function slotScore(input: ShapeInput, p: Player, pos: Position): number {
  const rank = fitRank(p, pos);
  const eligible = input.eligibility?.get(p.PlayerID)?.has(pos) ?? rank >= 2;
  return rank * 10 - (eligible ? 0 : INELIGIBLE_PENALTY) + (input.current.get(p.PlayerID) === pos ? STAY_BONUS : 0) + (input.home.get(p.PlayerID) === pos ? HOME_BONUS : 0);
}

/** The best way to spread `input.players` (exactly 18) over `GROUND_SLOTS`. */
export function bestShape(input: ShapeInput): Shape {
  const n = GROUND_SLOTS.length;
  const players = input.players;
  if (players.length !== n) throw new Error(`bestShape: need ${n} players, got ${players.length}`);
  const score = players.map((p) => GROUND_SLOTS.map((pos) => slotScore(input, p, pos)));
  const assignment = hungarianMax(score);
  const positions = new Map<number, Position>();
  let total = 0;
  let poorFits = 0;
  assignment.forEach((slot, i) => {
    const p = players[i];
    const pos = GROUND_SLOTS[slot];
    positions.set(p.PlayerID, pos);
    total += score[i][slot];
    if (fitRank(p, pos) <= 1) poorFits += 1;
  });
  return { positions, score: total, poorFits };
}

/** Square assignment maximising the total; returns row -> column. O(n^3), Kuhn-Munkres with potentials. */
function hungarianMax(w: number[][]): number[] {
  const n = w.length;
  const INF = Number.POSITIVE_INFINITY;
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(INF);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = INF;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = -w[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0);
  }
  const rowToCol = new Array<number>(n).fill(-1);
  for (let j = 1; j <= n; j++) if (p[j] > 0) rowToCol[p[j] - 1] = j - 1;
  return rowToCol;
}

// --- The goal-reset rotation --------------------------------------------------------------------------

/** On-ground fitness below this (plus the player's rest-policy offset) makes him a candidate to come off. */
export const ROTATION_THRESHOLD = 80;
/** A bench player must be at least this fresh to go back on. */
export const BENCH_READY_FITNESS = 90;
/** And at least this much fresher than the man he replaces — no swapping like for like. */
export const MIN_SWAP_GAP = 10;
/** Tyler: "2-4 players interchange" after a goal. */
export const MAX_SWAPS_PER_RESET = 4;

export interface ResetInput {
  onGround: readonly Player[];
  bench: readonly Player[];
  current: ReadonlyMap<number, Position>;
  home: ReadonlyMap<number, Position>;
  eligibility?: ReadonlyMap<number, ReadonlySet<Position>>;
  fitness: (id: number) => number;
  /** Bench player has sat long enough to go back on. */
  rested: (id: number) => boolean;
  policy: (id: number) => RestPolicy | undefined;
  /** Optional pinned reliever per on-ground player. */
  pin: (id: number) => number | undefined;
  maxSwaps?: number;
}

export interface ResetPlan {
  swaps: { outgoing: Player; incoming: Player }[];
  /** Final slot for every on-ground player after the swaps (only set when there are swaps). */
  positions: Map<number, Position> | null;
}

/**
 * Who comes off and on at one reset, and where everyone then lines up. Tiredest-first: each tired
 * player is matched with the ready bench player whose arrival leaves the best shape, never adding a
 * poor fit to the ground — so a small defender never ends up stranded at full back; if nobody on the
 * bench can keep the shape, the tired man plays on.
 */
export function planReset(input: ResetInput): ResetPlan {
  const maxSwaps = input.maxSwaps ?? MAX_SWAPS_PER_RESET;
  if (input.onGround.length !== GROUND_SLOTS.length) return { swaps: [], positions: null };
  let on = [...input.onGround];
  let bench = input.bench.filter((b) => input.rested(b.PlayerID) && input.fitness(b.PlayerID) >= BENCH_READY_FITNESS);
  if (bench.length === 0) return { swaps: [], positions: null };
  const shapeOf = (players: Player[]) => bestShape({ players, current: input.current, home: input.home, eligibility: input.eligibility });
  let shape = shapeOf(on);

  const tired = on
    .filter((p) => input.policy(p.PlayerID) !== "never")
    .map((p) => ({ p, need: ROTATION_THRESHOLD + restThresholdOffset(input.policy(p.PlayerID)) - input.fitness(p.PlayerID) }))
    .filter((t) => t.need > 0)
    .sort((a, b) => b.need - a.need);

  const swaps: ResetPlan["swaps"] = [];
  for (const { p: out } of tired) {
    if (swaps.length >= maxSwaps || bench.length === 0) break;
    const outFit = input.fitness(out.PlayerID);
    const pinned = input.pin(out.PlayerID);
    let best: { b: Player; shape: Shape; value: number } | null = null;
    for (const b of bench) {
      if (input.fitness(b.PlayerID) - outFit < MIN_SWAP_GAP) continue;
      const trial = on.map((x) => (x.PlayerID === out.PlayerID ? b : x));
      const s = shapeOf(trial);
      if (s.poorFits > shape.poorFits) continue;
      const value = s.score + (b.PlayerID === pinned ? 1000 : 0) + input.fitness(b.PlayerID) / 100;
      if (!best || value > best.value) best = { b, shape: s, value };
    }
    if (!best) continue;
    const incoming = best.b;
    on = on.map((x) => (x.PlayerID === out.PlayerID ? incoming : x));
    bench = bench.filter((x) => x.PlayerID !== incoming.PlayerID);
    shape = best.shape;
    swaps.push({ outgoing: out, incoming });
  }
  return { swaps, positions: swaps.length ? shape.positions : null };
}

// --- Bench balance --------------------------------------------------------------------------------------

/** The groups a player rotates through: those his eligible positions touch (the coach's override, else his archetype's Very/Somewhat positions — the same default `lineupToMatchTeam` uses). */
export function rotationGroupsOf(p: Player, override?: readonly Position[]): RotationGroup[] {
  return groupsCovered(override ?? defaultEligiblePositions(p.archetype as Archetype));
}

/** Groups no bench player rotates through — the "lopsided bench" warning. */
export function uncoveredGroups(bench: readonly Player[], overrides?: Record<number, readonly Position[]>): RotationGroup[] {
  const covered = new Set<RotationGroup>();
  for (const b of bench) for (const g of rotationGroupsOf(b, overrides?.[b.PlayerID])) covered.add(g);
  return ROTATION_GROUPS.map((g) => g.key).filter((g) => !covered.has(g));
}
