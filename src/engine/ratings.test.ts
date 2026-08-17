import { describe, it, expect } from "vitest";
import { fantasyPointsFor, computeAussieFootySimRatings } from "./ratings";
import type { BoxScoreLine, MatchEvent, MatchResult, StatDelta } from "./match";
import type { MatchTeam } from "./team";
import type { Zone } from "./zones";
import { makePlayer } from "../testUtils/makePlayer";

/**
 * Deliberately synthetic throughout, same isolation match.test.ts/
 * season.test.ts/listNeeds.test.ts use — hand-built MatchEvent[] fixtures so
 * the zone/state-of-game/hitout-outcome logic can be tested in precise
 * isolation, rather than depending on whatever a real simulated match
 * happens to produce. The real-data sanity check (every real club's players
 * produce finite, sensible ratings; the calibrated TARGET_POOL check against
 * real matches) lives in scratch/calibrate_ratings_pool.ts and
 * scratch/verify_ratings_real.ts instead, same reason progression.test.ts's
 * OVR-fidelity check isn't shipped here either — it depends on
 * src/data/generated/players.json, which only exists after `npm run
 * build:data`.
 */

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
    // BoxScoreLine doc comment (Aug 2026 contest-stat fields).
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
  };
}

function makeTeam(name: string, ids: number[]): MatchTeam {
  return { name, players: ids.map((id) => makePlayer({ PlayerID: id, Team: name })) };
}

function ev(partial: {
  tick: number;
  zone: Zone;
  phase: "STOPPAGE" | "GENERAL_PLAY" | "CONTEST" | "SHOT";
  statDeltas: StatDelta[];
  quarter?: 1 | 2 | 3 | 4;
}): MatchEvent {
  return {
    quarter: partial.quarter ?? 1,
    possession: "home",
    description: "test event",
    playerIds: partial.statDeltas.map((d) => d.playerId),
    tick: partial.tick,
    zone: partial.zone,
    phase: partial.phase,
    statDeltas: partial.statDeltas,
  };
}

function makeResult(events: MatchEvent[], ticksPerQuarter = 100): MatchResult {
  return {
    seed: 1,
    ticksPerQuarter,
    home: { name: "Home", goals: 0, behinds: 0, points: 0 },
    away: { name: "Away", goals: 0, behinds: 0, points: 0 },
    events,
    boxScore: {},
  };
}

describe("fantasyPointsFor", () => {
  it("matches the verified AFL Fantasy weights exactly", () => {
    const line = { ...emptyLine(), kicks: 10, handballs: 5, marks: 4, tackles: 3, hitouts: 2, goals: 2, behinds: 1 };
    // 3*10 + 2*5 + 3*4 + 4*3 + 1*2 + 6*2 + 1*1 = 30+10+12+12+2+12+1 = 79
    expect(fantasyPointsFor(line)).toBe(79);
  });

  it("is 0 for an untouched line", () => {
    expect(fantasyPointsFor(emptyLine())).toBe(0);
  });

  it("weighs a goal at exactly 6 and a behind at exactly 1", () => {
    expect(fantasyPointsFor({ ...emptyLine(), goals: 1 })).toBe(6);
    expect(fantasyPointsFor({ ...emptyLine(), behinds: 1 })).toBe(1);
  });
});

describe("computeAussieFootySimRatings", () => {
  it("gives every selected player a line, zero for anyone the event log never credits", () => {
    const home = makeTeam("Home", [1, 2, 3]);
    const away = makeTeam("Away", [4, 5, 6]);
    const events = [ev({ tick: 1, zone: 4, phase: "SHOT", statDeltas: [{ playerId: 1, stat: "goals", delta: 1 }] })];
    const result = makeResult(events);
    const ratings = computeAussieFootySimRatings(result, home, away);

    expect(Object.keys(ratings)).toHaveLength(6);
    expect(ratings[1].rating).toBeGreaterThan(0);
    for (const id of [2, 3, 4, 5, 6]) {
      expect(ratings[id].rating).toBe(0);
      expect(ratings[id].clutch).toBe(0);
    }
  });

  it("returns all-zero ratings for a match with no recorded events, without crashing", () => {
    const home = makeTeam("Home", [1, 2]);
    const away = makeTeam("Away", [3, 4]);
    const ratings = computeAussieFootySimRatings(makeResult([]), home, away);
    for (const id of [1, 2, 3, 4]) {
      expect(ratings[id].rating).toBe(0);
      expect(Number.isFinite(ratings[id].rating)).toBe(true);
    }
  });

  it("a goal outweighs a behind, all else equal", () => {
    const home = makeTeam("Home", [1, 2]);
    const away = makeTeam("Away", [3]);
    const events = [
      ev({ tick: 1, zone: 4, phase: "SHOT", statDeltas: [{ playerId: 1, stat: "goals", delta: 1 }] }),
      ev({ tick: 2, zone: 4, phase: "SHOT", statDeltas: [{ playerId: 2, stat: "behinds", delta: 1 }] }),
    ];
    const ratings = computeAussieFootySimRatings(makeResult(events), home, away);
    expect(ratings[1].rating).toBeGreaterThan(ratings[2].rating);
  });

  it("applies the zone multiplier: the same event type in defensive/forward-50 outscores midfield", () => {
    const home = makeTeam("Home", [1, 2]);
    const away = makeTeam("Away", [3]);
    const events = [
      ev({ tick: 1, zone: 4, phase: "GENERAL_PLAY", statDeltas: [{ playerId: 1, stat: "tackles", delta: 1 }] }),
      ev({ tick: 2, zone: 2, phase: "GENERAL_PLAY", statDeltas: [{ playerId: 2, stat: "tackles", delta: 1 }] }),
    ];
    const ratings = computeAussieFootySimRatings(makeResult(events), home, away);
    expect(ratings[1].rating).toBeGreaterThan(ratings[2].rating);
  });

  it("applies the state-of-game multiplier: a late tackle in a level game outscores an early one", () => {
    const home = makeTeam("Home", [1, 2]);
    const away = makeTeam("Away", [3]);
    // No goals/behinds logged at all, so the running margin stays level (0) throughout —
    // isolates the "widens as time runs out" lateness component on its own.
    const events = [
      ev({ tick: 1, zone: 2, phase: "GENERAL_PLAY", statDeltas: [{ playerId: 1, stat: "tackles", delta: 1 }] }),
      ev({ tick: 99, zone: 2, phase: "GENERAL_PLAY", statDeltas: [{ playerId: 2, stat: "tackles", delta: 1 }] }),
    ];
    const ratings = computeAussieFootySimRatings(makeResult(events, 100), home, away);
    expect(ratings[2].rating).toBeGreaterThan(ratings[1].rating);
  });

  it("a hitout to advantage (own side wins the ensuing clearance) outscores a sharked one", () => {
    const home = makeTeam("Home", [1, 2]);
    const away = makeTeam("Away", [3, 4]);
    // Player 1's hitout followed by a same-tick, same-side clearance -> "to advantage".
    const advantage = [
      ev({ tick: 1, zone: 2, phase: "STOPPAGE", statDeltas: [{ playerId: 1, stat: "hitouts", delta: 1 }] }),
      ev({ tick: 1, zone: 2, phase: "STOPPAGE", statDeltas: [{ playerId: 2, stat: "clearances", delta: 1 }] }),
    ];
    // Player 3 (away)'s hitout followed by player 1 (home) winning the clearance -> "sharked".
    const sharked = [
      ev({ tick: 1, zone: 2, phase: "STOPPAGE", statDeltas: [{ playerId: 3, stat: "hitouts", delta: 1 }] }),
      ev({ tick: 1, zone: 2, phase: "STOPPAGE", statDeltas: [{ playerId: 1, stat: "clearances", delta: 1 }] }),
    ];
    const ratingsAdvantage = computeAussieFootySimRatings(makeResult(advantage), home, away);
    const ratingsSharked = computeAussieFootySimRatings(makeResult(sharked), home, away);
    // Each hitout-winner's own rating, in their own match's normalised pool —
    // "to advantage" should clearly outscore "sharked" for the hitout winner specifically.
    expect(ratingsAdvantage[1].rating).toBeGreaterThan(ratingsSharked[3].rating);
  });

  it("normalises to the same total pool regardless of how many raw points a match generates", () => {
    const home = makeTeam("Home", [1]);
    const away = makeTeam("Away", [2]);
    const oneGoal = makeResult([ev({ tick: 1, zone: 4, phase: "SHOT", statDeltas: [{ playerId: 1, stat: "goals", delta: 1 }] })]);
    const fiveTackles = makeResult(
      Array.from({ length: 5 }, (_, i) => ev({ tick: i + 1, zone: 2, phase: "GENERAL_PLAY", statDeltas: [{ playerId: 2, stat: "tackles", delta: 1 }] })),
    );
    const a = computeAussieFootySimRatings(oneGoal, home, away);
    const b = computeAussieFootySimRatings(fiveTackles, home, away);
    // Each match has exactly one scoring player, so that player collects the whole pool in
    // both cases — the two totals should match despite wildly different raw point totals.
    expect(a[1].rating).toBeCloseTo(b[2].rating, 6);
  });

  it("clutch is a zero-sum redistribution within a match", () => {
    const home = makeTeam("Home", [1, 2]);
    const away = makeTeam("Away", [3]);
    const events = [
      ev({ tick: 1, zone: 2, phase: "GENERAL_PLAY", statDeltas: [{ playerId: 1, stat: "tackles", delta: 1 }] }),
      ev({ tick: 99, zone: 2, phase: "GENERAL_PLAY", statDeltas: [{ playerId: 2, stat: "tackles", delta: 1 }] }),
    ];
    const ratings = computeAussieFootySimRatings(makeResult(events, 100), home, away);
    const totalClutch = Object.values(ratings).reduce((s, r) => s + r.clutch, 0);
    expect(totalClutch).toBeCloseTo(0, 6);
  });
});
