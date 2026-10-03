import { describe, it, expect } from "vitest";
import {
  advanceClubFinances,
  boardVerdictFor,
  ensureFinanceBaseline,
  FOOTBALL_DEPT_BASE_ALLOCATION,
  financeMilestones,
  historyOf,
  launchCampaign,
  leagueStandingFor,
  tenureSummary,
  upgradeFacility,
  type SeasonPerformance,
} from "./clubFinance";
import { newSaveGame } from "./saveGame";
import { ALL_PLAYERS } from "../data/loadPlayers";
import { CLUBS } from "../types/club";
import { REAL_CLUB_FINANCIALS } from "../data/realClubFinancials";
import type { ClubFinanceState } from "../types/clubFinance";
import type { SeasonArchiveEntry } from "./seasonSummary";
import type { Player } from "../types/player";

/**
 * ROADMAP #14 — the real-scale club finance model and its pride layer. See `engine/clubFinance.ts`'s
 * own doc comment for the model; these pin its calibration, the two round-121 bugs it fixes, and the
 * behaviours the Club History tab / Annual Report read.
 */

const id = (name: string) => CLUBS.find((c) => c.name === name)!.ClubID;

/** A synthetic season: `order` top to bottom, the top club wins the flag over the second. */
function archive(year: number, order: number[]): SeasonArchiveEntry {
  const ladder = order.map((clubId, i) => ({ clubId, played: 23, wins: 0, losses: 0, draws: 0, pointsFor: 0, pointsAgainst: 0, premiershipPoints: 100 - i * 4, percentage: 100 }));
  const finals = {
    premierClubId: order[0],
    matches: [{ key: "GF", homeClubId: order[0], awayClubId: order[1], winnerClubId: order[0] }, ...order.slice(2, 8).map((c, i) => ({ key: `QF${i}`, homeClubId: c, awayClubId: order[0], winnerClubId: order[0] }))],
  };
  return { year, ladder, playerTotals: [], finals } as unknown as SeasonArchiveEntry;
}

/** Everyone stays contracted (the real game's contract sweep does this every off-season), so wage bills hold steady across years. */
const contracted = (players: readonly Player[], year: number) => players.map((p) => ({ ...p, expired_year: Math.max(p.expired_year, year + 1) }));

describe("real-scale calibration", () => {
  it("a first season with no ladder data reproduces every club's real 2025 operating result", () => {
    const save = newSaveGame("Carlton", ALL_PLAYERS);
    const next = advanceClubFinances(save.clubFinance, save.players, [], save.year);
    for (const c of CLUBS) {
      const row = historyOf(next[c.name]).at(-1)!;
      expect(row.source).toBe("sim");
      expect(Math.abs(row.result - REAL_CLUB_FINANCIALS[c.name].result)).toBeLessThanOrEqual(2);
      // ±$2: the two own-source halves are rounded separately.
      expect(Math.abs(row.revenue - REAL_CLUB_FINANCIALS[c.name].revenue)).toBeLessThanOrEqual(2);
    }
  });

  it("seeds real history rows and real members/net assets for every club", () => {
    const save = newSaveGame("Carlton", ALL_PLAYERS);
    for (const c of CLUBS) {
      const s = save.clubFinance[c.name];
      expect(s.members).toBe(REAL_CLUB_FINANCIALS[c.name].members);
      expect(s.netAssets).toBe(REAL_CLUB_FINANCIALS[c.name].netAssets);
      expect(historyOf(s).every((h) => h.source === "real")).toBe(true);
      expect(historyOf(s).at(-1)!.year).toBe(2025);
    }
  });

  it("West Coast and GWS are disclosed estimates inside the reporting clubs' range", () => {
    const reported = Object.values(REAL_CLUB_FINANCIALS).filter((r) => r.source === "report").map((r) => r.revenue);
    for (const name of ["West Coast", "Greater Western Sydney"]) {
      const r = REAL_CLUB_FINANCIALS[name];
      expect(r.source).toBe("estimate");
      expect(r.revenue).toBeGreaterThan(Math.min(...reported));
      expect(r.revenue).toBeLessThan(Math.max(...reported));
    }
  });
});

describe("round-121 bug regressions", () => {
  it("the Football Dept budget is funded every off-season instead of pinning to $0", () => {
    const save = newSaveGame("Carlton", ALL_PLAYERS);
    let fin = save.clubFinance;
    for (let y = 2026; y < 2031; y++) {
      const before = fin;
      fin = advanceClubFinances(fin, contracted(save.players, y), [], y);
      for (const c of CLUBS) expect(fin[c.name].budget - before[c.name].budget).toBeGreaterThanOrEqual(FOOTBALL_DEPT_BASE_ALLOCATION);
    }
  });

  it("ladder/finals revenue comes from the season being closed, never a stale archive", () => {
    const save = newSaveGame("Carlton", ALL_PLAYERS);
    const order = [id("Carlton"), ...CLUBS.filter((c) => c.name !== "Carlton").map((c) => c.ClubID)];
    const stale = advanceClubFinances(save.clubFinance, save.players, [archive(2025, order)], 2026);
    expect(historyOf(stale.Carlton).at(-1)!.ladderRank).toBeUndefined();
    const current = advanceClubFinances(save.clubFinance, save.players, [archive(2026, order)], 2026);
    const row = historyOf(current.Carlton).at(-1)!;
    expect(row.ladderRank).toBe(1);
    expect(row.premiers).toBe(true);
    expect(row.revenue).toBeGreaterThan(historyOf(stale.Carlton).at(-1)!.revenue + 4_000_000);
  });

  it("upgrading a facility keeps running marketing campaigns", () => {
    const s0 = ensureFinanceBaseline(undefined, "Carlton", ALL_PLAYERS, 2026);
    const s1 = launchCampaign({ ...s0, budget: 1_000_000 }, "membership", 2026);
    const s2 = upgradeFacility(s1, "gym");
    expect(s2.facilityLevels.gym).toBe(1);
    expect(s2.activeCampaigns).toHaveLength(1);
    expect(s2.members).toBe(s1.members);
  });
});

describe("migration of older saves", () => {
  it("fills real-scale fields, tops a $0 budget back up once, and keeps a real balance", () => {
    const zeroed = ensureFinanceBaseline({ facilityLevels: { gym: 2 }, budget: 0 }, "Adelaide", ALL_PLAYERS, 2027);
    expect(zeroed.budget).toBe(FOOTBALL_DEPT_BASE_ALLOCATION);
    expect(zeroed.facilityLevels.gym).toBe(2);
    expect(zeroed.fixedCosts).toBeGreaterThan(0);
    const kept = ensureFinanceBaseline({ facilityLevels: {}, budget: 185_000 }, "Adelaide", ALL_PLAYERS, 2027);
    expect(kept.budget).toBe(185_000);
    // Idempotent: the cost base is calibrated once and never re-derived.
    expect(ensureFinanceBaseline(kept, "Adelaide", [], 2030)).toBe(kept);
  });
});

describe("membership", () => {
  it("a dynasty grows, a wooden-spooner shrinks, and both stay inside soft bounds over 15 seasons", () => {
    const save = newSaveGame("Carlton", ALL_PLAYERS);
    let fin = save.clubFinance;
    const archives: SeasonArchiveEntry[] = [];
    const middle = CLUBS.filter((c) => c.name !== "Carlton" && c.name !== "Sydney").map((c) => c.ClubID);
    for (let y = 2026; y < 2041; y++) {
      archives.push(archive(y, [id("Carlton"), ...middle, id("Sydney")]));
      fin = advanceClubFinances(fin, contracted(save.players, y), archives, y);
    }
    const carlton = fin.Carlton.members! / REAL_CLUB_FINANCIALS.Carlton.members;
    const sydney = fin.Sydney.members! / REAL_CLUB_FINANCIALS.Sydney.members;
    expect(carlton).toBeGreaterThan(1.25);
    expect(carlton).toBeLessThan(1.6);
    expect(sydney).toBeLessThan(0.95);
    expect(sydney).toBeGreaterThan(0.55);
  });

  it("a resolved Membership Drive adds members on top of the base drift", () => {
    const s0 = ensureFinanceBaseline(undefined, "Carlton", ALL_PLAYERS, 2026);
    const withDrive = launchCampaign({ ...s0, budget: 1_000_000 }, "membership", 2026);
    const a = advanceClubFinances({ Carlton: withDrive }, ALL_PLAYERS, [], 2027);
    const b = advanceClubFinances({ Carlton: s0 }, ALL_PLAYERS, [], 2027);
    expect(a.Carlton.members! - b.Carlton.members!).toBeGreaterThan(1000);
  });
});

describe("AFL special assistance", () => {
  it("is paid to a club that starts the season with negative net assets", () => {
    const s0 = ensureFinanceBaseline(undefined, "Sydney", ALL_PLAYERS, 2026);
    const broke = advanceClubFinances({ Sydney: { ...s0, netAssets: -1 } }, ALL_PLAYERS, [], 2026);
    const fine = advanceClubFinances({ Sydney: s0 }, ALL_PLAYERS, [], 2026);
    expect(historyOf(broke.Sydney).at(-1)!.revenue - historyOf(fine.Sydney).at(-1)!.revenue).toBe(3_000_000);
  });
});

describe("the board", () => {
  const perf = (p: Partial<SeasonPerformance>): SeasonPerformance => ({ ladderRank: 9, madeFinals: false, wonFinal: false, madeGrandFinal: false, premiers: false, ...p });
  const history = ensureFinanceBaseline(undefined, "Carlton", ALL_PLAYERS, 2026).history!;

  it("reads a flag as meeting a Premiership brief", () => {
    const v = boardVerdictFor("Carlton", history, { result: 0, members: 1 }, perf({ ladderRank: 1, madeFinals: true, wonFinal: true, madeGrandFinal: true, premiers: true }), 3, { expectation: "Premiership", patience: 1 });
    expect(v.onField).toBe("met");
  });

  it("an impatient board marks a missed brief down harder than a patient one", () => {
    const missed = perf({ ladderRank: 14 });
    const impatient = boardVerdictFor("Carlton", history, { result: 0 }, missed, 10, { expectation: "Finals", patience: 1 });
    const patient = boardVerdictFor("Carlton", history, { result: 0 }, missed, 10, { expectation: "Finals", patience: 5 });
    expect(impatient.onField).toBe("missed");
    expect(impatient.delta).toBeLessThan(patient.delta);
  });

  it("calls a result above every previous season a record, and keeps confidence within 0-100", () => {
    const v = boardVerdictFor("Carlton", history, { result: 50_000_000 }, perf({ ladderRank: 1, madeFinals: true, madeGrandFinal: true, premiers: true }), 1, { expectation: "Development", patience: 5 });
    expect(v.finance).toBe("record");
    expect(v.confidence).toBeLessThanOrEqual(100);
    const bad = boardVerdictFor("Carlton", [{ ...history[0], board: { onField: "missed", finance: "heavyLoss", confidence: 3, delta: -20 } }], { result: -20_000_000 }, perf({ ladderRank: 18 }), 10, { expectation: "Premiership", patience: 1 });
    expect(bad.finance).toBe("heavyLoss");
    expect(bad.confidence).toBe(0);
  });

  it("only the coach's own club gets a verdict", () => {
    const save = newSaveGame("Carlton", ALL_PLAYERS);
    const next = advanceClubFinances(save.clubFinance, save.players, [], 2026, { myClub: "Carlton", board: { expectation: "Finals", patience: 3 } });
    expect(historyOf(next.Carlton).at(-1)!.board).toBeDefined();
    expect(historyOf(next.Collingwood).at(-1)!.board).toBeUndefined();
  });
});

describe("pride: milestones, tenure, league standing", () => {
  it("derives records and thresholds from simulated seasons only", () => {
    const save = newSaveGame("Carlton", ALL_PLAYERS);
    let fin: Record<string, ClubFinanceState> = save.clubFinance;
    const archives: SeasonArchiveEntry[] = [];
    const rest = CLUBS.filter((c) => c.name !== "Carlton").map((c) => c.ClubID);
    for (let y = 2026; y < 2030; y++) {
      archives.push(archive(y, [id("Carlton"), ...rest]));
      fin = advanceClubFinances(fin, contracted(save.players, y), archives, y, { myClub: "Carlton" });
    }
    const h = historyOf(fin.Carlton);
    const ms = financeMilestones(h, "Carlton", fin);
    expect(ms.length).toBeGreaterThan(0);
    expect(ms.every((m) => m.year >= 2026)).toBe(true);
    expect(ms.some((m) => m.kind === "recordRevenue")).toBe(true);
    expect(ms.some((m) => m.kind === "recordMembers")).toBe(true);

    const t = tenureSummary(h, 2026);
    expect(t.seasons).toBe(4);
    expect(t.baseline?.year).toBe(2025);
    expect(t.revenueChange).toBeGreaterThan(0);
    expect(t.membersChange).toBeGreaterThan(0);

    const standing = leagueStandingFor(fin, "Carlton")!;
    for (const r of Object.values(standing)) {
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(18);
    }
  });

  it("a brand-new save has no milestones and an empty tenure", () => {
    const save = newSaveGame("Carlton", ALL_PLAYERS);
    expect(financeMilestones(historyOf(save.clubFinance.Carlton))).toEqual([]);
    expect(tenureSummary(historyOf(save.clubFinance.Carlton), 2026).seasons).toBe(0);
  });
});
