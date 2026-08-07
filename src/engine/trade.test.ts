import { describe, it, expect } from "vitest";
import {
  isLegalListSize,
  projectedListSize,
  MIN_LEGAL_LIST_SIZE,
  MAX_LEGAL_LIST_SIZE,
  consentTier,
  buildTradeContext,
  evaluateTradeSide,
  evaluateTrade,
  resolveTradeOutcome,
  findCounterOfferAddition,
  executeTrade,
  tradeVolumePenalty,
  hasListInstability,
  applyMoraleImpact,
  simulateLeagueTrades,
  generateInboundOffers,
} from "./trade";
import { makePlayer } from "../testUtils/makePlayer";
import { clubByName } from "../types/club";
import type { ClubStrategy } from "./listNeeds";

/**
 * Deliberately synthetic throughout (makePlayer fixtures), same isolation
 * every other engine/*.test.ts file uses — see contracts.test.ts's own
 * note. The real-data cross-check (consent-tier spread against the real
 * loyaltyTend distribution, AI-trade frequency across many real seeds/days,
 * positional-need/core-loss firing against real red lines and real stars)
 * lives in scratch/verify_trade_real.ts and diag_trade.ts/diag_lines.ts
 * instead — those scripts are also what caught and fixed two real
 * calibration bugs during this slice's build (consentTier's original
 * 0.42/0.72 thresholds, and simulateLeagueTrades/generateInboundOffers's
 * original league-wide-banding match rule, which could never fire — see
 * those two functions' own doc comments in trade.ts for the full story).
 *
 * `simulateLeagueTrades`/`generateInboundOffers` specifically must use REAL
 * club names from `types/club.ts` in their fixtures below (not arbitrary
 * strings like every other describe block here) — both functions derive
 * their rival-club list from the real `CLUBS` constant internally, not from
 * whatever club names happen to appear in the players array passed in.
 */

describe("isLegalListSize / projectedListSize", () => {
  it("matches the confirmed 24-46 legal band", () => {
    expect(MIN_LEGAL_LIST_SIZE).toBe(24);
    expect(MAX_LEGAL_LIST_SIZE).toBe(46);
    expect(isLegalListSize(24)).toBe(true);
    expect(isLegalListSize(46)).toBe(true);
    expect(isLegalListSize(23)).toBe(false);
    expect(isLegalListSize(47)).toBe(false);
  });

  it("projects list size from a current count plus/minus trade movement", () => {
    expect(projectedListSize(38, 2, 1)).toBe(37);
    expect(projectedListSize(38, 0, 0)).toBe(38);
  });
});

describe("consentTier", () => {
  it("is always willing regardless of destination when nothing pushes resistance up", () => {
    // baseline = 0 (zero loyalty, moved on already, young) — max possible
    // with jitter is 0.15, still well under the 0.60 reluctant floor.
    const p = makePlayer({ PlayerID: 500, loyaltyTend: 0, OriginClub: "ClubX", Team: "ClubY", Age: 22 });
    expect(consentTier(p, "Adelaide")).toBe("willing");
    expect(consentTier(p, "Carlton")).toBe("willing");
    expect(consentTier(p, "Sydney")).toBe("willing");
  });

  it("refuses for a concrete high-resistance (player, destination) pair — empirically located via find_refuse_case.ts against this exact formula", () => {
    // PlayerID 1 -> Adelaide (ClubID 1): loyalty=99/99=1, stillAtOrigin=1,
    // veteran=1 -> baseline 0.9; that seed's jitter lands resistance at
    // ~0.7924, clearing the 0.76 refuse threshold.
    const p = makePlayer({ PlayerID: 1, loyaltyTend: 99, OriginClub: "Brisbane Lions", Team: "Brisbane Lions", Age: 32 });
    expect(consentTier(p, "Adelaide")).toBe("refuse");
  });

  it("reads reluctant for a concrete mid-resistance pair", () => {
    // PlayerID 13 -> Adelaide: loyalty=70/99, stillAtOrigin=1, not veteran
    // -> baseline 0.6035; that seed's jitter lands resistance at ~0.6204,
    // inside [0.60, 0.76).
    const p = makePlayer({ PlayerID: 13, loyaltyTend: 70, OriginClub: "Brisbane Lions", Team: "Brisbane Lions", Age: 26 });
    expect(consentTier(p, "Adelaide")).toBe("reluctant");
  });

  it("is deterministic — same player, same destination, same answer every call", () => {
    const p = makePlayer({ PlayerID: 42, loyaltyTend: 80, OriginClub: "Carlton", Team: "Carlton", Age: 31 });
    const first = consentTier(p, "Essendon");
    for (let i = 0; i < 5; i++) expect(consentTier(p, "Essendon")).toBe(first);
  });

  it("can differ for the very same player across two different destinations (rolled per pairing, not per player)", () => {
    const p = makePlayer({ PlayerID: 1, loyaltyTend: 99, OriginClub: "Brisbane Lions", Team: "Brisbane Lions", Age: 32 });
    // Confirmed refuse vs Adelaide above; assert it is NOT hard-coded to
    // refuse everywhere by checking it differs somewhere in the league.
    const tiers = new Set(["Adelaide", "Carlton", "Collingwood", "Essendon", "Fremantle", "Geelong", "Hawthorn", "Melbourne"].map((c) => consentTier(p, c)));
    expect(tiers.size).toBeGreaterThan(1);
  });
});

describe("evaluateTradeSide / evaluateTrade", () => {
  const strategies = new Map<string, ClubStrategy>([
    ["Receivers", "Balanced"],
    ["Givers", "Balanced"],
  ]);

  it("fires the positional need bonus only when the receiving club's line for that archetype is genuinely red", () => {
    const players = [
      makePlayer({ PlayerID: 1, Team: "Receivers", archetype: "Key Defender", OVR: 30, loyaltyTend: 0 }), // Receivers' only defender — weak
      makePlayer({ PlayerID: 2, Team: "Receivers", archetype: "Inside Mid", OVR: 60, loyaltyTend: 0 }), // Receivers' only mid — strong
      makePlayer({ PlayerID: 3, Team: "Givers", archetype: "Key Defender", OVR: 70, totalValue: 400_000, loyaltyTend: 0 }),
      makePlayer({ PlayerID: 4, Team: "Givers", archetype: "Inside Mid", OVR: 60, totalValue: 400_000, loyaltyTend: 0 }),
    ];
    // leagueAvgOvr = (30+60+70+60)/4 = 55. Receivers' Defence (just p1) gaps
    // to -25 (red, < -1.5). Receivers' Midfield (just p2) gaps to +5 (green).
    const ctx = buildTradeContext(players, 2026, strategies);

    const donorIntoNeed = players.find((p) => p.PlayerID === 3)!; // a defender, Receivers' weak line
    const withNeed = evaluateTradeSide("Receivers", "Givers", [], [donorIntoNeed], ctx);
    const bonus = withNeed.factors.find((f) => f.label.includes("genuine hole"));
    expect(bonus).toBeTruthy();
    expect(bonus!.value).toBe(Math.round(400_000 * 0.35));

    const donorIntoStrength = players.find((p) => p.PlayerID === 4)!; // a midfielder, Receivers' already-fine line
    const withoutNeed = evaluateTradeSide("Receivers", "Givers", [], [donorIntoStrength], ctx);
    expect(withoutNeed.factors.find((f) => f.label.includes("genuine hole"))).toBeUndefined();
  });

  it("fires the core-loss penalty only for a young, high-OVR player given up", () => {
    const players = [makePlayer({ PlayerID: 1, Team: "Givers", loyaltyTend: 0 })];
    const ctx = buildTradeContext(players, 2026, strategies);

    const star = makePlayer({ PlayerID: 10, Team: "Givers", Age: 22, OVR: 85, totalValue: 1_000_000, loyaltyTend: 0 });
    const withLoss = evaluateTradeSide("Givers", "Receivers", [star], [], ctx);
    const lossFactor = withLoss.factors.find((f) => f.label.includes("franchise asset"));
    expect(lossFactor).toBeTruthy();
    expect(lossFactor!.value).toBe(-Math.round(1_000_000 * 0.25));

    const journeyman = makePlayer({ PlayerID: 11, Team: "Givers", Age: 29, OVR: 65, totalValue: 300_000, loyaltyTend: 0 });
    const withoutLoss = evaluateTradeSide("Givers", "Receivers", [journeyman], [], ctx);
    expect(withoutLoss.factors.find((f) => f.label.includes("franchise asset"))).toBeUndefined();
  });

  it("blocks the trade and reads Below fair value when a hard-refuse player is involved", () => {
    const refuser = makePlayer({ PlayerID: 1, Team: "Brisbane Lions", OriginClub: "Brisbane Lions", loyaltyTend: 99, Age: 32 }); // confirmed refuse vs Adelaide above
    const players = [refuser, makePlayer({ PlayerID: 2, Team: "Adelaide", loyaltyTend: 0 })];
    const ctx = buildTradeContext(players, 2026, strategies);
    const result = evaluateTradeSide("Adelaide", "Brisbane Lions", [], [refuser], ctx);
    expect(result.blocked).toBe(true);
    expect(result.verdict).toBe("Below fair value");
  });

  it("evaluateTrade produces two independently-computed side evaluations, not a mirrored single number", () => {
    const players = [
      makePlayer({ PlayerID: 1, Team: "Receivers", totalValue: 400_000, loyaltyTend: 0 }),
      makePlayer({ PlayerID: 2, Team: "Givers", totalValue: 400_000, loyaltyTend: 0 }),
    ];
    const ctx = buildTradeContext(players, 2026, strategies);
    const result = evaluateTrade("Receivers", "Givers", [players[0]], [players[1]], ctx);
    expect(result.proposerView).not.toBe(result.recipientView);
    expect(result.proposerView.clubName).toBe("Receivers");
    expect(result.recipientView.clubName).toBe("Givers");
  });
});

describe("resolveTradeOutcome / findCounterOfferAddition", () => {
  const strategies = new Map<string, ClubStrategy>([
    ["Proposer", "Balanced"],
    ["Recipient", "Balanced"],
  ]);

  it("accepts outright when the recipient reads Overpay or Fair value", () => {
    const players = [
      makePlayer({ PlayerID: 1, Team: "Proposer", totalValue: 500_000, loyaltyTend: 0 }),
      makePlayer({ PlayerID: 2, Team: "Recipient", totalValue: 490_000, loyaltyTend: 0 }),
    ];
    const ctx = buildTradeContext(players, 2026, strategies);
    const evaluation = evaluateTrade("Proposer", "Recipient", [players[0]], [players[1]], ctx);
    const outcome = resolveTradeOutcome(evaluation, "Proposer", "Recipient", new Set([1]), [players[1]], ctx);
    expect(outcome.result).toBe("accepted");
  });

  it("rejects outright when a hard-refuse player blocks the deal, even if the value would otherwise clear", () => {
    const refuser = makePlayer({ PlayerID: 1, Team: "Brisbane Lions", OriginClub: "Brisbane Lions", loyaltyTend: 99, Age: 32, totalValue: 500_000 });
    const players = [refuser, makePlayer({ PlayerID: 2, Team: "Adelaide", totalValue: 500_000, loyaltyTend: 0 })];
    const ctx = buildTradeContext(players, 2026, strategies);
    const evaluation = evaluateTrade("Adelaide", "Brisbane Lions", [], [refuser], ctx);
    const outcome = resolveTradeOutcome(evaluation, "Adelaide", "Brisbane Lions", new Set(), [refuser], ctx);
    expect(outcome.result).toBe("rejected");
  });

  it("counters a Close-but-short offer by finding a cheap sufficient addition from the proposer's roster", () => {
    const players = [
      makePlayer({ PlayerID: 1, Team: "Proposer", totalValue: 100_000, loyaltyTend: 0 }), // the original lowball offer
      makePlayer({ PlayerID: 2, Team: "Proposer", totalValue: 350_000, loyaltyTend: 0 }), // should be found as the sweetener
      makePlayer({ PlayerID: 3, Team: "Recipient", totalValue: 500_000, loyaltyTend: 0 }),
    ];
    const ctx = buildTradeContext(players, 2026, strategies);
    const proposerGives = [players[0]];
    const proposerGets = [players[2]];
    const evaluation = evaluateTrade("Proposer", "Recipient", proposerGives, proposerGets, ctx);
    expect(evaluation.recipientView.verdict).toBe("Close but short");

    const addition = findCounterOfferAddition("Proposer", "Recipient", new Set([1]), proposerGets, ctx);
    expect(addition?.PlayerID).toBe(2);

    const outcome = resolveTradeOutcome(evaluation, "Proposer", "Recipient", new Set([1]), proposerGets, ctx);
    expect(outcome).toEqual({ result: "countered", addPlayerId: 2, addPlayerName: expect.any(String) });
  });

  it("rejects a Close-but-short offer with no rescue when nothing on the proposer's roster would close the gap", () => {
    const players = [
      makePlayer({ PlayerID: 1, Team: "Proposer", totalValue: 50_000, loyaltyTend: 0 }),
      makePlayer({ PlayerID: 3, Team: "Recipient", totalValue: 2_000_000, loyaltyTend: 0 }),
    ];
    const ctx = buildTradeContext(players, 2026, strategies);
    const evaluation = evaluateTrade("Proposer", "Recipient", [players[0]], [players[1]], ctx);
    const outcome = resolveTradeOutcome(evaluation, "Proposer", "Recipient", new Set([1]), [players[1]], ctx);
    expect(outcome.result).toBe("rejected");
  });
});

describe("executeTrade", () => {
  it("swaps both sides' Team and ClubID, never mutates the input, leaves everyone else untouched", () => {
    const players = [
      makePlayer({ PlayerID: 1, Team: "Adelaide", ClubID: 1 }),
      makePlayer({ PlayerID: 2, Team: "Carlton", ClubID: 3 }),
      makePlayer({ PlayerID: 3, Team: "Essendon", ClubID: 5 }),
    ];
    const frozen = players.map((p) => ({ ...p }));
    const next = executeTrade(players, "Adelaide", "Carlton", new Set([1]), new Set([2]));

    expect(players).toEqual(frozen); // input array's objects untouched

    const p1 = next.find((p) => p.PlayerID === 1)!;
    const p2 = next.find((p) => p.PlayerID === 2)!;
    const p3 = next.find((p) => p.PlayerID === 3)!;
    expect(p1.Team).toBe("Carlton");
    expect(p1.ClubID).toBe(clubByName("Carlton")!.ClubID);
    expect(p2.Team).toBe("Adelaide");
    expect(p2.ClubID).toBe(clubByName("Adelaide")!.ClubID);
    expect(p3).toEqual(players[2]); // untouched third player, same object shape
  });
});

describe("tradeVolumePenalty / hasListInstability", () => {
  it("matches Engine.md's confirmed escalating ladder", () => {
    expect(tradeVolumePenalty(0)).toEqual({ cultureImpact: 0, moraleImpact: 0, message: expect.any(String) }); // trade #1
    expect(tradeVolumePenalty(1)).toEqual({ cultureImpact: 0, moraleImpact: 0, message: expect.any(String) }); // trade #2
    expect(tradeVolumePenalty(2)).toEqual({ cultureImpact: -1, moraleImpact: 0, message: expect.any(String) }); // trade #3
    expect(tradeVolumePenalty(3)).toEqual({ cultureImpact: -3, moraleImpact: -1, message: expect.any(String) }); // trade #4
    expect(tradeVolumePenalty(10)).toEqual({ cultureImpact: -3, moraleImpact: -1, message: expect.any(String) }); // stays capped
  });

  it("list instability flips true starting at trade #4", () => {
    expect(hasListInstability(3)).toBe(false);
    expect(hasListInstability(4)).toBe(true);
  });
});

describe("applyMoraleImpact", () => {
  it("decrements only signed, non-delisted players at the target club, clamped to [10, 99], never mutates input", () => {
    const players = [
      makePlayer({ PlayerID: 1, Team: "Adelaide", morale: 50, expired_year: 2030 }),
      makePlayer({ PlayerID: 2, Team: "Adelaide", morale: 12, expired_year: 2030 }), // near floor
      makePlayer({ PlayerID: 3, Team: "Adelaide", morale: 50, expired_year: 2024, delisted: false }), // out of contract, excluded
      makePlayer({ PlayerID: 4, Team: "Adelaide", morale: 50, expired_year: 2030, delisted: true }), // delisted, excluded
      makePlayer({ PlayerID: 5, Team: "Carlton", morale: 50, expired_year: 2030 }), // other club, untouched
    ];
    const frozen = players.map((p) => ({ ...p }));
    const next = applyMoraleImpact(players, "Adelaide", -5, 2026);

    expect(players).toEqual(frozen);
    expect(next.find((p) => p.PlayerID === 1)!.morale).toBe(45);
    expect(next.find((p) => p.PlayerID === 2)!.morale).toBe(10); // clamped at floor
    expect(next.find((p) => p.PlayerID === 3)!.morale).toBe(50); // untouched, OOC
    expect(next.find((p) => p.PlayerID === 4)!.morale).toBe(50); // untouched, delisted
    expect(next.find((p) => p.PlayerID === 5)!.morale).toBe(50); // untouched, other club
  });

  it("is a no-op copy when delta is 0", () => {
    const players = [makePlayer({ PlayerID: 1, Team: "Adelaide", morale: 50 })];
    const next = applyMoraleImpact(players, "Adelaide", 0, 2026);
    expect(next).toEqual(players);
    expect(next).not.toBe(players);
  });
});

describe("simulateLeagueTrades", () => {
  const currentYear = 2026;
  const strategies = new Map<string, ClubStrategy>([
    ["Adelaide", "Balanced"],
    ["Brisbane Lions", "Balanced"],
  ]);

  // Adelaide: weak Midfield (OVR 40), strong Defence (OVR 70).
  // Brisbane Lions: strong Midfield (OVR 70), weak Defence (OVR 40).
  // A textbook complementary pairing — each is the other's answer.
  function threeAt(team: string, archetype: "Inside Mid" | "Key Defender", ovr: number, startId: number) {
    return [0, 1, 2].map((i) => makePlayer({ PlayerID: startId + i, Team: team, OriginClub: team, archetype, OVR: ovr, totalValue: 500_000, loyaltyTend: 0 }));
  }
  const players = [...threeAt("Adelaide", "Inside Mid", 40, 1), ...threeAt("Adelaide", "Key Defender", 70, 4), ...threeAt("Brisbane Lions", "Inside Mid", 70, 7), ...threeAt("Brisbane Lions", "Key Defender", 40, 10)];

  it("finds and executes the complementary trade, never touching myClub (a third, uninvolved real club)", () => {
    const { players: next, activity } = simulateLeagueTrades(players, "Carlton", currentYear, 1, 42, strategies);
    expect(activity.length).toBeGreaterThan(0);
    for (const a of activity) {
      expect(a.clubName).not.toBe("Carlton");
      expect(a.fromClubName).not.toBe("Carlton");
      expect(a.kind).toBe("traded");
    }
    // total player count preserved — a pure swap, nobody duplicated or dropped
    expect(next).toHaveLength(players.length);
  });

  it("is deterministic given the same seed", () => {
    const a = simulateLeagueTrades(players, "Carlton", currentYear, 1, 42, strategies);
    const b = simulateLeagueTrades(players, "Carlton", currentYear, 1, 42, strategies);
    expect(a).toEqual(b);
  });

  it("never trades an out-of-contract player — no eligible candidates means no trade", () => {
    const oocPlayers = players.map((p) => (p.Team === "Brisbane Lions" && p.archetype === "Inside Mid" ? { ...p, expired_year: 2024 } : p));
    const { activity } = simulateLeagueTrades(oocPlayers, "Carlton", currentYear, 1, 42, strategies);
    // Brisbane's only surplus-line donors (their Midfield) are now all OOC;
    // Adelaide's Defence donors remain eligible, but a trade needs both legs.
    expect(activity).toHaveLength(0);
  });
});

describe("generateInboundOffers", () => {
  const currentYear = 2026;
  const strategies = new Map<string, ClubStrategy>([
    ["Carlton", "Balanced"],
    ["Adelaide", "Balanced"],
  ]);
  function threeAt(team: string, archetype: "Inside Mid" | "Key Defender", ovr: number, startId: number) {
    return [0, 1, 2].map((i) => makePlayer({ PlayerID: startId + i, Team: team, OriginClub: team, archetype, OVR: ovr, totalValue: 500_000, loyaltyTend: 0 }));
  }
  // Carlton (myClub): weak Defence, strong Midfield. Adelaide (rival):
  // strong Defence, weak Midfield — the mirror, so Adelaide should offer
  // in one of its defenders wanting one of Carlton's midfielders back.
  const players = [...threeAt("Carlton", "Inside Mid", 70, 1), ...threeAt("Carlton", "Key Defender", 40, 4), ...threeAt("Adelaide", "Inside Mid", 40, 7), ...threeAt("Adelaide", "Key Defender", 70, 10)];

  it("builds offers from a rival into myClub's inbox without executing them", () => {
    const offers = generateInboundOffers(players, "Carlton", currentYear, 1, 7, strategies);
    expect(offers.length).toBeGreaterThan(0);
    for (const o of offers) {
      expect(o.toClub).toBe("Carlton");
      expect(o.fromClub).not.toBe("Carlton");
      expect(o.theyGivePlayerIds.length).toBeGreaterThan(0);
      expect(o.theyWantPlayerIds.length).toBeGreaterThan(0);
    }
    // purely constructive — the roster itself is untouched
    for (const p of players) {
      expect(p.Team).toBe(p.PlayerID <= 6 ? "Carlton" : "Adelaide");
    }
  });

  it("is deterministic given the same seed and respects the per-day cap", () => {
    const a = generateInboundOffers(players, "Carlton", currentYear, 1, 7, strategies);
    const b = generateInboundOffers(players, "Carlton", currentYear, 1, 7, strategies);
    expect(a).toEqual(b);
    expect(a.length).toBeLessThanOrEqual(2);
  });
});
