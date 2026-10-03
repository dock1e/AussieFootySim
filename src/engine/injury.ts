import type { Player } from "../types/player.ts";
import type { Rng } from "./rng.ts";
import type { AFLStadium } from "../data/stadiums.ts";
import { CONCUSSION_PRONE_IDS, SOFT_TISSUE_PRONE_IDS } from "../data/injuryProneness.ts";

/**
 * Oct 2026 — [[Injuries]]. Tyler's brief:
 *
 * - Two kinds. **Soft tissue** (hamstrings, calves...) is "repeatable or influenced by fatigue".
 *   **Contact** injuries are "bad luck, not influenced by fatigue or that player's injury history",
 *   with "a small bias where wet weather games are more likely to have contact injuries than dry".
 * - Some players are **injury prone** (more soft tissue injuries) and some **concussion prone**.
 *   The named real examples live in `data/injuryProneness.ts`.
 * - Club facilities "decrease the risk of soft tissue injuries as well as decrease the recovery
 *   time" for both kinds, except that "concussion protocol means the player will always miss a
 *   week, even if the facilities are maxed".
 *
 * Where each piece runs:
 * - In a match (`match.ts`), soft tissue is rolled every on-ground tick, scaled by fatigue
 *   (`fatigue.ts`'s `injuryRiskMultiplier`), proneness, recent soft-tissue history and the club's
 *   Sports Science level. Contact is rolled at contact moments (tackles, contested marks and
 *   possessions, ruck contests), scaled only by wet weather. An injured player leaves the ground for
 *   the rest of the match and a bench player comes on in his slot.
 * - In the season (`season.ts`), each injury gets a number of matches missed (Recovery Centre and
 *   Medical Suite shorten it). The player is unavailable until he's served it, and every club's 23 is
 *   patched round by round to cover the gap.
 *
 * Every rate below is calibrated against real AFL injury-survey shape (roughly 40 games-missing
 * injuries per club per season, about half of them soft tissue, hamstrings the single most common) and
 * checked in a season-scale simulation. Each is a disclosed starting point, not a fitted figure.
 */

export type InjuryKind = "softTissue" | "contact";

export interface InjuryType {
  id: string;
  label: string;
  kind: InjuryKind;
  /** Relative frequency within its kind. */
  weight: number;
  /** Matches missed before facilities: minimum, most likely, maximum (a triangular roll). */
  weeks: readonly [number, number, number];
  concussion?: boolean;
  /**
   * The only kind that can run into next season (Tyler: ACLs, "typically around 10 month injuries";
   * everyone else starts the new season fit). Its `weeks` are calendar weeks, and facilities shorten
   * it by at most `LONG_TERM_MIN_RECOVERY`.
   */
  longTerm?: boolean;
}

/** Weeks between the Grand Final and Round 1 (late September to mid-March). */
export const OFFSEASON_WEEKS = 24;
/** Facilities can't take more than 15% off a reconstruction. */
export const LONG_TERM_MIN_RECOVERY = 0.85;

export const INJURY_TYPES: readonly InjuryType[] = [
  // Soft tissue — the hamstring is the AFL's most common injury by a distance.
  { id: "hamstring", label: "Hamstring strain", kind: "softTissue", weight: 36, weeks: [1, 3, 6] },
  { id: "calf", label: "Calf strain", kind: "softTissue", weight: 22, weeks: [1, 2, 5] },
  { id: "groin", label: "Groin strain", kind: "softTissue", weight: 12, weeks: [1, 2, 5] },
  { id: "quad", label: "Quad strain", kind: "softTissue", weight: 10, weeks: [1, 2, 4] },
  { id: "hipFlexor", label: "Hip flexor strain", kind: "softTissue", weight: 8, weeks: [1, 1, 3] },
  { id: "back", label: "Back spasms", kind: "softTissue", weight: 8, weeks: [1, 1, 3] },
  { id: "achilles", label: "Achilles soreness", kind: "softTissue", weight: 4, weeks: [1, 2, 4] },
  // Contact.
  { id: "concussion", label: "Concussion", kind: "contact", weight: 24, weeks: [1, 1, 3], concussion: true },
  { id: "ankle", label: "Ankle sprain", kind: "contact", weight: 20, weeks: [1, 2, 5] },
  { id: "knee", label: "Knee (medial ligament)", kind: "contact", weight: 9, weeks: [3, 4, 7] },
  { id: "acl", label: "Knee (ACL)", kind: "contact", weight: 2, weeks: [38, 43, 50], longTerm: true }, // ~10 months
  { id: "shoulder", label: "Shoulder (AC joint)", kind: "contact", weight: 10, weeks: [2, 4, 8] },
  { id: "hand", label: "Broken hand", kind: "contact", weight: 10, weeks: [2, 3, 5] },
  { id: "ribs", label: "Rib cartilage", kind: "contact", weight: 8, weeks: [1, 2, 4] },
  { id: "corked", label: "Corked thigh", kind: "contact", weight: 13, weeks: [1, 1, 2] },
  { id: "jaw", label: "Fractured jaw", kind: "contact", weight: 4, weeks: [3, 4, 6] },
];

const TYPE_BY_ID = new Map(INJURY_TYPES.map((t) => [t.id, t]));

export function injuryType(id: string): InjuryType | undefined {
  return TYPE_BY_ID.get(id);
}

// --- In-match rates -----------------------------------------------------------------------------------

/** Chance per on-ground tick, for a fresh player of ordinary proneness, of a soft tissue injury. ~0.5 per team per match. */
export const SOFT_TISSUE_RATE_PER_TICK = 3.0e-5;
/** Chance per contact moment (see `CONTACT_STATS`) that someone in it is hurt. ~0.4 per team per match. */
export const CONTACT_RATE_PER_EVENT = 2.6e-3;
/** At most this many injuries per side in one match — see `queueInjury` in match.ts. */
export const MAX_INJURIES_PER_TEAM_PER_MATCH = 3;
/** Tyler's "small bias" for wet games. */
export const WET_CONTACT_MULTIPLIER = 1.3;
/** Box-score stats that mark a body-on-body moment. */
export const CONTACT_STATS: ReadonlySet<string> = new Set(["tackles", "contestedMarks", "contestedPoss", "hitouts"]);

/** A named soft-tissue-prone player gets this many times the risk. */
export const SOFT_TISSUE_PRONE_MULTIPLIER = 2.2;
/** A named concussion-prone player's contact injuries are this many times as likely to be a concussion. */
export const CONCUSSION_PRONE_MULTIPLIER = 3;
/** Soft tissue only: a player back from a soft tissue injury within this many rounds is at extra risk. */
export const RECURRENCE_WINDOW_ROUNDS = 6;
export const RECURRENCE_MULTIPLIER = 1.6;

export function isSoftTissueProne(p: Player): boolean {
  return p.softTissueProne ?? SOFT_TISSUE_PRONE_IDS.has(p.PlayerID);
}

export function isConcussionProne(p: Player): boolean {
  return p.concussionProne ?? CONCUSSION_PRONE_IDS.has(p.PlayerID);
}

/**
 * A player's own soft-tissue risk multiplier. `injuryTend` (0-100, modelled from games missed — see
 * Schema.md) gives a mild 0.85x-1.3x spread across the whole league so not every player is identical;
 * the named prone players carry the big multiplier on top.
 */
export function softTissueProneness(p: Player): number {
  const tend = Math.max(0, Math.min(100, p.injuryTend ?? 25));
  return (0.85 + 0.45 * (tend / 100)) * (isSoftTissueProne(p) ? SOFT_TISSUE_PRONE_MULTIPLIER : 1);
}

/** Picks which injury it is. A concussion-prone player's contact injury is weighted toward concussion. */
export function pickInjuryType(kind: InjuryKind, rng: Rng, concussionProne = false): InjuryType {
  const pool = INJURY_TYPES.filter((t) => t.kind === kind);
  const w = (t: InjuryType) => t.weight * (t.concussion && concussionProne ? CONCUSSION_PRONE_MULTIPLIER : 1);
  const total = pool.reduce((s, t) => s + w(t), 0);
  let r = rng() * total;
  for (const t of pool) {
    r -= w(t);
    if (r <= 0) return t;
  }
  return pool[pool.length - 1];
}

// --- Weather ------------------------------------------------------------------------------------------

/** Share of open-air matches played in the wet. A roofed venue (Marvel) is always dry. */
export const WET_MATCH_CHANCE = 0.2;

/** Deterministic per match: the same seed and venue always give the same weather. */
export function isWetMatch(seed: number, stadium: AFLStadium | undefined): boolean {
  if (stadium?.architecture.hasRetractableRoof) return false;
  let h = (seed ^ 0x5bd1e995) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296 < WET_MATCH_CHANCE;
}

// --- Club medical (facilities) --------------------------------------------------------------------------

export interface ClubMedical {
  sportsScience: number;
  recovery: number;
  medical: number;
}

export const NO_MEDICAL: ClubMedical = { sportsScience: 0, recovery: 0, medical: 0 };

/** Sports Science & GPS: −10% soft tissue risk per level (−30% at the max of 3). */
export function sportsScienceRiskMultiplier(m: ClubMedical): number {
  return 1 - 0.1 * m.sportsScience;
}

/** Recovery Centre and Medical Suite: −7% matches missed per level each (−42% with both maxed). */
export function recoveryTimeMultiplier(m: ClubMedical): number {
  return Math.max(0.5, 1 - 0.07 * m.recovery - 0.07 * m.medical);
}

/** Matches missed for `type`, after facilities. Never below 1 — a concussion always costs the week. */
export function rollWeeksOut(type: InjuryType, rng: Rng, m: ClubMedical = NO_MEDICAL): number {
  const [lo, mode, hi] = type.weeks;
  const u = rng();
  const c = hi === lo ? 0 : (mode - lo) / (hi - lo);
  const raw = u < c ? lo + Math.sqrt(u * (hi - lo) * (mode - lo)) : hi - Math.sqrt((1 - u) * (hi - lo) * (hi - mode));
  const mult = type.longTerm ? Math.max(LONG_TERM_MIN_RECOVERY, recoveryTimeMultiplier(m)) : recoveryTimeMultiplier(m);
  return Math.max(1, Math.round(raw * mult));
}

/**
 * What carries from a finished season into the next: long-term (ACL) injuries only, less the
 * off-season. Everyone else starts the new season fit. PlayerID -> injury.
 */
export function injuriesCarriedOver(injuries: ReadonlyMap<number, ActiveInjury> | undefined): Map<number, { typeId: string; weeksRemaining: number }> {
  const out = new Map<number, { typeId: string; weeksRemaining: number }>();
  for (const [id, i] of injuries ?? []) {
    if (!injuryType(i.typeId)?.longTerm) continue;
    const left = i.weeksRemaining - OFFSEASON_WEEKS;
    if (left > 0) out.set(id, { typeId: i.typeId, weeksRemaining: left });
  }
  return out;
}

// --- Season state ---------------------------------------------------------------------------------------

export interface ActiveInjury {
  playerId: number;
  clubId: number;
  typeId: string;
  kind: InjuryKind;
  /** The round it happened in (finals count on from the last home-and-away round). */
  round: number;
  /** Matches he still has to miss. Removed once it reaches 0. */
  weeksRemaining: number;
  /** Matches missed in total, as first diagnosed. */
  weeks: number;
}

export type InjuryRecord = Omit<ActiveInjury, "weeksRemaining">;

/** "Hamstring strain · 3 wks" */
export function injuryShortText(i: Pick<ActiveInjury, "typeId" | "weeksRemaining">): string {
  const label = injuryType(i.typeId)?.label ?? "Injured";
  return `${label} · ${i.weeksRemaining} wk${i.weeksRemaining === 1 ? "" : "s"}`;
}

/** Soft tissue only: the extra risk from a soft tissue injury this player came back from recently. */
export function recurrenceMultiplier(playerId: number, log: readonly InjuryRecord[], currentRound: number): number {
  for (let i = log.length - 1; i >= 0; i--) {
    const r = log[i];
    if (r.playerId !== playerId || r.kind !== "softTissue") continue;
    const returnedRound = r.round + r.weeks + 1;
    if (currentRound >= returnedRound && currentRound - returnedRound < RECURRENCE_WINDOW_ROUNDS) return RECURRENCE_MULTIPLIER;
  }
  return 1;
}
