/**
 * Round 93 ([[Coach-Driven & Performance-Linked Player Development]]'s own "Round 93" addendum)
 * verification — throwaway, matches the project's established verify_roundNN_scratch.ts convention
 * (excluded from both tsconfig.json and tsconfig.node.json — run directly via
 * `node --experimental-strip-types`, never held to tsc's strict bar).
 *
 * Tyler, again: "we will need to make sure there are mechanisms to balance our players." Covers the
 * two new, independent safeguards this round adds on top of round 91's own four structural limits,
 * both scoped to the performance half only (see engine/development.ts's own "Round 93" section for
 * the full reasoning):
 *   1. `eliteTaperFor` — the performance contribution matters less the closer a player's current OVR
 *      already is to the top of the pack.
 *   2. `performanceScarcityScales` — only so many players league-wide can bank a "breakout season"
 *      bonus at full value in the same season; everyone else gets a flat, gentle discount.
 * Section 5 runs one real simulated home-and-away season across the WHOLE real league (all clubs) to
 * confirm both safeguards are genuinely wired into `developmentMultipliersFor`'s real output, not just
 * correct in isolation. Section 6 is the calibration section proper — a deterministic, single-season
 * comparison between two REAL players from the same real club who already differ in OVR (the highest-
 * and lowest-rated), given the identical maxed performance signal, following this project's own
 * "measure a real simulated run, don't just guess" discipline (rounds 69/72/75/78/79/91). Section 6's
 * own top comment explains why it was redrawn this way after its first real run rather than the
 * multi-season organic-growth design it started with.
 */
import { CLUBS } from "../src/types/club.ts";
import { initSeason, buildTeams, simulateRound, isHomeAndAwayComplete } from "../src/engine/season.ts";
import { SEASON_ROUNDS } from "../src/engine/fixture.ts";
import { getPlayersByClub, ALL_PLAYERS } from "../src/data/loadPlayers.ts";
import { MATCH_DAY_COACH_ROLES, type MatchDayCoachRole } from "../src/types/coach.ts";
import type { Archetype } from "../src/types/archetype.ts";
import {
  DEVELOPMENT_TUNING,
  computeSeasonPerformanceSignals,
  coachContributionFor,
  performanceContributionFor,
  performanceScarcityScales,
  eliteTaperFor,
  developmentMultiplierFor,
  developmentMultipliersFor,
} from "../src/engine/development.ts";
import { ageOnePlayer, runOffSeason, potentialCeilingFor, potentialHeadroom } from "../src/engine/progression.ts";
import { ASSISTANT_COACH_POOL } from "../src/data/assistantCoachPool.ts";
import { RATED_ATTRIBUTES, type Player } from "../src/types/player.ts";

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

function meanHeadroom(p: Player): number {
  const ceiling = potentialCeilingFor(p);
  return RATED_ATTRIBUTES.reduce((s, attr) => s + potentialHeadroom(p[attr], ceiling), 0) / RATED_ATTRIBUTES.length;
}

console.log("=== Section 1: eliteTaperFor -- pure function ===");
{
  const { ELITE_TAPER_START_OVR, ELITE_TAPER_END_OVR, ELITE_TAPER_FLOOR } = DEVELOPMENT_TUNING;
  check(`at/below ELITE_TAPER_START_OVR (${ELITE_TAPER_START_OVR}): returns exactly 1`, eliteTaperFor(ELITE_TAPER_START_OVR) === 1 && eliteTaperFor(28) === 1);
  check(`at/above ELITE_TAPER_END_OVR (${ELITE_TAPER_END_OVR}): returns exactly the floor (${ELITE_TAPER_FLOOR})`, eliteTaperFor(ELITE_TAPER_END_OVR) === ELITE_TAPER_FLOOR && eliteTaperFor(99) === ELITE_TAPER_FLOOR);
  const midOVR = (ELITE_TAPER_START_OVR + ELITE_TAPER_END_OVR) / 2;
  const midTaper = eliteTaperFor(midOVR);
  const expectedMid = 1 - 0.5 * (1 - ELITE_TAPER_FLOOR);
  check(`exact midpoint OVR (${midOVR}) lands exactly halfway between 1 and the floor`, Math.abs(midTaper - expectedMid) < 1e-9, `got ${midTaper}, expected ${expectedMid}`);

  let monotonic = true;
  let prev = eliteTaperFor(28);
  for (let ovr = 29; ovr <= 99; ovr++) {
    const cur = eliteTaperFor(ovr);
    if (cur > prev + 1e-9) monotonic = false;
    prev = cur;
  }
  check("strictly non-increasing across the full OVR range 28-99 (never goes back up as OVR climbs)", monotonic);
  check("never taper below the floor even for an out-of-range/theoretical OVR above 99", eliteTaperFor(150) === ELITE_TAPER_FLOOR);
}

console.log("=== Section 2: performanceScarcityScales -- pure function, synthetic data ===");
{
  const fullCreditCount = Math.round(CLUBS.length * DEVELOPMENT_TUNING.PERFORMANCE_BONUS_FULL_CREDIT_PER_CLUB);
  console.log(`  Full-credit cutoff for today's ${CLUBS.length}-club league: ${fullCreditCount} players`);

  // More entries than the cutoff -- top N get 1, rest get BEYOND_CUTOFF_SCALE.
  const big = new Map<number, number>();
  for (let id = 1; id <= fullCreditCount + 20; id++) big.set(id, fullCreditCount + 20 - id + 1); // strictly descending by id: id=1 is the highest value
  const bigScales = performanceScarcityScales(big);
  let topGetFull = true;
  let restGetDiscount = true;
  for (let id = 1; id <= fullCreditCount + 20; id++) {
    const expectFull = id <= fullCreditCount;
    const scale = bigScales.get(id);
    if (expectFull && scale !== 1) topGetFull = false;
    if (!expectFull && scale !== DEVELOPMENT_TUNING.BEYOND_CUTOFF_SCALE) restGetDiscount = false;
  }
  check(`exactly the top ${fullCreditCount} ranked players get scale 1`, topGetFull);
  check(`every player beyond the cutoff gets exactly BEYOND_CUTOFF_SCALE (${DEVELOPMENT_TUNING.BEYOND_CUTOFF_SCALE})`, restGetDiscount);

  // Zero/negative-value entries are excluded from ranking entirely (never occupy a full-credit slot).
  const withZeros = new Map<number, number>([...big.entries(), [9001, 0], [9002, -5]]);
  const withZerosScales = performanceScarcityScales(withZeros);
  check("a player with a zero raw performance contribution gets no scale entry at all (excluded from ranking)", !withZerosScales.has(9001));
  check("a player with a negative raw performance contribution is likewise excluded", !withZerosScales.has(9002));

  // Fewer entries than the cutoff -- nobody gets scaled down.
  const small = new Map<number, number>([[1, 0.2], [2, 0.15], [3, 0.05]]);
  const smallScales = performanceScarcityScales(small);
  check("when fewer players than the cutoff have a positive signal, every one of them keeps full credit", [...smallScales.values()].every((v) => v === 1));

  const empty = performanceScarcityScales(new Map());
  check("an empty input map returns an empty result (no crash on a signal-free season)", empty.size === 0);
}

console.log("=== Section 3: composition -- raw * scarcity * taper, fed into developmentMultiplierFor ===");
{
  const coachContribution = 0.15;
  const rawPerformance = 0.18;
  const scarcity = DEVELOPMENT_TUNING.BEYOND_CUTOFF_SCALE;
  const taper = DEVELOPMENT_TUNING.ELITE_TAPER_FLOOR;
  const composed = developmentMultiplierFor(coachContribution, rawPerformance * scarcity * taper);
  const expected = 1 + coachContribution + rawPerformance * scarcity * taper;
  check("hand-computed composition matches developmentMultiplierFor's own combine-and-clamp exactly", Math.abs(composed - expected) < 1e-9, `got ${composed}, expected ${expected}`);
  check("scale=1 and taper=1 (an ordinary, unaffected player) reproduces round-91-only behaviour exactly", developmentMultiplierFor(coachContribution, rawPerformance * 1 * 1) === developmentMultiplierFor(coachContribution, rawPerformance));
  check(
    "applying BOTH safeguards at their most extreme (full scarcity discount AND full elite taper) still never drops the multiplier below 1 (can never be penalised by this mechanic)",
    developmentMultiplierFor(0, rawPerformance * scarcity * taper) >= 1,
  );
}

console.log("=== Section 4: regression safety -- round 93 changes nothing for ordinary/unaffected cases ===");
{
  const roster = getPlayersByClub(CLUBS[0].name);
  const nullSeasonMultipliers = developmentMultipliersFor(roster, null, [], CLUBS[0].name, null, {});
  check("null season (brand-new save): every real player still gets exactly 1, unchanged from round 91", [...nullSeasonMultipliers.values()].every((m) => m === 1));

  check("an ordinary player with zero coach + zero performance signal still gets exactly 1", developmentMultiplierFor(0, 0) === 1);
  check(
    "a low-OVR (below ELITE_TAPER_START_OVR), inside-the-cutoff player's effective performance contribution is untouched by either round-93 safeguard",
    eliteTaperFor(50) === 1,
  );
}

console.log("=== Section 5: real-season integration -- developmentMultipliersFor across the whole real league ===");
{
  const clubIds = CLUBS.map((c) => c.ClubID);
  let season = initSeason(933001, clubIds);
  const teams = buildTeams(clubIds);
  for (let r = 1; r <= SEASON_ROUNDS; r++) season = simulateRound(season, r, teams);
  check(`home-and-away season fully simulated for the real-data check (${season.played.length} matches)`, isHomeAndAwayComplete(season));

  const myClub = CLUBS[0].name;
  // No coach hired anywhere (null/{}) -- isolates the PERFORMANCE half entirely, which is exactly what
  // round 93's two new safeguards touch. Coach-side math is untouched from round 91 and already
  // covered by verify_round91_scratch.ts's own Section 4.
  const multipliers = developmentMultipliersFor(ALL_PLAYERS, season, [], myClub, null, {});

  check(`developmentMultipliersFor returns one entry per real player (${ALL_PLAYERS.length} total)`, multipliers.size === ALL_PLAYERS.length);
  const allInBounds = [...multipliers.values()].every((m) => m >= 1 - 1e-9 && m <= DEVELOPMENT_TUNING.MULTIPLIER_CAP + 1e-9);
  check("every real player's computed multiplier lands in [1, MULTIPLIER_CAP] across the whole real league", allInBounds);

  const signals = computeSeasonPerformanceSignals(season, []);
  const rawByPlayer = new Map<number, number>(ALL_PLAYERS.map((p) => [p.PlayerID, performanceContributionFor(signals.get(p.PlayerID))]));
  const scarcity = performanceScarcityScales(rawByPlayer);
  const positiveSignalCount = [...rawByPlayer.values()].filter((v) => v > 0).length;
  const fullCreditCount = Math.round(CLUBS.length * DEVELOPMENT_TUNING.PERFORMANCE_BONUS_FULL_CREDIT_PER_CLUB);
  console.log(`  ${positiveSignalCount} real players had a nonzero performance signal this season (votes and/or a career-best/record); scarcity cutoff is ${fullCreditCount}`);
  check("at least one real player found with a nonzero performance signal (sanity check on the sim itself)", positiveSignalCount > 0, `got ${positiveSignalCount}`);

  let anyTapered = false;
  let anyScarce = false;
  for (const p of ALL_PLAYERS) {
    const raw = rawByPlayer.get(p.PlayerID) ?? 0;
    if (raw <= 0) continue;
    const oldMultiplier = developmentMultiplierFor(0, raw);
    const newMultiplier = multipliers.get(p.PlayerID)!;
    if (eliteTaperFor(p.OVR) < 1 - 1e-9 && newMultiplier < oldMultiplier - 1e-9) anyTapered = true;
    if ((scarcity.get(p.PlayerID) ?? 1) < 1 - 1e-9 && newMultiplier < oldMultiplier - 1e-9) anyScarce = true;
  }
  check(
    "at least one real player this season had their multiplier measurably reduced by elite tapering (proves the taper is genuinely wired into the real pipeline, not dormant)",
    anyTapered,
    `${positiveSignalCount} players had a signal this season`,
  );
  check(
    `league-wide scarcity: either at least one real player beyond the ${fullCreditCount}-player cutoff was measurably discounted, or fewer than ${fullCreditCount} real players had a positive signal at all this season (both are valid outcomes for a single real season)`,
    anyScarce || positiveSignalCount <= fullCreditCount,
    `${positiveSignalCount} players had a signal`,
  );
}

console.log("=== Section 6: real elite-vs-non-elite comparison (same club, identical signal, deterministic) ===");
// Redrawn after this section's first real run: it originally tried to grow ONE real player organically
// INTO elite OVR territory over several repeat-maxed seasons and assert the taper engaged partway
// through. Tyler's own run showed that premise was wrong -- the specific real player picked (an older
// player past the "still developing" age band) had OVR fall every season regardless of treatment,
// since developmentMultiplier only ever touches the IMPROVEMENT half of ageOnePlayer's formula, never
// the age-driven decline half (by design, matching Tyler's own "positively influenced" framing from
// round 91). Whether -- and how fast -- a real player's OVR climbs depends on their age, their own
// individual imp_/deg_ rates, and ageOnePlayer's own per-season integer rounding, none of which this
// round changed or is trying to test. Comparing two real players who ALREADY differ in OVR removes that
// dependency entirely and tests the taper itself, deterministically, from data that's already there.
{
  const club = CLUBS[0].name;
  const roster = getPlayersByClub(club);

  const bestDev = [...ASSISTANT_COACH_POOL].sort((a, b) => b.ratings.Development.ovr - a.ratings.Development.ovr)[0];
  const lineCoachesReal: Partial<Record<MatchDayCoachRole, number>> = {};
  for (const role of MATCH_DAY_COACH_ROLES) {
    lineCoachesReal[role] = [...ASSISTANT_COACH_POOL].sort((a, b) => b.ratings[role].ovr - a.ratings[role].ovr)[0].id;
  }

  const byOvrDesc = [...roster].sort((a, b) => b.OVR - a.OVR);
  const eliteReal = byOvrDesc[0];
  const nonEliteReal = [...roster].filter((p) => meanHeadroom(p) > 0.2).sort((a, b) => a.OVR - b.OVR)[0] ?? byOvrDesc[byOvrDesc.length - 1];

  const rawMaxPerformance = DEVELOPMENT_TUNING.MAX_VOTES_BONUS + DEVELOPMENT_TUNING.MAX_RECORDS_BONUS;
  const eliteCoach = coachContributionFor(eliteReal.archetype as Archetype, true, bestDev.id, lineCoachesReal);
  const nonEliteCoach = coachContributionFor(nonEliteReal.archetype as Archetype, true, bestDev.id, lineCoachesReal);

  const eliteMultiplierOld = developmentMultiplierFor(eliteCoach, rawMaxPerformance);
  const nonEliteMultiplierOld = developmentMultiplierFor(nonEliteCoach, rawMaxPerformance);
  const eliteTaper = eliteTaperFor(eliteReal.OVR);
  const nonEliteTaper = eliteTaperFor(nonEliteReal.OVR);
  const eliteMultiplierNew = developmentMultiplierFor(eliteCoach, rawMaxPerformance * eliteTaper);
  const nonEliteMultiplierNew = developmentMultiplierFor(nonEliteCoach, rawMaxPerformance * nonEliteTaper);

  console.log(`  Real club: ${club}`);
  console.log(`    Highest-OVR player #${eliteReal.PlayerID} (OVR ${eliteReal.OVR}, ${eliteReal.archetype}): taper=${eliteTaper.toFixed(3)}, multiplier ${eliteMultiplierOld.toFixed(3)}x (round-91-only) -> ${eliteMultiplierNew.toFixed(3)}x (round-93)`);
  console.log(`    Lowest-OVR-with-headroom player #${nonEliteReal.PlayerID} (OVR ${nonEliteReal.OVR}, ${nonEliteReal.archetype}): taper=${nonEliteTaper.toFixed(3)}, multiplier ${nonEliteMultiplierOld.toFixed(3)}x (round-91-only) -> ${nonEliteMultiplierNew.toFixed(3)}x (round-93)`);

  check(
    `this real club's highest-OVR player (#${eliteReal.PlayerID}, OVR ${eliteReal.OVR}) gets a taper at or below the lowest-OVR-with-headroom player's (#${nonEliteReal.PlayerID}, OVR ${nonEliteReal.OVR}) -- the mechanism never favours the already-better-rated real player`,
    eliteTaper <= nonEliteTaper + 1e-9,
  );
  check(
    "round 93 never INCREASES a multiplier relative to round-91-only math for the identical signal, for either real player",
    eliteMultiplierNew <= eliteMultiplierOld + 1e-9 && nonEliteMultiplierNew <= nonEliteMultiplierOld + 1e-9,
  );
  if (eliteReal.OVR > DEVELOPMENT_TUNING.ELITE_TAPER_START_OVR) {
    check(
      `this club's real highest-OVR player (OVR ${eliteReal.OVR}, above the ${DEVELOPMENT_TUNING.ELITE_TAPER_START_OVR} taper threshold) gets a STRICTLY reduced multiplier under round 93 for the identical max signal`,
      eliteMultiplierNew < eliteMultiplierOld - 1e-9,
    );
  } else {
    console.log(`    (this club's highest-OVR player is only ${eliteReal.OVR}, below the ${DEVELOPMENT_TUNING.ELITE_TAPER_START_OVR} taper threshold -- no strict-reduction case to demonstrate on THIS club; Section 5's real, whole-league run already found and confirmed real elite players who do get tapered)`);
  }

  // Single-season, per-attribute comparison -- mirrors round 91's own already-proven Section 8 finding
  // ("a maxed multiplier NEVER produces a worse outcome than multiplier 1 on any single attribute") but
  // applied to round 93's TAPERED multiplier specifically. Deliberately single-season rather than
  // multi-season-chained: round 91's own Section 9 already flagged that multi-season COMPOUNDING
  // monotonicity ("boosted stays ahead after several chained seasons") is an empirically-observed
  // property of that run, not a proven mathematical certainty once two diverging headroom trajectories
  // start interacting -- exactly the class of assumption this section's own first draft got burned by.
  // A single ageOnePlayer call from an IDENTICAL starting point has no such compounding risk: since
  // eliteMultiplierNew/nonEliteMultiplierNew are always >= 1 (developmentMultiplierFor's own clamp) and
  // every attribute's delta is non-decreasing in the multiplier (imp_/headroom are never negative), the
  // boosted result can never be WORSE than multiplier-1 on any single attribute -- guaranteed, not just
  // likely.
  const eliteAgedBoosted = ageOnePlayer(eliteReal, eliteMultiplierNew);
  const eliteAgedZero = ageOnePlayer(eliteReal, 1);
  const nonEliteAgedBoosted = ageOnePlayer(nonEliteReal, nonEliteMultiplierNew);
  const nonEliteAgedZero = ageOnePlayer(nonEliteReal, 1);
  check(
    `the real elite player's (#${eliteReal.PlayerID}) fully-tapered multiplier still never produces a worse single-season outcome than multiplier 1 on any attribute -- tempered, not disabled`,
    RATED_ATTRIBUTES.every((attr) => eliteAgedBoosted[attr] >= eliteAgedZero[attr]),
  );
  check(
    `the real non-elite player's (#${nonEliteReal.PlayerID}) boosted multiplier likewise never produces a worse single-season outcome than multiplier 1 on any attribute`,
    RATED_ATTRIBUTES.every((attr) => nonEliteAgedBoosted[attr] >= nonEliteAgedZero[attr]),
  );
  check(
    "...and genuinely improves at least one attribute more than the zero-bonus case, for at least one of the two real players (the mechanism isn't a no-op even after tapering)",
    RATED_ATTRIBUTES.some((attr) => eliteAgedBoosted[attr] > eliteAgedZero[attr]) || RATED_ATTRIBUTES.some((attr) => nonEliteAgedBoosted[attr] > nonEliteAgedZero[attr]),
  );
  check(
    "POT is untouched for both real players under every treatment above",
    eliteAgedBoosted.potentialTall === eliteReal.potentialTall &&
      eliteAgedBoosted.potentialMid === eliteReal.potentialMid &&
      nonEliteAgedBoosted.potentialTall === nonEliteReal.potentialTall &&
      nonEliteAgedBoosted.potentialMid === nonEliteReal.potentialMid,
  );

  // Informational only, logged for a human to look at -- NOT asserted against, since how many seasons
  // an organically-growing real player takes (if ever) to cross into elite OVR territory depends on
  // factors this round didn't touch (age, individual imp_/deg_ rates, integer rounding) -- exactly the
  // dependency this section's first draft got burned by treating as a guaranteed outcome.
  const SEASONS = 5;
  let organicTrack: readonly Player[] = roster;
  const organicTrajectory: { season: number; ovr: number }[] = [];
  for (let s = 0; s < SEASONS; s++) {
    const now = organicTrack.find((p) => p.PlayerID === nonEliteReal.PlayerID)!;
    organicTrajectory.push({ season: s + 1, ovr: now.OVR });
    const map = new Map(roster.map((p) => [p.PlayerID, p.PlayerID === nonEliteReal.PlayerID ? developmentMultiplierFor(nonEliteCoach, rawMaxPerformance * eliteTaperFor(now.OVR)) : 1]));
    organicTrack = runOffSeason(organicTrack, map);
  }
  console.log(`  Informational only (not asserted) -- player #${nonEliteReal.PlayerID}'s own OVR under repeat-max treatment across ${SEASONS} seasons: ${organicTrajectory.map((t) => `S${t.season}=${t.ovr}`).join(", ")}`);
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
