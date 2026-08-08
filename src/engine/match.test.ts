import { describe, it, expect } from "vitest";
import { mulberry32 } from "./rng";
import { simulateMatch, startMatch, simulateQuarter, setGameStyle, getGameStyle, matchResultSoFar } from "./match";
import { pickBest22 } from "./team";
import type { MatchTeam } from "./team";
import { sanitizePlan } from "./tactics";
import type { TeamPlan } from "./tactics";
import { autoFillLineup, lineupToMatchTeam } from "./selection";
import { makePlayer } from "../testUtils/makePlayer";
import type { Player } from "../types/player";
import type { Archetype } from "../types/archetype";
import type { Position } from "../types/archetype";

/** Builds a full, valid 40-player club pool spread realistically across the four lines, so pickBest22 has enough of each to fill its targets. */
function makeClubPool(clubName: string): Player[] {
  const archetypesByLine: Record<string, Archetype[]> = {
    Defence: ["Key Defender", "Medium Defender", "Intercept Defender", "Half Back Flanker", "Back Pocket"],
    Midfield: ["Inside Mid", "Outside Mid"],
    Forwards: ["Key Forward", "Medium Forward", "Small Forward", "Pressure Forward", "Hybrid Mid Forward"],
    Ruck: ["Ruck", "Hybrid Key Forward Ruck"],
  };
  const allArchetypes = Object.values(archetypesByLine).flat();
  const players: Player[] = [];
  let id = 1;
  for (let i = 0; i < 40; i++) {
    const archetype = allArchetypes[i % allArchetypes.length];
    players.push(
      makePlayer({
        PlayerID: id++,
        Team: clubName,
        fname: `Test${i}`,
        lname: `Player${i}`,
        jumperNumber: i + 1,
        archetype,
        OVR: 50 + ((i * 7) % 40), // spread of ratings, deterministic
      }),
    );
  }
  return players;
}

describe("pickBest22", () => {
  it("selects exactly 22 unique players from a full club pool", () => {
    const pool = makeClubPool("Testers");
    const team = pickBest22("Testers", pool);
    expect(team.players).toHaveLength(22);
    expect(new Set(team.players.map((p) => p.PlayerID)).size).toBe(22);
  });

  it("tops up from best-available OVR if a line is under-strength", () => {
    // Only 3 Ruck-line players available against a target of 2 — fine. Make Defence
    // artificially thin (only 2 players) to force the top-up path.
    const pool = makeClubPool("Thin").filter((p) => p.archetype !== "Key Defender" && p.archetype !== "Medium Defender");
    const team = pickBest22("Thin", pool);
    expect(team.players.length).toBeLessThanOrEqual(22);
    expect(new Set(team.players.map((p) => p.PlayerID)).size).toBe(team.players.length);
  });
});

describe("simulateMatch", () => {
  const home = pickBest22("Home", makeClubPool("Home"));
  const away = pickBest22("Away", makeClubPool("Away"));

  it("produces a completed match with non-negative scores", () => {
    const result = simulateMatch(home, away, mulberry32(1), 1);
    expect(result.home.points).toBeGreaterThanOrEqual(0);
    expect(result.away.points).toBeGreaterThanOrEqual(0);
    expect(result.home.points).toBe(result.home.goals * 6 + result.home.behinds);
    expect(result.away.points).toBe(result.away.goals * 6 + result.away.behinds);
  });

  it("is deterministic for a fixed seed", () => {
    const r1 = simulateMatch(home, away, mulberry32(42), 42);
    const r2 = simulateMatch(home, away, mulberry32(42), 42);
    expect(r1.home).toEqual(r2.home);
    expect(r1.away).toEqual(r2.away);
    expect(r1.boxScore).toEqual(r2.boxScore);
  });

  it("box score goals/behinds sum to the team totals", () => {
    const result = simulateMatch(home, away, mulberry32(7), 7);
    const totalGoals = Object.values(result.boxScore).reduce((s, l) => s + l.goals, 0);
    const totalBehinds = Object.values(result.boxScore).reduce((s, l) => s + l.behinds, 0);
    expect(totalGoals).toBe(result.home.goals + result.away.goals);
    expect(totalBehinds).toBe(result.home.behinds + result.away.behinds);
  });

  it("gives every one of the 44 selected players a box score line", () => {
    const result = simulateMatch(home, away, mulberry32(3), 3);
    expect(Object.keys(result.boxScore)).toHaveLength(44);
  });

  it("recordEvents: false skips the log without changing the result", () => {
    const withEvents = simulateMatch(home, away, mulberry32(9), 9, { recordEvents: true });
    const withoutEvents = simulateMatch(home, away, mulberry32(9), 9, { recordEvents: false });
    expect(withEvents.events.length).toBeGreaterThan(0);
    expect(withoutEvents.events).toHaveLength(0);
    expect(withoutEvents.home).toEqual(withEvents.home);
    expect(withoutEvents.away).toEqual(withEvents.away);
  });

  it("statDeltas replayed from the event log exactly reproduce the final box score", () => {
    const result = simulateMatch(home, away, mulberry32(11), 11, { recordEvents: true });
    const replay: Record<number, Record<string, number>> = {};
    for (const p of [...home.players, ...away.players]) {
      replay[p.PlayerID] = Object.fromEntries(Object.keys(result.boxScore[p.PlayerID]).map((k) => [k, 0]));
    }
    for (const ev of result.events) {
      for (const d of ev.statDeltas) {
        replay[d.playerId][d.stat] += d.delta;
      }
    }
    expect(replay).toEqual(result.boxScore);
  });

  it("stays within a non-degenerate score range across many seeds", () => {
    for (let seed = 100; seed < 130; seed++) {
      const result = simulateMatch(home, away, mulberry32(seed), seed, { recordEvents: false });
      expect(result.home.points).toBeLessThan(300);
      expect(result.away.points).toBeLessThan(300);
    }
  });
});

describe("simulateMatch with tactics/game-style plans", () => {
  const home = pickBest22("Home", makeClubPool("Home"));
  const away = pickBest22("Away", makeClubPool("Away"));

  it("omitting plans entirely is byte-identical to the pre-tactics call shape", () => {
    // Every caller written before tactics.ts existed (scripts/simulate.ts, season.ts, the
    // Match tab) never passes homePlan/awayPlan — this is the regression guard that they keep
    // producing exactly what they always did.
    const withoutOpts = simulateMatch(home, away, mulberry32(55), 55);
    const withEmptyOpts = simulateMatch(home, away, mulberry32(55), 55, {});
    expect(withEmptyOpts).toEqual(withoutOpts);
  });

  it("sanitizePlan resets a tactic that doesn't belong to a player's own group back to their group default", () => {
    const defender = home.players.find((p) => p.archetype === "Key Defender")!;
    // "Tagging" is Midfield-only per Configuration.md's tactics menus — invalid for a defender.
    const invalid: TeamPlan = { gameStyle: "Balanced", tactics: new Map([[defender.PlayerID, { tactic: "Tagging", taggingTargetId: away.players[0].PlayerID }]]) };
    const cleaned = sanitizePlan(home.players, invalid);
    expect(cleaned.tactics.get(defender.PlayerID)?.tactic).toBe("Defensive Shoulder");
  });

  it("simulateMatch doesn't throw when handed a plan with a cross-group-mismatched tactic", () => {
    const defender = home.players.find((p) => p.archetype === "Key Defender")!;
    const invalid: TeamPlan = { gameStyle: "Balanced", tactics: new Map([[defender.PlayerID, { tactic: "Tagging", taggingTargetId: away.players[0].PlayerID }]]) };
    expect(() => simulateMatch(home, away, mulberry32(1), 1, { homePlan: invalid })).not.toThrow();
  });

  it("Tagging measurably suppresses the tagged player's disposal output, averaged across many seeds", () => {
    const target = away.players[0];
    const tagger = home.players.find((p) => p.archetype === "Inside Mid")!;
    const plan: TeamPlan = { gameStyle: "Balanced", tactics: new Map([[tagger.PlayerID, { tactic: "Tagging", taggingTargetId: target.PlayerID }]]) };

    let withTag = 0;
    let without = 0;
    const N = 25;
    for (let i = 0; i < N; i++) {
      const seed = 6000 + i;
      withTag += simulateMatch(home, away, mulberry32(seed), seed, { homePlan: plan, recordEvents: false }).boxScore[target.PlayerID].disposals;
      without += simulateMatch(home, away, mulberry32(seed), seed, { recordEvents: false }).boxScore[target.PlayerID].disposals;
    }
    expect(withTag).toBeLessThan(without);
  });

  it("a plan's game style shifts average combined scoring in the documented direction", () => {
    const N = 20;
    function avgCombined(homePlan?: TeamPlan): number {
      let total = 0;
      for (let i = 0; i < N; i++) {
        const seed = 7000 + i;
        const r = simulateMatch(home, away, mulberry32(seed), seed, { homePlan, recordEvents: false });
        total += r.home.points + r.away.points;
      }
      return total / N;
    }
    const balanced = avgCombined({ gameStyle: "Balanced", tactics: new Map() });
    const flood = avgCombined({ gameStyle: "Defensive Flood", tactics: new Map() });
    const attackMiddle = avgCombined({ gameStyle: "Attack the Middle", tactics: new Map() });

    expect(flood).toBeLessThan(balanced); // Engine.md: "lower-scoring both ways"
    expect(attackMiddle).toBeGreaterThan(balanced); // Engine.md: "+inside-50 count off clearances"
  });
});

describe("quarter-by-quarter simulation (quarter-time Coach's Call support)", () => {
  const home = pickBest22("Home", makeClubPool("Home"));
  const away = pickBest22("Away", makeClubPool("Away"));
  const plans = { homePlan: { gameStyle: "Balanced" as const, tactics: new Map() }, awayPlan: { gameStyle: "Balanced" as const, tactics: new Map() } };

  it("running all 4 quarters one at a time is byte-identical to simulateMatch() run all at once", () => {
    const seed = 9001;
    const allAtOnce = simulateMatch(home, away, mulberry32(seed), seed, plans);
    const match = startMatch(home, away, mulberry32(seed), seed, plans);
    simulateQuarter(match, 1);
    simulateQuarter(match, 2);
    simulateQuarter(match, 3);
    simulateQuarter(match, 4);
    expect(matchResultSoFar(match)).toEqual(allAtOnce);
  });

  it("events accumulate as a strict, unchanged prefix across quarters", () => {
    const seed = 9002;
    const match = startMatch(home, away, mulberry32(seed), seed, plans);
    simulateQuarter(match, 1);
    const q1Events = [...matchResultSoFar(match).events];
    simulateQuarter(match, 2);
    const q2Events = matchResultSoFar(match).events;
    expect(q2Events.length).toBeGreaterThan(q1Events.length);
    expect(q2Events.slice(0, q1Events.length)).toEqual(q1Events);
  });

  it("setGameStyle changes a side's active style, reflected by getGameStyle, and actually alters the next quarter's simulation", () => {
    const seed = 9003;
    const withChange = startMatch(home, away, mulberry32(seed), seed, plans);
    simulateQuarter(withChange, 1);
    expect(getGameStyle(withChange, "home")).toBe("Balanced");
    setGameStyle(withChange, "home", "Attack the Middle");
    expect(getGameStyle(withChange, "home")).toBe("Attack the Middle");
    simulateQuarter(withChange, 2);
    simulateQuarter(withChange, 3);
    simulateQuarter(withChange, 4);

    const withoutChange = startMatch(home, away, mulberry32(seed), seed, plans);
    simulateQuarter(withoutChange, 1);
    simulateQuarter(withoutChange, 2);
    simulateQuarter(withoutChange, 3);
    simulateQuarter(withoutChange, 4);

    expect(matchResultSoFar(withChange)).not.toEqual(matchResultSoFar(withoutChange));
  });

  it("setGameStyle on a side with no plan at all is a safe no-op", () => {
    const seed = 9004;
    const match = startMatch(home, away, mulberry32(seed), seed, {}); // no plans supplied
    simulateQuarter(match, 1);
    expect(getGameStyle(match, "home")).toBe("Balanced"); // the documented default with no plan
    expect(() => setGameStyle(match, "home", "Forward Press")).not.toThrow();
    simulateQuarter(match, 2);
    simulateQuarter(match, 3);
    simulateQuarter(match, 4);

    const baseline = simulateMatch(home, away, mulberry32(seed), seed, {});
    expect(matchResultSoFar(match)).toEqual(baseline);
  });
});

/** Finds the PlayerID assigned to a given real position in a MatchTeam built via autoFillLineup/lineupToMatchTeam — throws if that slot somehow wasn't filled, since every test below depends on it existing. */
function findByPosition(team: MatchTeam, position: Position): number {
  for (const [id, pos] of team.positions ?? []) {
    if (pos === position) return id;
  }
  throw new Error(`findByPosition: no player assigned to ${position} in ${team.name}`);
}

describe("Phase 8: position-weighted involvement (engine/involvement.ts wired into match.ts)", () => {
  // A real, suitability-aware lineup (not pickBest22) so `positions` is
  // actually populated — see engine/selection.ts's lineupToMatchTeam and
  // Tactics and Positional Play.md "Phase 8".
  const homePool = makeClubPool("Home");
  const awayPool = makeClubPool("Away");
  const home = lineupToMatchTeam("Home", autoFillLineup(homePool), homePool);
  const away = lineupToMatchTeam("Away", autoFillLineup(awayPool), awayPool);

  it("lineupToMatchTeam actually populates real position data for a full 22", () => {
    expect(home.positions?.size).toBe(22);
    expect(findByPosition(home, "FB")).toBeDefined();
    expect(findByPosition(home, "FF")).toBeDefined();
  });

  it("the real FB is measurably more involved in defensive-50 events than the real FF, and vice versa in forward-50, aggregated across many seeds", () => {
    const homeFbId = findByPosition(home, "FB");
    const homeFfId = findByPosition(home, "FF");

    let fbInDef50 = 0;
    let ffInDef50 = 0;
    let fbInFwd50 = 0;
    let ffInFwd50 = 0;

    const N = 30;
    for (let i = 0; i < N; i++) {
      const seed = 20000 + i;
      const result = simulateMatch(home, away, mulberry32(seed), seed, { recordEvents: true });
      for (const ev of result.events) {
        if (ev.zone === 0) {
          if (ev.playerIds.includes(homeFbId)) fbInDef50++;
          if (ev.playerIds.includes(homeFfId)) ffInDef50++;
        }
        if (ev.zone === 4) {
          if (ev.playerIds.includes(homeFbId)) fbInFwd50++;
          if (ev.playerIds.includes(homeFfId)) ffInFwd50++;
        }
      }
    }

    // Both should show up sometimes (the fallback floor keeps this from
    // being a hard lock) but the real position should dominate its own zone.
    expect(fbInDef50).toBeGreaterThan(ffInDef50);
    expect(ffInFwd50).toBeGreaterThan(fbInFwd50);
  });

  it("the same holds for the AWAY team, at the *mirrored* raw zones (Aug 2026 fix — the away side's zone wasn't mirrored before, so its positional weighting was backwards and this exact check would have failed)", () => {
    const awayFbId = findByPosition(away, "FB");
    const awayFfId = findByPosition(away, "FF");

    // Raw zone 0 is home's defensive 50 == away's *forward* 50; raw zone 4
    // is the reverse. So for the away team, the FF should dominate raw zone
    // 0 and the FB should dominate raw zone 4 - the mirror image of the
    // home-side test directly above.
    let fbInOwnFwd50 = 0;
    let ffInOwnFwd50 = 0;
    let fbInOwnDef50 = 0;
    let ffInOwnDef50 = 0;

    const N = 30;
    for (let i = 0; i < N; i++) {
      const seed = 21000 + i;
      const result = simulateMatch(home, away, mulberry32(seed), seed, { recordEvents: true });
      for (const ev of result.events) {
        if (ev.zone === 0) {
          if (ev.playerIds.includes(awayFbId)) fbInOwnFwd50++;
          if (ev.playerIds.includes(awayFfId)) ffInOwnFwd50++;
        }
        if (ev.zone === 4) {
          if (ev.playerIds.includes(awayFbId)) fbInOwnDef50++;
          if (ev.playerIds.includes(awayFfId)) ffInOwnDef50++;
        }
      }
    }

    expect(ffInOwnFwd50).toBeGreaterThan(fbInOwnFwd50);
    expect(fbInOwnDef50).toBeGreaterThan(ffInOwnDef50);
  });

  it("a team built without real position data (pickBest22) still simulates fine, falling back to archetype-only weighting", () => {
    const bestBest = pickBest22("BestOnly", makeClubPool("BestOnly"));
    expect(bestBest.positions).toBeUndefined();
    expect(() => simulateMatch(bestBest, away, mulberry32(1), 1)).not.toThrow();
  });
});
