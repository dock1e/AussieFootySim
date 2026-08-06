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
 * players are named in the *current* event move meaningfully tick to tick —
 * everyone else sits at a static "formation" slot based on their archetype's
 * line. This is honest, deliberate scope: full 2-D positional play is a much
 * bigger engine feature (see ROADMAP.md), not something this renderer fakes.
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
 * All 44 dot positions for a given moment: static formation, except the
 * player(s) named in `event` (if any) are pulled toward the ball's actual
 * zone and flagged `involved` — that's what actually visibly moves tick to
 * tick, per the "dot positions update per possession-state tick" spec.
 */
export function computeDotPositions(home: MatchTeam, away: MatchTeam, event: MatchEvent | null): DotPosition[] {
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
