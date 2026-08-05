import type { RatedAttribute } from "../types/player.ts";

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
