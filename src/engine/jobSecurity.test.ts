import { describe, it, expect } from "vitest";
import {
  advanceClubFinances,
  ASP_CLUB_LIMIT_PER_SEASON,
  ASP_MAX_PER_PLAYER,
  aspCommittedForSeason,
  canSignAsp,
  ensureFinanceBaseline,
  historyOf,
  maxAspFor,
  signAsp,
} from "./clubFinance";
import { capRoomForSigning, committedWages, evaluateOffer, SALARY_CAP } from "./contracts";
import { contractEndYear, renewalYears, reviewCoach } from "./boardReview";
import { newSaveGame, runOffSeasonOnSave, type CoachSave } from "./saveGame";
import { jobOffersFor } from "../narrative/jobMarket";
import { seedSeniorCoaches } from "./seniorCoaches";
import { ALL_PLAYERS } from "../data/loadPlayers";
import { clubByName } from "../types/club";
import type { BoardVerdict } from "../types/clubFinance";

/**
 * ROADMAP #14 — the Additional Service Payments retention lever and board job security (warnings,
 * sackings, contract renewal, the job market). See `engine/clubFinance.ts`'s ASP section and
 * `engine/boardReview.ts`.
 */

const carltonPlayer = ALL_PLAYERS.find((p) => p.Team === "Carlton" && !p.delisted)!;

describe("ASP in negotiation", () => {
  const ask = 1_000_000;
  const player = { totalValue: ask };

  it("counts toward the ask: 75% salary alone is countered, plus a 20% ASP it's accepted", () => {
    expect(evaluateOffer(player, 750_000, 0).result).toBe("countered");
    expect(evaluateOffer(player, 750_000, 0, 3, 200_000).result).toBe("accepted");
  });

  it("a counter asks for more salary on top of the ASP already offered", () => {
    const out = evaluateOffer(player, 650_000, 0, 3, 150_000);
    expect(out.result).toBe("countered");
    if (out.result === "countered") {
      // (800k + 1m) / 2 = 900k total, less the 150k ASP = 750k salary.
      expect(out.counterSalaryPerYear).toBe(750_000);
    }
  });

  it("cap room excludes the player being signed", () => {
    const year = carltonPlayer.expired_year;
    const room = capRoomForSigning(ALL_PLAYERS, "Carlton", year, carltonPlayer.PlayerID);
    expect(room).toBe(SALARY_CAP - committedWages(ALL_PLAYERS.filter((p) => p.PlayerID !== carltonPlayer.PlayerID), "Carlton", year));
  });
});

describe("ASP limits and bookkeeping", () => {
  const base = { ...ensureFinanceBaseline(undefined, "Carlton", ALL_PLAYERS, 2026), budget: 2_000_000 };

  it("caps a single player at 25% of their ask and $300k", () => {
    expect(maxAspFor(base, 800_000, 2026, 1)).toBe(200_000);
    expect(maxAspFor(base, 3_000_000, 2026, 1)).toBe(ASP_MAX_PER_PLAYER);
  });

  it("respects the club's season limit", () => {
    let s = base;
    for (let id = 1; id <= 5; id++) s = signAsp({ ...s, budget: 10_000_000 }, id, 300_000, 2026, 2028);
    expect(aspCommittedForSeason(s, 2026)).toBe(ASP_CLUB_LIMIT_PER_SEASON);
    expect(maxAspFor(s, 3_000_000, 2026, 99)).toBe(0);
    expect(canSignAsp(s, 99, 3_000_000, 50_000, 2026).ok).toBe(false);
  });

  it("pays the first season at signing and doesn't charge twice when renegotiated", () => {
    const s1 = signAsp(base, 7, 200_000, 2026, 2028);
    expect(s1.budget).toBe(base.budget - 200_000);
    const s2 = signAsp(s1, 7, 250_000, 2026, 2028);
    expect(s2.budget).toBe(s1.budget - 50_000);
    expect(s2.aspAgreements).toHaveLength(1);
  });

  it("won't sign what the budget can't pay for this season", () => {
    expect(canSignAsp({ ...base, budget: 100_000 }, 7, 1_000_000, 200_000, 2026).ok).toBe(false);
  });
});

describe("ASP across off-seasons", () => {
  const players = ALL_PLAYERS.map((p) => (p.PlayerID === carltonPlayer.PlayerID ? { ...p, expired_year: 2030 } : p));

  it("pays each later season from the budget and drops the agreement when it runs out", () => {
    const s = signAsp({ ...ensureFinanceBaseline(undefined, "Carlton", players, 2026), budget: 1_000_000 }, carltonPlayer.PlayerID, 200_000, 2026, 2027);
    const after2026 = advanceClubFinances({ Carlton: s }, players, [], 2026).Carlton;
    const row = historyOf(after2026).at(-1)!;
    expect(row.aspPaid).toBe(200_000);
    expect(after2026.budget).toBe(s.budget + row.allocation! - 200_000);
    const after2027 = advanceClubFinances({ Carlton: after2026 }, players, [], 2027).Carlton;
    expect(after2027.aspAgreements).toHaveLength(0);
    expect(historyOf(after2027).at(-1)!.aspPaid).toBeUndefined();
  });

  it("drops an agreement whose player has left the club", () => {
    const s = signAsp({ ...ensureFinanceBaseline(undefined, "Carlton", players, 2026), budget: 1_000_000 }, carltonPlayer.PlayerID, 200_000, 2026, 2029);
    const moved = players.map((p) => (p.PlayerID === carltonPlayer.PlayerID ? { ...p, Team: "Geelong" } : p));
    expect(advanceClubFinances({ Carlton: s }, moved, [], 2026).Carlton.aspAgreements).toHaveLength(0);
  });

  it("an ASP the budget can't cover is paid out of net assets", () => {
    const s0 = ensureFinanceBaseline(undefined, "Carlton", players, 2026);
    const withAsp = { ...s0, budget: 0, aspAgreements: [{ playerId: carltonPlayer.PlayerID, amountPerYear: 1_000_000, startYear: 2026, endYear: 2028 }] };
    const a = advanceClubFinances({ Carlton: withAsp }, players, [], 2026).Carlton;
    const b = advanceClubFinances({ Carlton: { ...s0, budget: 0 } }, players, [], 2026).Carlton;
    expect(a.budget).toBe(0);
    expect(b.netAssets! - a.netAssets!).toBeGreaterThan(0);
  });
});

describe("board review", () => {
  const coach: CoachSave = { name: "Test Coach", clubId: 3, contractYears: 3, startYear: 2026 };
  const verdict = (confidence: number): BoardVerdict => ({ onField: "met", finance: "onTarget", confidence, delta: 0 });

  it("is secure mid-contract at healthy confidence", () => {
    expect(reviewCoach(coach, verdict(60), 2026).outcome).toBe("secure");
    expect(contractEndYear(coach, 2026)).toBe(2028);
  });

  it("warns first, then sacks if confidence stays below 30", () => {
    const first = reviewCoach(coach, verdict(25), 2026);
    expect(first.outcome).toBe("warning");
    expect(first.coach.warnedYear).toBe(2026);
    const second = reviewCoach(first.coach, verdict(28), 2027);
    expect(second.outcome).toBe("sacked");
    expect(second.coach.unemployedSince).toBe(2028);
  });

  it("a recovery clears the warning", () => {
    const warned = reviewCoach(coach, verdict(25), 2026).coach;
    const back = reviewCoach(warned, verdict(40), 2027);
    expect(back.outcome).toBe("secure");
    expect(back.coach.warnedYear).toBeUndefined();
  });

  it("sacks outright below 15", () => {
    expect(reviewCoach(coach, verdict(12), 2026).outcome).toBe("sacked");
  });

  it("renews an expiring contract at 50+, longer the higher confidence is, and lets it lapse below", () => {
    const r = reviewCoach(coach, verdict(70), 2028);
    expect(r.outcome).toBe("renewed");
    expect(r.renewedYears).toBe(renewalYears(70));
    expect(contractEndYear(r.coach, 2029)).toBe(2028 + renewalYears(70));
    expect(reviewCoach(coach, verdict(45), 2028).outcome).toBe("notRenewed");
  });

  it("runs inside the real off-season and stamps the verdict row", () => {
    const save = { ...newSaveGame("Carlton", ALL_PLAYERS), coach: { name: "Test Coach", clubId: clubByName("Carlton")!.ClubID, contractYears: 1, startYear: 2026 }, board: { expectation: "Finals", patience: 3 } };
    const next = runOffSeasonOnSave(save);
    const row = historyOf(next.clubFinance.Carlton).at(-1)!;
    expect(row.board?.review).toBe("renewed");
    expect(next.coach?.contractStartYear).toBe(2027);
  });

  it("a coach already out of work isn't reviewed again", () => {
    const save = { ...newSaveGame("Carlton", ALL_PLAYERS), coach: { name: "Test Coach", clubId: 3, contractYears: 1, startYear: 2026, unemployedSince: 2026 } };
    const next = runOffSeasonOnSave(save);
    expect(historyOf(next.clubFinance.Carlton).at(-1)!.board?.review).toBeUndefined();
    expect(next.coach?.unemployedSince).toBe(2026);
  });
});

describe("job market", () => {
  const coach: CoachSave = { name: "Test Coach", clubId: 3, contractYears: 3, startYear: 2026 };

  it("puts real vacancies first, then tops up from the shakiest boards, never the coach's old club", () => {
    const sc = seedSeniorCoaches("Carlton", 2026);
    sc.clubs.Richmond = null;
    sc.changes.push({ year: 2026, club: "Richmond", outgoing: "Adem Yze", reason: "sacked" });
    sc.clubs.Geelong = { ...sc.clubs.Geelong!, confidence: 12 };
    const offers = jobOffersFor({ coach, myClub: "Carlton", year: 2027, seasonArchives: [], seniorCoaches: sc });
    expect(offers).toHaveLength(3);
    expect(offers[0].context.club).toBe("Richmond");
    expect(offers[0].note).toContain("sacked Adem Yze");
    expect(offers[1].context.club).toBe("Geelong");
    expect(offers.every((o) => o.context.club !== "Carlton")).toBe(true);
  });
});