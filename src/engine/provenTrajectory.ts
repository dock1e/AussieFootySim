import type { Player } from "../types/player.ts";
import { HONOUR_WEIGHTS } from "./prestige.ts";
import { draftHistoryFor } from "../data/realDraftHistory.ts";
import { ovrRawComposite } from "./progression.ts";

/**
 * Round C148 — [[End-of-2026 Player Database Refresh]] deliverable 3: "a new, objective 'proven
 * trajectory' rule (not a manual override) that reduces games-played shrinkage... for a young player
 * who has ALREADY shown enough real proof." Tyler named four real players who should qualify without
 * being hard-coded (Sam Darcy, Nick Watson, Harley Reid, Jason Horne-Francis) — this file is the
 * general, checkable rule, verified against all four (see `scripts/verify_roundC148_scratch.ts`),
 * not a name list.
 *
 * **The two-part objective test, both real and checkable from data already in this codebase**:
 *
 * 1. **Age <= `MAX_QUALIFYING_AGE` (23)**. Widened from an initial 22 after checking the real data:
 *    Sam Darcy and Jason Horne-Francis are both real Age 23 (2021 draftees), not 22 — 22 would have
 *    silently excluded 2 of the 4 named cases despite them being exactly the "proven-early" profile
 *    Tyler described. 23 is still a genuinely young cutoff (5th-6th real AFL season at the absolute
 *    latest for a National Draft pick) — not a loophole for an established veteran.
 * 2. **At least one REAL, NAMED, structured honour on file** (`draftHistoryFor`'s own `awards` field,
 *    the exact same source `prestige.ts`'s `honoursScoreFor` reads — any tag `HONOUR_WEIGHTS`
 *    recognises: AA/AA40/Rising Star/B&F/AFLPA-1st/etc., not a free-text scouting-report read) —
 *    Reid's real `AFLPA 1st: 2024`, Watson's real `AA: 2026`, Horne-Francis's real `AA40: 2024,
 *    2026`, Darcy's real `AA40: 2025` all satisfy this directly. Since the player is already
 *    confirmed <= age 23, ANY honour on file was by construction earned at <= 23 — no separate
 *    per-honour age check is needed. **AND**
 * 3. **Current real-season raw stat composite already at/above `MIN_QUALIFYING_Z` z-score** against
 *    the population — computed from the player's PRE-shrinkage `ovrRawComposite` (the fresh,
 *    real-stat-derived attribute set `AttributeZScorer` just produced, before
 *    `shrinkAttributesForSmallSample` pulls it toward the archetype mean) against the SAME
 *    `populationStats` `recomputeOVRWithShrinkage` already computes once up front. This is the "real,
 *    checkable proof already exists in this SEASON's own numbers" half of the test — a player who
 *    only has pedigree/an old honour but a genuinely poor current stat line does NOT qualify.
 *
 * **Why age+honour+current-form, not just "young + high draft pick"**: a raw high draft pick alone
 * (`draftPedigreeBonusFor` already covers that, separately, in `prestige.ts`) says "this player WAS
 * rated highly on debut," not "this player has since PROVEN it" — Tyler's own ask was specifically
 * for players who "have shown enough real, checkable proof ALREADY," i.e. a real honour actually won
 * since debuting, not just draft-day promise. A future similar case (any young player who wins a real
 * honour and is playing at an elite current level) is caught by this same objective test with zero
 * name-list maintenance.
 *
 * **The effect when a player qualifies** (`applyFairnessPass` in `ratingGeneration.ts`): their real
 * career games are treated as `careerGames + PROVEN_TRAJECTORY_GAMES_BONUS` for BOTH
 * `shrinkAttributesForSmallSample` and `blendedPotentialFor`'s shrinkage-weight calculation — less
 * pulled toward the archetype-mean prior (their own real, honour-and-elite-form-backed attributes are
 * trusted more), and `POT` leans more on that now-more-trusted attribute-driven upside rather than
 * needing to lean as hard on the separate draft-capital-only upside path. `PROVEN_TRAJECTORY_GAMES_BONUS`
 * (60) roughly doubles `shrinkageWeight` for a player debuting around the `SHRINKAGE_K` (30) mark —
 * a deliberate, disclosed magnitude choice tuned so all 4 named players' resulting `POT` reads
 * defensibly close to their `OVR` (see the verify script's own before/after report), not derived from
 * a first-principles formula.
 */
export const MAX_QUALIFYING_AGE = 23;
export const MIN_QUALIFYING_Z = 0.1;
export const PROVEN_TRAJECTORY_GAMES_BONUS = 60;

/** Does this real player have at least one honour type `prestige.ts`'s `HONOUR_WEIGHTS` recognises, anywhere in their `realDraftHistory.ts` rows? `false` for a player with no real draft history row at all, or one whose `awards` field is empty/unrecognised. */
function hasAnyRecognisedHonour(realFullName: string | undefined): boolean {
  if (!realFullName) return false;
  const rows = draftHistoryFor(realFullName);
  for (const row of rows) {
    if (!row.awards) continue;
    for (const clause of row.awards.split(";")) {
      const label = clause.split(":")[0]?.trim();
      if (label && (HONOUR_WEIGHTS[label] ?? 0) > 0) return true;
    }
  }
  return false;
}

/**
 * The full 3-part objective test (see this file's own doc comment). `p` must carry its FRESH,
 * pre-shrinkage attributes (the state `applyFairnessPass` has `p` in before it calls
 * `shrinkAttributesForSmallSample`) — this function does not shrink or mutate anything itself, it
 * only reads `p` to decide whether the caller should apply the games bonus.
 */
export function qualifiesForProvenTrajectory(p: Player, populationStats: { mean: number; stdDev: number }): boolean {
  if (p.Age > MAX_QUALIFYING_AGE) return false;
  if (!hasAnyRecognisedHonour(p.realFullName)) return false;
  if (populationStats.stdDev === 0) return false;
  const z = (ovrRawComposite(p) - populationStats.mean) / populationStats.stdDev;
  return z >= MIN_QUALIFYING_Z;
}
