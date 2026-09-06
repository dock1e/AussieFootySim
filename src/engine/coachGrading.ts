import { mulberry32 } from "./rng.ts";
import { COACH_ROLES, type Coach, type CoachRole, type CoachRoleRating, type CoachSource } from "../types/coach.ts";

/**
 * Assistant Coaching System — see [[Assistant Coaching System]] (vault root),
 * "Grading methodology" section, for the full disclosed reasoning behind
 * everything in this file. Short version: no formula in this game can
 * *precisely* grade a real person's real-world coaching aptitude, so every
 * real coach is placed into one of 3 broad seniority tiers by hand (from
 * real, sourced career facts), and this file turns a tier + role into an
 * actual 1-99 OVR/POT pair — deterministically (same person always grades
 * the same way), but with enough seeded per-person variance that two
 * "Established" coaches don't read as mechanically identical.
 */

/**
 * Legend: multi-time All-Australian / premiership player / multi-flag senior
 * coaching record. Established: a currently-named AFL-level line coach with a
 * specific title. Rising: a VFL-level line coach, newly-elevated assistant,
 * or development-tier title.
 */
export type SeniorityTier = "Legend" | "Established" | "Rising";

const TIER_OVR_BAND: Record<SeniorityTier, readonly [number, number]> = {
  Legend: [90, 97],
  Established: [72, 85],
  Rising: [58, 71],
};

/** Every non-primary, non-tier role a real person gets: real transferable aptitude, not their specialty. */
const GENERALIST_BAND: readonly [number, number] = [45, 60];

/** Default seeded headroom (POT - OVR) for a still-active real person (real-assistant/real-candidate/delisted-player) — they can still grow, per Tyler's "younger assistants... can grow into their potential skillset too." Historical sources get none: POT === OVR (see `buildRealCoachRatings`, `atPotential`). */
const DEFAULT_HEADROOM_BAND: readonly [number, number] = [5, 15];

/** Simple, stable string hash (djb2) -> unsigned 32-bit int — same construction as `engine/draft.ts`'s own module-private `hashSeed`, duplicated here rather than imported since draft.ts doesn't export it and this is a tiny, self-contained utility. */
function hashSeed(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return h >>> 0;
}

/** A deterministic integer in [lo, hi], seeded off `name + "::" + salt` — same coach name + same salt always grades the same, but two different roles (different salt) for the same person land differently. */
function seededInBand(name: string, salt: string, band: readonly [number, number]): number {
  const rng = mulberry32(hashSeed(name + "::" + salt));
  const [lo, hi] = band;
  return Math.round(lo + rng() * (hi - lo));
}

/** One real person's grading inputs — see [[Assistant Coaching System]] "Grading methodology". */
export interface RealCoachRatingInput {
  name: string;
  primaryRole: CoachRole;
  tier: SeniorityTier;
  /** Other roles (besides primaryRole) that should ALSO draw from the tier band rather than the flat generalist band — e.g. a coaching-director/list-management real title feeding a strong Talent Scout rating too. */
  secondaryTierRoles?: CoachRole[];
  /** Historical sources: true (POT === OVR, per Tyler's "older historical coaches have all reached their full potential"). Still-active real people (real-assistant/real-candidate/delisted-player): false (seeded 5-15 headroom above OVR, capped at 99). */
  atPotential: boolean;
}

/** Builds the full 6-role `ratings` record for one real person. */
export function buildRealCoachRatings(input: RealCoachRatingInput): Record<CoachRole, CoachRoleRating> {
  const ratings = {} as Record<CoachRole, CoachRoleRating>;
  for (const role of COACH_ROLES) {
    const usesTierBand = role === input.primaryRole || (input.secondaryTierRoles?.includes(role) ?? false);
    const band = usesTierBand ? TIER_OVR_BAND[input.tier] : GENERALIST_BAND;
    const ovr = seededInBand(input.name, role, band);
    const pot = input.atPotential ? ovr : Math.min(99, ovr + seededInBand(input.name, role + "::headroom", DEFAULT_HEADROOM_BAND));
    ratings[role] = { ovr, pot };
  }
  return ratings;
}

/** Fictional "graduating" coach: high POT (wide, high-centred spread — a few genuine high-ceiling gambles, mirroring `draft.ts`'s own `generatePotential` shape), current OVR well below it (fresh out of university, per Tyler's own framing) — deliberately the largest headroom of any source. */
export function buildFictionalCoachRatings(name: string, primaryRole: CoachRole): Record<CoachRole, CoachRoleRating> {
  const ratings = {} as Record<CoachRole, CoachRoleRating>;
  for (const role of COACH_ROLES) {
    const isPrimary = role === primaryRole;
    const potBand: readonly [number, number] = isPrimary ? [72, 93] : [45, 65];
    const headroomBand: readonly [number, number] = isPrimary ? [22, 38] : [10, 22];
    const pot = seededInBand(name, role + "::pot", potBand);
    const ovr = Math.max(1, pot - seededInBand(name, role + "::headroom", headroomBand));
    ratings[role] = { ovr, pot };
  }
  return ratings;
}

/** Compact authoring shape for a real person — see `data/assistantCoachPool.ts`. Converted to a full `Coach` by `buildRealCoach`. */
export interface RealCoachSeed {
  name: string;
  source: Exclude<CoachSource, "fictional">;
  primaryRole: CoachRole;
  tier: SeniorityTier;
  atPotential: boolean;
  bio: string;
  currentAffiliation?: string;
  age?: number;
  tags: string[];
  secondaryTierRoles?: CoachRole[];
}

/** Compact authoring shape for a fictional "graduate" coach. */
export interface FictionalCoachSeed {
  name: string;
  primaryRole: CoachRole;
  bio: string;
  tags: string[];
}

export function buildRealCoach(seed: RealCoachSeed, id: number): Coach {
  return {
    id,
    name: seed.name,
    source: seed.source,
    bio: seed.bio,
    primaryRole: seed.primaryRole,
    currentAffiliation: seed.currentAffiliation,
    ratings: buildRealCoachRatings({
      name: seed.name,
      primaryRole: seed.primaryRole,
      tier: seed.tier,
      secondaryTierRoles: seed.secondaryTierRoles,
      atPotential: seed.atPotential,
    }),
    age: seed.age,
    tags: seed.tags,
  };
}

export function buildFictionalCoach(seed: FictionalCoachSeed, id: number): Coach {
  return {
    id,
    name: seed.name,
    source: "fictional",
    bio: seed.bio,
    primaryRole: seed.primaryRole,
    ratings: buildFictionalCoachRatings(seed.name, seed.primaryRole),
    tags: seed.tags,
  };
}
