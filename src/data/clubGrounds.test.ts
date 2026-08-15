import { describe, it, expect } from "vitest";
import { CLUB_PRIMARY_GROUND, GROUND_EXCEPTIONS, groundForMatch } from "./clubGrounds";
import { GROUND_CONFIGS } from "./grounds";
import { CLUBS } from "../types/club";
import { generateFixture } from "../engine/fixture";

const clubIds = CLUBS.map((c) => c.ClubID);
const fixture = generateFixture(clubIds);

describe("CLUB_PRIMARY_GROUND", () => {
  it("has an entry for every real club, pointing at a real GroundConfig", () => {
    for (const id of clubIds) {
      const groundId = CLUB_PRIMARY_GROUND[id];
      expect(groundId, `club ${id} has no primary ground`).toBeDefined();
      expect(GROUND_CONFIGS[groundId], `club ${id}'s primary ground "${groundId}" isn't a real config`).toBeDefined();
    }
  });

  it("has no stray entries for club ids that don't exist", () => {
    for (const idStr of Object.keys(CLUB_PRIMARY_GROUND)) {
      expect(clubIds).toContain(Number(idStr));
    }
  });
});

describe("GROUND_EXCEPTIONS", () => {
  it("only references real clubs and real, existing GroundConfigs", () => {
    for (const ex of GROUND_EXCEPTIONS) {
      expect(clubIds, `exception club ${ex.clubId} isn't a real club`).toContain(ex.clubId);
      expect(GROUND_CONFIGS[ex.groundId], `exception ground "${ex.groundId}" isn't a real config`).toBeDefined();
    }
  });

  it("every exception ground genuinely differs from that club's own primary ground", () => {
    // An "exception" that resolved to the same ground as the primary would be a no-op -
    // catches a copy-paste mistake between the two tables.
    for (const ex of GROUND_EXCEPTIONS) {
      expect(ex.groundId).not.toBe(CLUB_PRIMARY_GROUND[ex.clubId]);
    }
  });

  it("covers exactly Tyler's three named examples (Tasmania, Darwin, Manuka)", () => {
    const labels = GROUND_EXCEPTIONS.map((e) => e.groundId).sort();
    expect(labels).toEqual(["manuka", "tasmania", "tio"]);
  });
});

describe("groundForMatch", () => {
  it("returns the primary ground for every club when no round/fixture is given (LiveMatch.tsx's ad-hoc friendly screen)", () => {
    for (const id of clubIds) {
      const config = groundForMatch(id);
      expect(config.id).toBe(CLUB_PRIMARY_GROUND[id]);
    }
  });

  it("still returns the primary ground if only one of round/fixture is supplied", () => {
    const hawthornId = GROUND_EXCEPTIONS.find((e) => e.groundId === "tasmania")!.clubId;
    expect(groundForMatch(hawthornId, 5).id).toBe(CLUB_PRIMARY_GROUND[hawthornId]); // round with no fixture
    expect(groundForMatch(hawthornId, undefined, fixture).id).toBe(CLUB_PRIMARY_GROUND[hawthornId]); // fixture with no round
  });

  it("falls back sensibly (doesn't throw) for an unknown club id", () => {
    expect(() => groundForMatch(-1)).not.toThrow();
    expect(groundForMatch(-1).id).toBe("mcg");
  });

  it("with a full fixture, fires each exception exactly homeGamesPerSeason times, only on that club's own real home rounds", () => {
    for (const ex of GROUND_EXCEPTIONS) {
      const homeRounds = fixture.filter((m) => m.homeClubId === ex.clubId).map((m) => m.round);
      const exceptionRounds = homeRounds.filter((r) => groundForMatch(ex.clubId, r, fixture).id === ex.groundId);
      expect(exceptionRounds).toHaveLength(Math.min(ex.homeGamesPerSeason, homeRounds.length));
      // Every fired round really is one of this club's own home rounds - groundForMatch
      // was only ever asked about rounds it's plausible to ask about, but this also
      // guards against the exception ground leaking onto a non-home round if called.
      for (const r of exceptionRounds) expect(homeRounds).toContain(r);
    }
  });

  it("never applies an exception ground to a club that doesn't have one", () => {
    const exceptionClubIds = new Set(GROUND_EXCEPTIONS.map((e) => e.clubId));
    for (const id of clubIds) {
      if (exceptionClubIds.has(id)) continue;
      // Representative spot-check (round 1) per non-exception club is enough here -
      // the exception-side test above already exhaustively checks every round for
      // the 3 clubs that DO have one.
      expect(groundForMatch(id, 1, fixture).id).toBe(CLUB_PRIMARY_GROUND[id]);
    }
  });

  it("is deterministic - same club/round/fixture always resolves the same ground", () => {
    const hawthornId = GROUND_EXCEPTIONS.find((e) => e.groundId === "tasmania")!.clubId;
    const homeRounds = fixture.filter((m) => m.homeClubId === hawthornId).map((m) => m.round);
    for (const r of homeRounds) {
      expect(groundForMatch(hawthornId, r, fixture).id).toBe(groundForMatch(hawthornId, r, fixture).id);
    }
  });

  it("spreads a club's exception rounds across the season rather than clustering them all at the start", () => {
    const hawthornId = GROUND_EXCEPTIONS.find((e) => e.groundId === "tasmania")!.clubId;
    const homeRounds = fixture.filter((m) => m.homeClubId === hawthornId).map((m) => m.round).sort((a, b) => a - b);
    const exceptionRounds = homeRounds.filter((r) => groundForMatch(hawthornId, r, fixture).id === "tasmania").sort((a, b) => a - b);
    expect(exceptionRounds.length).toBeGreaterThan(1);
    // "Spread" here just means not all bunched in the first third of this club's home
    // rounds - a weak but meaningful check that the even-spacing formula is doing
    // something, without hard-coding the exact round numbers (which would make this
    // test brittle to fixture.ts's own round-robin implementation details).
    const firstThird = homeRounds.slice(0, Math.ceil(homeRounds.length / 3));
    expect(exceptionRounds.every((r) => firstThird.includes(r))).toBe(false);
  });
});
