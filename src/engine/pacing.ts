import type { MatchEvent } from "./match";
import { kickFlightDurationMs, shotFlightDurationMs } from "./ground";

/**
 * Variable event pacing — ROADMAP #11 (Oct 2026, PC11-inspired). How long the live match viewer keeps
 * each event on screen before revealing the next one.
 *
 * Before this, every event stayed up for one flat `BASE_TICK_MS`, stretched only far enough for a
 * kick or shot to finish its flight. Tyler's description of what PC11 did: handballs were quick
 * exchanges, a kick paused while the kicker backed away from his mark and decided, ball-ups had
 * players set up and wait for the tap, a free kick stopped play while it was sorted out. The pause
 * builds suspense where the outcome is genuinely open (where's the kick going, is the shot straight)
 * and stays brisk where it isn't.
 *
 * The ball moves during the event that launches it (`ballTargetFor` aims it at the next event's
 * player), so a "deciding" pause belongs on the event where the ball comes to rest in someone's
 * hands: the mark, the free kick, the stoppage, the goal. That event's dwell is extended; the kick
 * that follows still flies at its own pace. Purely playback: the engine's tick budget and every
 * calibrated rate are untouched.
 *
 * Speed: the whole hold divides by the playback speed, as before. The dead-ball pauses on top of the
 * base hold are dropped at 8x and 16x, where the viewer is fast-forwarding and wants the play, not
 * the drama.
 */

/** ms an ordinary event stays up at 1x. Also `useMatchPlayback.ts`'s old flat pace. */
export const BASE_TICK_MS = 450;
/** A handball under no real decision pressure: a quick exchange. */
export const HANDBALL_TICK_MS = 300;

/** Extra dwell at 1x, on top of the base/flight hold, for each kind of dead-ball moment. Reasoned UX-feel numbers. */
export const PAUSE_MS = {
  /** Players celebrate, then trot back for the centre bounce (interchanges follow as their own events). */
  goal: 1800,
  /** The full-back collects it and sets up the kick-in. */
  behind: 700,
  /** Play stops while the umpire sorts out the free kick and the man on the mark sets. */
  freeKick: 1100,
  /** The marking player backs away from the mark and decides; leads start to spread. */
  mark: 700,
  /** Lining up a set shot: the extra suspense before the kick at goal. */
  setShotLineUp: 1000,
  /** A snap opportunity: a short breath before the shot. */
  snapLineUp: 250,
  /** Ball-up, throw-in or centre bounce: players set up and wait for the tap. */
  stoppage: 700,
  /** A landed tackle: the pile settles before the ball comes out. */
  tackle: 300,
  /** An injury: play stops while he's helped off. */
  injury: 1200,
  /** Each goal-reset interchange stays up long enough to read who's coming on. */
  interchange: 250,
} as const;

/** At or above this playback speed the dead-ball pauses are skipped. */
export const SKIP_PAUSES_AT_SPEED = 8;

function hasStat(event: MatchEvent, stat: string): boolean {
  return event.statDeltas.some((d) => d.stat === stat);
}

/** The extra dead-ball dwell (ms at 1x) this event earns. 0 for open play. */
export function deadBallPauseMs(current: MatchEvent, next: MatchEvent | null): number {
  if (current.injury) return PAUSE_MS.injury;
  if (current.interchange) return PAUSE_MS.interchange;
  if (current.phase === "SHOT") {
    if (hasStat(current, "goals")) return PAUSE_MS.goal;
    if (hasStat(current, "behinds")) return PAUSE_MS.behind;
    return 0;
  }
  const nextIsShot = next?.phase === "SHOT";
  const lineUp = nextIsShot ? (next.isSetShot === false ? PAUSE_MS.snapLineUp : PAUSE_MS.setShotLineUp) : 0;
  if (current.freeKick) return Math.max(PAUSE_MS.freeKick, lineUp);
  if (hasStat(current, "marks")) return Math.max(PAUSE_MS.mark, lineUp);
  if (lineUp) return lineUp;
  if (current.phase === "STOPPAGE" && current.stoppageType) return PAUSE_MS.stoppage;
  if (hasStat(current, "tackles")) return PAUSE_MS.tackle;
  return 0;
}

/** A handball event that isn't also waiting on a flight: the quick end of the pacing range. */
function isQuickHandball(current: MatchEvent): boolean {
  return hasStat(current, "handballs") && !hasStat(current, "kicks");
}

/** Real ms (after the speed divide) `current` should stay on screen before the next event is revealed. */
export function eventHoldMs(prev: MatchEvent | null, current: MatchEvent | null, next: MatchEvent | null, speed: number): number {
  if (!current) return BASE_TICK_MS / speed;
  const base = isQuickHandball(current) ? HANDBALL_TICK_MS : BASE_TICK_MS;
  const motion = Math.max(base, kickFlightDurationMs(prev, current), shotFlightDurationMs(current));
  const pause = speed >= SKIP_PAUSES_AT_SPEED ? 0 : deadBallPauseMs(current, next);
  return (motion + pause) / speed;
}

/**
 * True while the ball is resting in a player's hands at a dead-ball moment (a mark, a free kick)
 * — the viewer gives the ball a small idle wobble then, PC11's "jiggle" cue for a player deciding.
 */
export function isBallHeldDead(current: MatchEvent | null): boolean {
  if (!current || current.phase === "SHOT") return false;
  return !!current.freeKick || hasStat(current, "marks");
}
