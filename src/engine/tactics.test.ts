import { describe, it, expect } from "vitest";
import {
  tacticGroupFor,
  tacticsFor,
  defaultTacticFor,
  sanitizePlan,
  resolveTagger,
  ruckHitoutMultiplier,
  taggingClearanceMultiplier,
  carrierDisposalMultiplier,
  taggerDisposalMultiplier,
  tackleDefenderRatingMultiplier,
  runOffManDisposalMultiplier,
  contestRatingMultiplier,
  thirdManUpRuckMultiplier,
  gameStyleDefenderMultiplier,
  gameStyleDisposalMultiplier,
  gameStyleClearanceMultiplier,
  gameStyleContestChanceMultiplier,
  gameStyleForwardEntryMultiplier,
  opponentFloodGoalAccuracyMultiplier,
  MIDFIELD_TACTICS,
  KEY_FORWARD_TACTICS,
  SMALL_FORWARD_TACTICS,
  RUCK_TACTICS,
  DEFENDER_TACTICS,
  GAME_STYLES,
  type TeamPlan,
} from "./tactics";
import { ARCHETYPES, type Archetype } from "../types/archetype";
import { makePlayer } from "../testUtils/makePlayer";

describe("tacticGroupFor / tacticsFor / defaultTacticFor", () => {
  it("assigns every one of the 14 archetypes to exactly one of the 5 groups", () => {
    const groups = new Set(["Midfield", "KeyForward", "SmallForward", "Ruck", "Defender"]);
    for (const archetype of ARCHETYPES) {
      expect(groups.has(tacticGroupFor(archetype))).toBe(true);
    }
  });

  it("every group's tactic list matches Configuration.md's menus exactly", () => {
    expect(tacticsFor("Midfield")).toEqual(MIDFIELD_TACTICS);
    expect(tacticsFor("KeyForward")).toEqual(KEY_FORWARD_TACTICS);
    expect(tacticsFor("SmallForward")).toEqual(SMALL_FORWARD_TACTICS);
    expect(tacticsFor("Ruck")).toEqual(RUCK_TACTICS);
    expect(tacticsFor("Defender")).toEqual(DEFENDER_TACTICS);
  });

  it("every group's default is the first-listed (Engine.md-confirmed default) option", () => {
    expect(defaultTacticFor("Midfield")).toBe("Run Two Ways");
    expect(defaultTacticFor("KeyForward")).toBe("Leading Target");
    expect(defaultTacticFor("SmallForward")).toBe("Free Role");
    expect(defaultTacticFor("Ruck")).toBe("Follow the Ball");
    expect(defaultTacticFor("Defender")).toBe("Defensive Shoulder");
  });

  it("GAME_STYLES includes Balanced plus the 5 named styles from Engine.md", () => {
    expect(GAME_STYLES).toHaveLength(6);
    expect(GAME_STYLES).toContain("Balanced");
    expect(GAME_STYLES).toContain("Defensive Flood");
    expect(GAME_STYLES).toContain("Spread the Ground");
    expect(GAME_STYLES).toContain("Chip & Mark");
    expect(GAME_STYLES).toContain("Attack the Middle");
    expect(GAME_STYLES).toContain("Forward Press");
  });
});

describe("sanitizePlan", () => {
  const players = [
    makePlayer({ PlayerID: 1, archetype: "Inside Mid" as Archetype }),
    makePlayer({ PlayerID: 2, archetype: "Key Defender" as Archetype }),
    makePlayer({ PlayerID: 3, archetype: "Ruck" as Archetype }),
  ];

  it("keeps a valid, explicitly-assigned tactic as-is", () => {
    const plan: TeamPlan = { gameStyle: "Balanced", tactics: new Map([[1, { tactic: "Attacking" }]]) };
    const cleaned = sanitizePlan(players, plan);
    expect(cleaned.tactics.get(1)?.tactic).toBe("Attacking");
  });

  it("resets a cross-group-invalid tactic to that player's group default", () => {
    // "Aerial Target" is Ruck-only — invalid for an Inside Mid.
    const plan: TeamPlan = { gameStyle: "Balanced", tactics: new Map([[1, { tactic: "Aerial Target" }]]) };
    const cleaned = sanitizePlan(players, plan);
    expect(cleaned.tactics.get(1)?.tactic).toBe("Run Two Ways");
  });

  it("fills in every player not present in the input plan with their group default", () => {
    const plan: TeamPlan = { gameStyle: "Balanced", tactics: new Map() };
    const cleaned = sanitizePlan(players, plan);
    expect(cleaned.tactics.get(1)?.tactic).toBe("Run Two Ways");
    expect(cleaned.tactics.get(2)?.tactic).toBe("Defensive Shoulder");
    expect(cleaned.tactics.get(3)?.tactic).toBe("Follow the Ball");
  });

  it("preserves gameStyle unchanged", () => {
    const plan: TeamPlan = { gameStyle: "Attack the Middle", tactics: new Map() };
    expect(sanitizePlan(players, plan).gameStyle).toBe("Attack the Middle");
  });
});

describe("resolveTagger", () => {
  it("finds the tagger assigned to a given target's PlayerID", () => {
    const plan: TeamPlan = { gameStyle: "Balanced", tactics: new Map([[10, { tactic: "Tagging", taggingTargetId: 99 }]]) };
    expect(resolveTagger(plan, 99)).toEqual({ taggerId: 10 });
  });

  it("returns null if nobody is tagging that target", () => {
    const plan: TeamPlan = { gameStyle: "Balanced", tactics: new Map([[10, { tactic: "Tagging", taggingTargetId: 99 }]]) };
    expect(resolveTagger(plan, 100)).toBeNull();
  });

  it("returns null against an empty plan", () => {
    expect(resolveTagger({ gameStyle: "Balanced", tactics: new Map() }, 99)).toBeNull();
  });
});

describe("per-player tactic multipliers — every default/no-op case returns exactly 1", () => {
  it("ruckHitoutMultiplier", () => {
    expect(ruckHitoutMultiplier(undefined)).toBe(1);
    expect(ruckHitoutMultiplier("Follow the Ball")).toBe(1);
    expect(ruckHitoutMultiplier("Aerial Target")).toBeLessThan(1);
    expect(ruckHitoutMultiplier("Hold Position")).toBeGreaterThan(1);
  });

  it("taggingClearanceMultiplier / thirdManUpRuckMultiplier", () => {
    expect(taggingClearanceMultiplier(false)).toBe(1);
    expect(taggingClearanceMultiplier(true)).toBeLessThan(1);
    expect(thirdManUpRuckMultiplier(false)).toBe(1);
    expect(thirdManUpRuckMultiplier(true)).toBeGreaterThan(1);
  });

  it("carrierDisposalMultiplier / runOffManDisposalMultiplier / taggerDisposalMultiplier", () => {
    expect(carrierDisposalMultiplier(undefined)).toBe(1);
    expect(carrierDisposalMultiplier("Run Two Ways")).toBe(1);
    expect(carrierDisposalMultiplier("Attacking")).toBeGreaterThan(1);
    expect(runOffManDisposalMultiplier(undefined)).toBe(1);
    expect(runOffManDisposalMultiplier("Run off Man")).toBeGreaterThan(1);
    expect(taggerDisposalMultiplier(false)).toBe(1);
    expect(taggerDisposalMultiplier(true)).toBeLessThan(1);
  });

  it("tackleDefenderRatingMultiplier", () => {
    expect(tackleDefenderRatingMultiplier(undefined, false)).toBe(1);
    expect(tackleDefenderRatingMultiplier("Defensive", false)).toBeGreaterThan(1);
    expect(tackleDefenderRatingMultiplier("Attacking", false)).toBeLessThan(1);
    expect(tackleDefenderRatingMultiplier("Play in Front", false)).toBeGreaterThan(1);
    expect(tackleDefenderRatingMultiplier("Run off Man", false)).toBeLessThan(1);
    expect(tackleDefenderRatingMultiplier("High Press", false)).toBe(1); // only boosts in the forward half
    expect(tackleDefenderRatingMultiplier("High Press", true)).toBeGreaterThan(1);
  });

  it("contestRatingMultiplier", () => {
    expect(contestRatingMultiplier(undefined, "markContested", "attacker")).toBe(1);
    expect(contestRatingMultiplier("Contested Marking", "markContested", "attacker")).toBeGreaterThan(1);
    expect(contestRatingMultiplier("Bring Ball to Ground", "markContested", "attacker")).toBeLessThan(1);
    expect(contestRatingMultiplier("Aerial Target", "markContested", "defender")).toBeGreaterThan(1);
    expect(contestRatingMultiplier("Defensive Shoulder", "markContested", "defender")).toBeGreaterThan(1);
    expect(contestRatingMultiplier("Defensive Shoulder", "markContested", "attacker")).toBe(1); // only applies to the defender role
    expect(contestRatingMultiplier("Crumbing", "groundBall", "attacker")).toBeGreaterThan(1);
    expect(contestRatingMultiplier("Crumbing", "markContested", "attacker")).toBe(1); // groundBall-only per Engine.md
  });
});

describe("game style multipliers — Balanced is always a no-op", () => {
  it("every game-style function returns 1 for Balanced", () => {
    expect(gameStyleDefenderMultiplier("Balanced", false)).toBe(1);
    expect(gameStyleDefenderMultiplier("Balanced", true)).toBe(1);
    expect(gameStyleDisposalMultiplier("Balanced")).toBe(1);
    expect(gameStyleClearanceMultiplier("Balanced")).toBe(1);
    expect(gameStyleContestChanceMultiplier("Balanced")).toBe(1);
    expect(gameStyleForwardEntryMultiplier("Balanced")).toBe(1);
    expect(opponentFloodGoalAccuracyMultiplier("Balanced")).toBe(1);
  });

  it("Defensive Flood raises defending, lowers own forward entry, and reduces opponent goal accuracy", () => {
    expect(gameStyleDefenderMultiplier("Defensive Flood", false)).toBeGreaterThan(1);
    expect(gameStyleForwardEntryMultiplier("Defensive Flood")).toBeLessThan(1);
    expect(opponentFloodGoalAccuracyMultiplier("Defensive Flood")).toBeLessThan(1);
  });

  it("Attack the Middle raises clearance and forward entry, lowers defending", () => {
    expect(gameStyleClearanceMultiplier("Attack the Middle")).toBeGreaterThan(1);
    expect(gameStyleForwardEntryMultiplier("Attack the Middle")).toBeGreaterThan(1);
    expect(gameStyleDefenderMultiplier("Attack the Middle", false)).toBeLessThan(1);
  });

  it("Forward Press only boosts defending in the pressing team's forward half, and costs it elsewhere", () => {
    expect(gameStyleDefenderMultiplier("Forward Press", true)).toBeGreaterThan(1);
    expect(gameStyleDefenderMultiplier("Forward Press", false)).toBeLessThan(1);
  });

  it("Spread the Ground and Chip & Mark both boost disposal efficiency", () => {
    expect(gameStyleDisposalMultiplier("Spread the Ground")).toBeGreaterThan(1);
    expect(gameStyleDisposalMultiplier("Chip & Mark")).toBeGreaterThan(1);
  });

  it("Spread the Ground reduces how often a disposal becomes a contest; Chip & Mark reduces forward-entry tempo", () => {
    expect(gameStyleContestChanceMultiplier("Spread the Ground")).toBeLessThan(1);
    expect(gameStyleForwardEntryMultiplier("Chip & Mark")).toBeLessThan(1);
  });
});
