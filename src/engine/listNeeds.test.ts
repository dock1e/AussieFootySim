import { describe, it, expect } from "vitest";
import { computeLeagueIdealListedCounts, computeLeagueStrategies, computeListNeeds } from "./listNeeds";
import { makePlayer } from "../testUtils/makePlayer";
import type { Player } from "../types/player";
import type { Archetype } from "../types/archetype";

/**
 * Deliberately synthetic throughout — same isolation match.test.ts/
 * season.test.ts/progression.test.ts use, so this file doesn't depend on
 * `npm run build:data` having been run. The real-league evidence (all 18
 * real clubs produce a valid report, the strategy label splits 6/6/6, the
 * league-wide "ideal" counts land close to Engine.md's own live-observed
 * `8/14` Midfield example) lives in scratch/verify_list_needs_real.ts
 * instead, for the same reason progression.ts's OVR-fidelity check does.
 */

let nextId = 1;
function makeClub(archetype: Archetype, count: number, ovr: number, age = 25): Player[] {
  return Array.from({ length: count }, () => makePlayer({ PlayerID: nextId++, archetype, OVR: ovr, Age: age }));
}

describe("computeLeagueIdealListedCounts", () => {
  it("is the league's own average listed count per line, rounded", () => {
    const league = new Map<string, Player[]>([
      ["ClubA", [...makeClub("Inside Mid", 4, 50), ...makeClub("Key Forward", 2, 50)]],
      ["ClubB", [...makeClub("Inside Mid", 2, 50), ...makeClub("Key Forward", 6, 50)]],
    ]);
    // Midfield: (4+2)/2 = 3. Forwards: (2+6)/2 = 4. Defence/Ruck: 0.
    expect(computeLeagueIdealListedCounts(league)).toEqual({ Midfield: 3, Forwards: 4, Defence: 0, Ruck: 0 });
  });
});

describe("computeLeagueStrategies", () => {
  it("buckets an elite, prime-aged club as Contend and a weak, very young club as Rebuild", () => {
    const league = new Map<string, Player[]>([
      ["EliteOld", makeClub("Inside Mid", 10, 90, 30)],
      ["WeakYoung", makeClub("Inside Mid", 10, 35, 19)],
      ["Middling", makeClub("Inside Mid", 10, 55, 25)],
    ]);
    const strategies = computeLeagueStrategies(league);
    expect(strategies.get("EliteOld")).toBe("Contend");
    expect(strategies.get("WeakYoung")).toBe("Rebuild");
    expect(strategies.get("Middling")).toBe("Balanced");
  });

  it("returns a strategy for every club passed in, even a single-club league (no crash on zero variance)", () => {
    const league = new Map<string, Player[]>([["OnlyClub", makeClub("Inside Mid", 10, 60)]]);
    const strategies = computeLeagueStrategies(league);
    expect(strategies.get("OnlyClub")).toBe("Balanced"); // zero std dev -> z-score 0 both measures -> Balanced
  });
});

describe("computeListNeeds", () => {
  // A two-club league: "Deep" is even and solidly-rated everywhere, used only
  // to give the league-wide "ideal"/quality-bar numbers something real to be
  // relative to. "MyClub" is the club under test: deliberately thin, weak,
  // and elite-less at Midfield/Forwards/Defence, but deep, high-quality, and
  // elite-stocked at Ruck.
  const league = new Map<string, Player[]>([
    [
      "Deep",
      [...makeClub("Inside Mid", 8, 60), ...makeClub("Key Forward", 4, 60), ...makeClub("Key Defender", 4, 60), ...makeClub("Ruck", 4, 60)],
    ],
    [
      "MyClub",
      [
        ...makeClub("Inside Mid", 2, 20), // thin + weak + no elite
        ...makeClub("Key Forward", 3, 55),
        ...makeClub("Key Defender", 3, 55),
        ...makeClub("Ruck", 4, 90), // deep + quality + elite (84+)
      ],
    ],
  ]);
  const report = computeListNeeds("MyClub", league);

  it("returns exactly the 4 lines, each carrying the club's own players", () => {
    expect(report.lines).toHaveLength(4);
    expect(report.lines.map((l) => l.line).sort()).toEqual(["Defence", "Forwards", "Midfield", "Ruck"].sort());
  });

  it("flags the thin, weak, elite-less Midfield line with all three verdict clauses", () => {
    const midfield = report.lines.find((l) => l.line === "Midfield")!;
    expect(midfield.verdict).toContain("starter");
    expect(midfield.verdict).toContain("bodies short of shape");
    expect(midfield.verdict).toContain("no elite (84+)");
    expect(midfield.qualityCount).toBe(0); // both Midfield players are OVR 20, well under any reasonable league average
    expect(midfield.elite).toHaveLength(0);
  });

  it("reads the deep, high-quality, elite-stocked Ruck line as Healthy", () => {
    const ruck = report.lines.find((l) => l.line === "Ruck")!;
    expect(ruck.verdict).toBe("Healthy");
    expect(ruck.elite.length).toBeGreaterThan(0);
    expect(ruck.qualityCount).toBeGreaterThanOrEqual(ruck.starterQuota);
  });

  it("recommended actions never include a Healthy line, and are capped at 3", () => {
    expect(report.recommendedActions.length).toBeLessThanOrEqual(3);
    expect(report.recommendedActions.some((a) => a.line === "Ruck")).toBe(false);
    // Every generated action is draft-shaped for now (see RecommendedAction's own doc comment).
    expect(report.recommendedActions.every((a) => a.category === "DRAFT")).toBe(true);
  });

  it("recommended actions are sorted worst-first and tag a real starter shortfall HIGH PRIORITY", () => {
    const midfieldAction = report.recommendedActions.find((a) => a.line === "Midfield");
    expect(midfieldAction).toBeDefined();
    expect(midfieldAction!.priority).toBe("HIGH PRIORITY");
    // Descending score order.
    for (let i = 1; i < report.recommendedActions.length; i++) {
      const scoreOf = (a: (typeof report.recommendedActions)[number]) => {
        const l = report.lines.find((x) => x.line === a.line)!;
        return Math.max(0, l.starterQuota - l.qualityCount) * 2 + Math.max(0, l.ideal - l.listed);
      };
      expect(scoreOf(report.recommendedActions[i - 1])).toBeGreaterThanOrEqual(scoreOf(report.recommendedActions[i]));
    }
  });

  it("headline names the strategy and the worst-off line", () => {
    expect(report.headline.toLowerCase()).toContain(report.strategy.toLowerCase());
    expect(report.headline.toLowerCase()).toContain("midfield"); // the worst-scoring line in this fixture
  });

  it("age profile counts every player exactly once across young/prime/veteran bands", () => {
    const { young, prime, veteran, listSize } = report.ageProfile;
    expect(young + prime + veteran).toBe(listSize);
    expect(listSize).toBe(2 + 3 + 3 + 4);
  });

  it("legalSize reflects the real 24-46 trade-window band (Engine.md's Trade AI section)", () => {
    // This fixture's MyClub has exactly 12 players - well under the 24 floor.
    expect(report.ageProfile).toEqual({ listSize: 12, avgAge: 25, young: 0, prime: 12, veteran: 0, legalSize: false });

    // A club with a genuinely legal-sized list (30 players) reads true.
    const legalLeague = new Map<string, Player[]>([["LegalClub", makeClub("Inside Mid", 30, 50)]]);
    expect(computeListNeeds("LegalClub", legalLeague).ageProfile.legalSize).toBe(true);
  });

  it("an unknown club name returns an empty-list report rather than throwing", () => {
    const empty = computeListNeeds("Nonexistent FC", league);
    expect(empty.ageProfile.listSize).toBe(0);
    expect(empty.lines.every((l) => l.players.length === 0)).toBe(true);
  });
});
