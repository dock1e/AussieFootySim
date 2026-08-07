import { describe, it, expect } from "vitest";
import {
  freeAgencyStatus,
  experienceYears,
  committedWages,
  reSignEstimate,
  capForecast,
  allClubCapRows,
  compensationPickBand,
  interestScore,
  evaluateOffer,
  reSign,
  delist,
  signFreeAgent,
  simulateLeagueContracts,
  freeAgentsFor,
  allFreeAgents,
  SALARY_CAP,
} from "./contracts";
import { makePlayer } from "../testUtils/makePlayer";
import { CLUBS } from "../types/club";
import type { ClubStrategy } from "./listNeeds";

/**
 * Deliberately synthetic throughout (makePlayer fixtures), same isolation
 * every other engine/*.test.ts file uses — see listNeeds.test.ts's own note.
 * The real-data cross-check (cap forecasts against actual generated club
 * rosters) lives in scratch/verify_contracts_real.ts instead.
 */

describe("freeAgencyStatus / experienceYears", () => {
  const currentYear = 2026;

  it("reads Signed whenever expired_year hasn't lapsed yet", () => {
    const p = makePlayer({ expired_year: 2027 });
    expect(freeAgencyStatus(p, currentYear)).toBe("Signed");
  });

  it("reads Signed on the exact expiry year (inclusive)", () => {
    const p = makePlayer({ expired_year: 2026 });
    expect(freeAgencyStatus(p, currentYear)).toBe("Signed");
  });

  it("reads OOC below 4 years' experience once lapsed", () => {
    const p = makePlayer({ expired_year: 2025, draft_year: 2023 }); // 3 years
    expect(experienceYears(p, currentYear)).toBe(3);
    expect(freeAgencyStatus(p, currentYear)).toBe("OOC");
  });

  it("reads RFA from 4 up to (not including) 8 years' experience, inclusive at the boundary", () => {
    const atFour = makePlayer({ expired_year: 2025, draft_year: 2022 }); // 4 years
    expect(freeAgencyStatus(atFour, currentYear)).toBe("RFA");
    const atSeven = makePlayer({ expired_year: 2025, draft_year: 2019 }); // 7 years
    expect(freeAgencyStatus(atSeven, currentYear)).toBe("RFA");
  });

  it("reads UFA from 8+ years' experience, inclusive at the boundary", () => {
    const atEight = makePlayer({ expired_year: 2025, draft_year: 2018 }); // 8 years
    expect(freeAgencyStatus(atEight, currentYear)).toBe("UFA");
    const veteran = makePlayer({ expired_year: 2025, draft_year: 2010 }); // 16 years
    expect(freeAgencyStatus(veteran, currentYear)).toBe("UFA");
  });
});

describe("committedWages / reSignEstimate", () => {
  const players = [
    makePlayer({ PlayerID: 1, Team: "ClubA", totalValue: 500_000, expired_year: 2028 }), // signed
    makePlayer({ PlayerID: 2, Team: "ClubA", totalValue: 300_000, expired_year: 2025, draft_year: 2024 }), // OOC, excluded from committed
    makePlayer({ PlayerID: 3, Team: "ClubA", totalValue: 999_999, expired_year: 2030, delisted: true }), // delisted, excluded
    makePlayer({ PlayerID: 4, Team: "ClubB", totalValue: 1_000_000, expired_year: 2030 }), // other club, excluded
  ];

  it("sums only currently-signed, non-delisted players at the given club/year", () => {
    expect(committedWages(players, "ClubA", 2026)).toBe(500_000);
  });

  it("weights each lapsed player's value by their re-sign probability", () => {
    const faPlayers = [
      makePlayer({ PlayerID: 10, Team: "ClubA", totalValue: 400_000, expired_year: 2025, draft_year: 2024 }), // OOC, 0.55
      makePlayer({ PlayerID: 11, Team: "ClubA", totalValue: 600_000, expired_year: 2025, draft_year: 2020 }), // RFA, 0.70
      makePlayer({ PlayerID: 12, Team: "ClubA", totalValue: 999_999, expired_year: 2028 }), // Signed, excluded
    ];
    expect(reSignEstimate(faPlayers, "ClubA", 2026)).toBe(400_000 * 0.55 + 600_000 * 0.7);
  });
});

describe("capForecast", () => {
  const players = [
    makePlayer({ PlayerID: 1, Team: "ClubA", totalValue: 1_000_000, expired_year: 2030 }),
    makePlayer({ PlayerID: 2, Team: "ClubA", totalValue: 500_000, expired_year: 2024, draft_year: 2024 }), // OOC (0 experience in 2026, still OOC in 2027)
  ];

  it("matches the hand-computed committed/forecast/floor/headroom figures", () => {
    const forecast = capForecast(players, "ClubA", 2026);
    expect(forecast.committedNow).toBe(1_000_000);
    expect(forecast.yr1).toBe(1_000_000 + 500_000 * 0.55 + 480_000);
    expect(forecast.yr2).toBe(1_000_000 + 500_000 * 0.55 + 480_000 * 2);
    expect(forecast.floorMet).toBe(false);
    expect(forecast.headroom).toBe(SALARY_CAP - 1_000_000);
  });

  it("floorMet flips true once committed wages clear the floor percentage", () => {
    const rich = [makePlayer({ Team: "ClubA", totalValue: SALARY_CAP, expired_year: 2030 })];
    expect(capForecast(rich, "ClubA", 2026).floorMet).toBe(true);
  });
});

describe("allClubCapRows", () => {
  it("returns exactly one row per real club, list size excluding delisted players", () => {
    const players = [
      makePlayer({ PlayerID: 1, Team: "Adelaide", expired_year: 2030 }),
      makePlayer({ PlayerID: 2, Team: "Adelaide", expired_year: 2030, delisted: true }),
    ];
    const rows = allClubCapRows(players, 2026);
    expect(rows).toHaveLength(CLUBS.length);
    const adelaide = rows.find((r) => r.clubName === "Adelaide");
    expect(adelaide?.listSize).toBe(1);
  });
});

describe("compensationPickBand", () => {
  it("bands by value with disclosed boundaries, null below the bottom band", () => {
    expect(compensationPickBand(1_800_000)).toBe("End of 1st");
    expect(compensationPickBand(1_799_999)).toBe("Early 2nd");
    expect(compensationPickBand(1_050_000)).toBe("Early 2nd");
    expect(compensationPickBand(1_049_999)).toBe("Mid 2nd");
    expect(compensationPickBand(750_000)).toBe("Mid 2nd");
    expect(compensationPickBand(749_999)).toBe("Late 2nd");
    expect(compensationPickBand(480_000)).toBe("Late 2nd");
    expect(compensationPickBand(479_999)).toBeNull();
  });
});

describe("interestScore", () => {
  const currentYear = 2026;
  const strategies = new Map<string, ClubStrategy>([
    ["Contenders", "Contend"],
    ["Rebuilders", "Rebuild"],
  ]);

  it("adds every factor that applies and omits every one that doesn't", () => {
    const p = makePlayer({ Team: "OldClub", OriginClub: "OldClub", draft_year: 2010, morale: 60 }); // 16y experience, one-club, low morale
    const result = interestScore(p, "Contenders", currentYear, strategies, new Set(["Contenders"]));
    expect(result.factors.map((f) => f.label).sort()).toEqual(
      ["Long-tenured one-club player", "Low morale at current club", "Premiership window open", "Recent finals success"].sort(),
    );
    expect(result.score).toBe(12 + 8 + 7 - 7);
  });

  it("omits every factor when none of the conditions hold", () => {
    const p = makePlayer({ Team: "OldClub", OriginClub: "DifferentClub", draft_year: 2022, morale: 75 }); // 4y, moved clubs, settled morale
    const result = interestScore(p, "Rebuilders", currentYear, strategies, null);
    expect(result.factors).toHaveLength(0);
    expect(result.score).toBe(0);
  });
});

describe("evaluateOffer", () => {
  const player = { totalValue: 500_000 };

  it("accepts at or above 95% of the ask", () => {
    expect(evaluateOffer(player, 475_000, 0)).toEqual({ result: "accepted" });
  });

  it("counters between the lowball floor and the accept threshold, splitting the gap", () => {
    expect(evaluateOffer(player, 474_999, 0)).toEqual({ result: "countered", counterSalaryPerYear: 487_000 });
    expect(evaluateOffer(player, 400_000, 0)).toEqual({ result: "countered", counterSalaryPerYear: 450_000 });
  });

  it("rejects outright below 70% of the ask", () => {
    expect(evaluateOffer(player, 349_999, 0)).toEqual({ result: "rejected" });
  });

  it("rejects rather than counters once the offer cap is reached", () => {
    expect(evaluateOffer(player, 400_000, 2, 3)).toEqual({ result: "rejected" });
  });
});

describe("reSign / delist / signFreeAgent", () => {
  it("reSign returns a new object with fresh contract terms, never mutating the input", () => {
    const p = makePlayer({ totalValue: 400_000, expired_year: 2025 });
    const frozen = { ...p };
    const next = reSign(p, { years: 3, salaryPerYear: 600_000 }, 2026);
    expect(p).toEqual(frozen); // input untouched
    expect(next.signed_year).toBe(2026);
    expect(next.expired_year).toBe(2029);
    expect(next.totalValue).toBe(600_000);
  });

  it("delist flags without mutating the input", () => {
    const p = makePlayer({});
    const next = delist(p);
    expect(p.delisted).toBeUndefined();
    expect(next.delisted).toBe(true);
  });

  it("signFreeAgent moves the player to the signing club with new terms", () => {
    const p = makePlayer({ Team: "Adelaide", ClubID: 1, totalValue: 400_000, expired_year: 2025 });
    const next = signFreeAgent(p, "Carlton", { years: 4, salaryPerYear: 700_000 }, 2026);
    expect(next.Team).toBe("Carlton");
    expect(next.ClubID).toBe(3);
    expect(next.totalValue).toBe(700_000);
    expect(next.expired_year).toBe(2030);
  });
});

describe("simulateLeagueContracts", () => {
  const currentYear = 2026;
  const players = [
    makePlayer({ PlayerID: 1, Team: "MyClub", expired_year: 2024, draft_year: 2010 }), // my own OOC player, untouched
    makePlayer({ PlayerID: 2, Team: "RivalA", expired_year: 2030 }), // signed, untouched
    makePlayer({ PlayerID: 3, Team: "RivalA", expired_year: 2020, draft_year: 2010, delisted: true }), // already delisted, untouched
    makePlayer({ PlayerID: 4, Team: "RivalB", expired_year: 2024, draft_year: 2005 }), // rival UFA, in play
    makePlayer({ PlayerID: 5, Team: "RivalB", expired_year: 2024, draft_year: 2024 }), // rival OOC, in play
  ];

  it("is deterministic for a given seed", () => {
    const a = simulateLeagueContracts(players, "MyClub", currentYear, 1, 42);
    const b = simulateLeagueContracts(players, "MyClub", currentYear, 1, 42);
    expect(a).toEqual(b);
  });

  it("never touches my own club's players or already-delisted players", () => {
    const { players: next } = simulateLeagueContracts(players, "MyClub", currentYear, 1, 42);
    expect(next.find((p) => p.PlayerID === 1)).toEqual(players[0]);
    expect(next.find((p) => p.PlayerID === 3)).toEqual(players[2]);
  });

  it("leaves already-signed rivals alone and resolves every in-play rival to either resigned or delisted", () => {
    const { players: next, activity } = simulateLeagueContracts(players, "MyClub", currentYear, 1, 42);
    expect(next.find((p) => p.PlayerID === 2)).toEqual(players[1]);

    for (const id of [4, 5]) {
      const outcome = next.find((p) => p.PlayerID === id)!;
      const logged = activity.find((a) => a.playerId === id)!;
      expect(logged).toBeTruthy();
      if (logged.kind === "resigned") {
        expect(freeAgencyStatus(outcome, currentYear)).toBe("Signed");
      } else {
        expect(outcome.delisted).toBe(true);
      }
    }
  });
});

describe("freeAgentsFor / allFreeAgents", () => {
  const currentYear = 2026;
  const players = [
    makePlayer({ PlayerID: 1, Team: "ClubA", expired_year: 2030 }), // signed
    makePlayer({ PlayerID: 2, Team: "ClubA", expired_year: 2024, draft_year: 2024 }), // ClubA OOC
    makePlayer({ PlayerID: 3, Team: "ClubB", expired_year: 2024, draft_year: 2024 }), // ClubB OOC
    makePlayer({ PlayerID: 4, Team: "ClubA", expired_year: 2020, draft_year: 2010, delisted: true }), // delisted, excluded from both
  ];

  it("freeAgentsFor returns only that club's own lapsed, non-delisted players", () => {
    expect(freeAgentsFor(players, "ClubA", currentYear).map((p) => p.PlayerID)).toEqual([2]);
  });

  it("allFreeAgents returns every other club's lapsed, non-delisted players", () => {
    expect(allFreeAgents(players, "ClubA", currentYear).map((p) => p.PlayerID)).toEqual([3]);
  });
});
