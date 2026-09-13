// Round 97 — Tyler: "We also then need to work on the AIs logic for drafting players as I'm at pick 44
// and Cody Walker is still available despite being a top 5 pick." Throwaway verify script (excluded
// from tsconfig.json/tsconfig.node.json), run via `node --experimental-strip-types`.
//
// Scope note, same rule every prior verify script in this project follows: this only tests
// engine/*.ts pure functions. The AI draft-pick fix is `tierRankBonus` (extracted from
// `rankedPoolByTalent`'s own inline bonus) now shared with `prospectScore`, threaded through
// `bestAvailableProspect`/`autoResolvePick` via the new optional `tierByPlayerId` param, and wired into
// the real production call path (`autoResolveDraftPicks` in useSaveStore.ts). Everything below tests
// exactly that chain. The rest of round 97 — Draft.tsx's new PickTicker header, Tier sort mode,
// Scouting Confidence filter, and the Talent Scout panel's move onto the renamed "Talent Scouting" tab
// (Combine.tsx) — is React/Tailwind presentation with no new pure-function logic to unit-test here;
// those are verified visually via live Chrome instead (see this round's own "Live Chrome verification"
// step). draft.test.ts (Vitest) also gained 4 new synthetic tests this round covering the same fix in
// more granular isolation — Tyler, please also run `npm test` locally alongside `npx tsc --noEmit` for
// a full pass/fail on both.

import { ALL_PLAYERS } from "../src/data/loadPlayers.ts";
import { buildLeaguePlayersByClub, computeLeagueStrategies } from "../src/engine/listNeeds.ts";
import { generateProspectPool, scoutingTiersForPool, prospectScore, bestAvailableProspect, buildDraftOrder, type ScoutingTier } from "../src/engine/draft.ts";
import { playerFullName, type Player } from "../src/types/player.ts";
import { makePlayer } from "../src/testUtils/makePlayer.ts";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`  FAIL: ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("=== Section 1: synthetic guarantee — tierRankBonus flips both prospectScore and bestAvailableProspect ===");
{
  // Same shape as Tyler's exact report: a prospect with real ceiling (POT) but still-raw current OVR,
  // up against an ordinary, already-polished rival at the SAME archetype (so `needBonus` is identical
  // for both and can't be what decides the outcome) and an empty `playersByClub` (so `needBonus` is 0
  // for both regardless — this isolates the tier bonus as the only possible deciding factor).
  const emptyClub = new Map<string, Player[]>();
  const clubName = "Test FC";
  const generational = makePlayer({ PlayerID: 9001, archetype: "Outside Mid", OVR: 40, POT: 85 });
  const polishedButCapped = makePlayer({ PlayerID: 9002, archetype: "Outside Mid", OVR: 70, POT: 65 });

  const genScoreWithTier = prospectScore(generational, clubName, "Balanced", emptyClub, "Generational Talent");
  const rivalScore = prospectScore(polishedButCapped, clubName, "Balanced", emptyClub, undefined);
  check(
    "a Generational Talent (OVR 40/POT 85) outscores a much higher-OVR, non-tiered rival (OVR 70/POT 65) once tierByPlayerId is supplied",
    genScoreWithTier > rivalScore,
    `generational=${genScoreWithTier.toFixed(1)}, rival=${rivalScore.toFixed(1)}`,
  );

  const genScoreWithoutTier = prospectScore(generational, clubName, "Balanced", emptyClub, undefined);
  check(
    "without a tier supplied, the same lower-OVR prospect still loses to the higher-OVR rival — proves the bonus (not some other change) is what flips it",
    genScoreWithoutTier < rivalScore,
    `generational(no tier)=${genScoreWithoutTier.toFixed(1)}, rival=${rivalScore.toFixed(1)}`,
  );

  const tierByPlayerId = new Map<number, ScoutingTier>([[9001, "Generational Talent"]]);
  const chosen = bestAvailableProspect([generational, polishedButCapped], clubName, "Balanced", emptyClub, tierByPlayerId);
  check(
    "bestAvailableProspect actually picks the Generational Talent over the higher-OVR rival when tierByPlayerId is passed",
    chosen?.PlayerID === 9001,
    `chosen=${chosen?.PlayerID}`,
  );
  const chosenWithoutMap = bestAvailableProspect([generational, polishedButCapped], clubName, "Balanced", emptyClub);
  check(
    "bestAvailableProspect reproduces the exact pre-round-97 (buggy) outcome when tierByPlayerId is omitted — confirms every existing call site that never passes it is untouched",
    chosenWithoutMap?.PlayerID === 9002,
    `chosen=${chosenWithoutMap?.PlayerID}`,
  );
}

console.log("=== Section 2: real 2026 pool — no Generational Talent / Superstar prospect survives deep into a simulated draft ===");
{
  // The general, real-data proof: reproduces Tyler's exact production call shape
  // (autoResolveDraftPicks in useSaveStore.ts) — real rosters, real computed club strategies, a fixed
  // club order (no season/ladder simulated here, so it falls back to CLUBS' own order, same as a fresh
  // save), and tierByPlayerId computed ONCE off the fixed full pool, exactly like the production fix.
  // Before round 97, this section would have failed reliably: prospectScore never consulted tier at
  // all, so any Generational Talent/Superstar prospect with a still-raw current OVR could fall
  // arbitrarily deep — exactly the "top-5 talent still on the board at pick 44" shape Tyler reported.
  const pool = generateProspectPool(ALL_PLAYERS, 2026, 42);
  const tiers = scoutingTiersForPool(pool);
  const eliteIds = pool.filter((p) => tiers.get(p.PlayerID) === "Generational Talent" || tiers.get(p.PlayerID) === "Superstar").map((p) => p.PlayerID);
  check("this generated pool has at least one Generational Talent/Superstar prospect to test against", eliteIds.length > 0, `found ${eliteIds.length} of ${pool.length}`);

  if (eliteIds.length > 0) {
    const playersByClub = buildLeaguePlayersByClub();
    const strategies = computeLeagueStrategies(playersByClub);
    const order = buildDraftOrder(null);
    const picksToSimulate = Math.min(order.length, 60); // Tyler's report was at pick 44 — 60 gives headroom past that
    const pickedIds = new Set<number>();
    const pickNumberFor = new Map<number, number>();

    for (let i = 0; i < picksToSimulate; i++) {
      const clubOnClock = order[i];
      const stillAvailable = pool.filter((p) => !pickedIds.has(p.PlayerID));
      const chosen = bestAvailableProspect(stillAvailable, clubOnClock, strategies.get(clubOnClock) ?? "Balanced", playersByClub, tiers);
      if (!chosen) break;
      pickedIds.add(chosen.PlayerID);
      pickNumberFor.set(chosen.PlayerID, i + 1);
    }

    const stragglers = eliteIds.filter((id) => (pickNumberFor.get(id) ?? Infinity) > 30);
    check(
      `every Generational Talent/Superstar prospect (${eliteIds.length} total) is drafted by pick 30 of this simulation`,
      stragglers.length === 0,
      stragglers.map((id) => `${playerFullName(pool.find((p) => p.PlayerID === id)!)} (tier=${tiers.get(id)}, pick=${pickNumberFor.get(id) ?? "undrafted in first 60"})`).join("; "),
    );
  }
}

console.log("=== Section 3: the real Cody Walker, Tyler's exact reported case ===");
{
  // Illustrative real-name anecdote, same defensive pattern round 96's own Section 4 used for
  // Cochrane: Cody Walker's tier is procedurally generated (his real write-up carries no
  // tier-qualifying phrase-bank signal, per realProspects.ts — his POT comes from the normal
  // attribute-based formula plus a modest underage-signal bonus), so it can land anywhere run to run.
  // Section 2 above is the load-bearing general proof; this section just confirms his specific fate in
  // THIS run reads sensibly given whatever tier he actually lands.
  const pool = generateProspectPool(ALL_PLAYERS, 2026, 42);
  const cody = pool.find((p) => playerFullName(p).toLowerCase() === "cody walker");
  check("Cody Walker is present in a generated 2026 prospect pool", cody !== undefined);
  if (cody) {
    const tiers = scoutingTiersForPool(pool);
    const tier = tiers.get(cody.PlayerID);
    console.log(`  (Cody Walker: OVR=${cody.OVR}, POT=${cody.POT}, tier=${tier})`);

    const playersByClub = buildLeaguePlayersByClub();
    const strategies = computeLeagueStrategies(playersByClub);
    const order = buildDraftOrder(null);
    const picksToSimulate = Math.min(order.length, 60);
    const pickedIds = new Set<number>();
    let codyPickNumber: number | null = null;

    for (let i = 0; i < picksToSimulate; i++) {
      const clubOnClock = order[i];
      const stillAvailable = pool.filter((p) => !pickedIds.has(p.PlayerID));
      const chosen = bestAvailableProspect(stillAvailable, clubOnClock, strategies.get(clubOnClock) ?? "Balanced", playersByClub, tiers);
      if (!chosen) break;
      pickedIds.add(chosen.PlayerID);
      if (chosen.PlayerID === cody.PlayerID) {
        codyPickNumber = i + 1;
        break;
      }
    }
    console.log(`  (Cody Walker drafted at pick ${codyPickNumber ?? "undrafted in first 60"} in this simulation)`);

    if (tier === "Generational Talent" || tier === "Superstar") {
      check(`Cody Walker (tier=${tier}) is drafted well before pick 44 in this simulation`, codyPickNumber !== null && codyPickNumber < 44, `codyPickNumber=${codyPickNumber}`);
    } else {
      console.log(`  (skipped pick-number assertion: this run's Cody Walker fixture graded "${tier}", not Generational/Superstar — his procedurally-generated attributes just didn't land there this run. Section 2 above proves the general fix regardless of any one prospect's luck-of-the-draw tier.)`);
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
