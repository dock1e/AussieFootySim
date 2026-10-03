import { describe, it, expect } from "vitest";
import { allTimePlayerTotals, LEADERBOARD_STAT_FIELDS, type SeasonArchiveEntry, type SeasonPlayerTotals } from "./seasonSummary";
import { combinedRecordFor } from "./records";
import { recordWatchFeedFor } from "./dashboardInsights";
import { hasRealWorldData } from "../data/realWorldRecords";
import { getPlayerByRealFullName } from "../data/loadPlayers";

/**
 * Dashboard Record Watch showed "NaN inside 50s across 25 games": a season archived before round 135
 * has no inside50s/rebound50s/bounces/smothers/onePercenters/clangers keys in its persisted
 * `playerTotals`, and the all-time merge summed those `undefined`s into NaN.
 */

const ROUND_135_STATS = ["inside50s", "rebound50s", "bounces", "smothers", "onePercenters", "clangers"] as const;

const dawson = getPlayerByRealFullName("Jordan Dawson")!;

function totals(playerId: number, value: number, withRound135: boolean): SeasonPlayerTotals {
  const t = { playerId, gamesPlayed: 25, fantasyPoints: value * 10 } as SeasonPlayerTotals;
  for (const key of LEADERBOARD_STAT_FIELDS) t[key] = value;
  if (!withRound135) for (const key of ROUND_135_STATS) delete (t as Partial<SeasonPlayerTotals>)[key];
  return t;
}

const archive = (year: number, withRound135: boolean): SeasonArchiveEntry => ({
  year,
  ladder: [],
  playerTotals: [totals(dawson.PlayerID, 400, withRound135)],
});

describe("all-time totals across pre-round-135 archives", () => {
  it("treats a stat missing from an old archive as 0, not NaN", () => {
    const all = allTimePlayerTotals([archive(2026, false), archive(2027, true)], null).get(dawson.PlayerID)!;
    expect(all.gamesPlayed).toBe(50);
    expect(all.disposals).toBe(800);
    for (const key of ROUND_135_STATS) expect(all[key]).toBe(400);
  });

  it("never yields a NaN record row", () => {
    const archives = [archive(2026, false)];
    for (const key of ROUND_135_STATS) {
      for (const row of combinedRecordFor(key, archives, null, 25)) expect(Number.isFinite(row.value)).toBe(true);
    }
  });
});

describe("Record Watch feed", () => {
  it("only ranks categories with real-world history and never narrates NaN", () => {
    const archives = [archive(2026, false), archive(2027, true)];
    const feed = recordWatchFeedFor(dawson.Team, archives, null, 2027, 50);
    for (const e of feed) {
      expect(hasRealWorldData(e.category)).toBe(true);
      expect(Number.isFinite(e.row.value)).toBe(true);
      expect(e.text).not.toContain("NaN");
    }
    // Dawson tops the save-only inside 50s list, but that mustn't put it on the feed.
    expect(combinedRecordFor("inside50s", archives, null, 25)[0]?.player?.PlayerID).toBe(dawson.PlayerID);
    expect(feed.some((e) => (ROUND_135_STATS as readonly string[]).includes(e.category))).toBe(false);
  });
});
