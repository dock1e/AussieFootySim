import type { BoxScoreLine, MatchEvent, MatchResult } from "./match.ts";
import { LINE_FEEDBACK_FIELDS } from "./match.ts";
import { fantasyPointsFor } from "./ratings.ts";
import type { Archetype } from "../types/archetype.ts";
import type { ContestType } from "./contestTypes.ts";
import { MATCH_DAY_COACH_ROLES, type MatchDayCoachRole } from "../types/coach.ts";
import { matchDayRoleForTacticGroup } from "./lineCoaching.ts";
import { tacticGroupForSlot } from "./tactics.ts";
import type { MatchTeam } from "./team.ts";
import { isForward50, ownZone, type Side, type Zone } from "./zones.ts";

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
    // Aug 2026 round 55 — kept in sync with engine/match.ts's own emptyLine(), same convention as
    // the round 54 fields' own comment above.
    spoils: 0,
    interceptMarks: 0,
    interceptPossessions: 0,
    turnovers: 0,
    goalAssists: 0,
    // Sep 2026 round 90 — kept in sync with engine/match.ts's own emptyLine(), same convention as
    // the round 54/55 fields' own comments above. Always 0 here and in every per-quarter line below
    // (coachesVotes is a whole-of-match award baked on after the fact by engine/coachesVotes.ts's
    // applyVotesToBoxScore, never a MatchEvent/StatDelta, so it has nothing to accumulate from) —
    // sumTeam()'s generic per-key loop still sums it correctly across a real full-match box score.
    coachesVotes: 0,
    // Sep 2026 round 91 — kept in sync with engine/match.ts's own emptyLine(), same convention as
    // the coachesVotes comment directly above (always 0 here / per-quarter, baked on whole-of-match).
    brownlowVotes: 0,
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

// --- Quarter-scoped line coach win rates — Sep 2026 [[Quarter-Time Decision Room]] --------------

export interface SubStatQuarterLine {
  wins: number;
  attempts: number;
  rate: number;
}

export interface LineQuarterWinRate {
  role: MatchDayCoachRole;
  /** This line's own real sub-stat wins/attempts/rate for THIS quarter only, keyed by `ContestType` name — only sub-stats with a real attempt this quarter are present, so an untouched one never silently reads as a fabricated 0% or 100%. The raw `wins`/`attempts` are what a "2-7" style evidence line reads off directly; `rate` is what feeds `engine/lineCoaching.ts`'s `recommendedFocusFor` (pass `Object.fromEntries(Object.entries(subRates).map(([k, v]) => [k, v.rate]))`). */
  subRates: Partial<Record<ContestType, SubStatQuarterLine>>;
  /** Every listed sub-stat's attempts/wins blended together — same arithmetic `engine/match.ts`'s own `lineFeedbackFor` uses for its sentence, just quarter-scoped and returned as a number. 0.5 (neutral) when this line has recorded zero relevant attempts yet this quarter — same graceful default `lineFeedbackFor` itself already has. */
  blended: number;
}

/**
 * Real, quarter-scoped per-line contest form for `team` — built for the Quarter-Time Decision
 * Room's ranked "What's Hurting Us"/"What's Working" cards, which react to what just happened this
 * quarter, not the whole match. Reuses `match.ts`'s own `LINE_FEEDBACK_FIELDS` (the exact role ->
 * sub-stat grouping `lineFeedbackFor` already uses) so there's one single source of truth for "which
 * stats belong to which line," not a second, driftable copy — this function only adds the
 * quarter-scoping and keeps each sub-stat separate instead of blending on the way in.
 *
 * No spoiler-safety concern here (unlike `quarterlyPoints`): a break only ever happens after
 * `quarter`'s own ticks are fully simulated and revealed, so filtering `events` to `ev.quarter ===
 * quarter` is always looking at real, already-shown history, never a future quarter.
 */
export function lineQuarterWinRates(events: MatchEvent[], quarter: 1 | 2 | 3 | 4, team: MatchTeam): LineQuarterWinRate[] {
  const ids = team.players.map((p) => p.PlayerID);
  const byPlayer = playerLinesByQuarter(events, ids);

  return MATCH_DAY_COACH_ROLES.map((role) => {
    const roleIds = team.players
      .filter((p) => matchDayRoleForTacticGroup(tacticGroupForSlot(team.positions?.get(p.PlayerID), p.archetype as Archetype)) === role)
      .map((p) => p.PlayerID);

    const subRates: Partial<Record<ContestType, SubStatQuarterLine>> = {};
    let totalAttempts = 0;
    let totalWins = 0;
    for (const field of LINE_FEEDBACK_FIELDS[role]) {
      let attempts = 0;
      let wins = 0;
      for (const id of roleIds) {
        const q = byPlayer[id]?.find((l) => l.quarter === quarter);
        if (!q) continue;
        attempts += (q.line[field.attempts] as number) ?? 0;
        wins += (q.line[field.wins] as number) ?? 0;
      }
      if (attempts > 0) subRates[field.name] = { wins, attempts, rate: wins / attempts };
      totalAttempts += attempts;
      totalWins += wins;
    }
    return { role, subRates, blended: totalAttempts > 0 ? totalWins / totalAttempts : 0.5 };
  });
}

// --- Forward-entry origin thirds — Sep 2026 [[Quarter-Time Decision Room]] -----------------------

export interface ForwardEntryOriginThirds {
  defensive: number;
  midfield: number;
  forward: number;
  /** Total genuine new forward-50 arrivals counted this quarter — 0 is a real reading ("didn't reach forward 50 at all this quarter"), not missing data. */
  total: number;
}

/**
 * For every genuinely NEW arrival of `side`'s own forward 50 this quarter (a transition into
 * `isForward50`, not sustained forward-50 play already under way), walks back through that same
 * unbroken `side`-possession spell to the zone (in `side`'s own attacking-direction terms, via
 * `ownZone`) it started from, and buckets that start zone into three real ground-thirds
 * (defensive = their own zones 0-1, midfield = zone 2, forward = zones 3-4). A genuinely computed
 * answer to "where is this team's forward-50 ball actually coming from" — no engine field records
 * an inside-50 entry's origin directly, so this is built from the real per-tick `zone`/`possession`
 * every `MatchEvent` already carries. See [[Quarter-Time Decision Room]]'s own "What's real" section.
 * Same no-spoiler reasoning as `lineQuarterWinRates` above — quarter-scoped, always past history.
 */
export function forwardEntryOriginThirds(events: MatchEvent[], quarter: number, side: Side): ForwardEntryOriginThirds {
  const quarterEvents = events.filter((ev) => ev.quarter === quarter);
  let defensive = 0,
    midfield = 0,
    forward = 0;

  let spellStartZone: Zone | null = null;
  let wasForward50 = false;
  for (const ev of quarterEvents) {
    if (ev.possession !== side) {
      spellStartZone = null; // possession changed hands - the next spell starts fresh
      wasForward50 = false;
      continue;
    }
    if (spellStartZone === null) spellStartZone = ev.zone;
    const nowForward50 = isForward50(ev.zone, side);
    if (nowForward50 && !wasForward50) {
      const own = ownZone(side, spellStartZone);
      if (own <= 1) defensive++;
      else if (own === 2) midfield++;
      else forward++;
    }
    wasForward50 = nowForward50;
  }
  return { defensive, midfield, forward, total: defensive + midfield + forward };
}
