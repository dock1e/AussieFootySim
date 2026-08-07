import { describe, it, expect } from "vitest";
import {
  DRAFT_POOL_SIZE,
  DRAFT_ROUNDS,
  TOTAL_DRAFT_PICKS,
  DRAFT_POOL_TEAM,
  NOT_YET_DRAFTED,
  SCOUT_BUDGET_PER_DRAFT,
  SCOUT_HEADLINE_ATTRIBUTES,
  MOCK_OUTLETS,
  generateProspectPool,
  estimatedValue,
  ageFactorForPot,
  potentialForProspect,
  potentialLetterGrade,
  scoutOvrBand,
  scoutConfidence,
  trueProspectRank,
  mockProjection,
  buildDraftOrder,
  likelyNeedForClub,
  prospectScore,
  bestAvailableProspect,
  draftPlayer,
  autoResolvePick,
} from "./draft";
import { makePlayer } from "../testUtils/makePlayer";
import { ARCHETYPES } from "../types/archetype";
import { CLUBS } from "../types/club";
import { computeLadder } from "./ladder";
import type { Player } from "../types/player";

/**
 * Deliberately synthetic throughout (makePlayer fixtures spanning all 14
 * archetypes), same isolation convention every other engine/*.test.ts file
 * uses — see trade.test.ts's own note. The real-data cross-check (pool
 * calibration against the real 751-player league, a full chained 90-pick
 * draft, archetype-distribution matching, scout-band/confidence shape) lives
 * in scratch/verify_draft_scratch.ts instead, run directly under Node since
 * Vitest can't run in this sandbox (standing environment limitation, see
 * ROADMAP.md's "What I need from you" — Tyler, please run `npm test`
 * locally to get a real pass/fail here).
 */

function buildSyntheticLeague(): Player[] {
  const players: Player[] = [];
  let id = 1;
  for (const archetype of ARCHETYPES) {
    for (let i = 0; i < 4; i++) {
      const club = CLUBS[(id + i) % CLUBS.length].name;
      players.push(makePlayer({ PlayerID: id++, archetype, Age: 21 + i, Team: club, OriginClub: club, OVR: 45 + i * 8 }));
    }
  }
  return players;
}

describe("generateProspectPool", () => {
  const league = buildSyntheticLeague();
  const pool = generateProspectPool(league, 2026, 7);

  it("generates exactly DRAFT_POOL_SIZE prospects", () => {
    expect(pool.length).toBe(DRAFT_POOL_SIZE);
  });

  it("assigns unique PlayerIDs clear of the synthetic league's own IDs", () => {
    const ids = new Set(pool.map((p) => p.PlayerID));
    expect(ids.size).toBe(pool.length);
    expect(pool.every((p) => !league.some((l) => l.PlayerID === p.PlayerID))).toBe(true);
  });

  it("sits every prospect in the Draft Pool sentinel, undrafted", () => {
    expect(pool.every((p) => p.Team === DRAFT_POOL_TEAM && p.OriginClub === DRAFT_POOL_TEAM && p.ClubID === 0)).toBe(true);
    expect(pool.every((p) => p.draft_pick === NOT_YET_DRAFTED)).toBe(true);
  });

  it("keeps POT >= OVR for every prospect, both clipped to [1,99]", () => {
    for (const p of pool) {
      expect(p.POT).toBeGreaterThanOrEqual(p.OVR);
      expect(p.OVR).toBeGreaterThanOrEqual(1);
      expect(p.POT).toBeLessThanOrEqual(99);
    }
  });

  it("generates only ages 18-22", () => {
    expect(pool.every((p) => p.Age >= 18 && p.Age <= 22)).toBe(true);
  });

  it("zeroes every stat_* field (no games played)", () => {
    expect(pool.every((p) => p.stat_GM === 0 && p.stat_DI === 0 && p.stat_HO === 0)).toBe(true);
  });

  it("is deterministic given the same seed", () => {
    const again = generateProspectPool(league, 2026, 7);
    expect(again.map((p) => p.PlayerID + p.archetype + p.OVR)).toEqual(pool.map((p) => p.PlayerID + p.archetype + p.OVR));
  });

  it("produces a different pool for a different seed", () => {
    const other = generateProspectPool(league, 2026, 99);
    expect(other.map((p) => p.OVR)).not.toEqual(pool.map((p) => p.OVR));
  });

  it("never mutates the existingPlayers array it's handed", () => {
    const before = league.map((p) => ({ ...p }));
    generateProspectPool(league, 2026, 123);
    expect(league).toEqual(before);
  });
});

describe("estimatedValue", () => {
  it("matches Configuration.md's confirmed anchor: OVR 50 -> ~$500k", () => {
    expect(estimatedValue(50)).toBe(500_000);
  });

  it("floors at $140k (the 'new young kids' anchor)", () => {
    expect(estimatedValue(1)).toBe(140_000);
    expect(estimatedValue(28)).toBeGreaterThanOrEqual(140_000);
  });

  it("never exceeds the $2.5m ceiling even past OVR 99", () => {
    expect(estimatedValue(150)).toBe(2_500_000);
  });

  it("increases monotonically with OVR", () => {
    expect(estimatedValue(60)).toBeGreaterThan(estimatedValue(50));
    expect(estimatedValue(80)).toBeGreaterThan(estimatedValue(60));
  });
});

describe("ageFactorForPot", () => {
  it("matches Schema.md's clip((30-Age)/12, 0.1, 1) verbatim", () => {
    expect(ageFactorForPot(18)).toBeCloseTo(1, 5); // (30-18)/12 = 1, clipped to max 1
    expect(ageFactorForPot(30)).toBeCloseTo(0.1, 5); // (30-30)/12 = 0, clipped to min 0.1
    expect(ageFactorForPot(24)).toBeCloseTo(0.5, 5); // (30-24)/12 = 0.5
  });

  it("is a different formula from progression.ts's own ageFactor (decline mechanic) by design", () => {
    // progression.ts's ageFactor(18) === 0.4 (still-developing decline band);
    // this file's ageFactorForPot(18) === 1 (max headroom) — deliberately
    // not the same number, see this file's doc comment point 2.
    expect(ageFactorForPot(18)).not.toBeCloseTo(0.4, 5);
  });
});

describe("potentialForProspect", () => {
  it("never returns below the prospect's own OVR", () => {
    const p = makePlayer({ archetype: "Ruck", OVR: 40, potentialTall: 30, potentialMid: 30, Age: 29 });
    expect(potentialForProspect(p)).toBeGreaterThanOrEqual(40);
  });

  it("grants more upside to a younger player with the same attributes", () => {
    const young = makePlayer({ archetype: "Ruck", OVR: 40, potentialTall: 90, potentialMid: 50, Age: 18 });
    const old = makePlayer({ archetype: "Ruck", OVR: 40, potentialTall: 90, potentialMid: 50, Age: 29 });
    expect(potentialForProspect(young)).toBeGreaterThan(potentialForProspect(old));
  });

  it("picks potentialTall vs potentialMid via the real potentialCeilingFor (archetype frame), not a local guess", () => {
    // Ruck reads "Tall" (progression.ts's ARCHETYPE_FRAME) -> potentialTall gates it.
    const p = makePlayer({ archetype: "Ruck", OVR: 40, potentialTall: 99, potentialMid: 1, Age: 18 });
    expect(potentialForProspect(p)).toBeGreaterThan(40);
  });
});

describe("potentialLetterGrade", () => {
  it("mirrors PlayerDetailModal.tsx's private potentialGrade bucket thresholds exactly", () => {
    expect(potentialLetterGrade(90)).toBe("A+");
    expect(potentialLetterGrade(85)).toBe("A");
    expect(potentialLetterGrade(84)).toBe("A-");
    expect(potentialLetterGrade(80)).toBe("A-");
    expect(potentialLetterGrade(79)).toBe("B+");
    expect(potentialLetterGrade(70)).toBe("B");
    expect(potentialLetterGrade(65)).toBe("B-");
    expect(potentialLetterGrade(60)).toBe("C+");
    expect(potentialLetterGrade(55)).toBe("C");
    expect(potentialLetterGrade(50)).toBe("C-");
    expect(potentialLetterGrade(1)).toBe("D");
  });
});

describe("scoutOvrBand / scoutConfidence", () => {
  const p = makePlayer({ PlayerID: 12345, OVR: 55 });

  it("narrows as revealedCount climbs, never below the floor", () => {
    const b0 = scoutOvrBand(p, 0);
    const b4 = scoutOvrBand(p, 4);
    const b8 = scoutOvrBand(p, 8);
    expect(b4.high - b4.low).toBeLessThan(b0.high - b0.low);
    expect(b8.high - b8.low).toBeLessThan(b4.high - b4.low);
    expect(b8.high - b8.low).toBeGreaterThanOrEqual(4); // 2*FOG_WIDTH_FLOOR
  });

  it("is deterministic per prospect (same PlayerID always yields the same band)", () => {
    expect(scoutOvrBand(p, 2)).toEqual(scoutOvrBand(p, 2));
  });

  it("clips to [1,99] even for extreme OVRs", () => {
    const extreme = makePlayer({ PlayerID: 999, OVR: 99 });
    const band = scoutOvrBand(extreme, 0);
    expect(band.high).toBeLessThanOrEqual(99);
    expect(band.low).toBeGreaterThanOrEqual(1);
  });

  it("confidence stays within the spec's observed 35-84% band and rises with reveals", () => {
    const c0 = scoutConfidence(p, 0);
    const c8 = scoutConfidence(p, SCOUT_HEADLINE_ATTRIBUTES.length);
    expect(c0).toBeGreaterThanOrEqual(35);
    expect(c8).toBeLessThanOrEqual(84);
    expect(c8).toBeGreaterThan(c0);
  });
});

describe("trueProspectRank / mockProjection", () => {
  const pool = [
    makePlayer({ PlayerID: 1, OVR: 70, POT: 80 }),
    makePlayer({ PlayerID: 2, OVR: 60, POT: 70 }),
    makePlayer({ PlayerID: 3, OVR: 50, POT: 60 }),
  ];

  it("ranks the highest OVR/POT blend 1st", () => {
    expect(trueProspectRank(pool, pool[0])).toBe(1);
    expect(trueProspectRank(pool, pool[2])).toBe(3);
  });

  it("every mock outlet returns a range within [1, pool.length]", () => {
    for (const outlet of MOCK_OUTLETS) {
      const range = mockProjection(pool[0], pool, outlet);
      expect(range.low).toBeGreaterThanOrEqual(1);
      expect(range.high).toBeLessThanOrEqual(pool.length);
      expect(range.low).toBeLessThanOrEqual(range.high);
    }
  });
});

describe("buildDraftOrder", () => {
  it("produces TOTAL_DRAFT_PICKS entries, DRAFT_ROUNDS repeats of an 18-club sequence", () => {
    const order = buildDraftOrder(null);
    expect(order.length).toBe(TOTAL_DRAFT_PICKS);
    expect(order.slice(0, CLUBS.length)).toEqual(order.slice(CLUBS.length, CLUBS.length * 2));
  });

  it("reverses a real ladder — last place picks first", () => {
    const outcomes = [{ homeClubId: CLUBS[0].ClubID, awayClubId: CLUBS[1].ClubID, homePoints: 100, awayPoints: 50 }];
    const ladder = computeLadder(CLUBS.map((c) => c.ClubID), outcomes);
    const order = buildDraftOrder(ladder);
    // CLUBS[1] lost, so on a ladder of just these two decided results it's
    // not necessarily last overall (16 clubs are still tied at 0 games), but
    // CLUBS[0] (the winner) must not be picking before every 0-win club.
    const winnerIndex = order.indexOf(CLUBS[0].name);
    const loserIndex = order.indexOf(CLUBS[1].name);
    expect(loserIndex).toBeLessThan(winnerIndex);
  });

  it("falls back to CLUBS' own order when there's no ladder yet", () => {
    const order = buildDraftOrder(undefined);
    expect(order[0]).toBe(CLUBS[0].name);
  });
});

describe("prospectScore / bestAvailableProspect", () => {
  const clubName = CLUBS[0].name;
  const thinAtRuck = new Map<string, Player[]>([
    [clubName, [makePlayer({ PlayerID: 1, archetype: "Inside Mid", Team: clubName, OVR: 70 })]],
  ]);

  it("scores a prospect in the club's weakest line higher than an equally-talented one in a well-stocked line", () => {
    const ruckProspect = makePlayer({ PlayerID: 100, archetype: "Ruck", OVR: 55, POT: 60 });
    const midProspect = makePlayer({ PlayerID: 101, archetype: "Inside Mid", OVR: 55, POT: 60 });
    const ruckScore = prospectScore(ruckProspect, clubName, "Balanced", thinAtRuck);
    const midScore = prospectScore(midProspect, clubName, "Balanced", thinAtRuck);
    expect(ruckScore).toBeGreaterThan(midScore);
  });

  it("bestAvailableProspect picks the single highest-scoring prospect from a pool", () => {
    const pool = [
      makePlayer({ PlayerID: 200, archetype: "Ruck", OVR: 40, POT: 45 }),
      makePlayer({ PlayerID: 201, archetype: "Ruck", OVR: 65, POT: 70 }),
    ];
    const best = bestAvailableProspect(pool, clubName, "Balanced", thinAtRuck);
    expect(best?.PlayerID).toBe(201);
  });

  it("bestAvailableProspect returns null for an empty pool", () => {
    expect(bestAvailableProspect([], clubName, "Balanced", thinAtRuck)).toBeNull();
  });
});

describe("draftPlayer", () => {
  it("assigns the picking club, sets real draft fields, and signs a 2yr rookie deal", () => {
    const prospect = makePlayer({ PlayerID: 9001, Team: DRAFT_POOL_TEAM, OriginClub: DRAFT_POOL_TEAM, ClubID: 0, draft_pick: 0, totalValue: 180_000, POT: 62 });
    const club = CLUBS[3];
    const drafted = draftPlayer(prospect, club.name, 25, 2026);

    expect(drafted.Team).toBe(club.name);
    expect(drafted.OriginClub).toBe(club.name);
    expect(drafted.ClubID).toBe(club.ClubID);
    expect(drafted.draft_pick).toBe(25);
    expect(drafted.draft_year).toBe(2026);
    expect(drafted.draft_draftType).toBe("National Draft");
    expect(drafted.expired_year).toBe(2028); // reSign's 2yr term
    expect(drafted.totalValue).toBe(180_000);
    expect(drafted.POT).toBe(62); // untouched, "no formula change" at draft time
  });
});

describe("autoResolvePick", () => {
  const clubName = CLUBS[0].name;
  const playersByClub = new Map<string, Player[]>([[clubName, []]]);

  it("drafts the best-available prospect and returns a matching record", () => {
    const pool = [
      makePlayer({ PlayerID: 300, archetype: "Ruck", OVR: 40, POT: 45 }),
      makePlayer({ PlayerID: 301, archetype: "Ruck", OVR: 65, POT: 70 }),
    ];
    const result = autoResolvePick(pool, clubName, 3, 2026, "Balanced", playersByClub);
    expect(result?.player.PlayerID).toBe(301);
    expect(result?.player.Team).toBe(clubName);
    expect(result?.record).toEqual({ pickNumber: 3, round: 1, clubName, playerId: 301, playerName: result?.player.fname + " " + result?.player.lname });
  });

  it("computes round correctly from pick number (19 -> round 2)", () => {
    const pool = [makePlayer({ PlayerID: 400, archetype: "Ruck", OVR: 50, POT: 55 })];
    const result = autoResolvePick(pool, clubName, 19, 2026, "Balanced", playersByClub);
    expect(result?.record.round).toBe(2);
  });

  it("returns null for an empty pool", () => {
    expect(autoResolvePick([], clubName, 1, 2026, "Balanced", playersByClub)).toBeNull();
  });
});

describe("likelyNeedForClub", () => {
  it("flags a thin line and stays quiet when everything reads green", () => {
    const clubName = CLUBS[0].name;
    const thin = new Map<string, Player[]>([[clubName, [makePlayer({ archetype: "Inside Mid", Team: clubName, OVR: 40 })]]]);
    expect(likelyNeedForClub(clubName, thin)).not.toBeNull();

    const empty = new Map<string, Player[]>([[clubName, []]]);
    // A club with literally no players has every line at a 0 average, tied
    // with the (also 0, since it's the only club) league average — reads as
    // no discernible gap rather than crashing.
    expect(() => likelyNeedForClub(clubName, empty)).not.toThrow();
  });
});

describe("shared constants", () => {
  it("TOTAL_DRAFT_PICKS is DRAFT_ROUNDS x 18 real clubs", () => {
    expect(TOTAL_DRAFT_PICKS).toBe(DRAFT_ROUNDS * CLUBS.length);
    expect(TOTAL_DRAFT_PICKS).toBe(90); // Configuration.md's confirmed National Draft class size
  });

  it("SCOUT_BUDGET_PER_DRAFT matches Engine.md's confirmed 4 reveal uses", () => {
    expect(SCOUT_BUDGET_PER_DRAFT).toBe(4);
  });

  it("SCOUT_HEADLINE_ATTRIBUTES has exactly 8 entries, matching the 'n/8 revealed' spec text", () => {
    expect(SCOUT_HEADLINE_ATTRIBUTES.length).toBe(8);
  });
});
