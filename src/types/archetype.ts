import type { RatedAttribute } from "./player";

/**
 * The 14 fixed on-field archetypes — see `../../Player Database/Archetypes/`
 * (one page each) and Configuration.md "Archetypes".
 */
export const ARCHETYPES = [
  "Inside Mid",
  "Outside Mid",
  "Pressure Forward",
  "Hybrid Mid Forward",
  "Small Forward",
  "Medium Forward",
  "Ruck",
  "Key Forward",
  "Hybrid Key Forward Ruck",
  "Medium Defender",
  "Intercept Defender",
  "Half Back Flanker",
  "Back Pocket",
  "Key Defender",
] as const;

export type Archetype = (typeof ARCHETYPES)[number];

/**
 * Each archetype's "primary" attributes — weighted x3 in the OVR composite,
 * x1 otherwise (see Schema.md, `OVR` row). Pulled directly from each
 * Archetype page's own "Key attributes" section (`../../Player Database/Archetypes/*.md`),
 * NOT from Schema.md's inline OVR-row example, which is illustrative and
 * slightly out of sync with a couple of archetype pages (e.g. it lists 6
 * attributes for Inside Mid where the archetype page itself lists 5) — the
 * per-archetype page is the more specific source and what this table follows.
 */
export const ARCHETYPE_PRIMARY_ATTRIBUTES: Record<Archetype, readonly RatedAttribute[]> = {
  "Inside Mid": ["strengthGroundLevel", "tenacity", "courage", "readPlay", "copeWithPressure"],
  "Outside Mid": ["endurance", "speed", "agility", "skill", "acceleration"],
  "Pressure Forward": ["tenacity", "aggression", "strengthManOnMan", "courage"],
  "Hybrid Mid Forward": ["skill", "xFactor", "confidence", "courage", "readPlay"],
  "Small Forward": ["agility", "xFactor", "acceleration", "confidence"],
  "Medium Forward": ["manMarking", "skill", "confidence"],
  Ruck: ["strengthOverhead", "verticalLeap", "endurance"],
  "Key Forward": ["manMarking", "strengthOverhead", "verticalLeap", "confidence"],
  "Hybrid Key Forward Ruck": ["strengthOverhead", "verticalLeap", "manMarking"],
  "Medium Defender": ["strengthManOnMan", "positioning", "consistancy"],
  "Intercept Defender": ["readPlay", "positioning", "manMarking", "skill"],
  "Half Back Flanker": ["speed", "skill", "endurance", "acceleration"],
  "Back Pocket": ["strengthManOnMan", "tenacity", "positioning"],
  "Key Defender": ["strengthOverhead", "manMarking", "verticalLeap", "courage"],
};

/**
 * The 18 on-field slots + 5 interchange — see Configuration.md "Positions".
 *
 * Aug 2026, round 8 (Tyler: "In 2026 the AFL increased the interchange to 5
 * players on the bench, so we should also align to having 5 on the bench in
 * SimAFL too"): a real rule change, confirmed this session, not just Tyler's
 * recollection taken on faith — the AFL scrapped the substitute (the old
 * "23rd player, only activated by taking someone off") and expanded the
 * interchange bench from 4 to 5 in its place, so a real matchday squad is now
 * 23 (18 on-field + 5 interchange), same total headcount as before but all 5
 * bench spots are now live interchange rather than 4 interchange + 1
 * sub-only. `INT` gained a 5th entry below to match. This is a data-model
 * provision only — see `MatchTeam.onGround` (team.ts) for what it actually
 * changes; no interchange *rotation strategy* exists yet, per Tyler's own
 * words: "I am going to work on providing you more direction on the tactics
 * and running patterns for the engine" first.
 */
export const POSITIONS = [
  "FB",
  "BP",
  "BP",
  "HBF",
  "HBF",
  "CHB",
  "W",
  "C",
  "W",
  "R",
  "RR",
  "ROV",
  "HFF",
  "HFF",
  "CHF",
  "FF",
  "FP",
  "FP",
  "INT",
  "INT",
  "INT",
  "INT",
  "INT",
] as const;

export type Position = (typeof POSITIONS)[number];

export type Suitability = "Very suitable" | "Somewhat suitable" | "Barely suitable" | "Not suitable";

/**
 * Archetype -> position suitability starting map — see Configuration.md
 * "Archetype -> position suitability (starting map)". Anything not listed
 * for a given archetype defaults to "Barely suitable"; a genuinely nonsense
 * pairing (e.g. a Ruck at BP) is "Not suitable" — see `suitabilityFor`.
 *
 * Aug 2026, round 17 — Tyler's real-AFL corrections (live-tested: "the Ruck
 * Rover role is always yellow and never green"):
 *   - Rover/Centre: Inside Mid and Outside Mid both primary (green); Hybrid
 *     Mid Forward secondary (yellow) in either.
 *   - Ruck Rover: Outside Mid, Inside Mid, and Hybrid Mid Forward all
 *     primary; Half Back Flanker secondary — the actual bug fix, since
 *     nothing was ever "very suitable" at RR before this.
 *   - Wing: Outside Mid and Half Back Flanker both primary (Half Back
 *     Flanker was only ever secondary before); Hybrid Mid Forward secondary
 *     (already correct, kept as-is).
 *   - Back Pocket: "dynamic and flexible... tall defenders playing 3rd man
 *     up or on a 3rd tall/resting ruck... a general Medium defender or a
 *     small lock down defender" — Key Defender promoted to primary,
 *     joining Medium Defender and the Back Pocket archetype itself (both
 *     already primary there).
 *   - Forward Pocket: "dynamic and flexible... smalls, mediums, key
 *     forwards or resting rucks" — Key Forward promoted to primary
 *     (joining Small/Medium/Pressure Forward, already primary); Ruck gains
 *     secondary suitability there for the first time (was "Not suitable" —
 *     see NOT_SUITABLE_OVERRIDE below).
 */
const SUITABILITY_MAP: Record<Archetype, { very: Position[]; somewhat: Position[] }> = {
  "Inside Mid": { very: ["C", "ROV", "RR"], somewhat: ["W"] },
  "Outside Mid": { very: ["W", "C", "ROV", "RR"], somewhat: ["HBF", "HFF"] },
  Ruck: { very: ["R"], somewhat: ["RR", "FF", "FP"] },
  "Hybrid Key Forward Ruck": { very: ["FF", "R"], somewhat: ["RR", "CHF"] },
  "Key Forward": { very: ["FF", "CHF", "FP"], somewhat: ["HFF"] },
  "Hybrid Mid Forward": { very: ["HFF", "RR"], somewhat: ["CHF", "W", "ROV", "C"] },
  "Medium Forward": { very: ["HFF", "FP"], somewhat: ["CHF"] },
  "Small Forward": { very: ["FP"], somewhat: ["HFF"] },
  "Pressure Forward": { very: ["FP", "HFF"], somewhat: ["FF"] },
  "Key Defender": { very: ["FB", "CHB", "BP"], somewhat: [] },
  "Intercept Defender": { very: ["CHB", "BP"], somewhat: ["HBF"] },
  "Medium Defender": { very: ["BP", "HBF"], somewhat: ["CHB"] },
  "Half Back Flanker": { very: ["HBF", "W"], somewhat: ["BP", "RR"] },
  "Back Pocket": { very: ["BP"], somewhat: ["FB"] },
};

/** Slots a completely mismatched archetype (e.g. a Ruck at BP) reads as "Not suitable" rather than merely "Barely". Round 17: "FP" dropped from Ruck's list — a resting ruck in the forward pocket is now a real, if secondary, selection (see SUITABILITY_MAP above), not a nonsense one. */
const NOT_SUITABLE_OVERRIDE: Partial<Record<Archetype, Position[]>> = {
  Ruck: ["BP", "FB", "HBF"],
  "Key Forward": ["BP", "FB"],
  "Key Defender": ["FF", "FP"],
};

export function suitabilityFor(archetype: Archetype, position: Position): Suitability {
  if (position === "INT") return "Very suitable"; // interchange takes anyone
  const map = SUITABILITY_MAP[archetype];
  if (map.very.includes(position)) return "Very suitable";
  if (map.somewhat.includes(position)) return "Somewhat suitable";
  if (NOT_SUITABLE_OVERRIDE[archetype]?.includes(position)) return "Not suitable";
  return "Barely suitable";
}
