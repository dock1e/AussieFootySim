import type { BoxScoreLine, MatchEvent, MatchResult } from "./match.ts";
import { fantasyPointsFor } from "./ratings.ts";

/**
 * Pure post-match summary helpers — split out from FullTimeResult.tsx so
 * they're framework-free and independently testable, same reasoning as the
 * rest of src/engine/. The old placeholder composite rating that used to
 * live here (disposals + 2*marks + 2*tackles + 2*clearances + 0.5*hitouts +
 * 6*goals) is gone — Best on Ground/Top Performers now use the real
 * event-weighted AussieFootySim Rating from ratings.ts (Phase 5), not a box-score
 * approximation.
 */

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
    // Kept in sync with engine/match.ts's own emptyLine() — see that file's
    // BoxScoreLine doc comment (Aug 2026 contest-stat fields). sumTeam()
    // below sums every field generically, these included.
    markLeadAttempts: 0,
    markLeadWins: 0,
    markContestedAttempts: 0,
    markContestedWins: 0,
    groundBallAttempts: 0,
    groundBallWins: 0,
    tackleAttempts: 0,
    tackleWins: 0,
    ruckAttempts: 0,
    ruckWins: 0,
    clearanceAttempts: 0,
    clearanceWins: 0,
    freeKicksFor: 0,
    freeKicksAgainst: 0,
    // Aug 2026 round 54 — kept in sync with engine/match.ts's own emptyLine(), same convention as
    // the contest-stat fields' own comment above.
    shotsAtGoal: 0,
    hitoutsToAdvantage: 0,
    marksInside50: 0,
  };
}

export function sumTeam(box: Record<number, BoxScoreLine>, ids: Set<number>): BoxScoreLine {
  const total = emptyLine();
  for (const [idStr, line] of Object.entries(box)) {
    if (!ids.has(Number(idStr))) continue;
    for (const key of Object.keys(total) as (keyof BoxScoreLine)[]) {
      // Aug 2026 round 54 — `?? 0` is load-bearing, not defensive filler: `line` here can be a
      // REAL box score persisted before a field existed (a match played in an earlier round of
      // this project, sitting in a real save's IndexedDB) — see seasonSummary.ts's
      // `aggregateBoxScores` for the live-caught NaN bug this same guard fixes there.
      total[key] += line[key] ?? 0;
    }
  }
  return total;
}

export interface PlayerQuarterLine {
  quarter: 1 | 2 | 3 | 4;
  /** This quarter's own stat deltas only — not cumulative. */
  line: BoxScoreLine;
  /** This quarter's own fantasy points, from `line` above via `fantasyPointsFor` — not cumulative. */
  fantasyPoints: number;
}

/**
 * Buckets every requested player's box score by quarter — Aug 2026 round 49,
 * [[Detailed Match Statistics]]. `MatchEvent.quarter` already carries
 * everything needed; nothing before this round reduced it into a per-quarter
 * view of anything but the scoreline (`quarterlyPoints` above). One pass over
 * `events`, same "accumulate once, not per render" discipline
 * `useMatchPlayback`'s own `liveBoxScore` reducer already established.
 *
 * Takes a raw `MatchEvent[]` rather than a full `MatchResult` — same
 * convention `LiveMatch.tsx`'s own `zoneCountsFor` already uses — so a caller
 * that only has a *sliced*, still-being-revealed events array (the
 * click-to-inspect modal's own "genuinely live, not spoiled" principle) can
 * pass that directly, without needing a synthetic `MatchResult` wrapper.
 *
 * Per-quarter, deliberately NOT cumulative — matches the real behaviour of
 * the reference site this round is built from (dfsaustralia.com's "Fantasy
 * By Qtr" view): confirmed by arithmetic on a real captured row before
 * assuming it, a real player's Q1/Q2/Q3 figures summed exactly to their
 * match FP total, so that reference is per-quarter too, not running-total.
 * Non-cumulative also reads better for a "who's fading" trend glance — a
 * cumulative number only ever goes up, which hides a quiet quarter.
 *
 * Returns one entry per quarter that actually appears anywhere in `events`
 * (not a fixed 4) — a live match paused at the Q2 break naturally produces a
 * 2-length array per player, nothing padded in for quarters that haven't
 * been simulated yet. A player with zero involvement in a played quarter
 * still gets an (all-zero) entry for it, since the quarter itself happened —
 * only presence in `events` decides which quarters exist, never a specific
 * player's own activity within them.
 */
export function playerLinesByQuarter(events: MatchEvent[], ids: Iterable<number>): Record<number, PlayerQuarterLine[]> {
  const idSet = new Set(ids);
  const quartersPresent = [...new Set(events.map((ev) => ev.quarter))].sort((a, b) => a - b);

  const perPlayerQuarter = new Map<number, Map<1 | 2 | 3 | 4, BoxScoreLine>>();
  for (const id of idSet) {
    const byQuarter = new Map<1 | 2 | 3 | 4, BoxScoreLine>();
    for (const q of quartersPresent) byQuarter.set(q, emptyLine());
    perPlayerQuarter.set(id, byQuarter);
  }

  for (const ev of events) {
    for (const d of ev.statDeltas) {
      const byQuarter = perPlayerQuarter.get(d.playerId);
      if (!byQuarter) continue; // not one of the requested ids
      const line = byQuarter.get(ev.quarter);
      if (line) (line[d.stat] as number) += d.delta;
    }
  }

  const out: Record<number, PlayerQuarterLine[]> = {};
  for (const id of idSet) {
    const byQuarter = perPlayerQuarter.get(id)!;
    out[id] = quartersPresent.map((q) => {
      const line = byQuarter.get(q)!;
      return { quarter: q, line, fantasyPoints: fantasyPointsFor(line) };
    });
  }
  return out;
}
