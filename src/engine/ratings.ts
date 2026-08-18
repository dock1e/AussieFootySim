import type { BoxScoreLine, MatchEvent, MatchResult, StatDelta } from "./match.ts";
import type { MatchTeam } from "./team.ts";
import type { Side, Zone } from "./zones.ts";

/**
 * Player Ratings.md "AussieFootySim's own scoring stack" — layers 2 and 3 of the
 * proposed four-layer stack (layer 1, the box score, already exists in
 * match.ts; layer 4, the recency-weighted Season Rating, needs the
 * persistent multi-match history this project doesn't have yet — see
 * ROADMAP.md gap #24/#29 and the new gap this file's own ROADMAP writeup
 * adds).
 */

// ---------------------------------------------------------------------------
// Layer 2: Fantasy Points — Player Ratings.md "AFL Fantasy — the exact
// formula (verified)": an unconstrained linear regression against a real
// 46-player, 2-game 2026 box score landed R²=1.00000, max residual 0.00 —
// not an approximation, an exact fit, and it matches the publicly-cited AFL
// Fantasy Classic formula. Implemented literally, straight off the box
// score, zero ambiguity.
//
// One remaining honest, pre-existing box-score simplification this formula
// inherits (not new to this file — see ROADMAP.md known gaps):
// - `line.marks` only ever counts *contested* marks (match.ts's only mark
//   event is the forward-50 CONTEST phase win) — an uncontested "mark on a
//   lead" isn't modelled as its own event, so Fantasy Points will read
//   somewhat low relative to a real AFL box score for high-mark players.
//
// `FreeFor`/`FreeAgainst` used to be hardcoded to 0 here — "match.ts has no
// free-kick concept at all" — until Aug 2026 round 19 built one (see
// `BoxScoreLine.freeKicksFor`/`freeKicksAgainst`, `P_HIGH_CONTACT_FREE_KICK`/
// `P_KICK_GOES_OUT_ON_FULL` in match.ts). Wired into the real, verified
// formula's actual term now rather than left as a permanent zero.
// ---------------------------------------------------------------------------

export function fantasyPointsFor(line: BoxScoreLine): number {
  return (
    3 * line.kicks +
    2 * line.handballs +
    3 * line.marks +
    4 * line.tackles +
    1 * line.hitouts +
    1 * line.freeKicksFor -
    3 * line.freeKicksAgainst +
    6 * line.goals +
    1 * line.behinds
  );
}

// ---------------------------------------------------------------------------
// Layer 3: AussieFootySim Rating — "award points per resolved engine event... apply
// the zone multiplier... apply a live state-of-game multiplier... apply a
// per-match normalisation pass." Every constant below is the same kind of
// "deliberately roughed in, checked against real reference points, meant for
// the balance simulator to tune later" number as everywhere else in this
// project (contest.ts's `K`, match.ts's placeholder probabilities, etc.) —
// not a literal transcription of Champion Data's real (still partly secret)
// weights.
// ---------------------------------------------------------------------------

export interface AussieFootySimRatingLine {
  playerId: number;
  /** The headline number — event-weighted, zone- and state-of-game-adjusted, pool-normalised. */
  rating: number;
  /**
   * `rating` minus the equivalent pool-normalised score with the
   * state-of-game multiplier stripped out — positive means this player's
   * output skewed toward high-leverage moments (Player Ratings.md's
   * "clutch" flavour stat, after Popowski's SuperCoach analysis). Zero-sum
   * *within* a match by construction, since raw and adjusted totals are each
   * independently rescaled to the same target pool.
   */
  clutch: number;
}

/**
 * Event-type base weights, mapped from Player Ratings.md's disclosed
 * (partial) SuperCoach table onto the specific events match.ts is actually
 * capable of distinguishing. Where the engine's own event vocabulary is
 * coarser than SuperCoach's real one, the closest defensible analog is used
 * — documented per constant below, same "close to the disclosed table" license
 * the spec itself grants rather than a literal 1:1 transcription.
 */
const HITOUT_TO_ADVANTAGE = 5; // disclosed: "Hit out to advantage"
const HITOUT_SHARKED = -1; // disclosed: "Hit out sharked"
const HITOUT_NEUTRAL = 0; // disclosed: plain "Hit out" — fallback only, see hitoutOutcome(): runStoppage always logs a clearance event immediately after a hitout, so this should only fire if a quarter's tick budget runs out mid-stoppage
const CLEARANCE = 4.5; // not named in the disclosed table; scored as "Contested poss. at ground level," the closest real analog to how clearanceRating() actually resolves a clearance
const TACKLE = 4; // disclosed: "Tackle"
const EFFECTIVE_KICK = 4; // disclosed: "Effective kick"
const EFFECTIVE_HANDBALL = 1.5; // disclosed: "Effective handball"
const CONTESTED_MARK = 6; // disclosed: "Contested mark" — not the higher "Intercept contested mark" (8), since match.ts's forward-50 mark contest isn't specifically modelled as an interception off a clean opposition possession
const CONTESTED_POSS_GROUND = 4.5; // disclosed: "Contested poss. at ground level" *and* "Intercept possession" both land on 4.5 in the table — match.ts scores an attacking ground-ball win and a defensive spoil-and-retain identically, so there's no need to tell them apart here either
const GOAL = 8; // disclosed: "Goal"
const BEHIND = 1; // disclosed: "Behind"
const FREE_KICK_WON = 4; // disclosed: "Free kick" — Aug 2026 round 19, see BoxScoreLine.freeKicksFor's own doc comment for what now actually produces this event. The conceding player isn't separately docked here (-4, "Free against") — same convention every other contest-loser in this file already follows (a tackled/spoiled/beaten player has no separate negative eventPoints entry either, just the absence of the positive one).

// "actions inside defensive-50 or forward-50 score ~20% more than the same action in the
// midfield." Applies uniformly to every event type including goals/behinds — a shot can only
// ever occur from forward-50 by construction (see runShot), so every goal/behind already
// receives this bonus automatically; not double-counted or special-cased separately.
const ZONE_MULTIPLIER = 1.2;

// State-of-game multiplier — "a multiplier between 0.5x (blowout garbage time) and ~2.0x
// (last-minute, close game), centred on 1.0x at kickoff... bell-curve in margin, widening as
// time runs out... soft cap (exponential decay) above ~1.5x." MARGIN_SCALE/SENSITIVITY were
// solved so the most extreme case (final tick, scores level) soft-caps to ≈1.95x — matching the
// spec's own disclosed real example (Dangerfield's and Roughead's real match-winning goals
// scored 1.95x and 1.96x, not a clean 2.0x).
const STATE_MARGIN_SCALE = 30; // points at which a margin starts to feel "safe" — roughly a 5-goal buffer
const STATE_SENSITIVITY = 3.3;
const STATE_SOFT_CAP_THRESHOLD = 1.5;
const STATE_CEILING = 2.0;
const STATE_FLOOR = 0.5;

/**
 * Target pool every match's *un-normalised* raw and adjusted AussieFootySim Rating
 * totals get rescaled to — Player Ratings.md's own "3300 rule" equivalent,
 * "pick a target pool that reads well against our 1-99 attribute scale."
 *
 * Checked empirically against 4 real simulated matches across different real
 * clubs/seeds (scratch/calibrate_ratings_pool.ts) rather than copying real
 * SuperCoach's own ~3300 figure blind: this engine resolves far fewer
 * discrete events per match than a real AFL game generates disposals alone
 * (~535 events across all 44 players here, vs real players averaging
 * 15-20+ disposals *each*), so matching real SuperCoach's exact per-player
 * numbers point-for-point isn't achievable without also matching its event
 * granularity. A real, disclosed trade-off came out of that check: no single
 * pool size hits both "best-on-ground lands under ~150" and "44-player
 * average lands at 60-70" (the spec's own two cited reference points)
 * simultaneously, since that ratio is fixed by this engine's own event
 * distribution shape, not adjustable by this constant alone. 2200 was picked
 * over the naive 3300 because it keeps the *displayed* headline numbers
 * (Best on Ground, Top Performers) in a sane range most of the time
 * (best-afield ~135-170 across the 4 test matches) at the cost of the
 * average sitting lower than the spec's reference (~50, vs the cited
 * 60-70) — the average isn't shown anywhere in the UI, so a display number
 * that never looks absurd was weighted over hitting an invisible one
 * exactly. A genuine "deliberately roughed in" number, same status as
 * everywhere else in this project — revisit with the balance simulator
 * (Phase 6) once there's a large enough sample to see the real distribution
 * shape, not just 4 matches.
 */
const TARGET_POOL = 2200;

function zoneMultiplier(zone: Zone): number {
  return zone === 0 || zone === 4 ? ZONE_MULTIPLIER : 1;
}

/** Closeness-and-lateness-driven live multiplier — see the doc comment above for the disclosed shape this reconstructs and the calibration this was checked against. */
function stateOfGameMultiplier(marginAbs: number, tick: number, totalTicks: number): number {
  const lateness = totalTicks > 0 ? Math.min(1, tick / totalTicks) : 0; // 0 at kickoff, 1 at the final tick
  const closeness = 1 / (1 + marginAbs / STATE_MARGIN_SCALE); // 1 when scores are level, -> 0 as the margin grows
  const raw = 1.0 + lateness * (closeness - 0.5) * STATE_SENSITIVITY;
  const floored = Math.max(STATE_FLOOR, raw);
  if (floored <= STATE_SOFT_CAP_THRESHOLD) return floored;
  const excess = floored - STATE_SOFT_CAP_THRESHOLD;
  const room = STATE_CEILING - STATE_SOFT_CAP_THRESHOLD;
  return STATE_SOFT_CAP_THRESHOLD + room * (1 - Math.exp(-excess / room));
}

function findDelta(deltas: StatDelta[], stat: keyof BoxScoreLine): StatDelta | undefined {
  return deltas.find((d) => d.stat === stat);
}

/**
 * A hitout's real value depends on whether it actually advantaged its own
 * team — `match.ts`'s `resolveRuckTap` always logs a *separate* clearance
 * contest right after the hitout (`runClearance`), and that clearance can be
 * won by either side independent of who won the hitout — so "did the
 * hitout winner's own side also win the following clearance" is a real,
 * already-available signal for "to advantage" vs "sharked," not a guess
 * dressed up as one.
 *
 * Aug 2026 round 25: the clearance used to resolve in the *same tick* as
 * the hitout (a single `resolveStoppage` call), which is what the old
 * `next.tick !== events[index].tick` check was actually checking for. Now
 * that it's `runClearance`'s own separate game-loop tick
 * ([[Contest Resolution Redesign]] phased-plan item 3, "ruck-tap-then-
 * clearance as two ticks, not one function call"), the two events are
 * still always immediately adjacent in `events[]` (this engine's state
 * machine is strictly sequential — a `resolveRuckTap` return always routes
 * to `runClearance` next, nothing else can land in between), so checking
 * `next.phase === "CLEARANCE"` alone is the correct, sufficient successor
 * to the old same-tick check — no tick-adjacency test needed at all.
 */
function hitoutOutcome(hitout: StatDelta, index: number, events: MatchEvent[], sideOf: Map<number, Side>): number {
  const next = events[index + 1];
  if (!next || next.phase !== "CLEARANCE") return HITOUT_NEUTRAL;
  const clearance = findDelta(next.statDeltas, "clearances");
  if (!clearance) return HITOUT_NEUTRAL;
  return sideOf.get(hitout.playerId) === sideOf.get(clearance.playerId) ? HITOUT_TO_ADVANTAGE : HITOUT_SHARKED;
}

/**
 * Which player (if any) gets credited for this event, and its base
 * (pre-zone, pre-state-of-game) point value. Returns null for events that
 * don't score anything (a missed shot — logged with no statDeltas at all).
 */
function eventPoints(
  ev: MatchEvent,
  index: number,
  events: MatchEvent[],
  sideOf: Map<number, Side>,
): { playerId: number; base: number } | null {
  if (ev.phase === "STOPPAGE") {
    const hitout = findDelta(ev.statDeltas, "hitouts");
    if (hitout) return { playerId: hitout.playerId, base: hitoutOutcome(hitout, index, events, sideOf) };
  }

  // Aug 2026 round 25: clearances now log under their own "CLEARANCE" phase
  // (match.ts's runClearance), a real tick after the hitout's "STOPPAGE"
  // event rather than sharing its phase tag — see hitoutOutcome's own doc
  // comment. Split into its own branch rather than left inside the
  // STOPPAGE check above, which can now never see a clearance delta at all.
  if (ev.phase === "CLEARANCE") {
    const clearance = findDelta(ev.statDeltas, "clearances");
    if (clearance) return { playerId: clearance.playerId, base: CLEARANCE };
  }

  if (ev.phase === "GENERAL_PLAY") {
    const tackle = findDelta(ev.statDeltas, "tackles");
    if (tackle) return { playerId: tackle.playerId, base: TACKLE };
    const kick = findDelta(ev.statDeltas, "kicks");
    if (kick) return { playerId: kick.playerId, base: EFFECTIVE_KICK };
    const handball = findDelta(ev.statDeltas, "handballs");
    if (handball) return { playerId: handball.playerId, base: EFFECTIVE_HANDBALL };
    // Aug 2026 round 19: a free kick with no accompanying kick/handball delta
    // on the same event (the High Contact branch — the carrier keeps the
    // ball uncontested rather than immediately disposing; the Out on the
    // Full branch already matches the `kick` check above instead, since that
    // event's own carrier still genuinely kicked it). Checked last, after
    // the three more specific stat types above, so it never shadows them.
    const freeKick = findDelta(ev.statDeltas, "freeKicksFor");
    if (freeKick) return { playerId: freeKick.playerId, base: FREE_KICK_WON };
  }

  if (ev.phase === "CONTEST") {
    const contestedMark = findDelta(ev.statDeltas, "contestedMarks");
    if (contestedMark) return { playerId: contestedMark.playerId, base: CONTESTED_MARK };
    const contestedPoss = findDelta(ev.statDeltas, "contestedPoss");
    if (contestedPoss) return { playerId: contestedPoss.playerId, base: CONTESTED_POSS_GROUND };
  }

  if (ev.phase === "SHOT") {
    const goal = findDelta(ev.statDeltas, "goals");
    if (goal) return { playerId: goal.playerId, base: GOAL };
    const behind = findDelta(ev.statDeltas, "behinds");
    if (behind) return { playerId: behind.playerId, base: BEHIND };
  }

  return null;
}

/**
 * The full AussieFootySim Rating for every selected player in `result`, keyed by
 * PlayerID — every player on both `home`/`away` gets a line, zero if the
 * event log never credited them with anything, same "everyone gets a line"
 * convention match.ts's own boxScore uses.
 *
 * Requires `result.events` to be populated (`SimulateMatchOptions.recordEvents`,
 * true by default) — this is genuinely an event-weighted rating, not a
 * box-score formula, so a match simulated with events off (the balance
 * simulator's 10,000-game mode) will produce all-zero lines here. Expected,
 * not a bug: the balance simulator doesn't call this function.
 */
export function computeAussieFootySimRatings(
  result: MatchResult,
  home: MatchTeam,
  away: MatchTeam,
): Record<number, AussieFootySimRatingLine> {
  const sideOf = new Map<number, Side>();
  for (const p of home.players) sideOf.set(p.PlayerID, "home");
  for (const p of away.players) sideOf.set(p.PlayerID, "away");

  const raw: Record<number, number> = {};
  const adjusted: Record<number, number> = {};
  for (const p of [...home.players, ...away.players]) {
    raw[p.PlayerID] = 0;
    adjusted[p.PlayerID] = 0;
  }

  const totalTicks = result.ticksPerQuarter * 4;
  let homePoints = 0;
  let awayPoints = 0;

  const events = result.events;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];

    // Margin BEFORE this event's own scoring effect — the actual pressure/stakes
    // the player was facing when this event happened, not the result of it.
    const marginAbs = Math.abs(homePoints - awayPoints);

    const scored = eventPoints(ev, i, events, sideOf);
    if (scored) {
      const base = scored.base * zoneMultiplier(ev.zone);
      const stateMult = stateOfGameMultiplier(marginAbs, ev.tick, totalTicks);
      raw[scored.playerId] = (raw[scored.playerId] ?? 0) + base;
      adjusted[scored.playerId] = (adjusted[scored.playerId] ?? 0) + base * stateMult;
    }

    // Now apply this event's own effect on the running score, for subsequent events.
    for (const d of ev.statDeltas) {
      if (d.stat !== "goals" && d.stat !== "behinds") continue;
      const side = sideOf.get(d.playerId);
      const pts = d.stat === "goals" ? 6 * d.delta : d.delta;
      if (side === "home") homePoints += pts;
      else if (side === "away") awayPoints += pts;
    }
  }

  const totalRaw = Object.values(raw).reduce((a, b) => a + b, 0);
  const totalAdjusted = Object.values(adjusted).reduce((a, b) => a + b, 0);
  const scaleRaw = totalRaw > 0 ? TARGET_POOL / totalRaw : 0;
  const scaleAdjusted = totalAdjusted > 0 ? TARGET_POOL / totalAdjusted : 0;

  const out: Record<number, AussieFootySimRatingLine> = {};
  for (const p of [...home.players, ...away.players]) {
    const id = p.PlayerID;
    const normRaw = raw[id] * scaleRaw;
    const normAdjusted = adjusted[id] * scaleAdjusted;
    out[id] = { playerId: id, rating: normAdjusted, clutch: normAdjusted - normRaw };
  }
  return out;
}
