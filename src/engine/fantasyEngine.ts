import type { BoxScoreLine, MatchEvent } from "./match.ts";
import type { AFLStadium } from "../data/stadiums.ts";
import { fantasyPointsFor, fantasyPointsForStat, FANTASY_POINT_WEIGHTS } from "./ratings.ts";
import { realMetresFor, type AbstractPosition } from "./positioning.ts";

/**
 * Sep 2026 round 112 — [[Match Day Fantasy Layer]]. The brief's "one module, one source of truth":
 * every number the momentum ribbon, the live board, and the drawer's nerd layer show is computed here,
 * once, from `ratings.ts`'s canonical `fp()` (`fantasyPointsFor`/`fantasyPointsForStat`) and the match's
 * own `events`. See the vault note for the full reasoning behind every approximation disclosed below —
 * this file's own comments cover the mechanics, that note covers the "why this and not something else".
 */

/** The ribbon/board/drawer's exact palette, [[Match Day Fantasy Layer]] — do not drift from these literal values. Lives here (not in `LiveMatch.tsx`) so `PlayerMatchDrawer.tsx`'s nerd layer can share it without one component importing from another. */
export const FANTASY_COLOR = {
  pageBg: "#0a0e17",
  headerBg: "#0d121d",
  rowBg: "#101725",
  altRowBg: "#0f1622",
  columnHeaderBg: "#0b1018",
  inkPrimary: "#eef2f8",
  inkSecondary: "#c3ccdd",
  inkTertiary: "#8b96ad",
  inkLabel: "#6f7c93",
  accentLine: "#7c5cf0",
  accentLit: "#9a80ff",
  accentSegment: "#b9a6ff",
  gain: "#4fbf87",
  loss: "#d9695f",
  goal: "#f0c04a",
  hairline: "rgba(255,255,255,.06)",
} as const;

// ---------------------------------------------------------------------------
// Tick <-> minute conversion. This engine has never modelled a tick's real-world duration (see
// LiveMatch.tsx's ScoreboardBand doc comment) — the brief's own `fpPerMin = fp / (togTicks *
// secondsPerTick / 60)` requires one, so this round establishes it, scoped ONLY to this module's own
// rate/projection metrics. Real AFL quarters run roughly 30 minutes including time-on; disclosed,
// reasonable-round-number assumption, same tolerance this project gives every other roughed-in constant.
// ---------------------------------------------------------------------------

export const MINUTES_PER_QUARTER = 30;

export function secondsPerTick(ticksPerQuarter: number): number {
  return (MINUTES_PER_QUARTER * 60) / ticksPerQuarter;
}

export function minutesForTicks(ticks: number, ticksPerQuarter: number): number {
  return (ticks * MINUTES_PER_QUARTER) / ticksPerQuarter;
}

export function ticksForMinutes(minutes: number, ticksPerQuarter: number): number {
  return (minutes * ticksPerQuarter) / MINUTES_PER_QUARTER;
}

/** The ribbon's own "last 5 minutes" window, in ticks — rounded to the nearest whole tick. */
export function ribbonWindowTicks(ticksPerQuarter: number): number {
  return Math.round(ticksForMinutes(5, ticksPerQuarter));
}

// ---------------------------------------------------------------------------
// Per-player fantasy event log — `{tick, quarter, type, points}`, built once per revealed event list.
// The cumulative curve, the ribbon's Δ-window, and "what changed" all read this one log, never a
// separately-sampled series (`useFantasyHistory`'s old wall-clock ring buffer is retired this round).
// ---------------------------------------------------------------------------

export interface FantasyLogEntry {
  tick: number;
  quarter: 1 | 2 | 3 | 4;
  type: keyof BoxScoreLine;
  points: number;
}

/** One pass over every revealed event's `statDeltas`, bucketed per player. Only stats with a nonzero fantasy weight are kept — a log entry with 0 points can never move `fpAt`/`fpBetween`/"what changed", and keeping them around would just be dead weight every consumer has to re-filter. */
export function buildFantasyLogs(events: MatchEvent[]): Map<number, FantasyLogEntry[]> {
  const logs = new Map<number, FantasyLogEntry[]>();
  for (const ev of events) {
    for (const d of ev.statDeltas) {
      const points = fantasyPointsForStat(d.stat, d.delta);
      if (points === 0) continue;
      const arr = logs.get(d.playerId);
      const entry: FantasyLogEntry = { tick: ev.tick, quarter: ev.quarter, type: d.stat, points };
      if (arr) arr.push(entry);
      else logs.set(d.playerId, [entry]);
    }
  }
  return logs;
}

/** Cumulative fantasy points through `tick` (inclusive) — the brief's `fpAt(playerId, tick)`. */
export function fpAt(log: FantasyLogEntry[] | undefined, tick: number): number {
  if (!log) return 0;
  let total = 0;
  for (const e of log) if (e.tick <= tick) total += e.points;
  return total;
}

/** Fantasy points scored strictly after `tickA`, through `tickB` inclusive — the brief's `fpBetween`. */
export function fpBetween(log: FantasyLogEntry[] | undefined, tickA: number, tickB: number): number {
  if (!log) return 0;
  let total = 0;
  for (const e of log) if (e.tick > tickA && e.tick <= tickB) total += e.points;
  return total;
}

// ---------------------------------------------------------------------------
// "What changed" — generated from the event log for a window, highest-value events first, max two
// clauses, sentence case, no trailing punctuation.
// ---------------------------------------------------------------------------

const STAT_LABELS: Partial<Record<keyof BoxScoreLine, [string, string]>> = {
  kicks: ["kick", "kicks"],
  handballs: ["handball", "handballs"],
  marks: ["mark", "marks"],
  tackles: ["tackle", "tackles"],
  hitouts: ["hitout", "hitouts"],
  freeKicksFor: ["free kick", "free kicks"],
  freeKicksAgainst: ["free kick against", "free kicks against"],
  goals: ["goal", "goals"],
  behinds: ["behind", "behinds"],
};

interface ChangeGroup {
  key: string;
  count: number;
  points: number;
  labels: [string, string];
}

/**
 * Reads `events` directly (not the pre-filtered log) so it can spot the two flavour distinctions the
 * brief's own examples show — "Goal from a contested mark" (a goal event whose SAME tick also carries a
 * `contestedMarks` delta for this player) and a hitout specifically "to advantage" (same idea against
 * `hitoutsToAdvantage`). Every other stat falls back to its plain `STAT_LABELS` pair. Not a claim that
 * every possible flavour distinction is covered — just the two the brief actually shows.
 */
export function whatChangedText(events: MatchEvent[], playerId: number, tickA: number, tickB: number): string {
  const groups = new Map<string, ChangeGroup>();
  for (const ev of events) {
    if (ev.tick <= tickA || ev.tick > tickB) continue;
    const mine = ev.statDeltas.filter((d) => d.playerId === playerId);
    for (const d of mine) {
      const points = fantasyPointsForStat(d.stat, d.delta);
      if (points === 0) continue;
      let key: string = d.stat;
      let labels = STAT_LABELS[d.stat] ?? [String(d.stat), String(d.stat)];
      if (d.stat === "goals" && mine.some((x) => x.stat === "contestedMarks")) {
        key = "goals_from_contested_mark";
        labels = ["goal from a contested mark", "goals from contested marks"];
      } else if (d.stat === "hitouts" && mine.some((x) => x.stat === "hitoutsToAdvantage")) {
        key = "hitouts_to_advantage";
        labels = ["hitout to advantage", "hitouts to advantage"];
      }
      const g = groups.get(key) ?? { key, count: 0, points: 0, labels };
      g.count += d.delta;
      g.points += points;
      groups.set(key, g);
    }
  }
  const sorted = [...groups.values()].sort((a, b) => b.points - a.points);
  const clauses = sorted.slice(0, 2).map((g) => (g.count === 1 ? g.labels[0] : `${g.count} ${g.labels[1]}`));
  if (clauses.length === 0) return "";
  const text = clauses.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------------------------------------------------------------------------
// FP ledger — the drawer's own "arithmetic, one row per scoring stat" (Section C item 2). Built
// straight off a `BoxScoreLine` using the SAME `FANTASY_POINT_WEIGHTS` table `fantasyPointsFor` sums
// over, so `ledgerTotal === fantasyPointsFor(line)` holds by construction, not by coincidence — this is
// what acceptance criterion #1's unit test actually asserts.
// ---------------------------------------------------------------------------

export interface FpLedgerRow {
  stat: keyof BoxScoreLine;
  label: string;
  count: number;
  weight: number;
  points: number;
}

/** Display order + label for the ledger — Tyler's brief lists the weights in this exact order. */
const LEDGER_ORDER: { stat: keyof BoxScoreLine; label: string }[] = [
  { stat: "kicks", label: "Kicks" },
  { stat: "handballs", label: "Handballs" },
  { stat: "marks", label: "Marks" },
  { stat: "tackles", label: "Tackles" },
  { stat: "hitouts", label: "Hitouts" },
  { stat: "freeKicksFor", label: "Free for" },
  { stat: "freeKicksAgainst", label: "Free against" },
  { stat: "goals", label: "Goals" },
  { stat: "behinds", label: "Behinds" },
];

export function fpLedgerRows(line: BoxScoreLine | undefined): FpLedgerRow[] {
  return LEDGER_ORDER.map(({ stat, label }) => {
    const count = (line?.[stat] as number | undefined) ?? 0;
    const weight = FANTASY_POINT_WEIGHTS[stat] ?? 0;
    return { stat, label, count, weight, points: count * weight };
  });
}

export function fpLedgerTotal(line: BoxScoreLine | undefined): number {
  return line ? fantasyPointsFor(line) : 0;
}

// ---------------------------------------------------------------------------
// Derived match-so-far metrics — tog, cba, kickIns, fpPerMin, paceDelta, proj/projFloor/projCeiling,
// expectedRemainingTogMinutes, longest stint. One pass over `events` computes every player's raw
// accumulators together (not one pass per player) — see the vault note for why each is sourced this way.
// ---------------------------------------------------------------------------

export interface PlayerMatchFantasyMetrics {
  fp: number;
  tog: number; // 0-100
  cba: number; // 0-100
  /** Raw numerator/denominator behind `cba` — the drawer's "21/24 - 88%" display wants both, not just the percentage. */
  cbaAttended: number;
  cbaTotal: number;
  kickIns: number;
  fpPerMin: number;
  paceDelta: number;
  proj: number;
  projFloor: number;
  projCeiling: number;
  expectedRemainingTogMinutes: number;
  longestStintMinutes: number;
  delta5: number;
  whatChanged: string;
}

interface RawAccumulator {
  presentCount: number;
  attended: number;
  kickIns: number;
  longestRunTicks: number;
  runStartTick: number | null;
  runLastTick: number | null;
}

function emptyAccumulator(): RawAccumulator {
  return { presentCount: 0, attended: 0, kickIns: 0, longestRunTicks: 0, runStartTick: null, runLastTick: null };
}

function closeRun(acc: RawAccumulator) {
  if (acc.runStartTick !== null && acc.runLastTick !== null) {
    acc.longestRunTicks = Math.max(acc.longestRunTicks, acc.runLastTick - acc.runStartTick);
  }
  acc.runStartTick = null;
  acc.runLastTick = null;
}

export interface FantasyMetricsContext {
  /** Already spoiler-safe truncated (live: `events.slice(0, currentIndex+1)`; archived: the whole match). */
  events: MatchEvent[];
  ticksPerQuarter: number;
  stadium: AFLStadium;
  /** Live-so-far box score. */
  lines: Record<number, BoxScoreLine>;
  fitnessOf: (playerId: number) => number; // 0-100
  seasonAvgFpOf: (playerId: number) => number;
}

/**
 * One pass over `events` for every id in `playerIds`, then a per-player closed-form finish using the
 * accumulated raw counts plus `lines`/`fitnessOf`/`seasonAvgFpOf`. Returns a metrics map even for a
 * pre-match (`events.length === 0`) call — every number reads 0 in that case; the ribbon's own
 * "PROJECTED OUTPUT" pre-match state is a UI-level decision (see `MomentumRibbon`), not this function's.
 */
export function computeFantasyMetrics(ctx: FantasyMetricsContext, playerIds: number[]): Map<number, PlayerMatchFantasyMetrics> {
  const logs = buildFantasyLogs(ctx.events);
  const acc = new Map<number, RawAccumulator>();
  for (const id of playerIds) acc.set(id, emptyAccumulator());

  const totalEvents = ctx.events.length;
  const sqHalf = ctx.stadium.markings.centreSquareWidth / 2;

  for (let i = 0; i < ctx.events.length; i++) {
    const ev = ctx.events[i];
    const positionsByPlayer = new Map<number, AbstractPosition>();
    for (const t of ev.trackedPositions ?? []) positionsByPlayer.set(t.playerId, t);

    // kickIns heuristic — see the vault note's own disclosure: the first-named player in the first
    // event after a SHOT whose possession flips sides took the restart. Structural, not a new engine
    // field, since threading a pending-credit through every one of `runGeneralPlay`'s 10+ disposal
    // call sites would be real, disproportionate surgery on the core sim loop for a board column no
    // acceptance criterion depends on.
    const prev = i > 0 ? ctx.events[i - 1] : null;
    if (prev && prev.phase === "SHOT" && ev.possession !== prev.possession && ev.playerIds.length > 0) {
      const takerId = ev.playerIds[0];
      const takerAcc = acc.get(takerId);
      if (takerAcc) takerAcc.kickIns += 1;
    }

    for (const [playerId, a] of acc) {
      const pos = positionsByPlayer.get(playerId);
      if (pos) {
        a.presentCount += 1;
        if (a.runStartTick === null) a.runStartTick = ev.tick;
        a.runLastTick = ev.tick;
      } else {
        closeRun(a);
      }
      if (ev.stoppageType === "centreBounce" && pos) {
        const { x, y } = realMetresFor(pos, ctx.stadium);
        if (Math.abs(x) <= sqHalf && Math.abs(y) <= sqHalf) a.attended += 1;
      }
    }
  }
  for (const a of acc.values()) closeRun(a);

  const bouncesHeld = ctx.events.filter((e) => e.stoppageType === "centreBounce").length;
  const latestTick = totalEvents > 0 ? ctx.events[totalEvents - 1].tick : 0;
  const totalMatchMinutes = MINUTES_PER_QUARTER * 4;
  const elapsedMinutes = minutesForTicks(latestTick, ctx.ticksPerQuarter);
  const remainingMatchMinutes = Math.max(0, totalMatchMinutes - elapsedMinutes);
  const windowTicks = ribbonWindowTicks(ctx.ticksPerQuarter);
  const tickA = Math.max(0, latestTick - windowTicks);

  const out = new Map<number, PlayerMatchFantasyMetrics>();
  for (const id of playerIds) {
    const a = acc.get(id) ?? emptyAccumulator();
    const line = ctx.lines[id];
    const fp = fpLedgerTotal(line);
    const log = logs.get(id);

    const togFraction = totalEvents > 0 ? a.presentCount / totalEvents : 0;
    const togTicksApprox = togFraction * latestTick;
    const togMinutesSoFar = minutesForTicks(togTicksApprox, ctx.ticksPerQuarter);
    const fpPerMin = togMinutesSoFar > 0 ? fp / togMinutesSoFar : 0;

    const matchFractionElapsed = latestTick / (ctx.ticksPerQuarter * 4);
    const seasonAvgFp = ctx.seasonAvgFpOf(id);
    const paceDelta = Math.round(fp - seasonAvgFp * matchFractionElapsed);

    const fitness = ctx.fitnessOf(id);
    const fitnessFactor = Math.min(1, Math.max(0.4, fitness / 60));
    const currentRotationShare = togFraction;
    const expectedRemainingTogMinutes = remainingMatchMinutes * Math.min(currentRotationShare, fitnessFactor);

    const proj = fp + fpPerMin * expectedRemainingTogMinutes;
    const projFloor = fp + fpPerMin * 0.7 * expectedRemainingTogMinutes;
    const projCeiling = fp + fpPerMin * 1.35 * expectedRemainingTogMinutes;

    const cba = bouncesHeld > 0 ? (a.attended / bouncesHeld) * 100 : 0;
    const longestRunTicks = Math.max(a.longestRunTicks, a.runLastTick !== null && a.runStartTick !== null ? a.runLastTick - a.runStartTick : 0);

    out.set(id, {
      fp,
      tog: togFraction * 100,
      cba,
      cbaAttended: a.attended,
      cbaTotal: bouncesHeld,
      kickIns: a.kickIns,
      fpPerMin,
      paceDelta,
      proj,
      projFloor,
      projCeiling,
      expectedRemainingTogMinutes,
      longestStintMinutes: minutesForTicks(longestRunTicks, ctx.ticksPerQuarter),
      delta5: fpBetween(log, tickA, latestTick),
      whatChanged: whatChangedText(ctx.events, id, tickA, latestTick),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ribbon curve geometry — pure data, no JSX. `MomentumRibbon` renders whatever this returns; kept here
// so the coordinate math (the part an earlier attempt "failed", per the brief) has one definition, and
// so it's independently testable from a verify script.
// ---------------------------------------------------------------------------

export interface CurvePoint {
  x: number;
  y: number;
  tick: number;
  isGoal: boolean;
}

export interface CurveGeometry {
  /** 12 points, oldest to newest, X and Y both normalised to "the match so far" (X: tick 0..now maps to 0..130; Y: 0..this player's own current total maps to 20..0, SVG-down). The last point is always at x=130. */
  points: CurvePoint[];
  /** Same X scale, restricted to the trailing 5-minute window, for the "redraw on top" segment. */
  recentPoints: CurvePoint[];
  /** Quarter-end gridline x-positions, only for quarters that have actually finished. */
  quarterGridlinesX: number[];
}

const CURVE_VIEWBOX_WIDTH = 130;
const CURVE_VIEWBOX_HEIGHT = 20;
const CURVE_SAMPLE_COUNT = 12;

export function curveGeometryFor(events: MatchEvent[], playerId: number, ticksPerQuarter: number): CurveGeometry {
  const logs = buildFantasyLogs(events);
  const log = logs.get(playerId);
  const latestTick = events.length > 0 ? events[events.length - 1].tick : 0;
  const currentTotal = Math.max(1, fpAt(log, latestTick)); // floor of 1 so a scoreless player's line is flat, not a division by zero

  const xForTick = (tick: number) => (latestTick > 0 ? (tick / latestTick) * CURVE_VIEWBOX_WIDTH : 0);
  const yForTotal = (total: number) => CURVE_VIEWBOX_HEIGHT - (Math.max(0, total) / currentTotal) * CURVE_VIEWBOX_HEIGHT;

  const points: CurvePoint[] = [];
  for (let s = 0; s < CURVE_SAMPLE_COUNT; s++) {
    const tick = latestTick > 0 ? (s / (CURVE_SAMPLE_COUNT - 1)) * latestTick : 0;
    const total = fpAt(log, tick);
    const isGoal = (log ?? []).some((e) => e.type === "goals" && Math.abs(e.tick - tick) < Math.max(1, latestTick / 40));
    points.push({ x: xForTick(tick), y: yForTotal(total), tick, isGoal });
  }

  const windowTicks = ribbonWindowTicks(ticksPerQuarter);
  const recentStartTick = Math.max(0, latestTick - windowTicks);
  const recentPoints = points.filter((p) => p.tick >= recentStartTick);
  // Always include a boundary point exactly at the window start so the redrawn segment doesn't visually
  // detach from the base line if none of the 12 samples happen to land inside the window.
  if (recentPoints.length > 0 && recentPoints[0].tick > recentStartTick) {
    const total = fpAt(log, recentStartTick);
    recentPoints.unshift({ x: xForTick(recentStartTick), y: yForTotal(total), tick: recentStartTick, isGoal: false });
  }

  const quarterGridlinesX: number[] = [];
  for (const q of [1, 2, 3] as const) {
    const qEndTick = q * ticksPerQuarter;
    if (qEndTick <= latestTick) quarterGridlinesX.push(xForTick(qEndTick));
  }

  return { points, recentPoints, quarterGridlinesX };
}

// ---------------------------------------------------------------------------
// Percentile display — reused by the drawer's "VS EVERY ARCHETYPE" section. `benchmarking.ts`'s own
// `benchmarkPlayer` returns `rank`/`cohortSize` with LOWER percentile = better (rank/cohortSize); the
// brief's own worked example ("Disposals 24.3 82nd pct") wants the conventional higher-is-better AFL.com.au
// framing, so this converts once, here, rather than every call site re-deriving it slightly differently.
// ---------------------------------------------------------------------------

export function displayPercentile(rank: number, cohortSize: number): number {
  if (cohortSize <= 0) return 0;
  return Math.round((1 - (rank - 1) / cohortSize) * 100);
}
