/**
 * Round 72 (trade-frequency calibration against real historical data, backlog
 * #43) verification — throwaway, matches the project's established
 * verify_roundNN_scratch.ts convention. Runs against the real generated
 * players.json (via ALL_PLAYERS) — no mocks. `AI_TRADE_VALUE_TOLERANCE`/
 * `MIN_RELATIVE_SURPLUS` are module-private in trade.ts (same as every other
 * calibrated constant in this file — POSITIONAL_NEED_BONUS_PCT,
 * CORE_LOSS_AGE_CEILING, etc.), so this verifies the resulting BEHAVIOUR
 * against the real target rather than importing the raw constants.
 */
import { ALL_PLAYERS } from "../src/data/loadPlayers.ts";
import { computeLeagueStrategies } from "../src/engine/listNeeds.ts";
import { simulateLeagueTrades, generateInboundOffers } from "../src/engine/trade.ts";
import { CLUBS } from "../src/types/club.ts";
import { REAL_DRAFT_YEAR_METRICS } from "../src/data/realDraftYearMetrics.ts";

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

function playersByClubFrom(pool: readonly (typeof ALL_PLAYERS)[number][]) {
  const map = new Map<string, (typeof ALL_PLAYERS)[number][]>();
  for (const p of pool) {
    if (p.delisted) continue;
    const list = map.get(p.Team);
    if (list) list.push(p);
    else map.set(p.Team, [p]);
  }
  return map;
}

function runWindow(myClub: string, year: number, trial: number): number {
  let pool = [...ALL_PLAYERS];
  let total = 0;
  for (let day = 1; day <= 10; day++) {
    const seed = year * 100000 + trial * 1000 + day;
    const strategies = computeLeagueStrategies(playersByClubFrom(pool));
    const { players, activity } = simulateLeagueTrades(pool, myClub, year, day, seed, strategies);
    pool = players;
    total += activity.length;
  }
  return total;
}

console.log("=== Section 1: real target derivation (data/realDraftYearMetrics.ts) ===");
const realAvg = REAL_DRAFT_YEAR_METRICS.reduce((s, m) => s + m.trades, 0) / REAL_DRAFT_YEAR_METRICS.length;
check("28 years of real trade data present", REAL_DRAFT_YEAR_METRICS.length === 28, `got ${REAL_DRAFT_YEAR_METRICS.length}`);
check("real 1998-2025 average is ~24.82 trades/year", Math.abs(realAvg - 24.82) < 0.05, `got ${realAvg.toFixed(2)}`);
const target17Club = (realAvg * 17) / 18;

console.log("=== Section 2: empirical AI-vs-AI trade volume lands near the real target ===");
const YEAR = 2026; // Tyler's live save's actual current year -- NOT swept forward, see trade.ts's own doc comment on why
const TRIALS = 60;
const results: number[] = [];
for (let trial = 0; trial < TRIALS; trial++) {
  const myClub = CLUBS[trial % CLUBS.length].name;
  results.push(runWindow(myClub, YEAR, trial));
}
const avg = results.reduce((a, b) => a + b, 0) / results.length;
console.log(`  ${TRIALS}-trial average: ${avg.toFixed(2)} per 10-day window (real target, 17-club-scaled: ${target17Club.toFixed(2)})`);
// Generous band (not the exact 150-trial figure from calibration, which was 23.40) --
// tight enough to catch a real regression (reverting to the original 5/0.25/3 defaults
// produced 14.55) but not so tight that ordinary trial-to-trial sampling noise trips it.
check("empirical average within +/-6 of the real (17-club-scaled) target", Math.abs(avg - target17Club) < 6, `avg=${avg.toFixed(2)}, target=${target17Club.toFixed(2)}`);
check("empirical average is NOT still near the pre-calibration figure (14.55)", Math.abs(avg - 14.55) > 4, `avg=${avg.toFixed(2)}`);
check("no trial produced a runaway/degenerate volume (>45 in a 10-day window)", results.every((r) => r <= 45), `max=${Math.max(...results)}`);

console.log("=== Section 3: determinism ===");
const a = runWindow("North Melbourne", 2026, 7);
const b = runWindow("North Melbourne", 2026, 7);
check("same myClub+year+trial -> identical total trade count", a === b, `${a} vs ${b}`);

console.log("=== Section 4: generateInboundOffers still sane, inherits the same calibration ===");
{
  const strategies = computeLeagueStrategies(playersByClubFrom(ALL_PLAYERS));
  let offerDaysWithAny = 0;
  let maxOffersSeenInADay = 0;
  for (let day = 1; day <= 10; day++) {
    const offers = generateInboundOffers(ALL_PLAYERS, "North Melbourne", 2026, day, 2026 * 1000 + day, strategies);
    if (offers.length > 0) offerDaysWithAny++;
    maxOffersSeenInADay = Math.max(maxOffersSeenInADay, offers.length);
    for (const o of offers) {
      check(`day ${day} offer has both sides populated`, o.theyGivePlayerIds.length > 0 && o.theyWantPlayerIds.length > 0, JSON.stringify(o));
    }
  }
  check("MAX_INBOUND_OFFERS_PER_DAY=2 still respected (untouched this round)", maxOffersSeenInADay <= 2, `saw ${maxOffersSeenInADay}`);
  check("at least some days produce an inbound offer (calibration didn't zero this out)", offerDaysWithAny > 0, `0/10 days had any offer`);
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
