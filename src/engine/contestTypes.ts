import type { RatedAttribute } from "../types/player.ts";
import type { Archetype } from "../types/archetype.ts";

/**
 * The one-on-one "contest" primitive — Engine.md core loop step 3, described
 * there as "the heart of the engine". Two players' relevant attributes are
 * compared with a random roll to decide the winner.
 *
 * This file covers the six *dueling* contest types from Engine.md's
 * "Attribute -> contest mapping" table — the ones with a clear attacker vs
 * defender shape. The other rows in that table (set shot, snap/running shot,
 * catching a handball, kick/handball in traffic) are a *rating-vs-difficulty*
 * shape rather than player-vs-player, and are intentionally left for the next
 * pass rather than half-implemented here — see ROADMAP.md "Engine — next up".
 */
export type ContestType = "markLead" | "markContested" | "groundBall" | "tackle" | "ruck" | "clearance";

export interface ContestConfig {
  /** Human label, matches the row name in Engine.md's mapping table. */
  label: string;
  /** Attribute set for the side initiating/favoured in this contest (e.g. the leading marker, the tackler). */
  attacker: readonly RatedAttribute[];
  /** Attribute set for the opposing side (e.g. the spoiler, the ball-carrier breaking the tackle). */
  defender: readonly RatedAttribute[];
  /** The imp_/deg_-tracked discrete skill each side's win/loss should feed — see Schema.md and Engine.md season progression. */
  attackerSkill: string;
  defenderSkill: string;
  /**
   * Ruck contests get a small height-derived bonus on top of the attribute
   * average — Engine.md lists "height proxy" alongside the rated attributes,
   * and height isn't itself a 1-99 rated attribute.
   */
  heightWeighted?: boolean;
}

export const CONTEST_CONFIG: Record<ContestType, ContestConfig> = {
  markLead: {
    label: "Mark on a lead",
    attacker: ["manMarking", "verticalLeap", "speed"],
    defender: ["strengthManOnMan"],
    attackerSkill: "markLead",
    defenderSkill: "spoilLead",
  },
  markContested: {
    label: "Contested mark / pack mark",
    attacker: ["manMarking", "strengthOverhead", "verticalLeap", "courage"],
    defender: ["manMarking", "strengthOverhead", "verticalLeap", "courage"],
    attackerSkill: "markContested",
    defenderSkill: "spoilContested",
  },
  groundBall: {
    label: "Ground ball / scrimmage",
    attacker: ["strengthGroundLevel", "agility", "courage"],
    defender: ["strengthGroundLevel", "agility", "courage"],
    attackerSkill: "hardBallGets",
    defenderSkill: "getToContest",
  },
  tackle: {
    label: "Tackle vs evasion",
    attacker: ["tenacity", "strengthManOnMan", "aggression"],
    defender: ["agility", "acceleration", "xFactor"],
    attackerSkill: "tackle",
    defenderSkill: "evasion",
  },
  ruck: {
    label: "Ruck contest",
    attacker: ["strengthOverhead", "verticalLeap"],
    defender: ["strengthOverhead", "verticalLeap"],
    attackerSkill: "ruck",
    defenderSkill: "ruck",
    heightWeighted: true,
  },
  clearance: {
    label: "Clearance (post-stoppage)",
    attacker: ["readPlay", "strengthGroundLevel", "courage"],
    defender: ["readPlay", "strengthGroundLevel", "courage"],
    attackerSkill: "clearance",
    defenderSkill: "clearance",
  },
};

/**
 * Archetype-specific contest rating bonuses — Sep 2026, Phase 10 round 105,
 * Phase A of [[Simulation Engine Report Review]]. That review found AFS's
 * contest math was attribute-average only (with one existing exception,
 * `ContestConfig.heightWeighted`'s ruck-only height term) — no general "this
 * archetype is just better/worse at this contest type, independent of its
 * attributes" hook existed anywhere, which was the one genuinely new, cheap
 * idea the reviewed report contributed (its own named archetype β-bonuses:
 * Gorilla/Key Forward +8.0 in aerial contests, Key Intercept Defender +10.0
 * defending them, Small Crumbing Forward +14.0 at ground level, Resting
 * Ruckman/Key Tall Defender -18.0 at ground level).
 *
 * Mapped onto AFS's own real 14 archetypes (`types/archetype.ts`), not the
 * reviewed report's invented sub-archetype taxonomy — see that review's own
 * Section 1 finding for why AFS's player-persistent archetype is the better
 * fit here than the report's slot-probabilistic one. A flat bonus per
 * archetype per `ContestType`, applied to whichever side (attacker or
 * defender role) that archetype's player actually occupies in a given
 * contest (`resolveContest`, in `contest.ts`) — not fixed to one role — since a real
 * Key Forward pressed into a defensive aerial contest (a forward-half
 * stoppage, say) is still a genuinely strong overhead mark, not suddenly an
 * average one just because this tick cast them as the "defender".
 *
 * `Hybrid Key Forward Ruck` deliberately carries both the aerial bonus AND
 * the ground-level penalty — a real, coherent football claim (tall,
 * ruck-capable forwards are genuinely strong overhead and genuinely
 * unsuited to scrambling at ground level), not an oversight of double-
 * booking one archetype across two rows.
 *
 * These are the reviewed report's own round figures, not yet independently
 * calibrated against AFS's actual rating distributions — same "deliberately
 * roughed in, meant for real-data verification before being trusted" status
 * every other placeholder constant in this project carries (`contest.ts`'s
 * own `DEFAULT_K`, `RUCK_HEIGHT_WEIGHT`, etc.). See
 * `scripts/verify_round105_scratch.ts` for the real-player before/after
 * win-rate check this round ran before shipping these numbers as-is.
 */
export const ARCHETYPE_CONTEST_BONUS: Partial<Record<Archetype, Partial<Record<ContestType, number>>>> = {
  "Key Forward": { markContested: 8, markLead: 8 },
  "Hybrid Key Forward Ruck": { markContested: 8, markLead: 8, groundBall: -18 },
  "Intercept Defender": { markContested: 10, markLead: 10 },
  "Small Forward": { groundBall: 14 },
  "Pressure Forward": { groundBall: 14 },
  Ruck: { groundBall: -18 },
  "Key Defender": { groundBall: -18 },
};
