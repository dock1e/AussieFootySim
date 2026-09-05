import { describe, it, expect } from "vitest";
import { newSaveGame, runOffSeasonOnSave, serializeSave, deserializeSave, SAVE_SCHEMA_VERSION, type SaveGameData } from "./saveGame";
import { runOffSeason } from "./progression";
import { defaultTeamPlan } from "./tactics";
import { makePlayer } from "../testUtils/makePlayer";
import { CURRENT_SEASON_YEAR } from "../config";
import type { Season } from "./season";
import { seedDraftPickInventory } from "./draftPicks";

/**
 * Deliberately synthetic throughout, same isolation match.test.ts/
 * season.test.ts/ratings.test.ts use — hand-built fixtures rather than a
 * real simulated season, since what this file actually needs to prove is
 * the save/serialization *mechanics* (does a Map survive a real JSON round
 * trip, does the off-season step wire through correctly), not season logic
 * itself (already covered by season.test.ts) or progression math (already
 * covered by progression.test.ts). A real end-to-end pass — an actual
 * simulated season's Season object, with real MatchResult events/box
 * scores, through the full save/load/JSON-export path — is scratch-verified
 * separately against real generated data (scratch/verify_saveGame_real.ts),
 * same reason ratings.test.ts's real-club sanity check isn't shipped here
 * either: it depends on `npm run build:data`'s gitignored output.
 */

function makePool(n: number): ReturnType<typeof makePlayer>[] {
  return Array.from({ length: n }, (_, i) => makePlayer({ PlayerID: i + 1, Age: 20 + i, archetype: "Inside Mid" }));
}

function minimalSeason(condition: [number, number][]): Season {
  return {
    seed: 42,
    clubIds: [1, 2],
    fixture: [],
    played: [],
    ladder: [],
    finals: null,
    premierClubId: null,
    condition: new Map(condition),
    disgruntlement: new Map(),
  };
}

describe("newSaveGame", () => {
  it("starts at CURRENT_SEASON_YEAR with no season and empty lineups/plans", () => {
    const pool = makePool(3);
    const save = newSaveGame("Adelaide", pool);
    expect(save.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(save.myClub).toBe("Adelaide");
    expect(save.year).toBe(CURRENT_SEASON_YEAR);
    expect(save.season).toBeNull();
    expect(save.lineups).toEqual({});
    expect(save.teamPlans).toEqual({});
    expect(save.contractWindow).toBeNull();
    expect(save.players).toHaveLength(3);
  });

  it("copies the players array rather than aliasing the input", () => {
    const pool = makePool(2);
    const save = newSaveGame("Adelaide", pool);
    expect(save.players).not.toBe(pool);
    expect(save.players).toEqual(pool);
  });
});

describe("runOffSeasonOnSave", () => {
  function makeSave(): SaveGameData {
    return newSaveGame("Adelaide", makePool(10));
  }

  it("advances the year by exactly 1", () => {
    const save = makeSave();
    const next = runOffSeasonOnSave(save);
    expect(next.year).toBe(save.year + 1);
  });

  it("clears season back to null", () => {
    const save = { ...makeSave(), season: minimalSeason([[1, 80]]) };
    const next = runOffSeasonOnSave(save);
    expect(next.season).toBeNull();
  });

  it("ages players exactly the same way calling runOffSeason directly would", () => {
    const save = makeSave();
    const expected = runOffSeason(save.players);
    const next = runOffSeasonOnSave(save);
    expect(next.players).toEqual(expected);
  });

  it("does not mutate the input save", () => {
    const save = makeSave();
    const before = JSON.stringify(save.players);
    runOffSeasonOnSave(save);
    expect(JSON.stringify(save.players)).toBe(before);
    expect(save.year).toBe(CURRENT_SEASON_YEAR);
  });

  it("carries lineups/teamPlans forward unchanged", () => {
    const plan = { ...defaultTeamPlan(), tactics: new Map([[1, { tactic: "Tagging" as const, taggingTargetId: 99 }]]) };
    const save: SaveGameData = { ...makeSave(), lineups: { Adelaide: [1, 2, null] }, teamPlans: { Adelaide: plan } };
    const next = runOffSeasonOnSave(save);
    expect(next.lineups).toEqual(save.lineups);
    expect(next.teamPlans.Adelaide.gameStyle).toBe(plan.gameStyle);
    expect(next.teamPlans.Adelaide.tactics).toEqual(plan.tactics);
  });

  it("resets contractWindow to null, same as season", () => {
    const save: SaveGameData = { ...makeSave(), contractWindow: { daysElapsed: 3, activity: [] } };
    const next = runOffSeasonOnSave(save);
    expect(next.contractWindow).toBeNull();
  });

  it("resets tradeWindow to null, same as contractWindow", () => {
    const save: SaveGameData = { ...makeSave(), tradeWindow: { daysElapsed: 4, activity: [], inbox: [] } };
    const next = runOffSeasonOnSave(save);
    expect(next.tradeWindow).toBeNull();
  });

  it("resets draftWindow to null, same as contractWindow/tradeWindow", () => {
    const save: SaveGameData = { ...makeSave(), draftWindow: { year: 2026, pool: [], order: ["Adelaide"], currentPickIndex: 1, picks: [], scoutingBudgetRemaining: 4, revealed: {} } };
    const next = runOffSeasonOnSave(save);
    expect(next.draftWindow).toBeNull();
  });
});

describe("serializeSave / deserializeSave", () => {
  function richSave(): SaveGameData {
    const plan1 = { gameStyle: "Forward Press" as const, tactics: new Map([[1, { tactic: "Tagging" as const, taggingTargetId: 55 }], [2, { tactic: "Run Two Ways" as const }]]) };
    const plan2 = defaultTeamPlan();
    return {
      schemaVersion: SAVE_SCHEMA_VERSION,
      myClub: "Adelaide",
      year: 2027,
      savedAt: "2027-03-01T00:00:00.000Z",
      players: makePool(4),
      season: minimalSeason([[1, 76], [2, 100], [3, 40]]),
      lineups: { Adelaide: [1, 2, 3, null] },
      eligibility: { Adelaide: { 1: ["FB", "CHB", "BP"], 3: ["FP", "HFF", "W"] } },
      teamPlans: { Adelaide: plan1, Carlton: plan2 },
      combineWindow: {
        year: 2027,
        pool: makePool(2).map((p) => ({ ...p, PlayerID: p.PlayerID + 8000, Team: "Draft Pool", OriginClub: "Draft Pool", ClubID: 0 })),
        invitedPlayerIds: [8001],
        results: {
          8001: {
            sprint20m: 2.95,
            agility505: 8.1,
            beepTest: 13.2,
            verticalLeap: 68,
            kickEfficiency: 15,
            composite: -0.42,
            reputationRank: 1,
            combineRank: 1,
            projectedSlot: 1,
            delta: 0,
            standoutTest: "sprint20m",
            weakestTest: "kickEfficiency",
          },
        },
      },
      contractWindow: {
        daysElapsed: 2,
        activity: [{ id: "1-d1", day: 1, kind: "resigned", playerId: 1, playerName: "Test Player", clubName: "Carlton", detail: "Test Player (RFA) re-signs with Carlton for 3 years." }],
      },
      tradeWindow: {
        daysElapsed: 1,
        activity: [{ id: "t-d1", day: 1, kind: "traded", playerId: 2, playerName: "Trade Target", clubName: "Adelaide", fromClubName: "Carlton", detail: "Adelaide trade Test Player to Carlton for Trade Target." }],
        inbox: [{ id: "offer-1", day: 1, fromClub: "Carlton", toClub: "Adelaide", theyGivePlayerIds: [3], theyWantPlayerIds: [4], flavourLine: "Trade Target would slot straight into our best 23." }],
      },
      draftWindow: {
        year: 2027,
        pool: makePool(2).map((p) => ({ ...p, PlayerID: p.PlayerID + 9000, Team: "Draft Pool", OriginClub: "Draft Pool", ClubID: 0 })),
        order: ["Adelaide", "Carlton"],
        currentPickIndex: 1,
        picks: [{ pickNumber: 1, round: 1, clubName: "Adelaide", playerId: 9001, playerName: "Test Player" }],
        scoutingBudgetRemaining: 3,
        revealed: { 9002: ["skill", "speed"] },
      },
      // Aug 2026 round 54 — [[Season Stats and Records]]. `playerTotals: []` is deliberate here,
      // not a shortcut: this test proves JSON round-tripping (a plain nested array, no Map — see
      // `SeasonArchiveEntry`'s own doc comment for why that needed zero special-casing), not
      // stats-aggregation correctness, which round 54's own real-simulated-season scratch script
      // covers separately.
      seasonArchives: [
        {
          year: 2026,
          ladder: [
            { clubId: 1, played: 22, wins: 18, losses: 4, draws: 0, pointsFor: 2400, pointsAgainst: 1800, premiershipPoints: 72, percentage: 133.3 },
            { clubId: 2, played: 22, wins: 10, losses: 12, draws: 0, pointsFor: 2000, pointsAgainst: 2100, premiershipPoints: 40, percentage: 95.2 },
          ],
          playerTotals: [],
        },
      ],
      draftPickInventory: seedDraftPickInventory(),
    };
  }

  it("round-trips through a real JSON.stringify/JSON.parse pass with no data loss", () => {
    const save = richSave();
    const wire = JSON.parse(JSON.stringify(serializeSave(save)));
    const restored = deserializeSave(wire);
    expect(restored).toEqual(save);
  });

  it("Season.condition survives as a real Map with the same entries, not an empty object", () => {
    const save = richSave();
    const wire = JSON.parse(JSON.stringify(serializeSave(save)));
    const restored = deserializeSave(wire);
    expect(restored.season?.condition).toBeInstanceOf(Map);
    expect(restored.season?.condition.get(2)).toBe(100);
    expect(restored.season?.condition.size).toBe(3);
  });

  it("TeamPlan.tactics survives as a real Map with the same entries, not an empty object", () => {
    const save = richSave();
    const wire = JSON.parse(JSON.stringify(serializeSave(save)));
    const restored = deserializeSave(wire);
    expect(restored.teamPlans.Adelaide.tactics).toBeInstanceOf(Map);
    expect(restored.teamPlans.Adelaide.tactics.get(1)).toEqual({ tactic: "Tagging", taggingTargetId: 55 });
    expect(restored.teamPlans.Adelaide.tactics.size).toBe(2);
  });

  it("handles a null season correctly through the round trip", () => {
    const save = { ...richSave(), season: null };
    const wire = JSON.parse(JSON.stringify(serializeSave(save)));
    const restored = deserializeSave(wire);
    expect(restored.season).toBeNull();
  });

  it("combineWindow survives a real JSON round trip untouched (plain data, no Map inside)", () => {
    const save = richSave();
    const wire = JSON.parse(JSON.stringify(serializeSave(save)));
    const restored = deserializeSave(wire);
    expect(restored.combineWindow).toEqual(save.combineWindow);
  });

  it("defaults combineWindow to null for a save written before Phase 4 Slice 6 existed", () => {
    const wire = JSON.parse(JSON.stringify(serializeSave(richSave())));
    delete wire.combineWindow;
    const restored = deserializeSave(wire);
    expect(restored.combineWindow).toBeNull();
  });

  it("contractWindow survives a real JSON round trip untouched (plain data, no Map inside)", () => {
    const save = richSave();
    const wire = JSON.parse(JSON.stringify(serializeSave(save)));
    const restored = deserializeSave(wire);
    expect(restored.contractWindow).toEqual(save.contractWindow);
  });

  it("defaults contractWindow to null for a save written before Phase 4 Slice 3 existed", () => {
    const wire = JSON.parse(JSON.stringify(serializeSave(richSave())));
    delete wire.contractWindow;
    const restored = deserializeSave(wire);
    expect(restored.contractWindow).toBeNull();
  });

  it("tradeWindow survives a real JSON round trip untouched (plain data, no Map inside)", () => {
    const save = richSave();
    const wire = JSON.parse(JSON.stringify(serializeSave(save)));
    const restored = deserializeSave(wire);
    expect(restored.tradeWindow).toEqual(save.tradeWindow);
  });

  it("defaults tradeWindow to null for a save written before Phase 4 Slice 4 existed", () => {
    const wire = JSON.parse(JSON.stringify(serializeSave(richSave())));
    delete wire.tradeWindow;
    const restored = deserializeSave(wire);
    expect(restored.tradeWindow).toBeNull();
  });

  it("draftWindow survives a real JSON round trip untouched (plain data, no Map inside)", () => {
    const save = richSave();
    const wire = JSON.parse(JSON.stringify(serializeSave(save)));
    const restored = deserializeSave(wire);
    expect(restored.draftWindow).toEqual(save.draftWindow);
  });

  it("defaults draftWindow to null for a save written before Phase 4 Slice 5 existed", () => {
    const wire = JSON.parse(JSON.stringify(serializeSave(richSave())));
    delete wire.draftWindow;
    const restored = deserializeSave(wire);
    expect(restored.draftWindow).toBeNull();
  });

  it("naive JSON.stringify on the raw (unserialized) save would have silently lost the Map data -- proving serializeSave is load-bearing, not redundant", () => {
    const save = richSave();
    const naiveWire = JSON.parse(JSON.stringify(save));
    // A Map serializes to "{}" via plain JSON.stringify -- the bug this file's own serialize step exists to prevent.
    expect(naiveWire.season.condition).toEqual({});
  });

  it("rejects a save with the wrong schema version instead of silently misreading it", () => {
    const wire = JSON.parse(JSON.stringify(serializeSave(richSave())));
    wire.schemaVersion = 999;
    expect(() => deserializeSave(wire)).toThrow();
  });

  it("rejects malformed input rather than crashing with an unhelpful error", () => {
    expect(() => deserializeSave(null)).toThrow();
    expect(() => deserializeSave({})).toThrow();
    expect(() => deserializeSave({ schemaVersion: SAVE_SCHEMA_VERSION })).toThrow();
  });
});
