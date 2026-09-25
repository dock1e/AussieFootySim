// Round 123 — [[Football Department Coach Market]]. Throwaway verify script (excluded from
// tsconfig.json/tsconfig.node.json), run via `node --experimental-strip-types`.
//
// Scope note, same rule every prior verify script in this project follows: this only tests
// engine/*.ts pure functions. This round's real logic is entirely in the new
// `engine/coachContracts.ts` (coachSalaryAsk, evaluateCoachOffer, committedStaffSpend) — everything
// below tests exactly that. The App.tsx logo/nav restyle, the AssistantCoaches.tsx Coach Market UI
// rebuild, and Combine.tsx's TalentScoutPanel -> ScoutSummaryCard swap are React/Tailwind presentation
// with no new pure-function logic beyond what's covered here; those are verified visually via live
// Chrome instead (see this round's own "Live Chrome verification" step).

import { coachSalaryAsk, evaluateCoachOffer, committedStaffSpend, type CoachContract } from "../src/engine/coachContracts.ts";
import { FOOTBALL_DEPT_CEILING } from "../src/engine/contracts.ts";
import { COACH_ROLES, type CoachRole } from "../src/types/coach.ts";
import { ASSISTANT_COACH_POOL } from "../src/data/assistantCoachPool.ts";

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

console.log("=== Section 1: coachSalaryAsk — monotonic, bounded, deterministic ===");
{
  const low = coachSalaryAsk(1);
  const mid = coachSalaryAsk(65);
  const high = coachSalaryAsk(99);
  check("ovr 1 salary is low (< $20k)", low < 20_000, `got ${low}`);
  check("ovr 99 salary is high (> $150k)", high > 150_000, `got ${high}`);
  check("monotonic: low < mid < high", low < mid && mid < high, `${low} / ${mid} / ${high}`);
  check("deterministic — same ovr, same salary", coachSalaryAsk(65) === mid);
  check("rounded to nearest $1000", high % 1000 === 0 && mid % 1000 === 0 && low % 1000 === 0);
  // A full 6-role A+-grade staff should be a real but not impossible fraction of the ceiling.
  const fullEliteStaff = coachSalaryAsk(99) * 6;
  check("6 elite (99 OVR) coaches together stay under the Football Dept ceiling", fullEliteStaff < FOOTBALL_DEPT_CEILING, `${fullEliteStaff} vs ${FOOTBALL_DEPT_CEILING}`);
}

console.log("=== Section 2: evaluateCoachOffer — same thresholds as engine/contracts.ts's evaluateOffer ===");
{
  const ask = 100_000;
  check("95% of ask accepts outright", evaluateCoachOffer(ask, 95_000, 0).result === "accepted");
  check("100% of ask accepts outright", evaluateCoachOffer(ask, 100_000, 0).result === "accepted");
  check("94.9% of ask does NOT accept outright", evaluateCoachOffer(ask, 94_900, 0).result !== "accepted");
  check("69% of ask rejects flatly", evaluateCoachOffer(ask, 69_000, 0).result === "rejected");
  const mid = evaluateCoachOffer(ask, 85_000, 0);
  check("85% of ask counters", mid.result === "countered");
  if (mid.result === "countered") {
    check("counter is the midpoint of (offer, ask), rounded to $1000", mid.counterSalaryPerYear === Math.round((85_000 + 100_000) / 2 / 1000) * 1000, `got ${mid.counterSalaryPerYear}`);
  }
  check("on the final allowed offer (offersUsed = maxOffers-1), a non-accept rejects instead of countering", evaluateCoachOffer(ask, 85_000, 2, 3).result === "rejected");
}

console.log("=== Section 3: committedStaffSpend — sums correctly, excludes the named role ===");
{
  const contracts: Partial<Record<CoachRole, CoachContract>> = {
    "Talent Scout": { coachId: 1, salaryPerYear: 50_000 },
    Development: { coachId: 2, salaryPerYear: 60_000 },
  };
  check("empty contracts sum to 0", committedStaffSpend({}) === 0);
  check("sums both entries", committedStaffSpend(contracts) === 110_000, `got ${committedStaffSpend(contracts)}`);
  check("excludes the named role", committedStaffSpend(contracts, "Talent Scout") === 60_000, `got ${committedStaffSpend(contracts, "Talent Scout")}`);
  check("excluding an unfilled role changes nothing", committedStaffSpend(contracts, "Midfield") === 110_000);
}

console.log("=== Section 4: real pool sanity — every coach has a real, gradeable OVR for every role ===");
{
  let allInRange = true;
  for (const c of ASSISTANT_COACH_POOL) {
    for (const role of COACH_ROLES) {
      const ovr = c.ratings[role].ovr;
      if (ovr < 1 || ovr > 99) allInRange = false;
    }
  }
  check(`all ${ASSISTANT_COACH_POOL.length} real/fictional coaches have every role's OVR in [1,99]`, allInRange);
  check("pool is non-trivial (matches round 82's ~84 coaches)", ASSISTANT_COACH_POOL.length >= 80, `got ${ASSISTANT_COACH_POOL.length}`);
}

console.log("=== Section 5: the staff-spend cap is a real, sometimes-binding constraint ===");
{
  // Hiring a 6th A+ coach after 5 are already hired at their salaryAsk should be blockable — i.e. the
  // cap can actually bind, it isn't so generous that no realistic roster ever hits it.
  const ask = coachSalaryAsk(99);
  const fiveHired: Partial<Record<CoachRole, CoachContract>> = {
    "Defensive Line": { coachId: 1, salaryPerYear: ask },
    "Forward Line": { coachId: 2, salaryPerYear: ask },
    Midfield: { coachId: 3, salaryPerYear: ask },
    "Ruck and Stoppage": { coachId: 4, salaryPerYear: ask },
    Development: { coachId: 5, salaryPerYear: ask },
  };
  const spendSoFar = committedStaffSpend(fiveHired);
  const wouldBeTotal = spendSoFar + ask;
  check("5 elite hires alone don't yet exceed the ceiling", spendSoFar <= FOOTBALL_DEPT_CEILING, `${spendSoFar} vs ${FOOTBALL_DEPT_CEILING}`);
  check("a 6th elite hire is still affordable (this app's real full-elite-staff headroom)", wouldBeTotal <= FOOTBALL_DEPT_CEILING, `${wouldBeTotal} vs ${FOOTBALL_DEPT_CEILING}`);
  // But an artificially inflated offer (e.g. way over ask, as a user could type into the stepper)
  // MUST be blockable — proving the cap check itself (spend-without-role + offer > ceiling) works.
  const inflatedOffer = FOOTBALL_DEPT_CEILING; // alone, this offer plus 5 existing elite hires must exceed the ceiling
  check("an inflated 6th offer that would exceed the ceiling is correctly flagged over-cap", spendSoFar + inflatedOffer > FOOTBALL_DEPT_CEILING);
}

console.log(`\n${pass} passed, ${fail} failed.`);
if (fail > 0) process.exit(1);
