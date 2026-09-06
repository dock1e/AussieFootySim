import type { MatchDayCoachRole } from "../types/coach.ts";
import type { TacticGroup } from "./tactics.ts";

/**
 * Match-Day Line Coach Direction — Sep 2026 round 84. See [[Match-Day Line
 * Coach Direction]] (vault root) for the full design note: Tyler's own ask
 * (Quarter/Half/Three-Quarter Time review with the 4 match-day line
 * coaches, each left on a default path or directed to a named focus area),
 * the per-role multiplier tables below, the feedback-sentence classifier,
 * and the disclosed scope split from round 82's still-unbuilt season-long
 * Development-Coach/discrete-skill-growth mapping (a genuinely different
 * mechanic — this file is a LIVE, in-match tactical layer, mirroring
 * `tactics.ts`'s own GameStyle/Tactic multiplier-function family, not a
 * training/progression system).
 *
 * Framework-free and match.ts-free on purpose, same discipline `tactics.ts`
 * itself already follows: every multiplier here is a small, pure, named
 * function taking a focus + an effectiveness scalar and returning a
 * multiplier or bias, called from specific match.ts sites that already
 * exist (see each function's own doc comment for which one). match.ts
 * decides WHEN to call these and what real box-score numbers feed the
 * feedback classifier; this file only decides WHAT a given choice is worth.
 */

// --- Focus areas per role --------------------------------------------------------------------
// Tyler's own 5-option shape (Default / 3 named focuses / Demand They Dig
// Deeper), repeated identically for all 4 roles per his own instruction:
// "Repeat these constructions for the Forward Line coach, Midfield Coach
// and Ruck and Stoppage coach."

export const DEFENSIVE_LINE_FOCUSES = ["Default", "Focus on Spoiling", "Focus on Intercepts", "Focus on Tackling", "Demand They Dig Deeper"] as const;
export const FORWARD_LINE_FOCUSES = ["Default", "Focus on Leading", "Focus on Contested Marking", "Focus on Forward Pressure", "Demand They Dig Deeper"] as const;
export const MIDFIELD_LINE_FOCUSES = ["Default", "Focus on Clearances", "Focus on Contested Possession", "Focus on Ball Use", "Demand They Dig Deeper"] as const;
export const RUCK_LINE_FOCUSES = ["Default", "Focus on Winning the Tap", "Focus on Clean Taps", "Focus on Around-the-Ground Work", "Demand They Dig Deeper"] as const;

export type DefensiveLineFocus = (typeof DEFENSIVE_LINE_FOCUSES)[number];
export type ForwardLineFocus = (typeof FORWARD_LINE_FOCUSES)[number];
export type MidfieldLineFocus = (typeof MIDFIELD_LINE_FOCUSES)[number];
export type RuckLineFocus = (typeof RUCK_LINE_FOCUSES)[number];
/** The full set of focus strings across all 4 roles — same "broad union, runtime-validated" shape `tactics.ts`'s own `Tactic` type already uses rather than 4 separately-typed parameters everywhere. */
export type LineCoachFocus = DefensiveLineFocus | ForwardLineFocus | MidfieldLineFocus | RuckLineFocus;

export const DEMAND_THEY_DIG_DEEPER: LineCoachFocus = "Demand They Dig Deeper";
export const DEFAULT_LINE_FOCUS: LineCoachFocus = "Default";

const FOCUSES_BY_ROLE: Record<MatchDayCoachRole, readonly LineCoachFocus[]> = {
  "Defensive Line": DEFENSIVE_LINE_FOCUSES,
  "Forward Line": FORWARD_LINE_FOCUSES,
  Midfield: MIDFIELD_LINE_FOCUSES,
  "Ruck and Stoppage": RUCK_LINE_FOCUSES,
};

/** The 5 valid focus choices for a given match-day role — for the quarter-break panel's own option buttons. */
export function focusesFor(role: MatchDayCoachRole): readonly LineCoachFocus[] {
  return FOCUSES_BY_ROLE[role];
}

/** Every line starts a match on "Default" — same "index 0 is the confirmed default" convention as tactics.ts's own `defaultTacticFor`. */
export function defaultLineFocusFor(_role: MatchDayCoachRole): LineCoachFocus {
  return DEFAULT_LINE_FOCUS;
}

// --- Which player a line coach's direction actually reaches ----------------------------------

/**
 * A match-day line coach's direction applies to a player by that player's
 * OWN tactic group (`tacticGroupForSlot`, tactics.ts) — the same "gate on
 * who the player IS, not which side of a specific roll they're on" rule
 * every per-player `Tactic` in this game already follows. A total mapping:
 * every `TacticGroup` a player can resolve to has exactly one match-day
 * line coach who owns it. Small/Key forward split (`SmallForward`/
 * `KeyForward`) both map to "Forward Line" — Tyler asked for one Forward
 * Line coach, not two.
 */
export function matchDayRoleForTacticGroup(group: TacticGroup): MatchDayCoachRole {
  switch (group) {
    case "Defender":
      return "Defensive Line";
    case "KeyForward":
    case "SmallForward":
      return "Forward Line";
    case "Midfield":
      return "Midfield";
    case "Ruck":
      return "Ruck and Stoppage";
  }
}

// --- Coach assignment & effectiveness ---------------------------------------------------------
// Directly mirrors round 83's `scoutAccuracyFor`/`scoutWidthMultiplier` precedent (draft.ts): an
// assigned coach's own role rating (ovr/99) scales how much their direction actually moves the
// needle, an unassigned role gets a flat middling baseline — deliberately NOT floored at the
// baseline, so a genuinely bad hire can underdeliver relative to fielding no coach at all. See
// [[Match-Day Line Coach Direction]]'s own "Coach assignment and effectiveness" section.

export const DEFAULT_LINE_COACH_EFFECTIVENESS = 0.5;

/** `effectiveness` is expected pre-computed by the caller as `coach.ratings[role].ovr / 99` (match.ts has no `Coach`/coach-pool dependency — see this file's own top comment) — `undefined` (role unassigned) falls back to the flat baseline. */
export function lineCoachEffectivenessFor(effectiveness: number | undefined): number {
  return effectiveness ?? DEFAULT_LINE_COACH_EFFECTIVENESS;
}

/**
 * Scales a raw designed multiplier by coach effectiveness: 1x the designed
 * effect at the 0.5 baseline (no coach, or a perfectly average one), up to
 * 2x at effectiveness 1 (an elite coach's direction swings harder), down to
 * 0x at effectiveness 0 — deliberately not floored, same disclosed ethos as
 * round 83's scout accuracy. `effectiveness` is clamped to [0, 1] first so a
 * caller can never pass something wilder than a real `ovr/99` value through
 * unclamped.
 */
export function scaledBonus(rawMultiplier: number, effectiveness: number): number {
  const clipped = Math.max(0, Math.min(1, effectiveness));
  return 1 + (rawMultiplier - 1) * 2 * clipped;
}

/** Same contract as `scaledBonus` but for an additive probability shift rather than a multiplier (no "1 +" offset needed — 0 raw bias is already a no-op at any effectiveness). See `defensiveLineCleanMarkBias`. */
export function scaledBias(rawBias: number, effectiveness: number): number {
  const clipped = Math.max(0, Math.min(1, effectiveness));
  return rawBias * 2 * clipped;
}

// --- Shared magnitude constants ----------------------------------------------------------------
// One consistent shape repeated across all 4 roles, so the whole system reads as "the same
// mechanic 4 times" rather than 4 independently-tuned ones: Default nudges every one of a line's
// levers up a modest amount; a named focus pushes ITS OWN lever to the peak amount while its
// sibling levers dip slightly below Default ("higher boost to X, but less to other stats" — Tyler's
// own words, read as a genuine trade-off, not merely "no further bonus"); Demand They Dig Deeper
// pushes every lever up by a bigger-than-Default, smaller-than-peak amount, matching Tyler's own
// "a greater boost across all stats" framing, with no trade-off (the cost lives in the fatigue hook
// below instead, not in a same-tick stat penalty).

const DEFAULT_BONUS = 1.05;
const FOCUSED_BONUS = 1.18;
const UNFOCUSED_PENALTY = 0.97;
const DIG_DEEPER_BONUS = 1.12;
/** Midfield's own ball-use lever is deliberately smaller-magnitude than every other lever in this file — anchored to `tactics.ts`'s own real `carrierDisposalMultiplier` scale ("Attacking" is +8%), not this file's own bigger contest-win numbers, since a disposal-execution nudge and a contest-win-rate nudge aren't the same kind of effect. See [[Match-Day Line Coach Direction]]'s own Midfield section. */
const DEFAULT_BONUS_SMALL = 1.02;
const FOCUSED_BONUS_SMALL = 1.08;
const UNFOCUSED_PENALTY_SMALL = 0.99;

function leverMultiplier(focus: LineCoachFocus, focusedWhen: LineCoachFocus, effectiveness: number, small = false): number {
  const raw =
    focus === DEMAND_THEY_DIG_DEEPER
      ? DIG_DEEPER_BONUS
      : focus === focusedWhen
        ? small
          ? FOCUSED_BONUS_SMALL
          : FOCUSED_BONUS
        : focus === DEFAULT_LINE_FOCUS
          ? small
            ? DEFAULT_BONUS_SMALL
            : DEFAULT_BONUS
          : small
            ? UNFOCUSED_PENALTY_SMALL
            : UNFOCUSED_PENALTY;
  return scaledBonus(raw, effectiveness);
}

// --- Defensive Line ------------------------------------------------------------------------
// Tyler's own literal words: spoiling, marking, tackling, intercept marking. Round 55's own
// defensive-tagging mechanism already makes "a clean intercept mark" vs. "a spoil" ONE
// probabilistic split (P_DEFENSIVE_MARKING_WIN_IS_CLEAN_MARK) of a single defensive contest win —
// so spoiling/intercepts are the two ends of that one split, not two independent dials. 3 real
// levers: the shared defensive contest rating (spoils+marks+intercepts together, since all 3 come
// from the same underlying win), a bias on which of those two outcomes a win becomes, and tackling.

/**
 * Defensive marking/groundBall contest-rating boost for the defending rep —
 * see match.ts's `runContest`/`runMarkingContest` `defenderMult`, gated on
 * the defender's own tactic group resolving to "Defensive Line"
 * (`matchDayRoleForTacticGroup`). Deliberately NOT `leverMultiplier`'s
 * single-`focusedWhen` shape: BOTH "Focus on Spoiling" and "Focus on
 * Intercepts" push this same shared lever to its peak (they're both about
 * winning the underlying contest more often — see this file's own
 * Defensive Line section comment); only `defensiveLineCleanMarkBias` below
 * tells the two apart. "Focus on Tackling" takes this lever's "other stats"
 * dip instead.
 */
export function defensiveLineContestMultiplier(focus: DefensiveLineFocus, effectiveness: number): number {
  const raw =
    focus === DEMAND_THEY_DIG_DEEPER
      ? DIG_DEEPER_BONUS
      : focus === "Focus on Spoiling" || focus === "Focus on Intercepts"
        ? FOCUSED_BONUS
        : focus === DEFAULT_LINE_FOCUS
          ? DEFAULT_BONUS
          : UNFOCUSED_PENALTY; // Focus on Tackling — this lever takes the "other stats" dip
  return scaledBonus(raw, effectiveness);
}

/**
 * Shifts the win toward a clean intercept mark (positive) or a knocked-away spoil (negative) once
 * the Defensive Line has already won the underlying contest — see match.ts's
 * `P_DEFENSIVE_MARKING_WIN_IS_CLEAN_MARK` and `effectiveCleanMarkProbability` below. "Focus on
 * Spoiling" pushes negative (knock it away rather than risk the grab — a real "safety first"
 * coaching philosophy); "Focus on Intercepts" pushes positive (back yourself to hold the grab).
 * Every other focus applies no bias at all — this is a pure redirect, not a magnitude lever, so
 * Default/Tackling/Dig Deeper all leave the underlying 35% split alone.
 */
export function defensiveLineCleanMarkBias(focus: DefensiveLineFocus, effectiveness: number): number {
  const raw = focus === "Focus on Spoiling" ? -0.12 : focus === "Focus on Intercepts" ? 0.12 : 0;
  return scaledBias(raw, effectiveness);
}

/** Tackle-rating boost for a Defensive Line player — see match.ts's `runGeneralPlay` chaser/direct-tackle sites (`chaserRating`/`tacklerRating`), gated the same way as `defensiveLineContestMultiplier`. */
export function defensiveLineTackleMultiplier(focus: DefensiveLineFocus, effectiveness: number): number {
  return leverMultiplier(focus, "Focus on Tackling", effectiveness);
}

/** Applies a clean-mark bias to the base probability, clamped to a valid [0, 1] range — see `defensiveLineCleanMarkBias`. */
export function effectiveCleanMarkProbability(base: number, bias: number): number {
  return Math.max(0, Math.min(1, base + bias));
}

// --- Forward Line ----------------------------------------------------------------------------
// Natural analogue per Tyler's own "repeat this construction" instruction: leading (markLead
// attacker rating), contested marking (markContested attacker rating), forward pressure (tackle
// rating specifically while inForwardHalf). Deliberately does NOT touch shot/set-shot accuracy
// (runShot's own real-geometry-tuned formula) — a line coach's direction is about getting the ball
// to the right players in the right ways, not a skill-execution buff on an already-tuned system.

/** markLead attacker-rating boost — see match.ts's `runContest` `attackerMult` (markLead branch), gated on the attacking rep's own tactic group resolving to "Forward Line". */
export function forwardLineMarkLeadMultiplier(focus: ForwardLineFocus, effectiveness: number): number {
  return leverMultiplier(focus, "Focus on Leading", effectiveness);
}

/** markContested attacker-rating boost — see match.ts's `runContest`/`runMarkingContest` `attackerMult`, same Forward Line gating. */
export function forwardLineMarkContestedMultiplier(focus: ForwardLineFocus, effectiveness: number): number {
  return leverMultiplier(focus, "Focus on Contested Marking", effectiveness);
}

/** Tackle-rating boost for a Forward Line player specifically while they're the one applying the tackle in the forward half — forcing turnovers up the ground, mirroring the shape `tackleDefenderRatingMultiplier`'s own "High Press" tactic effect already uses. See match.ts's `runGeneralPlay` chaser/direct-tackle sites. */
export function forwardLineForwardPressureTackleMultiplier(focus: ForwardLineFocus, effectiveness: number): number {
  return leverMultiplier(focus, "Focus on Forward Pressure", effectiveness);
}

// --- Midfield ----------------------------------------------------------------------------------
// Clearances (runClearance's team-wide rating), contested possession (groundBall-type contest
// rating for midfielders specifically), ball use (disposal-execution — deliberately the smaller-
// magnitude lever, see this file's own DEFAULT_BONUS_SMALL comment).

/** Clearance-rating boost for a Midfield player — see match.ts's `runClearance` `homeClearMult`/`awayClearMult`, gated on the clearance rep's own tactic group resolving to "Midfield". */
export function midfieldClearanceMultiplier(focus: MidfieldLineFocus, effectiveness: number): number {
  return leverMultiplier(focus, "Focus on Clearances", effectiveness);
}

/** groundBall contest-rating boost for a Midfield player — see match.ts's `runContest` `attackerMult`/`defenderMult` (groundBall branch), same Midfield gating. */
export function midfieldContestedPossessionMultiplier(focus: MidfieldLineFocus, effectiveness: number): number {
  return leverMultiplier(focus, "Focus on Contested Possession", effectiveness);
}

/** Disposal-rating boost for a Midfield ball-carrier — see match.ts's `runGeneralPlay` `disposalRating`, same Midfield gating. Small-magnitude — see this file's own DEFAULT_BONUS_SMALL comment. */
export function midfieldDisposalMultiplier(focus: MidfieldLineFocus, effectiveness: number): number {
  return leverMultiplier(focus, "Focus on Ball Use", effectiveness, true);
}

// --- Ruck and Stoppage ---------------------------------------------------------------------
// `resolveRuckTap`'s two INDEPENDENT levers map directly onto Tyler's own "winning the tap" vs.
// "clean taps" split: homeRuckMult/awayRuckMult (raw hitout win-rate) vs. the separate
// tapExecutionRating roll deciding tapWentToHand. Around-the-ground aerial work is a third,
// genuinely separate lever (markContested boost gated to Ruck-group players away from a stoppage,
// matching the existing "Aerial Target" tactic's own "+15%... around the ground" framing) —
// deliberately does NOT also touch Midfield's own clearance lever (Ruck and Stoppage's name
// notwithstanding): double-dipping two coaches' bonuses onto the same runClearance multiplier
// stack would make the two coaches' contributions unverifiable against each other.

/** Raw hitout win-rate boost — see match.ts's `resolveRuckTap` `homeRuckMult`/`awayRuckMult`. */
export function ruckHitoutFocusMultiplier(focus: RuckLineFocus, effectiveness: number): number {
  return leverMultiplier(focus, "Focus on Winning the Tap", effectiveness);
}

/** Tap-execution-rating boost — see match.ts's `resolveRuckTap` `tapExecutionRating` (the separate roll deciding `tapWentToHand`, independent of who wins the hitout itself). */
export function ruckTapExecutionMultiplier(focus: RuckLineFocus, effectiveness: number): number {
  return leverMultiplier(focus, "Focus on Clean Taps", effectiveness);
}

/** markContested contest-rating boost for a Ruck-group player away from a stoppage — see match.ts's `runContest`/`runMarkingContest`, gated on the rep's own tactic group resolving to "Ruck and Stoppage". */
export function ruckAerialFocusMultiplier(focus: RuckLineFocus, effectiveness: number): number {
  return leverMultiplier(focus, "Focus on Around-the-Ground Work", effectiveness);
}

// --- "Demand They Dig Deeper" fatigue risk ------------------------------------------------------
// Tyler's own words: "potential to trigger disgruntled players." engine/disgruntlement.ts is a
// SEASON-ROUND-level mechanic with no connection point to an individual Match Day exhibition game
// (see [[Match-Day Line Coach Direction]]'s own disclosed scope note) — building a hook into it
// that nothing can actually call yet would be speculative plumbing, not a real feature. Instead,
// the risk is a real, immediate, in-match consequence reusing round 48's own fitness meter: playing
// at a higher intensity costs a line's players more fitness, felt the same match.

/** Extra tick-by-tick fitness drain for a player currently under "Demand They Dig Deeper" — see match.ts's `stepFitnessSide`. 1 (no extra drain) for every other focus. */
export function digDeeperFitnessDrainMultiplier(focus: LineCoachFocus): number {
  return focus === DEMAND_THEY_DIG_DEEPER ? 1.6 : 1;
}

// --- Feedback classifier -------------------------------------------------------------------------
// Tyler's own 4 examples, read as a deterministic classifier over a real win-rate rather than
// invented flavour text — see match.ts's own `lineFeedbackFor` for how that win-rate is actually
// computed (this file stays match.ts-free, so it just classifies a plain 0-1 number here). 2 of
// Tyler's 4 example sentences ("Meeting all our key metrics" / "Boys are happy with their
// performance") are generic enough to reuse verbatim for every line at the neutral/positive tiers;
// the other 2 ("Allowing too many contested marks" / "Losing contested possession") fit Defensive
// Line and Midfield specifically, so they're placed there; Forward Line and Ruck and Stoppage get
// new negative lines in the same coach-speak style, disclosed here as this round's own addition
// rather than pretended to be Tyler's own words.

export const LINE_FEEDBACK_LOW_THRESHOLD = 0.4;
export const LINE_FEEDBACK_HIGH_THRESHOLD = 0.6;

const LOW_FEEDBACK: Record<MatchDayCoachRole, string> = {
  "Defensive Line": "Allowing too many contested marks.",
  "Forward Line": "Not winning enough of our own ball inside 50.",
  Midfield: "Losing contested possession.",
  "Ruck and Stoppage": "Getting beaten around the stoppages.",
};
const MID_FEEDBACK = "Meeting all our key metrics.";
const HIGH_FEEDBACK = "Boys are happy with their performance.";

/** One of Tyler's own 4 example feedback sentences (or this round's same-styled additions — see this section's own comment), banded off a real 0-1 win-rate match.ts computes from that line's own already-tracked contest stats. */
export function lineCoachFeedback(role: MatchDayCoachRole, winRate: number): string {
  if (winRate < LINE_FEEDBACK_LOW_THRESHOLD) return LOW_FEEDBACK[role];
  if (winRate > LINE_FEEDBACK_HIGH_THRESHOLD) return HIGH_FEEDBACK;
  return MID_FEEDBACK;
}
