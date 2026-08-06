import { useEffect, useMemo, useRef, useState } from "react";
import type { MatchResult, MatchEvent, BoxScoreLine } from "../engine/match";

/**
 * Turns a fully-simulated (deterministic, already-computed) MatchResult into
 * a controllable playback — User Interface.md "Live match screen": Pause,
 * Sim Quarter/Sim Game (approximated here as speed steps), Skip to Full
 * Time, speed multiplier 0.5x/1x/2x/4x/8x.
 *
 * Deliberate architecture: src/engine/match.ts always simulates the *entire*
 * match instantly (it's a pure function of a seed) — this hook doesn't
 * re-simulate anything, it just reveals the pre-computed event log at a
 * controllable pace. That's what makes "Skip to Full Time" trivial (jump the
 * index to the end) and keeps the engine itself simple and synchronous.
 */
export type PlaybackSpeed = 0.5 | 1 | 2 | 4 | 8;
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
  restart: () => void;
}

export function useMatchPlayback(result: MatchResult | null, homeIds: Set<number>, awayIds: Set<number>): MatchPlayback {
  const [currentIndex, setCurrentIndex] = useState(-1); // -1 = nothing revealed yet (pre-match)
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeedState] = useState<PlaybackSpeed>(1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset playback whenever a new match result comes in.
  useEffect(() => {
    setCurrentIndex(-1);
    setIsPlaying(false);
  }, [result]);

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
    restart: () => {
      setIsPlaying(false);
      setCurrentIndex(-1);
    },
  };
}
