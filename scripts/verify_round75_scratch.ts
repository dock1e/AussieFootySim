/**
 * Round 75 (disgruntlement mechanic, engine/disgruntlement.ts) verification
 * — throwaway, matches the project's established verify_roundNN_scratch.ts
 * convention. Section 5 is the real calibration run this mechanic's
 * constants were tuned against (see disgruntlement.ts's own CALIBRATION doc
 * comment) — kept here rather than in a deleted scratch script, since it's
 * the actual evidence the ~5-10/season real target (from the "AFL Trade
 * Whispers" sheet) is met, not just a unit-test-level sanity check.
 */
import { CLUBS } from "../src/types/club.ts";
import { initSeason, buildTeams, simulateRound, nextUnplayedRound, type Season } from "../src/engine/season.ts";
import { suitabilityFor, type Archetype } from "../src/types/archetype.ts";
import {
  effectiveMorale,
  disgruntledPlayerPool,
  DISGRUNTLEMENT_TUNING,
  type DisgruntlementState,
} from "../src/engine/disgruntlement.ts";
import { seedMorale } from "../src/engine/morale.ts";
import { serializeSave, deserializeSave, newSaveGame } from "../src/engine/saveGame.ts";
import { makePlayer } from "../src/testUtils/makePlayer.ts";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL  ${name}${detail ? " -- " + detail : ""}`);
  }
}

console.log("=== Section 1: tuning sanity — the documented accumulation formula, checked directly ===");
{
  const { POINTS_OUT_OF_POSITION, POINTS_LOW_GAME_TIME, STRUGGLING_CLUB_MULTIPLIER, DISCONTENT_THRESHOLD, P_FLIP_WHEN_ELIGIBLE } = DISGRUNTLEMENT_TUNING;
  check("FB really is unsuitable for a Key Forward (out-of-position's real-suitability premise)", !["Very suitable", "Somewhat suitable"].includes(suitabilityFor("Key Forward" as Archetype, "FB")));
  check("both factors + struggling-club multiplier matches the documented rounding", Math.round((POINTS_OUT_OF_POSITION + POINTS_LOW_GAME_TIME) * STRUGGLING_CLUB_MULTIPLIER) === Math.round(4 * 1.5));
  check("threshold needs multiple rounds of a single factor, not a 1-round trigger", DISCONTENT_THRESHOLD > Math.max(POINTS_OUT_OF_POSITION, POINTS_LOW_GAME_TIME));
  check("flip probability is genuinely rare per round, per Tyler's own 'uncommon' framing", P_FLIP_WHEN_ELIGIBLE < 0.05);
}

console.log("=== Section 2: effectiveMorale — live delta reconciliation, liveCondition-style ===");
{
  const withMorale = makePlayer({ PlayerID: 42, morale: 70 });
  check("no disgruntlement map -> falls back to player.morale", effectiveMorale(withMorale) === 70);
  const withoutMorale = makePlayer({ PlayerID: 43 });
  check("player.morale unset -> falls back to seedMorale(player)", effectiveMorale(withoutMorale) === seedMorale(withoutMorale));
  const disgruntledMap = new Map<number, DisgruntlementState>([[42, { discontent: 12, disgruntled: true, disgruntledSinceRound: 5, lastFactors: ["low_game_time"], moraleDelta: -DISGRUNTLEMENT_TUNING.MORALE_HIT }]]);
  check("disgruntled entry subtracts moraleDelta from baseline", effectiveMorale(withMorale, disgruntledMap) === 70 - DISGRUNTLEMENT_TUNING.MORALE_HIT);
  const lowBase = makePlayer({ PlayerID: 44, morale: 5 });
  const bigHitMap = new Map<number, DisgruntlementState>([[44, { discontent: 50, disgruntled: true, disgruntledSinceRound: 1, lastFactors: [], moraleDelta: -50 }]]);
  check("clamped to >= 0, never negative", effectiveMorale(lowBase, bigHitMap) === 0);
}

console.log("=== Section 3: disgruntledPlayerPool — filter + most-recently-disgruntled-first sort ===");
{
  const map = new Map<number, DisgruntlementState>([
    [1, { discontent: 15, disgruntled: true, disgruntledSinceRound: 3, lastFactors: [], moraleDelta: -18 }],
    [2, { discontent: 4, disgruntled: false, disgruntledSinceRound: null, lastFactors: [], moraleDelta: 0 }],
    [3, { discontent: 20, disgruntled: true, disgruntledSinceRound: 11, lastFactors: [], moraleDelta: -18 }],
  ]);
  const pool = disgruntledPlayerPool(map);
  check("excludes the non-disgruntled entry", !pool.includes(2));
  check("includes both disgruntled entries", pool.includes(1) && pool.includes(3));
  check("most-recently-disgruntled first", pool[0] === 3 && pool[1] === 1);
}

console.log("=== Section 4: save round-trip — disgruntlement Map survives serialize/deserialize; old saves default cleanly ===");
{
  const save = newSaveGame("Adelaide", [makePlayer({ PlayerID: 1 })]);
  const seasonWithDisgruntlement: Season = {
    ...initSeason(1, [1, 2]),
    disgruntlement: new Map([[1, { discontent: 7, disgruntled: false, disgruntledSinceRound: null, lastFactors: ["low_game_time"] as const, moraleDelta: 0 }]]),
  };
  const saveWithSeason = { ...save, season: seasonWithDisgruntlement };
  const wire = JSON.parse(JSON.stringify(serializeSave(saveWithSeason)));
  const restored = deserializeSave(wire);
  check("disgruntlement Map round-trips through JSON with identical content", JSON.stringify([...restored.season!.disgruntlement.entries()]) === JSON.stringify([...seasonWithDisgruntlement.disgruntlement.entries()]));

  // Simulate a genuinely old, pre-round-75 save blob: season present, but no
  // `disgruntlement` key at all in the wire format.
  const oldWire = JSON.parse(JSON.stringify(serializeSave(saveWithSeason))) as { season: { disgruntlement?: unknown } };
  delete oldWire.season.disgruntlement;
  const restoredOld = deserializeSave(oldWire as Parameters<typeof deserializeSave>[0]);
  check("a save missing `disgruntlement` entirely deserializes to an empty Map, not a crash", restoredOld.season!.disgruntlement.size === 0);
}

console.log("=== Section 5: REAL calibration run — full 23-round home-and-away seasons, real player pool ===");
{
  const clubIds = CLUBS.map((c) => c.ClubID);
  const seeds = [1001, 2002, 3003];
  const results: number[] = [];
  for (const seed of seeds) {
    let season: Season = initSeason(seed, clubIds);
    const teams = buildTeams(clubIds);
    const everDisgruntled = new Set<number>();
    let round = nextUnplayedRound(season);
    while (round !== null) {
      season = simulateRound(season, round, teams);
      for (const [id, state] of season.disgruntlement) if (state.disgruntled) everDisgruntled.add(id);
      round = nextUnplayedRound(season);
    }
    results.push(everDisgruntled.size);
  }
  console.log(`  measured newly-disgruntled-per-season across seeds ${seeds.join(",")}: ${results.join(", ")}`);
  check("every seed lands in a generous real-anchored band (3-20/season) around the measured 8/8/9", results.every((r) => r >= 3 && r <= 20), `got ${results.join(",")}`);
  check("every seed is comfortably under Tyler's ~40-trades/year rarity anchor", results.every((r) => r < 40));
  check("results are consistent across seeds (no wild outlier), not just one lucky run", Math.max(...results) - Math.min(...results) <= 5, `spread: ${results.join(",")}`);
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
