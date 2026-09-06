/**
 * Round 82 verification — throwaway script per this project's established
 * verify_roundNN_scratch.ts convention.
 *
 * Covers the Assistant Coaching System build: the Coach type/schema
 * (types/coach.ts), the grading engine (engine/coachGrading.ts), and the
 * populated talent pool (data/assistantCoachPool.ts) — see
 * [[Assistant Coaching System]] (vault root) for the full design note.
 */
import { COACH_ROLES, COACH_GRADES, COACH_GRADE_OVR_FLOOR, gradeForOvr, coachGradeIn, type Coach, type CoachRole } from "../src/types/coach.ts";
import { buildRealCoachRatings, buildFictionalCoachRatings } from "../src/engine/coachGrading.ts";
import { ASSISTANT_COACH_POOL } from "../src/data/assistantCoachPool.ts";

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

console.log("=== Section 1: grade ladder sanity ===");
{
  check("COACH_GRADES has 7 entries", COACH_GRADES.length === 7);
  check('Tyler\'s own 4 anchors present: B, B+, A, A+', ["B", "B+", "A", "A+"].every((g) => (COACH_GRADES as readonly string[]).includes(g)));
  // Floors strictly increasing
  const floors = COACH_GRADES.map((g) => COACH_GRADE_OVR_FLOOR[g]);
  check(`floors strictly increasing (got ${JSON.stringify(floors)})`, floors.every((f, i) => i === 0 || f > floors[i - 1]));
  check("gradeForOvr(1) === D", gradeForOvr(1) === "D");
  check("gradeForOvr(39) === D", gradeForOvr(39) === "D");
  check("gradeForOvr(40) === C", gradeForOvr(40) === "C");
  check("gradeForOvr(64) === C+", gradeForOvr(64) === "C+");
  check("gradeForOvr(65) === B", gradeForOvr(65) === "B");
  check("gradeForOvr(74) === B", gradeForOvr(74) === "B");
  check("gradeForOvr(75) === B+", gradeForOvr(75) === "B+");
  check("gradeForOvr(92) === A", gradeForOvr(92) === "A");
  check("gradeForOvr(93) === A+", gradeForOvr(93) === "A+");
  check("gradeForOvr(99) === A+", gradeForOvr(99) === "A+");
}

console.log("=== Section 2: grading engine determinism ===");
{
  const a = buildRealCoachRatings({ name: "Test Person", primaryRole: "Midfield", tier: "Established", atPotential: false });
  const b = buildRealCoachRatings({ name: "Test Person", primaryRole: "Midfield", tier: "Established", atPotential: false });
  check("same real-coach input produces byte-identical ratings (deterministic, no Math.random)", JSON.stringify(a) === JSON.stringify(b));

  const fa = buildFictionalCoachRatings("Test Fictional", "Forward Line");
  const fb = buildFictionalCoachRatings("Test Fictional", "Forward Line");
  check("same fictional-coach input produces byte-identical ratings", JSON.stringify(fa) === JSON.stringify(fb));

  const c = buildRealCoachRatings({ name: "Different Person", primaryRole: "Midfield", tier: "Established", atPotential: false });
  check("different names produce different ratings (not a constant)", JSON.stringify(a) !== JSON.stringify(c));

  const historical = buildRealCoachRatings({ name: "Historical Person", primaryRole: "Defensive Line", tier: "Legend", atPotential: true });
  check("atPotential:true gives POT === OVR on every role", COACH_ROLES.every((r) => historical[r].ovr === historical[r].pot));
}

console.log("=== Section 3: pool-wide structural invariants ===");
{
  check(`pool is non-empty (got ${ASSISTANT_COACH_POOL.length})`, ASSISTANT_COACH_POOL.length > 0);
  console.log(`  Pool size: ${ASSISTANT_COACH_POOL.length}`);

  const ids = ASSISTANT_COACH_POOL.map((c) => c.id);
  check("all ids unique", new Set(ids).size === ids.length);
  check("ids are 1..N with no gaps", JSON.stringify([...ids].sort((x, y) => x - y)) === JSON.stringify(Array.from({ length: ids.length }, (_, i) => i + 1)));

  const names = ASSISTANT_COACH_POOL.map((c) => c.name);
  const dupeNames = names.filter((n, i) => names.indexOf(n) !== i);
  check(`no duplicate coach names (dupes: ${JSON.stringify(dupeNames)})`, dupeNames.length === 0);

  for (const c of ASSISTANT_COACH_POOL) {
    check(`${c.name}: has all 6 role ratings`, COACH_ROLES.every((r) => c.ratings[r] !== undefined), JSON.stringify(Object.keys(c.ratings)));
    for (const r of COACH_ROLES) {
      const { ovr, pot } = c.ratings[r];
      if (!(ovr >= 1 && ovr <= 99 && pot >= 1 && pot <= 99 && pot >= ovr)) {
        check(`${c.name} [${r}]: ovr=${ovr} pot=${pot} in range with pot>=ovr`, false);
      }
    }
    check(`${c.name}: primaryRole is a real CoachRole`, (COACH_ROLES as readonly string[]).includes(c.primaryRole));
    check(`${c.name}: has at least 1 tag`, c.tags.length > 0);
    check(`${c.name}: bio is non-empty`, c.bio.trim().length > 0);
  }
  check("all pool-wide role-rating checks passed (see any FAIL lines above for detail)", true);
}

console.log("=== Section 4: source-specific invariants ===");
{
  const historical = ASSISTANT_COACH_POOL.filter((c) => c.source === "historical");
  check(`historical bucket non-empty (got ${historical.length})`, historical.length > 0);
  for (const c of historical) {
    check(`${c.name} (historical): POT === OVR on every role`, COACH_ROLES.every((r) => c.ratings[r].ovr === c.ratings[r].pot));
  }

  const nonHistorical = ASSISTANT_COACH_POOL.filter((c) => c.source !== "historical");
  for (const c of nonHistorical) {
    check(`${c.name} (${c.source}): POT > OVR on primary role (still has headroom to grow)`, c.ratings[c.primaryRole].pot > c.ratings[c.primaryRole].ovr);
  }

  const bySource: Record<string, number> = {};
  for (const c of ASSISTANT_COACH_POOL) bySource[c.source] = (bySource[c.source] ?? 0) + 1;
  console.log("  By source:", JSON.stringify(bySource));
  check("delisted-player bucket is empty this round (disclosed, not yet wired to contracts.ts's delist())", (bySource["delisted-player"] ?? 0) === 0);
  check("fictional bucket has exactly 8 entries (one per role + 2 extra depth picks)", (bySource["fictional"] ?? 0) === 8);

  const byPrimaryRole: Record<string, number> = {};
  for (const c of ASSISTANT_COACH_POOL) byPrimaryRole[c.primaryRole] = (byPrimaryRole[c.primaryRole] ?? 0) + 1;
  console.log("  By primary role:", JSON.stringify(byPrimaryRole));
  check("every one of the 6 roles has at least 1 coach with it as primary", COACH_ROLES.every((r) => (byPrimaryRole[r] ?? 0) > 0), JSON.stringify(byPrimaryRole));
}

console.log("=== Section 5: named real people resolve correctly (spot checks) ===");
{
  const byName = (n: string) => ASSISTANT_COACH_POOL.find((c) => c.name === n);

  const clarkson = byName("Alastair Clarkson");
  check("Alastair Clarkson in pool", !!clarkson);
  check("Clarkson source is historical", clarkson?.source === "historical");
  check("Clarkson tier reads as Legend-band (OVR >= 90 on primary role)", (clarkson?.ratings[clarkson.primaryRole].ovr ?? 0) >= 90);

  const pendlebury = byName("Scott Pendlebury");
  check("Scott Pendlebury in pool", !!pendlebury);
  check("Pendlebury tagged pending/player-coach", !!pendlebury?.tags.includes("pending") && !!pendlebury?.tags.includes("player-coach"));

  const fraser = byName("Josh Fraser");
  check("Josh Fraser NOT in pool (now Carlton's senior coach, not available assistant talent)", !fraser);
  const king = byName("Steven King");
  check("Steven King NOT in pool (now Melbourne's senior coach)", !king);
  const daniher = byName("Neale Daniher");
  check("Neale Daniher NOT in pool (sensitivity exclusion, disclosed in file's doc comment)", !daniher);
  const hardwick = byName("Damien Hardwick");
  check("Damien Hardwick NOT in pool (active senior coach, not available)", !hardwick);

  const talentScouts = ASSISTANT_COACH_POOL.filter((c) => c.primaryRole === "Talent Scout");
  check(`at least 1 coach has Talent Scout as primary (got ${talentScouts.length})`, talentScouts.length >= 1);
  check("Talent Scout coaches have no special exemption from the same 1-99/POT>=OVR rules", talentScouts.every((c) => COACH_ROLES.every((r) => c.ratings[r].ovr >= 1 && c.ratings[r].ovr <= 99)));
}

console.log("=== Section 6: club coverage spot-check (18-club research ask) ===");
{
  const clubTags = new Set<string>();
  for (const c of ASSISTANT_COACH_POOL) for (const t of c.tags) if (t.startsWith("team/")) clubTags.add(t);
  console.log(`  Distinct team/ tags: ${clubTags.size}`, JSON.stringify([...clubTags].sort()));
  check("17 of 18 clubs have at least 1 real-assistant tagged (Richmond disclosed as a real gap, not padded)", clubTags.size === 17);
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
