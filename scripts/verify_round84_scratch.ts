/**
 * Round 84 (Match-Day Line Coach Direction) verification — throwaway,
 * matches the project's established verify_roundNN_scratch.ts convention.
 * Covers [[Match-Day Line Coach Direction]] as actually built in
 * engine/lineCoaching.ts, engine/match.ts, types/coach.ts, and
 * engine/saveGame.ts: every per-role/per-lever multiplier table at the
 * baseline 0.5 effectiveness, scaledBonus/scaledBias's effectiveness
 * scaling (1x/2x/0x + clamping), matchDayRoleForTacticGroup's total
 * mapping, effectiveCleanMarkProbability's clamping + bias direction,
 * digDeeperFitnessDrainMultiplier's 1.6x/1x split, lineCoachFeedback's
 * threshold banding, the SaveGameData.lineCoaches round trip, and an
 * end-to-end pass wiring a real startMatch/simulateQuarter match with real
 * setLineFocus changes to confirm the engine hooks actually move real
 * outcomes (feedback cross-validation, mid-match focus persistence, the
 * fatigue hook's direction, and the contest hook's direction over a
 * multi-seed batch).
 */
import {
  DEFENSIVE_LINE_FOCUSES,
  FORWARD_LINE_FOCUSES,
  MIDFIELD_LINE_FOCUSES,
  RUCK_LINE_FOCUSES,
  DEMAND_THEY_DIG_DEEPER,
  DEFAULT_LINE_FOCUS,
  LINE_FEEDBACK_LOW_THRESHOLD,
  LINE_FEEDBACK_HIGH_THRESHOLD,
  defensiveLineContestMultiplier,
  defensiveLineCleanMarkBias,
  defensiveLineTackleMultiplier,
  effectiveCleanMarkProbability,
  forwardLineMarkLeadMultiplier,
  forwardLineMarkContestedMultiplier,
  forwardLineForwardPressureTackleMultiplier,
  midfieldClearanceMultiplier,
  midfieldContestedPossessionMultiplier,
  midfieldDisposalMultiplier,
  ruckHitoutFocusMultiplier,
  ruckTapExecutionMultiplier,
  ruckAerialFocusMultiplier,
  digDeeperFitnessDrainMultiplier,
  lineCoachFeedback,
  matchDayRoleForTacticGroup,
  scaledBonus,
  scaledBias,
  type DefensiveLineFocus,
  type ForwardLineFocus,
  type MidfieldLineFocus,
  type RuckLineFocus,
} from "../src/engine/lineCoaching.ts";
import { MATCH_DAY_COACH_ROLES, type MatchDayCoachRole } from "../src/types/coach.ts";
import { tacticGroupForSlot, defaultTeamPlan, type TacticGroup } from "../src/engine/tactics.ts";
import { startMatch, simulateQuarter, setLineFocus, getLineFocus, lineFeedbackFor, CONTEST_STAT_FIELDS, type MatchInProgress, type Ctx, type BoxScoreLine } from "../src/engine/match.ts";
import type { Side } from "../src/engine/zones.ts";
import { mulberry32 } from "../src/engine/rng.ts";
import { onGroundPlayers } from "../src/engine/team.ts";
import { getPlayersByClub } from "../src/data/loadPlayers.ts";
import { autoFillLineup, lineupToMatchTeam } from "../src/engine/selection.ts";
import { newSaveGame, serializeSave, deserializeSave } from "../src/engine/saveGame.ts";
import { makePlayer } from "../src/testUtils/makePlayer.ts";
import type { Archetype } from "../src/types/archetype.ts";

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
function near(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) < eps;
}

console.log("=== Section 1: per-role/per-lever multiplier tables at the 0.5 baseline effectiveness ===");
{
  // At effectiveness=0.5, scaledBonus(raw, 0.5) = 1 + (raw-1)*2*0.5 = raw exactly (the "1x the
  // designed effect at baseline" identity lineCoaching.ts's own scaledBonus doc comment claims) --
  // so every lever's returned multiplier at 0.5 should equal its documented raw constant verbatim.
  const EFF = 0.5;
  const DEFAULT_BONUS = 1.05;
  const FOCUSED_BONUS = 1.18;
  const UNFOCUSED_PENALTY = 0.97;
  const DIG_DEEPER_BONUS = 1.12;
  const DEFAULT_BONUS_SMALL = 1.02;
  const FOCUSED_BONUS_SMALL = 1.08;
  const UNFOCUSED_PENALTY_SMALL = 0.99;

  // Defensive Line: contest lever is shared between "Focus on Spoiling" and "Focus on Intercepts"
  // (both peak it); "Focus on Tackling" takes the dip on THIS lever instead.
  for (const focus of DEFENSIVE_LINE_FOCUSES) {
    const actual = defensiveLineContestMultiplier(focus, EFF);
    const expected =
      focus === DEMAND_THEY_DIG_DEEPER ? DIG_DEEPER_BONUS : focus === "Focus on Spoiling" || focus === "Focus on Intercepts" ? FOCUSED_BONUS : focus === DEFAULT_LINE_FOCUS ? DEFAULT_BONUS : UNFOCUSED_PENALTY;
    check(`defensiveLineContestMultiplier("${focus}", 0.5) === ${expected}`, near(actual, expected), `got ${actual}`);
  }
  for (const focus of DEFENSIVE_LINE_FOCUSES) {
    const actual = defensiveLineTackleMultiplier(focus, EFF);
    const expected = focus === DEMAND_THEY_DIG_DEEPER ? DIG_DEEPER_BONUS : focus === "Focus on Tackling" ? FOCUSED_BONUS : focus === DEFAULT_LINE_FOCUS ? DEFAULT_BONUS : UNFOCUSED_PENALTY;
    check(`defensiveLineTackleMultiplier("${focus}", 0.5) === ${expected}`, near(actual, expected), `got ${actual}`);
  }
  // Clean-mark bias: a pure redirect, not a magnitude lever -- only Spoiling(-)/Intercepts(+) are nonzero.
  check('defensiveLineCleanMarkBias("Focus on Spoiling", 0.5) === -0.12', near(defensiveLineCleanMarkBias("Focus on Spoiling", EFF), -0.12));
  check('defensiveLineCleanMarkBias("Focus on Intercepts", 0.5) === 0.12', near(defensiveLineCleanMarkBias("Focus on Intercepts", EFF), 0.12));
  for (const focus of ["Default", "Focus on Tackling", "Demand They Dig Deeper"] as DefensiveLineFocus[]) {
    check(`defensiveLineCleanMarkBias("${focus}", 0.5) === 0 (pure redirect, no bias outside Spoiling/Intercepts)`, near(defensiveLineCleanMarkBias(focus, EFF), 0));
  }

  // Forward Line: 3 independent single-peak levers (leading / contested marking / forward pressure).
  const forwardLeverChecks: [string, (f: ForwardLineFocus, e: number) => number, ForwardLineFocus][] = [
    ["forwardLineMarkLeadMultiplier", forwardLineMarkLeadMultiplier, "Focus on Leading"],
    ["forwardLineMarkContestedMultiplier", forwardLineMarkContestedMultiplier, "Focus on Contested Marking"],
    ["forwardLineForwardPressureTackleMultiplier", forwardLineForwardPressureTackleMultiplier, "Focus on Forward Pressure"],
  ];
  for (const [label, fn, peakFocus] of forwardLeverChecks) {
    for (const focus of FORWARD_LINE_FOCUSES) {
      const actual = fn(focus, EFF);
      const expected = focus === DEMAND_THEY_DIG_DEEPER ? DIG_DEEPER_BONUS : focus === peakFocus ? FOCUSED_BONUS : focus === DEFAULT_LINE_FOCUS ? DEFAULT_BONUS : UNFOCUSED_PENALTY;
      check(`${label}("${focus}", 0.5) === ${expected}`, near(actual, expected), `got ${actual}`);
    }
  }

  // Midfield: clearances + contested possession are normal-magnitude; ball use is deliberately small.
  for (const focus of MIDFIELD_LINE_FOCUSES) {
    const actual = midfieldClearanceMultiplier(focus, EFF);
    const expected = focus === DEMAND_THEY_DIG_DEEPER ? DIG_DEEPER_BONUS : focus === "Focus on Clearances" ? FOCUSED_BONUS : focus === DEFAULT_LINE_FOCUS ? DEFAULT_BONUS : UNFOCUSED_PENALTY;
    check(`midfieldClearanceMultiplier("${focus}", 0.5) === ${expected}`, near(actual, expected), `got ${actual}`);
  }
  for (const focus of MIDFIELD_LINE_FOCUSES) {
    const actual = midfieldContestedPossessionMultiplier(focus, EFF);
    const expected = focus === DEMAND_THEY_DIG_DEEPER ? DIG_DEEPER_BONUS : focus === "Focus on Contested Possession" ? FOCUSED_BONUS : focus === DEFAULT_LINE_FOCUS ? DEFAULT_BONUS : UNFOCUSED_PENALTY;
    check(`midfieldContestedPossessionMultiplier("${focus}", 0.5) === ${expected}`, near(actual, expected), `got ${actual}`);
  }
  for (const focus of MIDFIELD_LINE_FOCUSES) {
    const actual = midfieldDisposalMultiplier(focus, EFF);
    // Dig Deeper is deliberately NOT scaled down for the small lever -- uniform 1.12 everywhere.
    const expected = focus === DEMAND_THEY_DIG_DEEPER ? DIG_DEEPER_BONUS : focus === "Focus on Ball Use" ? FOCUSED_BONUS_SMALL : focus === DEFAULT_LINE_FOCUS ? DEFAULT_BONUS_SMALL : UNFOCUSED_PENALTY_SMALL;
    check(`midfieldDisposalMultiplier("${focus}", 0.5) === ${expected} (small-magnitude lever)`, near(actual, expected), `got ${actual}`);
  }
  check("midfieldDisposalMultiplier's Focused value is smaller than the normal-magnitude levers' Focused value", FOCUSED_BONUS_SMALL < FOCUSED_BONUS);

  // Ruck and Stoppage: 3 independent single-peak levers (hitout / clean taps / aerial work).
  const ruckLeverChecks: [string, (f: RuckLineFocus, e: number) => number, RuckLineFocus][] = [
    ["ruckHitoutFocusMultiplier", ruckHitoutFocusMultiplier, "Focus on Winning the Tap"],
    ["ruckTapExecutionMultiplier", ruckTapExecutionMultiplier, "Focus on Clean Taps"],
    ["ruckAerialFocusMultiplier", ruckAerialFocusMultiplier, "Focus on Around-the-Ground Work"],
  ];
  for (const [label, fn, peakFocus] of ruckLeverChecks) {
    for (const focus of RUCK_LINE_FOCUSES) {
      const actual = fn(focus, EFF);
      const expected = focus === DEMAND_THEY_DIG_DEEPER ? DIG_DEEPER_BONUS : focus === peakFocus ? FOCUSED_BONUS : focus === DEFAULT_LINE_FOCUS ? DEFAULT_BONUS : UNFOCUSED_PENALTY;
      check(`${label}("${focus}", 0.5) === ${expected}`, near(actual, expected), `got ${actual}`);
    }
  }
}

console.log("=== Section 2: scaledBonus / scaledBias effectiveness scaling + clamping ===");
{
  const raw = 1.18;
  check("scaledBonus(raw, 0.5) === raw (1x the designed effect at baseline)", near(scaledBonus(raw, 0.5), raw));
  check("scaledBonus(raw, 1) === 1 + (raw-1)*2 (2x the excess at elite effectiveness)", near(scaledBonus(raw, 1), 1 + (raw - 1) * 2));
  check("scaledBonus(raw, 0) === 1 (0x the excess -- no effect at all with zero effectiveness)", near(scaledBonus(raw, 0), 1));
  check("scaledBonus clamps effectiveness > 1 to the eff=1 result", near(scaledBonus(raw, 5), scaledBonus(raw, 1)));
  check("scaledBonus clamps effectiveness < 0 to the eff=0 result", near(scaledBonus(raw, -3), scaledBonus(raw, 0)));

  const rawBias = 0.12;
  check("scaledBias(rawBias, 0.5) === rawBias (same 1x-at-baseline identity, no +1 offset)", near(scaledBias(rawBias, 0.5), rawBias));
  check("scaledBias(rawBias, 1) === rawBias*2", near(scaledBias(rawBias, 1), rawBias * 2));
  check("scaledBias(rawBias, 0) === 0", near(scaledBias(rawBias, 0), 0));
  check("scaledBias clamps effectiveness > 1 to the eff=1 result", near(scaledBias(rawBias, 9), scaledBias(rawBias, 1)));
  check("scaledBias clamps effectiveness < 0 to the eff=0 result", near(scaledBias(rawBias, -9), scaledBias(rawBias, 0)));
}

console.log("=== Section 3: matchDayRoleForTacticGroup is a total, correct mapping over all 5 TacticGroups ===");
{
  const ALL_GROUPS: TacticGroup[] = ["Defender", "KeyForward", "SmallForward", "Midfield", "Ruck"];
  const expected: Record<TacticGroup, MatchDayCoachRole> = {
    Defender: "Defensive Line",
    KeyForward: "Forward Line",
    SmallForward: "Forward Line",
    Midfield: "Midfield",
    Ruck: "Ruck and Stoppage",
  };
  for (const group of ALL_GROUPS) {
    check(`matchDayRoleForTacticGroup("${group}") === "${expected[group]}"`, matchDayRoleForTacticGroup(group) === expected[group]);
  }
  check("KeyForward and SmallForward both resolve to the SAME Forward Line coach (one coach, not two)", matchDayRoleForTacticGroup("KeyForward") === matchDayRoleForTacticGroup("SmallForward"));
  const resolvedRoles = new Set(ALL_GROUPS.map(matchDayRoleForTacticGroup));
  check("every one of the 4 match-day roles is reachable from some TacticGroup", resolvedRoles.size === 4 && MATCH_DAY_COACH_ROLES.every((r) => resolvedRoles.has(r)));
}

console.log("=== Section 4: effectiveCleanMarkProbability clamping + bias direction ===");
{
  const BASE = 0.35; // P_DEFENSIVE_MARKING_WIN_IS_CLEAN_MARK's real value
  check("no bias leaves the base probability untouched", near(effectiveCleanMarkProbability(BASE, 0), BASE));
  check("positive bias (Focus on Intercepts) raises the clean-mark probability", effectiveCleanMarkProbability(BASE, 0.24) > BASE);
  check("negative bias (Focus on Spoiling) lowers the clean-mark probability", effectiveCleanMarkProbability(BASE, -0.24) < BASE);
  check("result clamps at 1 even with an oversized positive bias", effectiveCleanMarkProbability(BASE, 5) === 1);
  check("result clamps at 0 even with an oversized negative bias", effectiveCleanMarkProbability(BASE, -5) === 0);
  check("result never exceeds 1 at the real max bias (elite Intercepts coach, eff=1: base + 0.24)", effectiveCleanMarkProbability(BASE, scaledBias(0.12, 1)) <= 1);
  check("result never drops below 0 at the real max negative bias (elite Spoiling coach, eff=1: base - 0.24)", effectiveCleanMarkProbability(BASE, scaledBias(-0.12, 1)) >= 0);
}

console.log("=== Section 5: digDeeperFitnessDrainMultiplier — 1.6x under Dig Deeper, 1x for every other focus ===");
{
  const ALL_FOCUSES = [...DEFENSIVE_LINE_FOCUSES, ...FORWARD_LINE_FOCUSES, ...MIDFIELD_LINE_FOCUSES, ...RUCK_LINE_FOCUSES];
  for (const focus of ALL_FOCUSES) {
    const actual = digDeeperFitnessDrainMultiplier(focus);
    const expected = focus === DEMAND_THEY_DIG_DEEPER ? 1.6 : 1;
    check(`digDeeperFitnessDrainMultiplier("${focus}") === ${expected}`, actual === expected, `got ${actual}`);
  }
}

console.log("=== Section 6: lineCoachFeedback threshold banding (low/mid/high, per role) ===");
{
  // Hand-mirrored from lineCoaching.ts's own private LOW_FEEDBACK/MID_FEEDBACK/HIGH_FEEDBACK --
  // update these literals if that file's own copy changes.
  const LOW: Record<MatchDayCoachRole, string> = {
    "Defensive Line": "Allowing too many contested marks.",
    "Forward Line": "Not winning enough of our own ball inside 50.",
    Midfield: "Losing contested possession.",
    "Ruck and Stoppage": "Getting beaten around the stoppages.",
  };
  const MID = "Meeting all our key metrics.";
  const HIGH = "Boys are happy with their performance.";

  check(`LINE_FEEDBACK_LOW_THRESHOLD === 0.4 (got ${LINE_FEEDBACK_LOW_THRESHOLD})`, LINE_FEEDBACK_LOW_THRESHOLD === 0.4);
  check(`LINE_FEEDBACK_HIGH_THRESHOLD === 0.6 (got ${LINE_FEEDBACK_HIGH_THRESHOLD})`, LINE_FEEDBACK_HIGH_THRESHOLD === 0.6);

  for (const role of MATCH_DAY_COACH_ROLES) {
    check(`${role}: winRate well below threshold (0.1) -> role-specific low-band sentence`, lineCoachFeedback(role, 0.1) === LOW[role]);
    check(`${role}: winRate just under the low threshold (0.39999) -> still low-band`, lineCoachFeedback(role, 0.39999) === LOW[role]);
    check(`${role}: winRate exactly AT the low threshold (0.4) -> mid-band, not low (strict < only)`, lineCoachFeedback(role, LINE_FEEDBACK_LOW_THRESHOLD) === MID);
    check(`${role}: winRate mid-band (0.5) -> generic "meeting all our key metrics"`, lineCoachFeedback(role, 0.5) === MID);
    check(`${role}: winRate exactly AT the high threshold (0.6) -> still mid-band, not high (strict > only)`, lineCoachFeedback(role, LINE_FEEDBACK_HIGH_THRESHOLD) === MID);
    check(`${role}: winRate just over the high threshold (0.60001) -> high-band`, lineCoachFeedback(role, 0.60001) === HIGH);
    check(`${role}: winRate well above threshold (0.9) -> generic "boys are happy" sentence`, lineCoachFeedback(role, 0.9) === HIGH);
  }
  const lowSentences = new Set(MATCH_DAY_COACH_ROLES.map((r) => lineCoachFeedback(r, 0.1)));
  check("low-band feedback is genuinely role-specific (4 distinct sentences, not one generic line)", lowSentences.size === 4);
  const midSentences = new Set(MATCH_DAY_COACH_ROLES.map((r) => lineCoachFeedback(r, 0.5)));
  const highSentences = new Set(MATCH_DAY_COACH_ROLES.map((r) => lineCoachFeedback(r, 0.9)));
  check("mid-band feedback is the SAME generic sentence across all 4 roles", midSentences.size === 1);
  check("high-band feedback is the SAME generic sentence across all 4 roles", highSentences.size === 1);
}

console.log("=== Section 7: SaveGameData.lineCoaches round trip ===");
{
  const players = Array.from({ length: 5 }, (_, i) => makePlayer({ PlayerID: i + 1 }));
  const fresh = newSaveGame("Adelaide", players);
  check("newSaveGame defaults lineCoaches to {} ", JSON.stringify(fresh.lineCoaches) === "{}");

  const assignment: Partial<Record<MatchDayCoachRole, number>> = { "Defensive Line": 11, Midfield: 22, "Ruck and Stoppage": 33 };
  const withCoaches = { ...fresh, lineCoaches: assignment };
  const wire = JSON.parse(JSON.stringify(serializeSave(withCoaches)));
  const restored = deserializeSave(wire);
  check("lineCoaches (3 of 4 roles assigned) round-trips through a real JSON.stringify/JSON.parse pass with no data loss", JSON.stringify(restored.lineCoaches) === JSON.stringify(assignment));

  const emptyAssignment: Partial<Record<MatchDayCoachRole, number>> = {};
  const withNoCoaches = { ...fresh, lineCoaches: emptyAssignment };
  const wire2 = JSON.parse(JSON.stringify(serializeSave(withNoCoaches)));
  const restored2 = deserializeSave(wire2);
  check("an empty lineCoaches ({}) also round-trips correctly", JSON.stringify(restored2.lineCoaches) === "{}");

  const wireMissing = JSON.parse(JSON.stringify(serializeSave(withCoaches)));
  delete wireMissing.lineCoaches;
  const restoredMissing = deserializeSave(wireMissing);
  check("defaults lineCoaches to {} for a save written before round 84 existed (field absent on the wire)", JSON.stringify(restoredMissing.lineCoaches) === "{}");
}

console.log("=== Section 8: end-to-end integration on a real match (real players, real startMatch/simulateQuarter) ===");
{
  const homeClubName = "Melbourne";
  const awayClubName = "Collingwood";
  const homePlayers = getPlayersByClub(homeClubName);
  const awayPlayers = getPlayersByClub(awayClubName);
  const homeLineup = autoFillLineup(homePlayers);
  const awayLineup = autoFillLineup(awayPlayers);
  check(`fixture clubs resolved real rosters (home ${homePlayers.length}, away ${awayPlayers.length} players)`, homePlayers.length > 0 && awayPlayers.length > 0);

  function freshTeams() {
    return {
      home: lineupToMatchTeam(homeClubName, homeLineup, homePlayers),
      away: lineupToMatchTeam(awayClubName, awayLineup, awayPlayers),
    };
  }

  // A hand-mirror of match.ts's own private LINE_FEEDBACK_FIELDS -- deliberately built from the
  // exported CONTEST_STAT_FIELDS table so field NAMES track that table automatically; only the
  // role-to-contest-type grouping itself is a disclosed copy, kept in sync with match.ts's own.
  const LINE_FEEDBACK_FIELDS_MIRROR: Record<MatchDayCoachRole, { attempts: keyof BoxScoreLine; wins: keyof BoxScoreLine }[]> = {
    "Defensive Line": [CONTEST_STAT_FIELDS.markContested, CONTEST_STAT_FIELDS.groundBall, CONTEST_STAT_FIELDS.tackle],
    "Forward Line": [CONTEST_STAT_FIELDS.markLead, CONTEST_STAT_FIELDS.markContested, CONTEST_STAT_FIELDS.tackle],
    Midfield: [CONTEST_STAT_FIELDS.clearance, CONTEST_STAT_FIELDS.groundBall],
    "Ruck and Stoppage": [CONTEST_STAT_FIELDS.ruck, CONTEST_STAT_FIELDS.markContested],
  };
  function expectedWinRateForRole(ctx: Ctx, side: Side, role: MatchDayCoachRole): number {
    const team = side === "home" ? ctx.home : ctx.away;
    const ids = onGroundPlayers(team)
      .filter((p) => matchDayRoleForTacticGroup(tacticGroupForSlot(team.positions?.get(p.PlayerID), p.archetype as Archetype)) === role)
      .map((p) => p.PlayerID);
    let attempts = 0;
    let wins = 0;
    for (const id of ids) {
      const line = ctx.box[id];
      if (!line) continue;
      for (const f of LINE_FEEDBACK_FIELDS_MIRROR[role]) {
        attempts += (line[f.attempts] as number) ?? 0;
        wins += (line[f.wins] as number) ?? 0;
      }
    }
    return attempts > 0 ? wins / attempts : 0.5;
  }

  // --- 8a: kickoff smoke test -- before a single contest has resolved, every role's feedback
  // should be the neutral 0.5-band ("Meeting all our key metrics") on both sides.
  {
    const { home, away } = freshTeams();
    const match = startMatch(home, away, mulberry32(424242), 424242, { homePlan: defaultTeamPlan(), awayPlan: defaultTeamPlan() });
    for (const side of ["home", "away"] as Side[]) {
      for (const role of MATCH_DAY_COACH_ROLES) {
        const feedback = lineFeedbackFor(match.ctx, side, role);
        check(`kickoff, ${side}/${role}: feedback is the neutral mid-band sentence before any contest has resolved`, feedback === "Meeting all our key metrics.", `got "${feedback}"`);
      }
    }
  }

  // --- 8b: full-match cross-validation -- lineFeedbackFor's real output must match lineCoachFeedback
  // applied to an INDEPENDENTLY computed win-rate for every role on both sides.
  {
    const { home, away } = freshTeams();
    const match = startMatch(home, away, mulberry32(13579), 13579, { homePlan: defaultTeamPlan(), awayPlan: defaultTeamPlan() });
    for (let q = 1 as 1 | 2 | 3 | 4; q <= 4; q = (q + 1) as 1 | 2 | 3 | 4) simulateQuarter(match, q);
    for (const side of ["home", "away"] as Side[]) {
      for (const role of MATCH_DAY_COACH_ROLES) {
        const winRate = expectedWinRateForRole(match.ctx, side, role);
        const expected = lineCoachFeedback(role, winRate);
        const actual = lineFeedbackFor(match.ctx, side, role);
        check(`full match, ${side}/${role}: lineFeedbackFor matches an independently-computed win-rate classification (winRate=${winRate.toFixed(3)})`, actual === expected, `expected "${expected}", got "${actual}"`);
      }
    }
  }

  // --- 8c: setLineFocus/getLineFocus mid-match persistence -- a focus set after Q1 must survive
  // being read both immediately and after further quarters simulate, and must not leak to the
  // other 3 roles or the other side.
  {
    const { home, away } = freshTeams();
    const match = startMatch(home, away, mulberry32(97531), 97531, { homePlan: defaultTeamPlan(), awayPlan: defaultTeamPlan() });
    for (const role of MATCH_DAY_COACH_ROLES) {
      check(`kickoff: ${role} starts on Default for home`, getLineFocus(match, "home", role) === "Default");
    }
    simulateQuarter(match, 1);
    setLineFocus(match, "home", "Midfield", "Focus on Clearances");
    check("immediately after setLineFocus: getLineFocus reflects the new focus", getLineFocus(match, "home", "Midfield") === "Focus on Clearances");
    check("setting Midfield's focus does not leak into the other 3 home roles", MATCH_DAY_COACH_ROLES.filter((r) => r !== "Midfield").every((r) => getLineFocus(match, "home", r) === "Default"));
    check("setting home's Midfield focus does not leak to away's Midfield focus", getLineFocus(match, "away", "Midfield") === "Default");
    simulateQuarter(match, 2);
    simulateQuarter(match, 3);
    check("focus set at Q1 break survives simulating Q2 and Q3 (not reset each quarter)", getLineFocus(match, "home", "Midfield") === "Focus on Clearances");
    setLineFocus(match, "home", "Midfield", "Demand They Dig Deeper");
    simulateQuarter(match, 4);
    check("a second focus change at the Q3 break also survives to full time", getLineFocus(match, "home", "Midfield") === "Demand They Dig Deeper");
  }

  // --- 8d: fatigue-drain hook direction -- same seed/roster, only the home Midfield focus differs
  // (Dig Deeper vs Default). Drain itself is unconditional (not RNG-gated), BUT round 48's own
  // automatic fitness-triggered rotation reacts to that same drain -- a Dig Deeper player crosses
  // the rotation threshold sooner, gets pulled to the bench, and starts RECOVERING fitness earlier
  // than their Default counterpart. A naive "average fitness across the whole role-group roster"
  // comparison is confounded by that emergent interaction (a first attempt at this check actually
  // came out backwards for exactly this reason). Isolating the real per-tick drain-multiplier
  // effect means restricting the comparison to players who stayed continuously on-ground (never
  // rotated to the bench) in BOTH runs -- for those specific players only, the two runs differ by
  // nothing except the drain multiplier itself.
  {
    function playOneQuarter(focus: "Demand They Dig Deeper" | null): { match: MatchInProgress; endOnGround: Set<number> } {
      const { home, away } = freshTeams();
      const match = startMatch(home, away, mulberry32(271828), 271828, { homePlan: defaultTeamPlan(), awayPlan: defaultTeamPlan() });
      if (focus) setLineFocus(match, "home", "Midfield", focus);
      simulateQuarter(match, 1);
      return { match, endOnGround: new Set(match.ctx.home.onGround ?? []) };
    }
    function avgFitnessFor(match: MatchInProgress, side: Side, ids: number[]): number {
      const fitnessMap = side === "home" ? match.ctx.homeFitness : match.ctx.awayFitness;
      const total = ids.reduce((sum, id) => sum + (fitnessMap.get(id) ?? 100), 0);
      return ids.length > 0 ? total / ids.length : NaN;
    }

    const { home: kickoffHome } = freshTeams();
    const kickoffOnGround = new Set(kickoffHome.onGround ?? []);
    const kickoffMidfielders = kickoffHome.players
      .filter((p) => kickoffOnGround.has(p.PlayerID))
      .filter((p) => matchDayRoleForTacticGroup(tacticGroupForSlot(kickoffHome.positions?.get(p.PlayerID), p.archetype as Archetype)) === "Midfield")
      .map((p) => p.PlayerID);
    check("fixture has at least one Midfield-group player starting on-ground for home", kickoffMidfielders.length > 0, `count=${kickoffMidfielders.length}`);

    const digDeeper = playOneQuarter("Demand They Dig Deeper");
    const baseline = playOneQuarter(null);
    const stableIds = kickoffMidfielders.filter((id) => digDeeper.endOnGround.has(id) && baseline.endOnGround.has(id));
    check(
      "at least one starting Midfielder stayed on-ground the entire quarter in BOTH runs (a clean, rotation-free comparison group exists)",
      stableIds.length > 0,
      `stable=${stableIds.length} of ${kickoffMidfielders.length} starting Midfielders`,
    );

    const digFit = avgFitnessFor(digDeeper.match, "home", stableIds);
    const defFit = avgFitnessFor(baseline.match, "home", stableIds);
    check(
      "for players who never left the ground in either run, Demand They Dig Deeper leaves them with LOWER average fitness than Default (same seed/roster) -- the per-tick drain hook really is wired into stepFitnessSide",
      digFit < defFit,
      `digDeeper=${digFit.toFixed(3)} default=${defFit.toFixed(3)} over ${stableIds.length} stable player(s)`,
    );

    // The away side's own Midfield line (never touched by home's focus change) should be
    // essentially unaffected -- confirms the hook is per-side, not global. Softer/whole-roster
    // comparison is fine here since it's a sanity bound, not the primary directional claim.
    function avgFitnessForRole(match: MatchInProgress, side: Side, role: MatchDayCoachRole): number {
      const team = side === "home" ? match.ctx.home : match.ctx.away;
      const fitnessMap = side === "home" ? match.ctx.homeFitness : match.ctx.awayFitness;
      const relevant = team.players.filter((p) => matchDayRoleForTacticGroup(tacticGroupForSlot(team.positions?.get(p.PlayerID), p.archetype as Archetype)) === role);
      const total = relevant.reduce((sum, p) => sum + (fitnessMap.get(p.PlayerID) ?? 100), 0);
      return relevant.length > 0 ? total / relevant.length : NaN;
    }
    const digFitAway = avgFitnessForRole(digDeeper.match, "away", "Midfield");
    const defFitAway = avgFitnessForRole(baseline.match, "away", "Midfield");
    const homeWholeRosterDelta = Math.abs(avgFitnessForRole(digDeeper.match, "home", "Midfield") - avgFitnessForRole(baseline.match, "home", "Midfield"));
    check(
      "away's own Midfield fitness moves less than home's own Midfield fitness does (per-side hook, not global)",
      Math.abs(digFitAway - defFitAway) < homeWholeRosterDelta,
      `awayDelta=${Math.abs(digFitAway - defFitAway).toFixed(3)} homeDelta=${homeWholeRosterDelta.toFixed(3)}`,
    );
  }

  // --- 8e: contest hook direction over a multi-seed batch -- an elite, clearance-focused Midfield
  // coach should lift the home team's aggregate clearance win-rate above the no-coach baseline.
  // Single-match comparisons are too RNG-noisy (a changed multiplier changes which branch every
  // subsequent roll takes, so two seeded runs diverge from the first affected roll onward) --
  // summing attempts/wins across many seeds, mirroring verify_round48_scratch.ts's own multi-seed
  // sampling idiom, is what actually isolates the real directional signal from that noise.
  {
    function clearanceStatsForRole(ctx: Ctx, side: Side, role: MatchDayCoachRole): { attempts: number; wins: number } {
      const team = side === "home" ? ctx.home : ctx.away;
      let attempts = 0;
      let wins = 0;
      for (const p of team.players) {
        const group = tacticGroupForSlot(team.positions?.get(p.PlayerID), p.archetype as Archetype);
        if (matchDayRoleForTacticGroup(group) !== role) continue;
        const line = ctx.box[p.PlayerID];
        if (!line) continue;
        attempts += line.clearanceAttempts ?? 0;
        wins += line.clearanceWins ?? 0;
      }
      return { attempts, wins };
    }
    function playMatch(seed: number, boosted: boolean): MatchInProgress {
      const { home, away } = freshTeams();
      const opts = boosted
        ? { homePlan: defaultTeamPlan(), awayPlan: defaultTeamPlan(), homeLineCoachEffectiveness: { Midfield: 0.98 } }
        : { homePlan: defaultTeamPlan(), awayPlan: defaultTeamPlan() };
      const match = startMatch(home, away, mulberry32(seed), seed, opts);
      if (boosted) setLineFocus(match, "home", "Midfield", "Focus on Clearances");
      for (let q = 1 as 1 | 2 | 3 | 4; q <= 4; q = (q + 1) as 1 | 2 | 3 | 4) simulateQuarter(match, q);
      return match;
    }

    const SEEDS = [101, 202, 303, 404, 505, 606, 707, 808, 909, 1010, 1111, 1212];
    let baselineAttempts = 0;
    let baselineWins = 0;
    let boostedAttempts = 0;
    let boostedWins = 0;
    for (const seed of SEEDS) {
      const baseline = playMatch(seed, false);
      const boosted = playMatch(seed, true);
      const b = clearanceStatsForRole(baseline.ctx, "home", "Midfield");
      const o = clearanceStatsForRole(boosted.ctx, "home", "Midfield");
      baselineAttempts += b.attempts;
      baselineWins += b.wins;
      boostedAttempts += o.attempts;
      boostedWins += o.wins;
    }
    const baselineRate = baselineAttempts > 0 ? baselineWins / baselineAttempts : NaN;
    const boostedRate = boostedAttempts > 0 ? boostedWins / boostedAttempts : NaN;
    check(`batch has real clearance attempts recorded on both sides (baseline=${baselineAttempts}, boosted=${boostedAttempts})`, baselineAttempts > 0 && boostedAttempts > 0);
    check(
      `over ${SEEDS.length} seeds, an elite (0.98) Focus-on-Clearances home Midfield coach lifts the AGGREGATE home clearance win-rate above the no-coach baseline`,
      boostedRate > baselineRate,
      `baseline=${baselineRate.toFixed(4)} boosted=${boostedRate.toFixed(4)}`,
    );
  }
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`);
if (fail > 0) process.exit(1);
