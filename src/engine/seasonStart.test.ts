import { describe, it, expect } from "vitest";
import { buildStartingPlayers, seasonStartReadiness, REAL_OFF_SEASON_2026, type OffSeasonLog } from "./seasonStart";
import { seedDraftPickInventory } from "./draftPicks";
import { seedSeniorCoaches } from "./seniorCoaches";
import { generatedPlayers } from "../data/loadPlayers";
import { REAL_PROSPECTS } from "../data/realProspects";
import { DEPARTURES_2026, NOT_IN_DATABASE } from "../data/realOffSeason2026";
import { LAST_FLAG_YEAR, PREMIERSHIP_COUNT, REAL_LADDER } from "../narrative/clubFacts";
import { CLUBS } from "../types/club";

/**
 * 2027 season start (Oct 2026). The shipped start season is still 2026, so these exercise the 2027
 * builder directly, with a sample off-season log where the real one is still empty.
 */

const base = generatedPlayers();
const carlton = base.filter((p) => p.Team === "Carlton" && !p.delisted && !p.realStatus).sort((a, b) => b.OVR - a.OVR);
const mover = carlton[0];
const prospect = REAL_PROSPECTS.find((r) => !base.some((p) => p.realFullName === r.name))!;

const sample: OffSeasonLog = {
  ...REAL_OFF_SEASON_2026,
  clubMoves: [{ realFullName: mover.realFullName!, fromClub: "Carlton", toClub: "Geelong", type: "Traded", years: 4, date: "2026-10-10", source: "test" }],
  draftees: [
    { realFullName: prospect.name, club: "West Coast", draft: "National", pick: 1, date: "2026-11-19", source: "test" },
    { realFullName: "Totally Madeup Recruit", club: "Essendon", draft: "Rookie", pick: 3, date: "2026-11-23", source: "test" },
  ],
  extensions: [{ realFullName: carlton[1].realFullName!, club: "Carlton", throughYear: 2031, source: "test" }],
};

describe("2026 start", () => {
  it("is the end-of-2026 database unchanged", () => {
    const { players } = buildStartingPlayers(base, 2026);
    expect(players).toEqual([...base]);
  });
});

describe("2027 start", () => {
  const { players, report } = buildStartingPlayers(base, 2027, sample);
  const byName = (n: string) => players.find((p) => p.realFullName === n);

  it("takes every real 2026 retirement and delisting off its list, matching or confirming every name", () => {
    for (const d of DEPARTURES_2026) {
      if (NOT_IN_DATABASE.has(d.realFullName)) continue;
      const p = players.find((x) => x.realFullName === d.realFullName || x.realFullName === (d.realFullName === "Lachlan Fogarty" ? "Lachie Fogarty" : d.realFullName === "Lachie Sullivan" ? "Lachlan Sullivan" : ""));
      expect(p?.delisted, d.realFullName).toBe(true);
    }
    expect(report.unmatchedDepartures).toEqual([]);
  });

  it("moves a traded player and gives him the reported contract", () => {
    const p = byName(mover.realFullName!)!;
    expect(p.Team).toBe("Geelong");
    expect(p.ClubID).toBe(CLUBS.find((c) => c.name === "Geelong")!.ClubID);
    expect(p.expired_year).toBe(2030);
  });

  it("adds real draftees to their club, and flags one with no prospect record", () => {
    const real = byName(prospect.name)!;
    expect(real.Team).toBe("West Coast");
    expect(real.draft_pick).toBe(1);
    expect(real.draft_year).toBe(2026);
    expect(real.draft_draftType).toBe("National Draft");
    expect(byName("Totally Madeup Recruit")?.draft_draftType).toBe("Rookie Draft");
    expect(report.genericDraftees).toEqual(["Totally Madeup Recruit"]);
    expect(players.length).toBe(base.length + 2);
  });

  it("applies real extensions, and nobody still listed starts 2027 out of contract", () => {
    expect(byName(carlton[1].realFullName!)!.expired_year).toBe(2031);
    expect(players.filter((p) => !p.delisted && p.expired_year < 2027)).toEqual([]);
    expect(report.defaultExtensions).toBeGreaterThan(0);
  });

  it("ages existing players a year without touching ratings", () => {
    const before = base.find((p) => p.PlayerID === carlton[2].PlayerID)!;
    const after = players.find((p) => p.PlayerID === before.PlayerID)!;
    expect(after.Age).toBe(before.Age + 1);
    expect(after.OVR).toBe(before.OVR);
    expect(after.POT).toBe(before.POT);
  });

  it("is deterministic", () => {
    const again = buildStartingPlayers(base, 2027, sample).players;
    expect(again.map((p) => `${p.PlayerID}:${p.Team}:${p.OVR}:${p.expired_year}`)).toEqual(players.map((p) => `${p.PlayerID}:${p.Team}:${p.OVR}:${p.expired_year}`));
  });
});

describe("2027 start: the rest of the world", () => {
  it("draft picks: 2027-2029, every club holding its own 2029 hand", () => {
    const picks = seedDraftPickInventory(2027);
    expect(new Set(picks.map((p) => p.year))).toEqual(new Set([2027, 2028, 2029]));
    expect(picks.filter((p) => p.year === 2029)).toHaveLength(CLUBS.length * 4);
    expect(picks.filter((p) => p.year === 2029).every((p) => p.originalClubId === p.currentClubId)).toBe(true);
    expect(seedDraftPickInventory(2026).some((p) => p.year === 2026)).toBe(true);
  });

  it("senior coaches: real 2027 appointments, Brisbane and North vacant, real free agents on the market", () => {
    const sc = seedSeniorCoaches("Adelaide", 2027);
    expect(sc.clubs["Brisbane Lions"]).toBeNull();
    expect(sc.clubs["North Melbourne"]).toBeNull();
    expect(sc.clubs.Carlton?.name).toBe("Josh Fraser");
    expect(sc.clubs.Essendon?.name).toBe("Mark McVeigh");
    expect(sc.clubs.Essendon?.contractEndYear).toBe(2029);
    const fa = sc.freeAgents.map((f) => f.coach.name);
    expect(fa).toEqual(expect.arrayContaining(["Alastair Clarkson", "Michael Voss", "Brad Scott", "Matthew Nicks"]));
    expect(fa).not.toContain("Chris Fagan");
    expect(sc.freeAgents.every((f) => f.availableFrom === 2028)).toBe(true);
  });

  it("the real 2026 ladder is on record; this build (2026 start) doesn't yet credit Brisbane's 2026 flag", () => {
    expect(REAL_LADDER[2026]).toHaveLength(18);
    expect(REAL_LADDER[2026][0]).toBe("FRE");
    expect(LAST_FLAG_YEAR.BL).toBe(2025);
    expect(PREMIERSHIP_COUNT.BL).toBe(5);
  });

  it("readiness: reports the real off-season as incomplete today", () => {
    const items = seasonStartReadiness(base, 2027);
    expect(items.some((i) => i.required && !i.ready)).toBe(true);
    expect(items.find((i) => i.label === "Senior coaches")?.detail).toContain("Brisbane Lions");
  });
});
