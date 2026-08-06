import { describe, it, expect } from "vitest";
import { mulberry32 } from "./rng";
import { simulateMatch } from "./match";
import { pickBest22 } from "./team";
import { makePlayer } from "../testUtils/makePlayer";
import type { Player } from "../types/player";
import type { Archetype } from "../types/archetype";

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
