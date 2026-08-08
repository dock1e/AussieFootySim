import { describe, it, expect } from "vitest";
import { mulberry32 } from "./rng";
import { archetypeZoneWeight, involvementWeight, weightedChoice, weightedPlayerChoice } from "./involvement";
import { SUITABILITY_RANK } from "./selection";
import { makePlayer } from "../testUtils/makePlayer";
import type { MatchTeam } from "./team";

describe("archetypeZoneWeight", () => {
  it("rates a Key Defender highest in defensive 50 and at the fallback floor in forward 50", () => {
    const def50 = archetypeZoneWeight("Key Defender", 0);
    const fwd50 = archetypeZoneWeight("Key Defender", 4);
    expect(def50).toBe(SUITABILITY_RANK["Very suitable"]);
    expect(fwd50).toBeLessThan(SUITABILITY_RANK["Barely suitable"]);
    expect(fwd50).toBeGreaterThan(0); // never literally impossible
  });

  it("mirrors that exactly for a Key Forward (highest in forward 50, floor in defensive 50)", () => {
    expect(archetypeZoneWeight("Key Forward", 4)).toBe(SUITABILITY_RANK["Very suitable"]);
    expect(archetypeZoneWeight("Key Forward", 0)).toBeLessThan(SUITABILITY_RANK["Barely suitable"]);
  });

  it("rates a Ruck and an Inside Mid both highest in midfield (zone 2), matching the live Max Gawn / Clayton Oliver heat-map evidence", () => {
    expect(archetypeZoneWeight("Ruck", 2)).toBe(SUITABILITY_RANK["Very suitable"]);
    expect(archetypeZoneWeight("Inside Mid", 2)).toBe(SUITABILITY_RANK["Very suitable"]);
  });

  it("gives a Ruck real (if lesser) forward-50 presence rather than a hard lock, matching the live Max Gawn heat map", () => {
    const ruckFwd50 = archetypeZoneWeight("Ruck", 4);
    const keyDefFwd50 = archetypeZoneWeight("Key Defender", 4);
    // Ruck is "somewhat suitable" at FF (SUITABILITY_MAP) - meaningfully more forward presence
    // than a Key Defender's fallback-floor read of the same zone.
    expect(ruckFwd50).toBeGreaterThan(keyDefFwd50);
  });

  it("every archetype gets a strictly positive weight in every zone (never literally impossible)", () => {
    const archetypes = [
      "Inside Mid", "Outside Mid", "Pressure Forward", "Hybrid Mid Forward", "Small Forward",
      "Medium Forward", "Ruck", "Key Forward", "Hybrid Key Forward Ruck", "Medium Defender",
      "Intercept Defender", "Half Back Flanker", "Back Pocket", "Key Defender",
    ] as const;
    for (const archetype of archetypes) {
      for (const zone of [0, 1, 2, 3, 4] as const) {
        expect(archetypeZoneWeight(archetype, zone)).toBeGreaterThan(0);
      }
    }
  });
});

describe("involvementWeight", () => {
  it("a real assigned position outside the player's own archetype zone still floors the weight at Very suitable (home side)", () => {
    // A Small Forward's own archetype reads low in defensive 50 (zone 0) -
    // but if the coach has actually played them at CHB this week, that real
    // placement should count for at least as much as the archetype default.
    const player = makePlayer({ PlayerID: 1, archetype: "Small Forward" });
    const archetypeOnly = involvementWeight("home", player, 0);
    const withRealPosition = involvementWeight("home", player, 0, "CHB");
    expect(withRealPosition).toBeGreaterThan(archetypeOnly);
    expect(withRealPosition).toBe(SUITABILITY_RANK["Very suitable"]);
  });

  it("a real assigned position in a *different* zone than the one being weighted has no effect (home side)", () => {
    const player = makePlayer({ PlayerID: 1, archetype: "Small Forward" });
    const withUnrelatedPosition = involvementWeight("home", player, 0, "FF"); // FF is zone 4, not 0
    const archetypeOnly = involvementWeight("home", player, 0);
    expect(withUnrelatedPosition).toBe(archetypeOnly);
  });

  it("INT (interchange) has no fixed zone, so it never overrides the archetype read", () => {
    const player = makePlayer({ PlayerID: 1, archetype: "Key Defender" });
    expect(involvementWeight("home", player, 4, "INT")).toBe(involvementWeight("home", player, 4));
  });

  // --- Fixed Aug 2026: the away side's zone must be mirrored before any
  // position/archetype lookup, or the away team's real defenders/forwards
  // get read against the wrong end of the ground. These tests would have
  // failed against the original, unmirrored Phase 8 implementation - every
  // test above (and every one that existed before this fix) only ever
  // checked the home side, which is exactly why it went uncaught. ---
  describe("away-side zone mirroring", () => {
    it("a Key Defender archetype rates highest in zone 4 (home-relative) for an away player, since zone 4 is *their own* defensive 50", () => {
      // For home, zone 0 is home's own defensive 50 and zone 4 is home's own
      // forward 50 - so a home Key Defender should peak at raw zone 0.
      expect(involvementWeight("home", makePlayer({ PlayerID: 1, archetype: "Key Defender" }), 0)).toBe(
        SUITABILITY_RANK["Very suitable"],
      );
      // For away, the *raw* zones are flipped: zone 4 is away's own
      // defensive 50 (== home's forward 50), zone 0 is away's own forward
      // 50 (== home's defensive 50). An away Key Defender should peak at
      // raw zone 4, the mirror image of the home case above.
      expect(involvementWeight("away", makePlayer({ PlayerID: 2, archetype: "Key Defender" }), 4)).toBe(
        SUITABILITY_RANK["Very suitable"],
      );
      // And correspondingly read at the fallback floor at raw zone 0 - the
      // exact opposite of a home Key Defender at that same raw zone.
      expect(involvementWeight("away", makePlayer({ PlayerID: 3, archetype: "Key Defender" }), 0)).toBeLessThan(
        SUITABILITY_RANK["Barely suitable"],
      );
    });

    it("an away player's real assigned position (e.g. FB) floors the weight at raw zone 4, not raw zone 0", () => {
      const player = makePlayer({ PlayerID: 1, archetype: "Small Forward" }); // low archetype fit either way
      const atOwnDefensive50 = involvementWeight("away", player, 4, "FB"); // raw zone 4 == away's own def 50
      const atOwnForward50 = involvementWeight("away", player, 0, "FB"); // raw zone 0 == away's own fwd 50 - unrelated to FB
      expect(atOwnDefensive50).toBe(SUITABILITY_RANK["Very suitable"]);
      expect(atOwnForward50).toBeLessThan(atOwnDefensive50);
    });

    it("home and away readings at their own mirrored raw zones agree exactly (symmetry check)", () => {
      const archetypes = ["Key Defender", "Key Forward", "Ruck", "Inside Mid", "Small Forward"] as const;
      for (const archetype of archetypes) {
        for (const zone of [0, 1, 2, 3, 4] as const) {
          const homeReading = involvementWeight("home", makePlayer({ PlayerID: 1, archetype }), zone);
          const awayReading = involvementWeight("away", makePlayer({ PlayerID: 2, archetype }), (4 - zone) as 0 | 1 | 2 | 3 | 4);
          expect(awayReading).toBe(homeReading);
        }
      }
    });
  });
});

describe("weightedChoice", () => {
  it("is deterministic for a fixed seed", () => {
    const items = ["a", "b", "c", "d"];
    const weights: Record<string, number> = { a: 1, b: 5, c: 2, d: 0.5 };
    const weightOf = (x: string) => weights[x];
    const rng1 = mulberry32(123);
    const rng2 = mulberry32(123);
    const picks1 = Array.from({ length: 20 }, () => weightedChoice(rng1, items, weightOf));
    const picks2 = Array.from({ length: 20 }, () => weightedChoice(rng2, items, weightOf));
    expect(picks1).toEqual(picks2);
  });

  it("heavily favours a high-weight item over many draws", () => {
    const items = ["heavy", "light"];
    const weightOf = (x: string) => (x === "heavy" ? 1000 : 0.001);
    const rng = mulberry32(1);
    const picks = Array.from({ length: 500 }, () => weightedChoice(rng, items, weightOf));
    const heavyCount = picks.filter((p) => p === "heavy").length;
    expect(heavyCount).toBeGreaterThan(490);
  });

  it("a single item is always returned regardless of weight", () => {
    const rng = mulberry32(1);
    expect(weightedChoice(rng, ["only"], () => 0.001)).toBe("only");
  });
});

describe("weightedPlayerChoice", () => {
  it("favours the player whose real assigned position matches the zone in play (home side)", () => {
    const keyDef = makePlayer({ PlayerID: 1, archetype: "Key Defender" });
    const keyFwd = makePlayer({ PlayerID: 2, archetype: "Key Forward" });
    const team: MatchTeam = {
      name: "Test",
      players: [keyDef, keyFwd],
      positions: new Map([
        [1, "FB"],
        [2, "FF"],
      ]),
    };
    const rng = mulberry32(1);
    const picksInDef50 = Array.from({ length: 200 }, () => weightedPlayerChoice(rng, "home", team, 0));
    const keyDefShareInDef50 = picksInDef50.filter((p) => p.PlayerID === 1).length / picksInDef50.length;
    expect(keyDefShareInDef50).toBeGreaterThan(0.85); // heavily, not exclusively, favoured

    const picksInFwd50 = Array.from({ length: 200 }, () => weightedPlayerChoice(rng, "home", team, 4));
    const keyFwdShareInFwd50 = picksInFwd50.filter((p) => p.PlayerID === 2).length / picksInFwd50.length;
    expect(keyFwdShareInFwd50).toBeGreaterThan(0.85);
  });

  it("favours the same players correctly for an away team, at the mirrored raw zones (Aug 2026 fix)", () => {
    const keyDef = makePlayer({ PlayerID: 1, archetype: "Key Defender" });
    const keyFwd = makePlayer({ PlayerID: 2, archetype: "Key Forward" });
    const team: MatchTeam = {
      name: "Test Away",
      players: [keyDef, keyFwd],
      positions: new Map([
        [1, "FB"],
        [2, "FF"],
      ]),
    };
    const rng = mulberry32(1);
    // For an away team, raw zone 4 is *their own* defensive 50 (home's zone
    // 0 mirrored) - the real FB should dominate picks there, not at raw
    // zone 0 the way a home team's FB would.
    const picksAtOwnDef50 = Array.from({ length: 200 }, () => weightedPlayerChoice(rng, "away", team, 4));
    const keyDefShare = picksAtOwnDef50.filter((p) => p.PlayerID === 1).length / picksAtOwnDef50.length;
    expect(keyDefShare).toBeGreaterThan(0.85);

    const picksAtOwnFwd50 = Array.from({ length: 200 }, () => weightedPlayerChoice(rng, "away", team, 0));
    const keyFwdShare = picksAtOwnFwd50.filter((p) => p.PlayerID === 2).length / picksAtOwnFwd50.length;
    expect(keyFwdShare).toBeGreaterThan(0.85);
  });
});
