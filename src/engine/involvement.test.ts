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
  it("a real assigned position outside the player's own archetype zone still floors the weight at Very suitable", () => {
    // A Small Forward's own archetype reads low in defensive 50 (zone 0) -
    // but if the coach has actually played them at CHB this week, that real
    // placement should count for at least as much as the archetype default.
    const player = makePlayer({ PlayerID: 1, archetype: "Small Forward" });
    const archetypeOnly = involvementWeight(player, 0);
    const withRealPosition = involvementWeight(player, 0, "CHB");
    expect(withRealPosition).toBeGreaterThan(archetypeOnly);
    expect(withRealPosition).toBe(SUITABILITY_RANK["Very suitable"]);
  });

  it("a real assigned position in a *different* zone than the one being weighted has no effect", () => {
    const player = makePlayer({ PlayerID: 1, archetype: "Small Forward" });
    const withUnrelatedPosition = involvementWeight(player, 0, "FF"); // FF is zone 4, not 0
    const archetypeOnly = involvementWeight(player, 0);
    expect(withUnrelatedPosition).toBe(archetypeOnly);
  });

  it("INT (interchange) has no fixed zone, so it never overrides the archetype read", () => {
    const player = makePlayer({ PlayerID: 1, archetype: "Key Defender" });
    expect(involvementWeight(player, 4, "INT")).toBe(involvementWeight(player, 4));
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
  it("favours the player whose real assigned position matches the zone in play", () => {
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
    const picksInDef50 = Array.from({ length: 200 }, () => weightedPlayerChoice(rng, team, 0));
    const keyDefShareInDef50 = picksInDef50.filter((p) => p.PlayerID === 1).length / picksInDef50.length;
    expect(keyDefShareInDef50).toBeGreaterThan(0.85); // heavily, not exclusively, favoured

    const picksInFwd50 = Array.from({ length: 200 }, () => weightedPlayerChoice(rng, team, 4));
    const keyFwdShareInFwd50 = picksInFwd50.filter((p) => p.PlayerID === 2).length / picksInFwd50.length;
    expect(keyFwdShareInFwd50).toBeGreaterThan(0.85);
  });
});
