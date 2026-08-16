import { useEffect, useMemo, useRef, useState } from "react";
import type { MatchResult, MatchEvent, BoxScoreLine } from "../engine/match";

/**
 * Turns a fully- or partially-simulated MatchResult into a controllable
 * playback — User Interface.md "Live match screen": Pause, Sim Quarter, Sim
 * Game, Skip to Full Time, speed multiplier 0.5x/1x/2x/4x/8x/16x.
 *
 * Deliberate architecture: this hook doesn't re-simulate anything itself, it
 * just reveals whatever's in `result.events` at a controllable pace — that's
 * what makes "Skip to Full Time" trivial (jump the index to the end) and
 * keeps the engine itself simple and synchronous. Historically `result` was
 * always the *entire* match, computed instantly up front. Since the
 * quarter-time Coach's Call (src/engine/match.ts's `simulateQuarter`), a
 * caller may instead grow `result.events` one quarter at a time across
 * several `MatchResult` objects that share the same `seed` — the
 * reset-on-new-match effect below keys off `result?.seed`, not `result`
 * itself, specifically so a same-seed object with a longer `events` array
 * (another quarter just simulated) *doesn't* reset `currentIndex` back to
 * -1 and replay from the start; it just naturally keeps revealing forward
 * from wherever playback had already reached. A genuinely new match-up
 * always has a different seed (or is `null`), so that case still resets
 * exactly as before.
 *
 * `skipQuarter` (Phase 7 Slice A, ROADMAP.md) makes "Sim Quarter" real
 * rather than "approximated here as speed steps" as this comment used to
 * say — every quarter's events already exist in `result.events` in full the
 * moment `simulateQuarter` runs (playback just reveals them at a pace), so
 * jumping straight to the last event of the *current* quarter is a free,
 * instant index jump, exactly like `skipToFullTime` already was.
 */
export type PlaybackSpeed = 0.5 | 1 | 2 | 4 | 8 | 16;
const BASE_TICK_MS = 450; // ms between events at 1x — tune freely, purely a UX feel constant

function emptyLine(): BoxScoreLine {
  return {
    disposals: 0,
    kicks: 0,
    handballs: 0,
    marks: 0,
    contestedMarks: 0,
    tackles: 0,
    clearances: 0,
    hitouts: 0,
    contestedPoss: 0,
    uncontestedPoss: 0,
    goals: 0,
    behinds: 0,
    // Kept in sync with engine/match.ts's own emptyLine() — see that file's
    // BoxScoreLine doc comment (Aug 2026 contest-stat fields).
    markLeadAttempts: 0,
    markLeadWins: 0,
    markContestedAttempts: 0,
    markContestedWins: 0,
    groundBallAttempts: 0,
    groundBallWins: 0,
    tackleAttempts: 0,
    tackleWins: 0,
    ruckAttempts: 0,
    ruckWins: 0,
    clearanceAttempts: 0,
    clearanceWins: 0,
  };
}

export interface LiveScore {
  homeGoals: number;
  homeBehinds: number;
  homePoints: number;
  awayGoals: number;
  awayBehinds: number;
  awayPoints: number;
}

export interface MatchPlayback {
  currentIndex: number;
  currentEvent: MatchEvent | null;
  isPlaying: boolean;
  speed: PlaybackSpeed;
  isComplete: boolean;
  /** Every selected player's box score, accumulated from events[0..currentIndex] only — genuinely live, not the final result peeked early. */
  liveBoxScore: Record<number, BoxScoreLine>;
  liveScore: LiveScore;
  play: () => void;
  pause: () => void;
  setSpeed: (s: PlaybackSpeed) => void;
  skipToFullTime: () => void;
  /** Jumps straight to the last already-simulated event of the *current* quarter (see this file's own doc comment) — a smaller, quarter-scoped sibling of `skipToFullTime`. */
  skipQuarter: () => void;
  restart: () => void;
}

export function useMatchPlayback(result: MatchResult | null, homeIds: Set<number>, awayIds: Set<number>): MatchPlayback {
  const [currentIndex, setCurrentIndex] = useState(-1); // -1 = nothing revealed yet (pre-match)
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeedState] = useState<PlaybackSpeed>(1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset playback whenever a genuinely new match comes in (different seed,
  // or null) — see this hook's own doc comment for why the dependency is
  // `result?.seed` and not `result` itself.
  useEffect(() => {
    setCurrentIndex(-1);
    setIsPlaying(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed on seed, not the result object itself
  }, [result?.seed]);

  useEffect(() => {
    if (!isPlaying || !result) return;
    if (currentIndex >= result.events.length - 1) {
      setIsPlaying(false);
      return;
    }
    timerRef.current = setTimeout(() => {
      setCurrentIndex((i) => Math.min(i + 1, result.events.length - 1));
    }, BASE_TICK_MS / speed);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isPlaying, currentIndex, speed, result]);

  const currentEvent = result && currentIndex >= 0 ? result.events[currentIndex] : null;

  const liveBoxScore = useMemo(() => {
    const acc: Record<number, BoxScoreLine> = {};
    if (!result) return acc;
    for (const id of [...homeIds, ...awayIds]) acc[id] = emptyLine();
    for (let i = 0; i <= currentIndex && i < result.events.length; i++) {
      for (const d of result.events[i].statDeltas) {
        if (!acc[d.playerId]) acc[d.playerId] = emptyLine();
        (acc[d.playerId][d.stat] as number) += d.delta;
      }
    }
    return acc;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- homeIds/awayIds are stable Sets built from the current result
  }, [result, currentIndex]);

  const liveScore = useMemo<LiveScore>(() => {
    let homeGoals = 0,
      homeBehinds = 0,
      awayGoals = 0,
      awayBehinds = 0;
    for (const [idStr, line] of Object.entries(liveBoxScore)) {
      const id = Number(idStr);
      if (homeIds.has(id)) {
        homeGoals += line.goals;
        homeBehinds += line.behinds;
      } else if (awayIds.has(id)) {
        awayGoals += line.goals;
        awayBehinds += line.behinds;
      }
    }
    return {
      homeGoals,
      homeBehinds,
      homePoints: homeGoals * 6 + homeBehinds,
      awayGoals,
      awayBehinds,
      awayPoints: awayGoals * 6 + awayBehinds,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveBoxScore]);

  return {
    currentIndex,
    currentEvent,
    isPlaying,
    speed,
    isComplete: !!result && currentIndex >= result.events.length - 1,
    liveBoxScore,
    liveScore,
    play: () => setIsPlaying(true),
    pause: () => setIsPlaying(false),
    setSpeed: setSpeedState,
    skipToFullTime: () => {
      setIsPlaying(false);
      if (result) setCurrentIndex(result.events.length - 1);
    },
    skipQuarter: () => {
      if (!result) return;
      const q = currentEvent?.quarter ?? 1;
      let lastIdxForQuarter = currentIndex;
      for (let i = 0; i < result.events.length; i++) {
        if (result.events[i].quarter === q) lastIdxForQuarter = i;
      }
      setIsPlaying(false);
      setCurrentIndex((i) => Math.max(i, lastIdxForQuarter));
    },
    restart: () => {
      setIsPlaying(false);
      setCurrentIndex(-1);
    },
  };
}
