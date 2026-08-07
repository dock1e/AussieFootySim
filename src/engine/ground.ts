import type { Player } from "../types/player.ts";
import type { Archetype } from "../types/archetype.ts";
import type { MatchTeam } from "./team.ts";
import type { MatchEvent } from "./match.ts";
import { ARCHETYPE_LINE, type Line } from "../data/lines.ts";
import type { Side, Zone } from "./zones.ts";

/**
 * Ground-shape geometry and dot placement for the Canvas match renderer —
 * User Interface.md "Match simulation screen (the signature feature)": a
 * top-down 2D AFL ground, each player a numbered dot, ball moving
 * dot-to-dot per possession-state tick.
 *
 * IMPORTANT SIMPLIFICATION, stated up front: the engine (src/engine/match.ts)
 * only tracks a 1-D ball *zone* (0-4, distance from goal), not real 2-D
 * player positions for all 22+22 players. So only the ball and whichever
 * players are named in the *current* event move *meaningfully* tick to tick
 * — everyone else sits at a static "formation" slot based on their
 * archetype's line, plus (since Phase 7 Slice A) a small continuous wander
 * around that slot so they don't read as frozen. This is honest, deliberate
 * scope: full 2-D positional play, where formation slots reflect real
 * assigned positions rather than a coarse 4-line grouping, is a bigger
 * engine/selection feature (see ROADMAP.md item #7 and Phase 7 Slice B),
 * not something this renderer fakes.
 */
export const GROUND_WIDTH = 1000;
export const GROUND_HEIGHT = 600;
const MARGIN = 30;
const MIN_HALF_HEIGHT = 70;

const ZONE_X_FRACTION: Record<Zone, number> = {
  0: 0.08,
  1: 0.29,
  2: 0.5,
  3: 0.71,
  4: 0.92,
};

export function zoneToX(zone: Zone): number {
  return MARGIN + ZONE_X_FRACTION[zone] * (GROUND_WIDTH - 2 * MARGIN);
}

/** Half the playable height at a given x, tapering toward the goals like a real oval (with a floor so goal-square dots aren't crushed together). */
export function maxHalfHeightAt(x: number): number {
  const cx = GROUND_WIDTH / 2;
  const a = GROUND_WIDTH / 2 - MARGIN;
  const b = GROUND_HEIGHT / 2 - MARGIN;
  const t = Math.max(0, 1 - ((x - cx) / a) ** 2);
  return Math.max(MIN_HALF_HEIGHT, b * Math.sqrt(t));
}

export const CENTER_Y = GROUND_HEIGHT / 2;

// Each line's "home" x-position, expressed as a zone — mirrored for the away
// side, since their attacking direction runs the opposite way (zones.ts:
// zone 0 is always *home*'s defensive 50, regardless of which side has it).
const LINE_ZONE: Record<Line, Zone> = { Defence: 0, Midfield: 2, Forwards: 4, Ruck: 2 };

function lineZoneFor(side: Side, line: Line): Zone {
  const z = LINE_ZONE[line];
  if (side === "home") return z;
  return (4 - z) as Zone; // mirror: away's "Defence" sits at zone 4, their "Forwards" at zone 0
}

export interface DotPosition {
  playerId: number;
  lname: string;
  jumperNumber: number;
  side: Side;
  x: number;
  y: number;
  /** True if this player is one of the 1-2 involved in the current event (drawn near the ball, highlighted). */
  involved: boolean;
}

/** Static per-team formation: groups a team's 22 by line, spreads each group vertically at that line's zone-x. A small per-side x-offset keeps home/away dots at the same nominal zone from perfectly overlapping. */
function formationFor(team: MatchTeam, side: Side): Map<number, DotPosition> {
  const bySLine = new Map<Line, Player[]>();
  for (const p of team.players) {
    const line = ARCHETYPE_LINE[p.archetype as Archetype] ?? "Midfield";
    if (!bySLine.has(line)) bySLine.set(line, []);
    bySLine.get(line)!.push(p);
  }

  const sideOffset = side === "home" ? 18 : -18;
  const out = new Map<number, DotPosition>();
  for (const [line, players] of bySLine) {
    const zone = lineZoneFor(side, line);
    const x = zoneToX(zone) + sideOffset;
    const halfHeight = maxHalfHeightAt(x) * 0.85;
    players.forEach((p, i) => {
      const frac = players.length === 1 ? 0.5 : i / (players.length - 1);
      const y = CENTER_Y - halfHeight + frac * (2 * halfHeight);
      out.set(p.PlayerID, {
        playerId: p.PlayerID,
        lname: p.lname,
        jumperNumber: p.jumperNumber,
        side,
        x,
        y,
        involved: false,
      });
    });
  }
  return out;
}

/**
 * Small, deterministic "off-ball wander" so the other 42 players don't sit
 * frozen at a static formation slot for the whole match — Phase 7 Slice A
 * (ROADMAP.md), the rendering-only fix for "very lagged, few interim steps."
 * Deliberately NOT random (`Math.random` would make every consumer of this
 * function non-reproducible, including anything that ever wants to
 * screenshot/replay a specific moment) — each player gets a fixed phase
 * derived from their own PlayerID, so the same player always wanders the
 * same way relative to their own clock, and different players land out of
 * phase with each other so the group doesn't visibly move in unison.
 */
const DRIFT_RADIUS_X = 9;
const DRIFT_RADIUS_Y = 13;

function driftOffset(playerId: number, driftTime: number): { dx: number; dy: number } {
  const phase = (playerId % 997) * 0.0171;
  return {
    dx: Math.sin(driftTime * 0.9 + phase) * DRIFT_RADIUS_X,
    dy: Math.cos(driftTime * 0.7 + phase * 1.33) * DRIFT_RADIUS_Y,
  };
}

/**
 * All 44 dot positions for a given moment: static formation (plus a small
 * continuous wander for whoever isn't currently named in `event` — see
 * `driftOffset` above), except the player(s) named in `event` (if any) are
 * pulled toward the ball's actual zone and flagged `involved`.
 *
 * `driftTime` is an optional, continuously-increasing clock (seconds is the
 * natural unit here since `driftOffset`'s constants were tuned against it,
 * but nothing here enforces that) — omit it (or pass 0) to reproduce the
 * exact pre-Phase-7 behaviour byte-for-byte, which every existing caller
 * (the balance simulator, every scratch/Vitest determinism check) still
 * does untouched. Only `MatchCanvas.tsx`'s live animation loop passes a real
 * driftTime, and only to *this* function — the underlying event log and
 * match simulation in `src/engine/match.ts` are completely unaffected by
 * this parameter; it only changes what a UI *renders*, never what happened.
 */
export function computeDotPositions(home: MatchTeam, away: MatchTeam, event: MatchEvent | null, driftTime = 0): DotPosition[] {
  const homeForm = formationFor(home, "home");
  const awayForm = formationFor(away, "away");
  const all = new Map<number, DotPosition>([...homeForm, ...awayForm]);

  if (event) {
    const ballX = zoneToX(event.zone);
    event.playerIds.forEach((id, i) => {
      const existing = all.get(id);
      if (!existing) return;
      const spread = event.playerIds.length > 1 ? (i === 0 ? -16 : 16) : 0;
      all.set(id, { ...existing, x: ballX, y: CENTER_Y + spread, involved: true });
    });
  }

  if (driftTime !== 0) {
    for (const [id, dot] of all) {
      if (dot.involved) continue; // involved players are already headed somewhere specific - don't also wobble them
      const { dx, dy } = driftOffset(id, driftTime);
      const halfHeight = maxHalfHeightAt(dot.x) * 0.85; // same taper bound formationFor itself uses
      const x = Math.min(GROUND_WIDTH - MARGIN, Math.max(MARGIN, dot.x + dx));
      const y = Math.min(CENTER_Y + halfHeight, Math.max(CENTER_Y - halfHeight, dot.y + dy));
      all.set(id, { ...dot, x, y });
    }
  }

  return [...all.values()];
}

/** Where to draw the ball itself: at the current carrier's dot if we can find one, else the zone's centre-line point. */
export function ballDotPosition(dots: DotPosition[], event: MatchEvent | null): { x: number; y: number } {
  if (event) {
    const carrier = dots.find((d) => d.involved && d.playerId === event.playerIds[0]);
    if (carrier) return { x: carrier.x, y: carrier.y };
    return { x: zoneToX(event.zone), y: CENTER_Y };
  }
  return { x: zoneToX(2), y: CENTER_Y };
}
