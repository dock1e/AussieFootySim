import type { Player, RatedAttribute } from "../types/player.ts";
import { RATED_ATTRIBUTES } from "../types/player.ts";
import type { Archetype } from "../types/archetype.ts";
import { ARCHETYPES, ARCHETYPE_PRIMARY_ATTRIBUTES } from "../types/archetype.ts";
import { ARCHETYPE_FRAME, recomputeOVR } from "./progression.ts";
import { DRAFT_POOL_TEAM } from "./draft.ts";

/**
 * Position Switch — Engine.md "Position switch / redeployment" +
 * User Interface.md "Position Switch Review (modal)".
 *
 * The vault is thin here (two short paragraphs, no formulas) and Engine.md
 * hedges its own suggestion as "likely a general check-pass run once per
 * off-season... worth modelling as something concrete and inspectable...
 * rather than a random event." Everything numeric below is this file's own
 * disclosed construction, built the same way Combine's test constants and
 * Contracts/Trade's calibration numbers were: reuse exact existing formulas
 * wherever one exists, invent the smallest possible new number otherwise,
 * and calibrate that number against the real 751-player pool rather than
 * guess blind (see scripts/verify_position_switch_scratch.ts).
 *
 * **Trigger — a same-frame fit-score comparison, not a new formula.**
 * `archetypeFitScore` reuses `recomputeOVR`'s own `rawComposite` shape
 * verbatim (mean of the 20 `RATED_ATTRIBUTES`, x3-weighted for whichever are
 * `ARCHETYPE_PRIMARY_ATTRIBUTES` of the archetype being scored) — the same
 * table OVR itself is built from, just evaluated once per candidate
 * archetype instead of only the player's current one. A player is flagged
 * when their best-fitting *other* archetype beats their current one by more
 * than `SWITCH_MARGIN`. Deliberately NOT z-scored against the population
 * (unlike OVR) — this is a same-player, cross-archetype comparison, not a
 * cross-player ranking, so a raw composite is the right shape.
 *
 * **Same-frame only (Tall<->Tall, Mid<->Mid).** `ARCHETYPE_FRAME`
 * (progression.ts, exported for this file — previously private, since
 * draft.ts's own use of the equivalent table is purely cosmetic and didn't
 * need the real export) grounds this in the same avg_height_cm split
 * progression.ts already uses for potential ceilings. A small Pressure
 * Forward physically becoming a Ruck isn't a position switch, it's a
 * different player — and keeping the frame fixed means `POT`'s underlying
 * ceiling basis (`potentialTall`/`potentialMid`) never changes across a
 * switch either, so "not directly comparable" (User Interface.md's own
 * escape hatch for a cross-frame comparison) never needs to fire here.
 *
 * **OVR** is recomputed via the exact same "merge into the full live
 * population, keep only the one changed player's slice, discard everyone
 * else's" pattern draft.ts's `generateProspectPool` already established for
 * exactly this reason: `recomputeOVR` is a population z-score, so computing
 * it needs the real population as context, but nobody else's stored OVR
 * should drift by even ±1 as a side effect of one player's switch.
 *
 * **POT is left untouched** — the same disclosed gap `runOffSeason`'s own
 * doc comment already carries: the real blended POT formula's
 * `draft_capital_score` term only ever existed in the offline
 * data-generation script, not as reusable app code, so recomputing POT here
 * with only part of its real formula would silently diverge from what's
 * documented. Simpler and more honest to leave it as-is.
 */

/**
 * Calibrated against the real 751-player pool (scripts/verify_position_switch_scratch.ts)
 * before shipping, not guessed blind. A sweep from 0.03-0.20 showed a steep
 * drop-off: 0.08 (an initial guess) left only 2 candidates league-wide and 0
 * for a sampled single club — too sparse for a tab meant to be worth opening
 * most off-seasons. 0.045 lands at 35/751 (4.7%) league-wide, ~1.9 candidates
 * per club on average, with only 3 of 18 clubs reading empty in a given
 * off-season — frequent enough to be a real, present feature; still rare
 * enough per player to read as "occasional, considered" rather than routine
 * churn, matching Engine.md's own "rather than a random event" framing.
 */
export const SWITCH_MARGIN = 0.045;

/** Human-readable labels for the `archetype_reason` string below — a disclosed duplicate of the same small local label map Draft.tsx/PlayerDetailModal.tsx each already keep their own copy of, for the identical reason those give: engine/ stays framework-free, components/ isn't importable from here. */
const ATTR_LABEL: Record<RatedAttribute, string> = {
  manMarking: "Man Marking",
  verticalLeap: "Vertical Leap",
  tenacity: "Tenacity",
  skill: "Skill",
  agility: "Agility",
  courage: "Courage",
  aggression: "Aggression",
  xFactor: "X-Factor",
  strengthGroundLevel: "Ground-Level Strength",
  strengthOverhead: "Overhead Strength",
  strengthManOnMan: "Man-on-Man Strength",
  acceleration: "Acceleration",
  speed: "Speed",
  endurance: "Endurance",
  confidence: "Confidence",
  readPlay: "Read of Play",
  consistancy: "Consistency",
  positioning: "Positioning",
  copeWithPressure: "Coping Under Pressure",
  kickMaxDistance: "Kicking Distance",
};

/**
 * `recomputeOVR`'s own `rawComposite`, exported here under its own name so
 * it can be evaluated against archetypes other than the player's current
 * one — `recomputeOVR` itself always reads `p.archetype`, never a
 * hypothetical alternative, so it can't be reused directly for this.
 */
export function archetypeFitScore(p: Player, archetype: Archetype): number {
  const primary = new Set(ARCHETYPE_PRIMARY_ATTRIBUTES[archetype]);
  let weightedSum = 0;
  let weightTotal = 0;
  for (const attr of RATED_ATTRIBUTES) {
    const weight = primary.has(attr) ? 3 : 1;
    weightedSum += p[attr] * weight;
    weightTotal += weight;
  }
  return weightedSum / weightTotal;
}

/** The proposed archetype's own top 3 primary attributes by this player's raw rating — Engine.md's own example names "the specific attributes that justify the read" (Endurance, Decision, Contested, Speed in its illustration; this file grounds the same idea in the real, exported `ARCHETYPE_PRIMARY_ATTRIBUTES` table rather than inventing a parallel one). */
export function justificationFor(p: Player, archetype: Archetype): RatedAttribute[] {
  return [...ARCHETYPE_PRIMARY_ATTRIBUTES[archetype]].sort((a, b) => p[b] - p[a]).slice(0, 3);
}

export interface SwitchCandidate {
  player: Player;
  currentArchetype: Archetype;
  proposedArchetype: Archetype;
  /** (proposedFit - currentFit) / currentFit — must be >= SWITCH_MARGIN for a candidate to exist at all. */
  marginPct: number;
  currentOvr: number;
  /** OVR if this switch were applied right now — computed via the merge-and-slice pattern described in this file's doc comment; nothing else's OVR is touched to produce this preview. */
  previewOvr: number;
  ovrDelta: number;
  justification: RatedAttribute[];
}

/** Every same-frame archetype other than `current` — always 6 candidates (Tall has 5 archetypes, Mid has 9; see ARCHETYPE_FRAME), so this never returns empty. */
function otherSameFrameArchetypes(current: Archetype): Archetype[] {
  const frame = ARCHETYPE_FRAME[current];
  return ARCHETYPES.filter((a) => a !== current && ARCHETYPE_FRAME[a] === frame);
}

function previewOvrAfterSwitch(playerId: number, newArchetype: Archetype, fullPopulation: readonly Player[]): number {
  const merged = fullPopulation.map((p) => (p.PlayerID === playerId ? { ...p, archetype: newArchetype } : p));
  const recomputed = recomputeOVR(merged);
  return recomputed.find((p) => p.PlayerID === playerId)!.OVR;
}

/**
 * Evaluates a single player. `fullPopulation` should be the whole live pool
 * (`ALL_PLAYERS`) — used only as `recomputeOVR`'s z-score reference for the
 * preview OVR, exactly like `generateProspectPool`'s own `existingPlayers`
 * parameter. Returns null if no same-frame archetype beats the player's
 * current one by at least `SWITCH_MARGIN`.
 */
export function evaluateSwitchCandidate(p: Player, fullPopulation: readonly Player[]): SwitchCandidate | null {
  const current = p.archetype as Archetype;
  const currentFit = archetypeFitScore(p, current);

  let best: { archetype: Archetype; fit: number } | null = null;
  for (const a of otherSameFrameArchetypes(current)) {
    const fit = archetypeFitScore(p, a);
    if (!best || fit > best.fit) best = { archetype: a, fit };
  }
  if (!best) return null; // unreachable (otherSameFrameArchetypes always returns >=1), guarded anyway

  const marginPct = (best.fit - currentFit) / currentFit;
  if (marginPct < SWITCH_MARGIN) return null;

  const previewOvr = previewOvrAfterSwitch(p.PlayerID, best.archetype, fullPopulation);
  return {
    player: p,
    currentArchetype: current,
    proposedArchetype: best.archetype,
    marginPct,
    currentOvr: p.OVR,
    previewOvr,
    ovrDelta: previewOvr - p.OVR,
    justification: justificationFor(p, best.archetype),
  };
}

/**
 * Scans `candidatePool` (the roster to check — typically `myClub`'s own
 * non-delisted players, since Engine.md frames this as something "the
 * coach" reviews and decides, not something rival clubs also do; see
 * useSaveStore.ts's `findMyPositionSwitchCandidates` action, and ROADMAP.md's
 * disclosed asymmetry list for the AI-club-side gap this leaves). Every
 * player's OVR preview is still z-scored against the real full
 * `fullPopulation`, regardless of which smaller pool is being scanned.
 * Sorted by margin, best switch first.
 */
export function findSwitchCandidates(candidatePool: readonly Player[], fullPopulation: readonly Player[]): SwitchCandidate[] {
  const eligible = candidatePool.filter((p) => !p.delisted && p.Team !== DRAFT_POOL_TEAM);
  const results: SwitchCandidate[] = [];
  for (const p of eligible) {
    const c = evaluateSwitchCandidate(p, fullPopulation);
    if (c) results.push(c);
  }
  return results.sort((a, b) => b.marginPct - a.marginPct);
}

function buildReason(currentArchetype: Archetype, proposedArchetype: Archetype, justification: RatedAttribute[]): string {
  const attrs = justification.map((a) => ATTR_LABEL[a]).join(", ");
  return `Position Switch: moved from ${currentArchetype} to ${proposedArchetype} — ${attrs} now profile a better fit.`;
}

/**
 * Applies a switch to `playerId`: new archetype, a fresh `archetype_reason`,
 * OVR recomputed for real via the exact same merge-into-the-full-population,
 * keep-only-this-one-player's-slice pattern `previewOvrAfterSwitch` above
 * already uses for the preview (so the applied OVR always matches what the
 * UI already showed) — and, per this file's doc comment, everyone else's
 * slice from that same `recomputeOVR` call is discarded, not written back,
 * so no other player's stored OVR drifts even by ±1 as a side effect.
 * `POT` is deliberately untouched (see this file's doc comment). Takes
 * primitives rather than a `SwitchCandidate` object so the caller always
 * mutates the *current* record, not a possibly-stale snapshot from an
 * earlier scan — mirrors `reSign`/`delist`'s own single-player-in,
 * single-player-out shape in engine/contracts.ts. Returns null (rather than
 * mutating anything) if `playerId` isn't found.
 */
export function applySwitch(playerId: number, newArchetype: Archetype, fullPopulation: readonly Player[]): Player | null {
  const before = fullPopulation.find((p) => p.PlayerID === playerId);
  if (!before) return null;
  const reason = buildReason(before.archetype as Archetype, newArchetype, justificationFor(before, newArchetype));
  const merged = fullPopulation.map((p) => (p.PlayerID === playerId ? { ...p, archetype: newArchetype, archetype_reason: reason } : p));
  const recomputed = recomputeOVR(merged);
  return recomputed.find((p) => p.PlayerID === playerId)!;
}
