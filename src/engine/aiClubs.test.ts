import { describe, it, expect } from "vitest";
import { advanceClubFinances, aspAgreementsOf, ensureFinanceBaseline } from "./clubFinance";
import { AI_ASP_MIN_VALUE, simulateLeagueContracts } from "./contracts";
import { coachJoinsClub, ensureSeniorCoaches, fillVacancies, reviewAiCoaches, seedSeniorCoaches, type SeniorCoachesState } from "./seniorCoaches";
import { newSaveGame, runOffSeasonOnSave } from "./saveGame";
import { ALL_PLAYERS } from "../data/loadPlayers";
import { CLUBS } from "../types/club";
import { REAL_SENIOR_COACHES_2026 } from "../data/realSeniorCoaches2026";
import type { ClubFinanceState } from "../types/clubFinance";
import type { Player } from "../types/player";

/**
 * ROADMAP #14 follow-up — AI clubs using Additional Service Payments in the contract sweep, and AI
 * boards reviewing (and sacking) their own senior coaches. See `engine/contracts.ts`'s
 * `simulateLeagueContracts` and `engine/seniorCoaches.ts`.
 */

describe("AI clubs use ASP", () => {
  const year = 2027;
  /** Every Geelong player out of contract this window, everyone else signed. */
  const players: Player[] = ALL_PLAYERS.map((p) => ({ ...p, expired_year: p.Team === "Geelong" ? year - 1 : Math.max(p.expired_year, year + 2) }));
  const rich = (budget: number): Record<string, ClubFinanceState> => ({ Geelong: { ...ensureFinanceBaseline(undefined, "Geelong", players, year), budget } });

  it("offers valuable players an off-cap top-up, records it and pays the first year", () => {
    const { clubFinance, activity } = simulateLeagueContracts(players, "Carlton", year, 1, 42, rich(5_000_000));
    const agreements = aspAgreementsOf(clubFinance.Geelong);
    expect(agreements.length).toBeGreaterThan(0);
    for (const a of agreements) {
      const p = players.find((x) => x.PlayerID === a.playerId)!;
      expect(p.totalValue).toBeGreaterThanOrEqual(AI_ASP_MIN_VALUE);
      expect(a.startYear).toBe(year);
    }
    expect(clubFinance.Geelong.budget).toBe(5_000_000 - agreements.reduce((s, a) => s + a.amountPerYear, 0));
    expect(activity.some((e) => e.detail.includes("off-cap Additional Service Payments"))).toBe(true);
  });

  it("an ASP raises a club's retention: more valuable players stay than without the budget", () => {
    const withAsp = simulateLeagueContracts(players, "Carlton", year, 1, 42, rich(5_000_000));
    const without = simulateLeagueContracts(players, "Carlton", year, 1, 42, rich(0));
    const stayed = (ps: Player[]) => ps.filter((p) => p.Team === "Geelong" && !p.delisted && p.totalValue >= AI_ASP_MIN_VALUE).length;
    expect(stayed(withAsp.players)).toBeGreaterThanOrEqual(stayed(without.players));
    expect(aspAgreementsOf(without.clubFinance.Geelong)).toHaveLength(0);
  });

  it("doesn't change outcomes for players it can't offer an ASP to", () => {
    const a = simulateLeagueContracts(players, "Carlton", year, 1, 42, rich(5_000_000));
    const b = simulateLeagueContracts(players, "Carlton", year, 1, 42, rich(0));
    const cheap = (ps: Player[]) => ps.filter((p) => p.Team === "Geelong" && p.totalValue < AI_ASP_MIN_VALUE).map((p) => `${p.PlayerID}:${p.delisted}`);
    expect(cheap(a.players)).toEqual(cheap(b.players));
  });
});

describe("seeding the real 2026 coaches", () => {
  it("gives every AI club its real coach and sends the coach's own club's real coach to the market", () => {
    const sc = seedSeniorCoaches("Hawthorn", 2026);
    expect(Object.keys(sc.clubs)).toHaveLength(CLUBS.length - 1);
    expect(sc.clubs.Hawthorn).toBeUndefined();
    expect(sc.clubs["Brisbane Lions"]?.name).toBe("Chris Fagan");
    expect(sc.clubs["Brisbane Lions"]?.contractEndYear).toBe(2027);
    expect(sc.freeAgents.map((f) => f.coach.name)).toEqual([REAL_SENIOR_COACHES_2026.Hawthorn.name]);
  });

  it("an older save is seeded on load, and a club the coach now runs never keeps an AI coach", () => {
    const sc = ensureSeniorCoaches(seedSeniorCoaches("Hawthorn", 2026), "Geelong", 2027);
    expect(sc.clubs.Geelong).toBeUndefined();
    expect(sc.freeAgents.some((f) => f.coach.name === "Chris Scott")).toBe(true);
  });
});

describe("AI boards", () => {
  const save = newSaveGame("Carlton", ALL_PLAYERS);
  const closed = advanceClubFinances(save.clubFinance, save.players, [], 2026);
  const withConfidence = (sc: SeniorCoachesState, club: string, confidence: number, extra: object = {}): SeniorCoachesState => ({ ...sc, clubs: { ...sc.clubs, [club]: { ...sc.clubs[club]!, confidence, contractEndYear: 2030, ...extra } } });

  it("sack a coach whose confidence collapses, log it, and send him to the market for at least a season", () => {
    const sc = withConfidence(seedSeniorCoaches("Carlton", 2026), "Richmond", 0);
    const { state, outcomes } = reviewAiCoaches(sc, closed, [], 2026);
    expect(outcomes.Richmond).toBe("sacked");
    expect(state.clubs.Richmond).toBeNull();
    expect(state.changes).toContainEqual({ year: 2026, club: "Richmond", outgoing: "Adem Yze", reason: "sacked" });
    expect(state.freeAgents.find((f) => f.coach.name === "Adem Yze")?.availableFrom).toBe(2028);
  });

  it("follow the same warning rule: on notice once, gone if still below 30 a year later", () => {
    const first = reviewAiCoaches(withConfidence(seedSeniorCoaches("Carlton", 2026), "Richmond", 14), closed, [], 2026);
    expect(first.outcomes.Richmond).toBe("warning");
    const again = withConfidence(first.state, "Richmond", 10, { warnedYear: 2026 });
    const closed2027 = advanceClubFinances(closed, save.players.map((p) => ({ ...p, expired_year: Math.max(p.expired_year, 2028) })), [], 2027);
    expect(reviewAiCoaches(again, closed2027, [], 2027).outcomes.Richmond).toBe("sacked");
  });

  it("renew a well-regarded coach whose contract is up", () => {
    const sc = withConfidence(seedSeniorCoaches("Carlton", 2026), "Geelong", 80, { contractEndYear: 2026 });
    const { state, outcomes } = reviewAiCoaches(sc, closed, [], 2026);
    expect(outcomes.Geelong).toBe("renewed");
    expect(state.clubs.Geelong!.contractEndYear).toBeGreaterThan(2026);
  });
});

describe("filling vacancies", () => {
  const vacant = (): SeniorCoachesState => {
    const sc = seedSeniorCoaches("Carlton", 2026);
    return { ...sc, clubs: { ...sc.clubs, Richmond: null, Essendon: null }, changes: [{ year: 2026, club: "Richmond", outgoing: "Adem Yze", reason: "sacked" }] };
  };

  it("appoints someone to every vacancy, deterministically, and completes the change log", () => {
    const a = fillVacancies(vacant(), 2026, new Set());
    const b = fillVacancies(vacant(), 2026, new Set());
    expect(a.clubs.Richmond).toBeTruthy();
    expect(a.clubs.Essendon).toBeTruthy();
    expect(a.clubs.Richmond!.name).toBe(b.clubs.Richmond!.name);
    expect(a.clubs.Richmond!.sinceYear).toBe(2027);
    expect(a.changes.find((c) => c.club === "Richmond")?.incoming).toBe(a.clubs.Richmond!.name);
    expect(new Set(Object.values(a.clubs).map((c) => c!.name)).size).toBe(Object.keys(a.clubs).length);
  });

  it("never appoints the coach's own hired assistants, or a free agent before he's available", () => {
    const first = fillVacancies(vacant(), 2026, new Set());
    const pickedPoolId = first.clubs.Richmond!.poolCoachId;
    if (pickedPoolId !== undefined) expect(fillVacancies(vacant(), 2026, new Set([pickedPoolId])).clubs.Richmond!.poolCoachId).not.toBe(pickedPoolId);
    const sc = vacant();
    sc.freeAgents.push({ coach: { ...sc.clubs.Geelong!, name: "Fresh Sacking" }, availableFrom: 2028, lastClub: "Geelong" });
    const filled = fillVacancies(sc, 2026, new Set());
    expect(Object.values(filled.clubs).some((c) => c?.name === "Fresh Sacking")).toBe(false);
  });

  it("when the coach takes a job, the incumbent makes way and the coach's old club is filled", () => {
    const sc = seedSeniorCoaches("Carlton", 2026);
    const next = coachJoinsClub(sc, "Carlton", "Richmond", 2026, new Set());
    expect(next.clubs.Richmond).toBeUndefined();
    expect(next.clubs.Carlton).toBeTruthy();
    expect(next.freeAgents.some((f) => f.coach.name === "Adem Yze" && f.lastClub === "Richmond")).toBe(true);
    expect(next.changes.find((c) => c.club === "Richmond" && c.incoming === "you")).toBeTruthy();
  });
});

describe("inside the real off-season", () => {
  it("every AI club still has a coach after an ordinary off-season", () => {
    const next = runOffSeasonOnSave(newSaveGame("Carlton", ALL_PLAYERS));
    const clubs = next.seniorCoaches!.clubs;
    expect(Object.keys(clubs)).toHaveLength(CLUBS.length - 1);
    expect(Object.values(clubs).every((c) => c !== null)).toBe(true);
  });

  it("holds vacancies open when the coach has just lost their own job", () => {
    const save = newSaveGame("Carlton", ALL_PLAYERS);
    const sc = save.seniorCoaches!;
    const doomed = { ...save, seniorCoaches: { ...sc, clubs: { ...sc.clubs, Richmond: { ...sc.clubs.Richmond!, confidence: 0 } } }, coach: { name: "Test", clubId: 3, contractYears: 3, startYear: 2025, warnedYear: 2025 } };
    // The coach has been in charge since 2025 with confidence already at 5 -> under 15 at this review -> sacked.
    doomed.clubFinance = { ...doomed.clubFinance, Carlton: { ...doomed.clubFinance.Carlton, history: [...doomed.clubFinance.Carlton.history!.slice(0, -1), { ...doomed.clubFinance.Carlton.history!.at(-1)!, board: { onField: "missed", finance: "below", confidence: 5, delta: -10 } }] } };
    const next = runOffSeasonOnSave(doomed);
    expect(next.coach?.unemployedSince).toBe(2027);
    expect(next.seniorCoaches!.clubs.Richmond).toBeNull();
  });
});
