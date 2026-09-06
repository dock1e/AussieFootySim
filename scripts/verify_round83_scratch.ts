/**
 * Round 83 (Talent Scout wired into the draft engine's fog-of-war)
 * verification — throwaway, matches the project's established
 * verify_roundNN_scratch.ts convention. Covers [[Assistant Coaching System]]'s
 * "Talent Scout — how it plugs into the existing draft engine" section as
 * actually built in engine/draft.ts, types/coach.ts, and engine/saveGame.ts:
 * the 6-bucket archetype partition, scoutAccuracyFor's resolution logic
 * (including the deliberately-not-floored "bad hire" case), the shared
 * width-multiplier's effect on scoutOvrBand/scoutConfidence/
 * predictedDraftRange, the SaveGameData.talentScout round trip, and an
 * end-to-end pass over a real generated prospect pool.
 */
import { DEFAULT_SCOUT_ACCURACY, scoutAccuracyFor, scoutOvrBand, scoutConfidence, predictedDraftRange, generateProspectPool } from "../src/engine/draft.ts";
import { SCOUT_FOCUS_AREAS, SCOUT_FOCUS_AREA_ARCHETYPES, COACH_ROLES, type Coach, type CoachRole, type ScoutFocusArea } from "../src/types/coach.ts";
import { ARCHETYPES, type Archetype } from "../src/types/archetype.ts";
import { makePlayer } from "../src/testUtils/makePlayer.ts";
import { ALL_PLAYERS } from "../src/data/loadPlayers.ts";
import { newSaveGame, serializeSave, deserializeSave, type TalentScoutAssignment } from "../src/engine/saveGame.ts";

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

/** Minimal valid Coach fixture — every role filled with a plausible mid rating so the object satisfies Record<CoachRole, CoachRoleRating> in full; only Talent Scout's own ovr is what each test actually varies. */
function makeCoach(talentScoutOvr: number, id = 9001): Coach {
  const ratings = {} as Record<CoachRole, { ovr: number; pot: number }>;
  for (const r of COACH_ROLES) ratings[r] = { ovr: 50, pot: 55 };
  ratings["Talent Scout"] = { ovr: talentScoutOvr, pot: talentScoutOvr };
  return { id, name: "Test Scout", source: "fictional", bio: "Test fixture coach.", primaryRole: "Talent Scout", ratings, tags: ["test-fixture"] };
}

console.log("=== Section 1: SCOUT_FOCUS_AREA_ARCHETYPES partitions all 14 archetypes exactly ===");
{
  check(`SCOUT_FOCUS_AREAS has 6 entries (got ${SCOUT_FOCUS_AREAS.length})`, SCOUT_FOCUS_AREAS.length === 6);
  const allBucketed = SCOUT_FOCUS_AREAS.flatMap((a) => SCOUT_FOCUS_AREA_ARCHETYPES[a] as readonly Archetype[]);
  check(`every archetype appears exactly once across all 6 buckets combined (got ${allBucketed.length} slots for ${ARCHETYPES.length} archetypes)`, allBucketed.length === ARCHETYPES.length);
  const bucketedSet = new Set(allBucketed);
  check("no archetype missing from any bucket", ARCHETYPES.every((a) => bucketedSet.has(a)), JSON.stringify(ARCHETYPES.filter((a) => !bucketedSet.has(a))));
  const dupes = allBucketed.filter((a, i) => allBucketed.indexOf(a) !== i);
  check("no archetype appears in more than one bucket (no overlap)", dupes.length === 0, JSON.stringify(dupes));
  for (const area of SCOUT_FOCUS_AREAS) {
    check(`${area}: bucket is non-empty`, (SCOUT_FOCUS_AREA_ARCHETYPES[area] as readonly Archetype[]).length > 0);
  }
}

console.log("=== Section 2: scoutAccuracyFor resolution ===");
{
  const midProspect = makePlayer({ PlayerID: 1, archetype: "Inside Mid" });
  const ruckProspect = makePlayer({ PlayerID: 2, archetype: "Ruck" });

  check(
    "no scout assigned -> DEFAULT_SCOUT_ACCURACY regardless of prospect/focus",
    scoutAccuracyFor(midProspect, null, null) === DEFAULT_SCOUT_ACCURACY && scoutAccuracyFor(midProspect, null, "Midfielders") === DEFAULT_SCOUT_ACCURACY,
  );

  const goodScout = makeCoach(90);
  const goodAccuracy = 90 / 99;
  check("scout assigned, no focus set -> own accuracy applies league-wide (Inside Mid)", scoutAccuracyFor(midProspect, goodScout, null) === goodAccuracy);
  check("scout assigned, no focus set -> own accuracy applies league-wide (Ruck, a different archetype)", scoutAccuracyFor(ruckProspect, goodScout, null) === goodAccuracy);

  check("scout assigned + focus set + prospect archetype IN focus bucket -> own accuracy", scoutAccuracyFor(midProspect, goodScout, "Midfielders") === goodAccuracy);
  check("scout assigned + focus set + prospect archetype OUT of focus bucket -> falls back to DEFAULT_SCOUT_ACCURACY", scoutAccuracyFor(ruckProspect, goodScout, "Midfielders") === DEFAULT_SCOUT_ACCURACY);
  check("...and NOT the scout's own (higher) accuracy when out of focus", scoutAccuracyFor(ruckProspect, goodScout, "Midfielders") !== goodAccuracy);

  // Disclosed "bad hire can be worse than no scout" behaviour: a low-graded
  // (D-band) Talent Scout's own accuracy sits below DEFAULT_SCOUT_ACCURACY,
  // and scoutAccuracyFor deliberately does NOT floor it back up.
  const badScout = makeCoach(20);
  const badAccuracy = 20 / 99;
  check("bad hire (D-grade, OVR well under baseline): own accuracy IS below DEFAULT_SCOUT_ACCURACY (the premise the trade-off depends on)", badAccuracy < DEFAULT_SCOUT_ACCURACY);
  check("bad hire, no focus -> league-wide accuracy is the LOWER value, not floored at DEFAULT_SCOUT_ACCURACY", scoutAccuracyFor(midProspect, badScout, null) === badAccuracy);
  check("bad hire, focused on their own bucket -> still the lower value inside it (no floor even in-focus)", scoutAccuracyFor(midProspect, badScout, "Midfielders") === badAccuracy);
  check(
    "bad hire, prospect outside focus -> falls back to DEFAULT_SCOUT_ACCURACY, which is HIGHER (better) than the bad scout's own accuracy",
    scoutAccuracyFor(ruckProspect, badScout, "Midfielders") === DEFAULT_SCOUT_ACCURACY && DEFAULT_SCOUT_ACCURACY > badAccuracy,
  );
}

console.log("=== Section 3: scoutOvrBand / scoutConfidence — baseline identity + direction ===");
{
  const p = makePlayer({ PlayerID: 555, OVR: 70, POT: 80 });
  const revealed = 4;
  const widthOf = (b: { low: number; high: number }) => b.high - b.low;

  const bandDefaultImplicit = scoutOvrBand(p, revealed);
  const bandDefaultExplicit = scoutOvrBand(p, revealed, DEFAULT_SCOUT_ACCURACY);
  check("scoutOvrBand: omitting scoutAccuracy is byte-identical to passing DEFAULT_SCOUT_ACCURACY explicitly", JSON.stringify(bandDefaultImplicit) === JSON.stringify(bandDefaultExplicit));

  const bandGreat = scoutOvrBand(p, revealed, 1);
  const bandPoor = scoutOvrBand(p, revealed, 0);
  check("accuracy=1 (great scout) band is narrower than or equal to the default band", widthOf(bandGreat) <= widthOf(bandDefaultImplicit), `great=${widthOf(bandGreat)} default=${widthOf(bandDefaultImplicit)}`);
  check("accuracy=0 (poor scout) band is wider than or equal to the default band", widthOf(bandPoor) >= widthOf(bandDefaultImplicit), `poor=${widthOf(bandPoor)} default=${widthOf(bandDefaultImplicit)}`);
  check("even a perfect scout's fully-revealed band never collapses below the documented floor of 1", widthOf(scoutOvrBand(p, 8, 1)) >= 1);

  const confDefaultImplicit = scoutConfidence(p, revealed);
  const confDefaultExplicit = scoutConfidence(p, revealed, DEFAULT_SCOUT_ACCURACY);
  check("scoutConfidence: omitting scoutAccuracy is byte-identical to passing DEFAULT_SCOUT_ACCURACY explicitly", confDefaultImplicit === confDefaultExplicit);

  const confGreat = scoutConfidence(p, revealed, 1);
  const confPoor = scoutConfidence(p, revealed, 0);
  check("accuracy=1 (great scout) confidence is >= the default at the same reveal count", confGreat >= confDefaultImplicit, `great=${confGreat} default=${confDefaultImplicit}`);
  check("accuracy=0 (poor scout) confidence is <= the default at the same reveal count", confPoor <= confDefaultImplicit, `poor=${confPoor} default=${confDefaultImplicit}`);
  check("a great scout with every attribute revealed reaches the ceiling at least as fast as the default", scoutConfidence(p, 8, 1) >= scoutConfidence(p, 8, DEFAULT_SCOUT_ACCURACY));
  check(
    "confidence always stays within the documented 35-84% envelope, at every accuracy extreme",
    [0, 0.25, 0.5, 0.75, 1].every((acc) => {
      const c = scoutConfidence(p, revealed, acc);
      return c >= 35 && c <= 84;
    }),
  );
}

console.log("=== Section 4: predictedDraftRange scoutAccuracy plumbing ===");
{
  const pool = generateProspectPool(ALL_PLAYERS, 2026, 777);
  const target = pool[Math.floor(pool.length / 2)]; // a mid-pack prospect, away from rank-1's own separate clarity-scale clamp
  const widthOf = (r: { low: number; high: number }) => r.high - r.low;

  const rangeDefaultImplicit = predictedDraftRange(target, pool);
  const rangeDefaultExplicit = predictedDraftRange(target, pool, DEFAULT_SCOUT_ACCURACY);
  check("predictedDraftRange: omitting scoutAccuracy is byte-identical to passing DEFAULT_SCOUT_ACCURACY explicitly", JSON.stringify(rangeDefaultImplicit) === JSON.stringify(rangeDefaultExplicit));

  const rangeGreat = predictedDraftRange(target, pool, 1);
  const rangePoor = predictedDraftRange(target, pool, 0);
  check(
    "scoutAccuracy=1 never produces a wider range than the default (+/-1 slack for the independent jitter term)",
    widthOf(rangeGreat) <= widthOf(rangeDefaultImplicit) + 1,
    `great=${widthOf(rangeGreat)} default=${widthOf(rangeDefaultImplicit)}`,
  );
  check(
    "scoutAccuracy=0 never produces a narrower range than the default (+/-1 slack for the independent jitter term)",
    widthOf(rangePoor) >= widthOf(rangeDefaultImplicit) - 1,
    `poor=${widthOf(rangePoor)} default=${widthOf(rangeDefaultImplicit)}`,
  );
}

console.log("=== Section 5: TalentScoutAssignment save persistence + round trip ===");
{
  const players = Array.from({ length: 5 }, (_, i) => makePlayer({ PlayerID: i + 1 }));
  const fresh = newSaveGame("Adelaide", players);
  check("newSaveGame defaults talentScout to null (pre-round-83 behaviour preserved)", fresh.talentScout === null);

  const assignment: TalentScoutAssignment = { coachId: 42, focusArea: "Midfielders" };
  const withScout = { ...fresh, talentScout: assignment };
  const wire = JSON.parse(JSON.stringify(serializeSave(withScout)));
  const restored = deserializeSave(wire);
  check("talentScout round-trips through a real JSON.stringify/JSON.parse pass with no data loss", JSON.stringify(restored.talentScout) === JSON.stringify(assignment));

  const assignmentNoFocus: TalentScoutAssignment = { coachId: 7, focusArea: null };
  const withScoutNoFocus = { ...fresh, talentScout: assignmentNoFocus };
  const wire2 = JSON.parse(JSON.stringify(serializeSave(withScoutNoFocus)));
  const restored2 = deserializeSave(wire2);
  check("a scout assigned with no focus area (focusArea: null) also round-trips correctly", JSON.stringify(restored2.talentScout) === JSON.stringify(assignmentNoFocus));

  const wireMissing = JSON.parse(JSON.stringify(serializeSave(withScout)));
  delete wireMissing.talentScout;
  const restoredMissing = deserializeSave(wireMissing);
  check("defaults talentScout to null for a save written before round 83 existed (field absent on the wire)", restoredMissing.talentScout === null);
}

console.log("=== Section 6: end-to-end integration on a real generated prospect pool ===");
{
  const pool = generateProspectPool(ALL_PLAYERS, 2026, 888);
  const focusArea: ScoutFocusArea = "Rucks";
  const inBucket = SCOUT_FOCUS_AREA_ARCHETYPES[focusArea] as readonly Archetype[];
  const scout = makeCoach(95, 9002); // near-elite Talent Scout, ovr/99 ~= 0.960
  const widthOf = (r: { low: number; high: number }) => r.high - r.low;

  const inFocusProspects = pool.filter((p) => inBucket.includes(p.archetype as Archetype));
  const outFocusProspects = pool.filter((p) => !inBucket.includes(p.archetype as Archetype));
  check(
    `this pool/seed has at least one prospect inside (${inFocusProspects.length}) and outside (${outFocusProspects.length}) the ${focusArea} focus bucket`,
    inFocusProspects.length > 0 && outFocusProspects.length > 0,
  );

  let anyNarrower = false;
  for (const p of inFocusProspects) {
    const accuracy = scoutAccuracyFor(p, scout, focusArea);
    check(`PlayerID ${p.PlayerID} (${p.archetype}, in focus): scoutAccuracyFor resolves to the scout's own high accuracy`, Math.abs(accuracy - 95 / 99) < 1e-9);
    const withScoutRange = predictedDraftRange(p, pool, accuracy);
    const withoutScoutRange = predictedDraftRange(p, pool, DEFAULT_SCOUT_ACCURACY);
    if (widthOf(withScoutRange) < widthOf(withoutScoutRange)) anyNarrower = true;
  }
  check("at least one in-focus prospect's predicted range is genuinely narrower with the near-elite focused scout than the no-scout baseline", anyNarrower);

  for (const p of outFocusProspects) {
    const accuracy = scoutAccuracyFor(p, scout, focusArea);
    check(`PlayerID ${p.PlayerID} (${p.archetype}, out of focus): scoutAccuracyFor falls back to DEFAULT_SCOUT_ACCURACY`, accuracy === DEFAULT_SCOUT_ACCURACY);
    const withScoutRange = predictedDraftRange(p, pool, accuracy);
    const withoutScoutRange = predictedDraftRange(p, pool, DEFAULT_SCOUT_ACCURACY);
    check(`PlayerID ${p.PlayerID}: out-of-focus range is byte-identical to the no-scout baseline (same resolved multiplier)`, JSON.stringify(withScoutRange) === JSON.stringify(withoutScoutRange));
  }
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
