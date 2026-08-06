import type { BoxScoreLine, MatchResult } from "./match.ts";

/**
 * Pure post-match summary helpers — split out from FullTimeResult.tsx so
 * they're framework-free and independently testable, same reasoning as the
 * rest of src/engine/. See FullTimeResult.tsx for the "why a placeholder
 * rating, not the real SimAFL Rating yet" caveat.
 */

export function ratingFor(line: BoxScoreLine): number {
  return line.disposals + 2 * line.marks + 2 * line.tackles + 2 * line.clearances + 0.5 * line.hitouts + 6 * line.goals;
}

export interface QuarterPoints {
  quarter: 1 | 2 | 3 | 4;
  homePoints: number;
  awayPoints: number;
  margin: number;
}

const QUARTERS = [1, 2, 3, 4] as const;

export function quarterlyPoints(result: MatchResult, homeIds: Set<number>, awayIds: Set<number>): QuarterPoints[] {
  return QUARTERS.map((q) => {
    let homeGoals = 0,
      homeBehinds = 0,
      awayGoals = 0,
      awayBehinds = 0;
    for (const ev of result.events) {
      if (ev.quarter > q) continue;
      for (const d of ev.statDeltas) {
        if (d.stat !== "goals" && d.stat !== "behinds") continue;
        const isHome = homeIds.has(d.playerId);
        const isAway = awayIds.has(d.playerId);
        if (d.stat === "goals") {
          if (isHome) homeGoals += d.delta;
          if (isAway) awayGoals += d.delta;
        } else {
          if (isHome) homeBehinds += d.delta;
          if (isAway) awayBehinds += d.delta;
        }
      }
    }
    const homePoints = homeGoals * 6 + homeBehinds;
    const awayPoints = awayGoals * 6 + awayBehinds;
    return { quarter: q, homePoints, awayPoints, margin: homePoints - awayPoints };
  });
}

function emptyLine(): BoxScoreLine {
  return {
    disposals: 0,
    kicks: 0,
    handballs: 0,
    marks: 0,
    contestedMarks: 0,
    tackles: 0,
    clearances: 0,
    hitouts: 0,
    contestedPoss: 0,
    uncontestedPoss: 0,
    goals: 0,
    behinds: 0,
  };
}

export function sumTeam(box: Record<number, BoxScoreLine>, ids: Set<number>): BoxScoreLine {
  const total = emptyLine();
  for (const [idStr, line] of Object.entries(box)) {
    if (!ids.has(Number(idStr))) continue;
    for (const key of Object.keys(total) as (keyof BoxScoreLine)[]) {
      total[key] += line[key];
    }
  }
  return total;
}
