import type { Archetype, Position } from "../types/archetype.ts";
import type { Player } from "../types/player.ts";
import { summariseLines, bandForGap, type Line } from "../data/lines.ts";

/**
 * Per-player tactics and team-wide game styles — Engine.md "Tactics system"
 * / "Game styles", Configuration.md "Tactics menus (by position group)" /
 * "Game styles". Every number below is copied directly from Engine.md's own
 * tables (themselves flagged there as "deliberately roughed in" starting
 * points for the balance simulator) — see the comment beside each function
 * for which line of Engine.md it encodes.
 *
 * Scoping note: Engine.md describes several effects as changes to how often
 * a player is *involved* (e.g. "+8% personal disposal involvement",
 * "-15% forward/general-play involvement"). match.ts doesn't have a concept
 * of positional player selection yet (attacker/defender reps are still
 * picked by `rngChoice` across the whole 22 — see ROADMAP.md gap #9/#16), so
 * involvement-frequency effects aren't wireable without that deeper
 * restructuring. What *is* wired here is every effect that reads as a
 * contest-rating or shot/disposal-probability change at a specific
 * already-existing call site in match.ts — see match.ts for exactly where
 * each function below gets called, and ROADMAP.md for the full list of
 * effects left unmodeled for this reason.
 */

export type TacticGroup = "Midfield" | "KeyForward" | "SmallForward" | "Ruck" | "Defender";

export const MIDFIELD_TACTICS = ["Run Two Ways", "Attacking", "Defensive", "Tagging"] as const;
/**
 * "General Forward" (Aug 2026) added to both forward lists per Tyler's
 * hand-drawn tactics pack — see [[Tactics and Positional Play]] Part 7. It
 * shows up on all four forward position slides (FF, FP, HFF, CHF), so it's
 * additive to both existing menus rather than replacing anything on either.
 */
export const KEY_FORWARD_TACTICS = ["Leading Target", "Contested Marking", "Bring Ball to Ground", "General Forward"] as const;
export const SMALL_FORWARD_TACTICS = ["Free Role", "Crumbing", "Lead-Up Target", "High Press", "General Forward"] as const;
export const RUCK_TACTICS = ["Follow the Ball", "Aerial Target", "Hold Position"] as const;
/** "General Defender" (Aug 2026) added per Tyler's tactics pack — a genuinely new 5th defender tactic, not a relabelling of an existing one. See [[Tactics and Positional Play]] Part 7. */
export const DEFENDER_TACTICS = ["Defensive Shoulder", "Play in Front", "Third Man Up", "Run off Man", "General Defender"] as const;

export type MidfieldTactic = (typeof MIDFIELD_TACTICS)[number];
export type KeyForwardTactic = (typeof KEY_FORWARD_TACTICS)[number];
export type SmallForwardTactic = (typeof SMALL_FORWARD_TACTICS)[number];
export type RuckTactic = (typeof RUCK_TACTICS)[number];
export type DefenderTactic = (typeof DEFENDER_TACTICS)[number];
export type Tactic = MidfieldTactic | KeyForwardTactic | SmallForwardTactic | RuckTactic | DefenderTactic;

/**
 * Archetype -> tactic group. Finer-grained than `data/lines.ts`'s four
 * lines (Configuration.md splits "Forwards" into separate Key forward and
 * Small/medium forward tactic menus) — another first-pass inference not
 * pinned down anywhere in the vault as a table, same caveat lines.ts's own
 * doc comment already carries for the coarser Line grouping.
 */
const TACTIC_GROUP: Record<Archetype, TacticGroup> = {
  "Inside Mid": "Midfield",
  "Outside Mid": "Midfield",
  "Key Forward": "KeyForward",
  "Medium Forward": "SmallForward",
  "Small Forward": "SmallForward",
  "Pressure Forward": "SmallForward",
  "Hybrid Mid Forward": "SmallForward",
  Ruck: "Ruck",
  "Hybrid Key Forward Ruck": "Ruck",
  "Key Defender": "Defender",
  "Medium Defender": "Defender",
  "Intercept Defender": "Defender",
  "Half Back Flanker": "Defender",
  "Back Pocket": "Defender",
};

export function tacticGroupFor(archetype: Archetype): TacticGroup {
  return TACTIC_GROUP[archetype];
}

const TACTICS_BY_GROUP: Record<TacticGroup, readonly Tactic[]> = {
  Midfield: MIDFIELD_TACTICS,
  KeyForward: KEY_FORWARD_TACTICS,
  SmallForward: SMALL_FORWARD_TACTICS,
  Ruck: RUCK_TACTICS,
  Defender: DEFENDER_TACTICS,
};

export function tacticsFor(group: TacticGroup): readonly Tactic[] {
  return TACTICS_BY_GROUP[group];
}

/** Every group's first listed option is its Engine.md-confirmed default. */
export function defaultTacticFor(group: TacticGroup): Tactic {
  return TACTICS_BY_GROUP[group][0];
}

/**
 * Finer-grained than `defaultTacticFor`'s one-per-group answer — Tyler's
 * hand-drawn tactics pack (Aug 2026, see [[Tactics and Positional Play]]
 * Part 7) gives the flank defensive/forward positions (BP, HBF, FP, HFF)
 * their own default distinct from their group's centre-position default (FB/
 * CHB/CHF), matching the same centre-vs-flank split `ground.ts`'s own
 * `POSITION_LANES` already encodes structurally (single lane for the centre
 * positions, mirrored dual lane for the flanks). Positions not listed here
 * (including every centre position, since their default already equals the
 * group default) fall through to `defaultTacticFor`, same as when
 * `position` itself is unknown — a match with no Selection Committee lineup
 * behind it (no `MatchTeam.positions` map) degrades to exactly the old
 * per-group behaviour, not an error.
 */
const POSITION_DEFAULT_TACTIC: Partial<Record<Position, Tactic>> = {
  BP: "General Defender",
  HBF: "General Defender",
  FF: "Contested Marking",
  FP: "General Forward",
  HFF: "General Forward",
};

export function defaultTacticForPosition(position: Position | undefined, group: TacticGroup): Tactic {
  const positional = position ? POSITION_DEFAULT_TACTIC[position] : undefined;
  return positional ?? defaultTacticFor(group);
}

export const GAME_STYLES = [
  "Balanced",
  "Defensive Flood",
  "Spread the Ground",
  "Attack the Middle",
  "Forward Press",
] as const;
export type GameStyle = (typeof GAME_STYLES)[number];
export const DEFAULT_GAME_STYLE: GameStyle = "Balanced";

export interface PlayerTactic {
  tactic: Tactic;
  /** Only meaningful when `tactic === "Tagging"` — the opponent PlayerID this player is assigned to shadow. */
  taggingTargetId?: number;
}

export interface TeamPlan {
  gameStyle: GameStyle;
  /** Keyed by PlayerID. Any player not present uses their tactic group's default. */
  tactics: Map<number, PlayerTactic>;
}

export function defaultTeamPlan(): TeamPlan {
  return { gameStyle: DEFAULT_GAME_STYLE, tactics: new Map() };
}

/**
 * A real, roster-shape-driven default game style — Phase 8 (see
 * [[Tactics and Positional Play]]): AI-controlled clubs previously played
 * every match with no `TeamPlan` supplied at all, which is fully inert
 * (`tacticFor` below returns `undefined` outright for a `null` plan, not
 * even each player's own archetype default — see its own doc comment), not
 * just "using the default style". This gives every AI club a genuine read
 * of its *own* roster instead of a fixed style repeated 18 times over,
 * built entirely from data that already existed and was already vetted —
 * `data/lines.ts`'s `summariseLines`/`bandForGap`, the exact same
 * league-relative gap the List Needs report and Dashboard rating bars
 * already show a human coach. Deliberately a simple, explainable,
 * roster-only decision tree rather than a full strategic AI (it doesn't
 * know who it's playing this week, or the ladder situation) — see the
 * research doc's own "Open questions" section for why that's a separate,
 * later piece of work, not scope creep on top of this one.
 */
export function chooseGameStyleForClub(clubPlayers: Player[], leagueAvgOvr: number): GameStyle {
  const lines = summariseLines(clubPlayers, leagueAvgOvr);
  const bandOf = (line: Line) => bandForGap(lines.find((l) => l.line === line)?.gapToLeague ?? 0);

  if (bandOf("Defence") === "red") return "Defensive Flood"; // a leaky defence gets shored up first
  if (bandOf("Forwards") === "green") return "Forward Press"; // a strong forward line can afford to press high up the ground
  if (bandOf("Midfield") === "green") return "Attack the Middle"; // a strong midfield wants more of the contested ball
  if (bandOf("Forwards") === "red") return "Spread the Ground"; // no strong targets inside 50 - favour ball movement over contested forward-half footy
  return "Balanced"; // nothing stands out either way - a real, common choice, not a placeholder
}

/**
 * The full plan an AI-controlled club fields — `chooseGameStyleForClub`
 * above plus an empty per-player tactics map, which is enough on its own:
 * `match.ts`'s `startMatch` runs every supplied plan through `sanitizePlan`
 * regardless, which fills every player in with their own tactic group's
 * real default (e.g. defenders start on "Defensive Shoulder") — the same
 * fallback a human coach who never touches Match Preparation also gets. See
 * `useSeasonStore.ts`'s `currentPlans()` for where this is actually called,
 * once per club per season/round.
 */
export function aiTeamPlan(clubPlayers: Player[], leagueAvgOvr: number): TeamPlan {
  return { gameStyle: chooseGameStyleForClub(clubPlayers, leagueAvgOvr), tactics: new Map() };
}

/**
 * Rebuilds a plan's tactics map so every player is assigned a tactic that
 * actually belongs to their own archetype's group — anything mismatched
 * (e.g. a defender somehow assigned "Tagging", a midfield-only option) or
 * simply unlisted falls back to that player's group default. Nothing in the
 * data model otherwise stops a caller from constructing a mismatched
 * `TeamPlan` by hand (the real Match Preparation UI only ever offers each
 * player their own group's menu, so this mainly guards against
 * programmatic misuse — scripts, tests, a future save-file import), but
 * `simulateMatch` runs every supplied plan through this before using it, so
 * match.ts's tactic-lookup functions can assume every plan they see is
 * already valid.
 *
 * `positions` is optional (Aug 2026) — when the caller has a real Selection
 * Committee lineup behind this team (`MatchTeam.positions`), an unlisted or
 * mismatched player falls back to their own *position's* default (see
 * `defaultTacticForPosition`), not just their archetype group's. Omit it and
 * every player falls back to the group default exactly as before — this
 * param doesn't change behaviour for any existing caller that doesn't pass it.
 */
export function sanitizePlan(players: readonly Player[], plan: TeamPlan, positions?: Map<number, Position>): TeamPlan {
  const tactics = new Map<number, PlayerTactic>();
  for (const p of players) {
    const group = tacticGroupFor(p.archetype as Archetype);
    const valid: readonly Tactic[] = tacticsFor(group);
    const existing = plan.tactics.get(p.PlayerID);
    const fallback = defaultTacticForPosition(positions?.get(p.PlayerID), group);
    tactics.set(p.PlayerID, existing && valid.includes(existing.tactic) ? existing : { tactic: fallback });
  }
  return { gameStyle: plan.gameStyle, tactics };
}

// --- Per-player tactic effects -------------------------------------------------------------
// Each multiplier is named after the specific Engine.md clause it encodes.

/** Ruck hit-out reliability — Engine.md Ruck tactics: Aerial Target "-8%", Hold Position "+10%". */
export function ruckHitoutMultiplier(tactic: Tactic | undefined): number {
  if (tactic === "Aerial Target") return 0.92;
  if (tactic === "Hold Position") return 1.1;
  return 1;
}

/** A team's clearance rating dips slightly while running a tagger — Engine.md Tagging: "small team-wide clearance dip". */
export function taggingClearanceMultiplier(teamIsRunningATagger: boolean): number {
  return teamIsRunningATagger ? 0.95 : 1;
}

/** Disposal rating for whoever currently has the ball — Engine.md Midfield Attacking "+8% personal disposal involvement" read as a rating proxy; Tagging target/tagger effects handled separately (see `resolveTagger`/`taggerDisposalMultiplier`). */
export function carrierDisposalMultiplier(carrierTactic: Tactic | undefined): number {
  if (carrierTactic === "Attacking") return 1.08;
  return 1;
}

/** A tagger's own disposal output while running the tag — Engine.md Tagging: "tagger's own disposal output drops ~20-30%" (midpoint used). */
export function taggerDisposalMultiplier(playerIsTagging: boolean): number {
  return playerIsTagging ? 0.75 : 1;
}

/**
 * If the defending team has a tagger assigned to the current ball carrier,
 * the tag deterministically wins the defensive matchup (rather than the
 * usual random defender pick) — Engine.md Tagging: "locks onto one named
 * opponent... target's effective contest rating vs this player cut
 * ~40-60%" (midpoint 50% used as the carrier-rating multiplier applied
 * alongside forcing the tagger into the defender role).
 */
export function resolveTagger(plan: TeamPlan, carrierId: number): { taggerId: number } | null {
  for (const [playerId, pt] of plan.tactics) {
    if (pt.tactic === "Tagging" && pt.taggingTargetId === carrierId) return { taggerId: playerId };
  }
  return null;
}
export const TAGGED_CARRIER_RATING_MULTIPLIER = 0.5;

/** Tackling/defending rating in general play — Midfield Attacking "-15%"/Defensive "+20%" weight on tackle contests; Defender Play in Front "+20%" intercept-read, Run off Man "-own direct-opponent coverage" (~-15%, symmetric with Third Man Up's own-coverage cost below); Small/medium forward High Press "+15%" forward-half turnover generation. */
export function tackleDefenderRatingMultiplier(defenderTactic: Tactic | undefined, defenderIsInForwardHalf: boolean): number {
  switch (defenderTactic) {
    case "Attacking":
      return 0.85;
    case "Defensive":
      return 1.2;
    case "Play in Front":
      return 1.2;
    case "Run off Man":
      return 0.85;
    case "High Press":
      return defenderIsInForwardHalf ? 1.15 : 1;
    default:
      return 1;
  }
}

/** A carrier who just won the ball off a spoil/kick-in with "Run off Man" set gets a clean-release disposal boost — Engine.md Defender Run off Man: "+20% rebound-50/uncontested-chain involvement". */
export function runOffManDisposalMultiplier(carrierTactic: Tactic | undefined): number {
  return carrierTactic === "Run off Man" ? 1.2 : 1;
}

/** Contest rating (markContested/groundBall) for whichever player is actually picked as the attacker/defender rep — Key forward Contested Marking "+20%"/Bring Ball to Ground "-25%"; Small/medium forward Crumbing "+20%" (ground balls only, "around forward-50 packs"); Ruck Aerial Target "+15% markContested weight around the ground"; Defender Defensive Shoulder "+15% spoil weight" (applied as the defender's markContested rating, its closest modelled equivalent). */
export function contestRatingMultiplier(
  tactic: Tactic | undefined,
  contestType: "markContested" | "groundBall",
  role: "attacker" | "defender",
): number {
  if (contestType === "markContested") {
    if (tactic === "Contested Marking" && role === "attacker") return 1.2;
    if (tactic === "Bring Ball to Ground" && role === "attacker") return 0.75;
    if (tactic === "Aerial Target") return 1.15;
    if (tactic === "Defensive Shoulder" && role === "defender") return 1.15;
  } else {
    if (tactic === "Crumbing") return 1.2;
  }
  return 1;
}

/** Team-wide stoppage crash — Engine.md Defender Third Man Up: "+team hit-out/contest win rate at stoppages near this player's zone", approximated here as a flat team-wide ruck-rating nudge since match.ts doesn't model per-player zone proximity at stoppages. */
export function thirdManUpRuckMultiplier(teamHasThirdManUp: boolean): number {
  return teamHasThirdManUp ? 1.05 : 1;
}

// --- Team-wide game style effects -----------------------------------------------------------
// Numbers chosen to sit in the same rough band as Engine.md's own confirmed live figures
// (e.g. Defensive Wall "+3.5% intercepts", Contested "+4.2%/-6% rating") without claiming to
// literally reproduce aflclubmanager's exact tuning — see Engine.md "Game styles" confirmation
// paragraph. Exactly the kind of number the balance simulator (scripts/simulate.ts) exists to
// re-tune once there's a large enough sample of game-style-vs-game-style results.

/** Engine.md Defensive Flood "+intercept/spoil rate"; Forward Press "+opponent turnovers... own inside-50 count" (own defending in the forward half only, "if the press is broken" downside applied as the else-branch penalty). */
export function gameStyleDefenderMultiplier(style: GameStyle, defenderIsInForwardHalf: boolean): number {
  switch (style) {
    case "Defensive Flood":
      return 1.15;
    case "Forward Press":
      return defenderIsInForwardHalf ? 1.15 : 0.9;
    case "Attack the Middle":
      return 0.9;
    default:
      return 1;
  }
}

/** Engine.md Spread the Ground "+uncontested-possession chains". */
export function gameStyleDisposalMultiplier(style: GameStyle): number {
  switch (style) {
    case "Spread the Ground":
      return 1.15;
    default:
      return 1;
  }
}

/** Engine.md Attack the Middle "+clearance differential". */
export function gameStyleClearanceMultiplier(style: GameStyle): number {
  return style === "Attack the Middle" ? 1.15 : 1;
}

/** Engine.md Spread the Ground "-reliance on contested footy" (less likely a disposal becomes a contest). */
export function gameStyleContestChanceMultiplier(style: GameStyle): number {
  return style === "Spread the Ground" ? 0.8 : 1;
}

/** Engine.md Attack the Middle "+inside-50 count off clearances"; Forward Press "+own inside-50 count"; Defensive Flood "-own inside-50 count and forward structure". */
export function gameStyleForwardEntryMultiplier(style: GameStyle): number {
  switch (style) {
    case "Attack the Middle":
      return 1.15;
    case "Forward Press":
      return 1.1;
    case "Defensive Flood":
      return 0.85;
    default:
      return 1;
  }
}

/** Engine.md Defensive Flood: "opponent's scoring accuracy drops when they do enter forward 50" — applied to the *shooting* team when the *defending* team is running Defensive Flood. */
export function opponentFloodGoalAccuracyMultiplier(defendingTeamStyle: GameStyle): number {
  return defendingTeamStyle === "Defensive Flood" ? 0.9 : 1;
}
