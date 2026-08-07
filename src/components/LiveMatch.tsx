import { useEffect, useMemo, useState } from "react";
import { CLUBS } from "../types/club";
import { getPlayersByClub } from "../data/loadPlayers";
import { pickBest22, type MatchTeam } from "../engine/team";
import { isLineupComplete, lineupToMatchTeam } from "../engine/selection";
import {
  simulateMatch,
  startMatch,
  simulateQuarter,
  setGameStyle,
  getGameStyle,
  matchResultSoFar,
  type MatchResult,
  type MatchInProgress,
  type BoxScoreLine,
} from "../engine/match";
import { mulberry32 } from "../engine/rng";
import type { TeamPlan, GameStyle } from "../engine/tactics";
import { useMatchPlayback, type PlaybackSpeed } from "../hooks/useMatchPlayback";
import { useGameStore } from "../store/useGameStore";
import { useSelectionStore } from "../store/useSelectionStore";
import { MatchCanvas } from "./MatchCanvas";
import { FullTimeResult } from "./FullTimeResult";
import { MatchPreparation } from "./MatchPreparation";
import { CoachsCall } from "./CoachsCall";

const SPEEDS: PlaybackSpeed[] = [0.5, 1, 2, 4, 8, 16];

const TEAM_STAT_KEYS = ["disposals", "marks", "tackles", "clearances", "hitouts"] as const;

type Stage = "setup" | "prep";

export function LiveMatch() {
  const [homeClub, setHomeClub] = useState(CLUBS[10].name); // Melbourne, arbitrary
  const [awayClub, setAwayClub] = useState(CLUBS[3].name); // Collingwood, arbitrary
  const [stage, setStage] = useState<Stage>("setup");
  const [result, setResult] = useState<MatchResult | null>(null);
  const [lastSeed, setLastSeed] = useState<number | null>(null);

  /**
   * Quarter-time Coach's Call (Engine.md "Match-day flow" step 4) — only
   * ever populated when the user's own club is playing (see `mySide` and
   * `kickOff()` below). `matchInProgress` stays null for an AI-vs-AI game,
   * which still simulates instantly in one `simulateMatch()` call exactly
   * like every Match-tab game did before this feature existed.
   */
  const [matchInProgress, setMatchInProgress] = useState<MatchInProgress | null>(null);
  const [quartersSimulated, setQuartersSimulated] = useState(0);
  const [pendingCoachsCall, setPendingCoachsCall] = useState<{ side: "home" | "away"; quarterJustFinished: 1 | 2 | 3 } | null>(null);

  const myClub = useGameStore((s) => s.myClub);
  const myLineup = useSelectionStore((s) => s.lineupFor(myClub));

  /** Uses the coach's own Selection Committee lineup when it's their club and it's complete; every other club still falls back to the OVR-only auto-pick (see ROADMAP.md gap #16). */
  function resolveTeam(clubName: string): MatchTeam {
    const clubPlayers = getPlayersByClub(clubName);
    if (clubName === myClub && myLineup && isLineupComplete(myLineup)) {
      return lineupToMatchTeam(clubName, myLineup, clubPlayers);
    }
    return pickBest22(clubName, clubPlayers);
  }

  const homeTeam = useMemo(() => resolveTeam(homeClub), [homeClub, myClub, myLineup]);
  const awayTeam = useMemo(() => resolveTeam(awayClub), [awayClub, myClub, myLineup]);
  const homeIds = useMemo(() => new Set(homeTeam.players.map((p) => p.PlayerID)), [homeTeam]);
  const awayIds = useMemo(() => new Set(awayTeam.players.map((p) => p.PlayerID)), [awayTeam]);
  const homeIsCustom = homeClub === myClub && !!myLineup && isLineupComplete(myLineup);
  const awayIsCustom = awayClub === myClub && !!myLineup && isLineupComplete(myLineup);

  const playback = useMatchPlayback(result, homeIds, awayIds);

  /** Which side (if any) the user is actually coaching this game — a Coach's Call only ever applies to them; the AI opponent has no UI to make its own calls (ROADMAP.md gap #22). */
  const mySide: "home" | "away" | null = homeTeam.name === myClub ? "home" : awayTeam.name === myClub ? "away" : null;

  function kickOff(homePlan: TeamPlan, awayPlan: TeamPlan) {
    const seed = Math.floor(Math.random() * 1_000_000_000);
    setLastSeed(seed);

    if (!mySide) {
      // Neither side is the user's own club (e.g. watching two AI clubs
      // play) - no one to offer a Coach's Call to, so simulate the whole
      // match up front exactly like every Match-tab game did before this
      // feature existed.
      const fresh = simulateMatch(homeTeam, awayTeam, mulberry32(seed), seed, { homePlan, awayPlan });
      setResult(fresh);
      setMatchInProgress(null);
      setQuartersSimulated(4);
      return;
    }

    const match = startMatch(homeTeam, awayTeam, mulberry32(seed), seed, { homePlan, awayPlan });
    simulateQuarter(match, 1);
    setMatchInProgress(match);
    setQuartersSimulated(1);
    setResult(matchResultSoFar(match));
  }

  function newMatchup() {
    setResult(null);
    setStage("setup");
    setMatchInProgress(null);
    setQuartersSimulated(0);
    setPendingCoachsCall(null);
  }

  function chooseCoachsCall(style: GameStyle) {
    if (!matchInProgress || !pendingCoachsCall) return;
    setGameStyle(matchInProgress, pendingCoachsCall.side, style);
    const nextQuarter = (quartersSimulated + 1) as 1 | 2 | 3 | 4;
    simulateQuarter(matchInProgress, nextQuarter);
    setQuartersSimulated(nextQuarter);
    setResult(matchResultSoFar(matchInProgress));
    setPendingCoachsCall(null);
    playback.play(); // auto-resume - "click play and let it run," the Coach's Call is the only interruption
  }

  /** "Skip to Full Time" during an interactive match auto-simulates every remaining quarter with no further Coach's Call prompts (current game style holds), then jumps playback straight to the end - same "stop asking me things, just finish it" behaviour as skipping any other screen. A no-op simulation-wise for a non-interactive (AI-vs-AI) match, which already has the full result. */
  function skipRestOfMatch() {
    if (matchInProgress) {
      let q = quartersSimulated;
      while (q < 4) {
        q += 1;
        simulateQuarter(matchInProgress, q as 1 | 2 | 3 | 4);
      }
      setQuartersSimulated(4);
      setResult(matchResultSoFar(matchInProgress));
      setPendingCoachsCall(null);
    }
    playback.skipToFullTime();
  }

  // Detects "playback has caught up to a just-simulated quarter's end" and
  // surfaces the Coach's Call for the user's side. Falls back to
  // auto-continuing with no prompt if somehow neither side is the user's
  // club (shouldn't happen - kickOff() only ever starts an interactive,
  // matchInProgress-tracked match when mySide is set) rather than getting
  // stuck.
  useEffect(() => {
    if (!matchInProgress || !playback.isComplete || quartersSimulated >= 4 || pendingCoachsCall) return;
    if (mySide) {
      setPendingCoachsCall({ side: mySide, quarterJustFinished: quartersSimulated as 1 | 2 | 3 });
    } else {
      const nextQuarter = (quartersSimulated + 1) as 1 | 2 | 3 | 4;
      simulateQuarter(matchInProgress, nextQuarter);
      setQuartersSimulated(nextQuarter);
      setResult(matchResultSoFar(matchInProgress));
    }
  }, [playback.isComplete, matchInProgress, quartersSimulated, pendingCoachsCall, mySide]);

  if (playback.isComplete && result && quartersSimulated >= 4 && !pendingCoachsCall) {
    return <FullTimeResult result={result} homeTeam={homeTeam} awayTeam={awayTeam} onNewMatch={newMatchup} />;
  }

  if (stage === "prep" && !result) {
    return <MatchPreparation homeTeam={homeTeam} awayTeam={awayTeam} onBack={() => setStage("setup")} onKickOff={kickOff} />;
  }

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-1.5">
          <select
            className="rounded-lg border border-base-600 bg-base-900 px-3 py-2 text-sm"
            value={homeClub}
            onChange={(e) => setHomeClub(e.target.value)}
            disabled={!!result}
          >
            {CLUBS.map((c) => (
              <option key={c.ClubID} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          {homeIsCustom && <span className="stat-pill stat-pill-good">your lineup</span>}
        </div>
        <span className="text-slate-500">vs</span>
        <div className="flex items-center gap-1.5">
          <select
            className="rounded-lg border border-base-600 bg-base-900 px-3 py-2 text-sm"
            value={awayClub}
            onChange={(e) => setAwayClub(e.target.value)}
            disabled={!!result}
          >
            {CLUBS.map((c) => (
              <option key={c.ClubID} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
          {awayIsCustom && <span className="stat-pill stat-pill-good">your lineup</span>}
        </div>
        {!result ? (
          <button
            onClick={() => setStage("prep")}
            disabled={homeClub === awayClub}
            className="ml-auto rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-dark disabled:opacity-40"
          >
            Continue to Match Preparation
          </button>
        ) : (
          <button
            onClick={newMatchup}
            className="ml-auto rounded-lg bg-base-700 px-4 py-2 text-sm font-medium text-slate-200 hover:bg-base-600"
          >
            New match-up
          </button>
        )}
      </div>

      {!result && (
        <div className="card text-sm text-slate-400">
          Pick two clubs and continue to Match Preparation to set tactics, a tagger, and a game
          style (or just kick off with the defaults). {myClub} fields whatever's set on the
          Selection tab once it's a full 22; every other club still fields the auto-picked
          best-22 by OVR (no AI Selection Committee behaviour yet — see ROADMAP.md). The match
          runs against a fresh random seed every time.
        </div>
      )}

      {result && (
        <>
          <div className="card">
            <div className="mb-3 flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
              <span>
                {playback.currentEvent ? `Quarter ${playback.currentEvent.quarter}` : "Pre-match"} &middot; tick{" "}
                {playback.currentIndex + 1}/{result.events.length}
              </span>
              <span>seed {lastSeed}</span>
            </div>
            <div className="flex items-center justify-between">
              <ScoreBlock name={homeTeam.name} goals={playback.liveScore.homeGoals} behinds={playback.liveScore.homeBehinds} points={playback.liveScore.homePoints} align="left" />
              <div className="px-4 text-2xl text-slate-600">vs</div>
              <ScoreBlock name={awayTeam.name} goals={playback.liveScore.awayGoals} behinds={playback.liveScore.awayBehinds} points={playback.liveScore.awayPoints} align="right" />
            </div>
          </div>

          <MatchCanvas home={homeTeam} away={awayTeam} event={playback.currentEvent} liveBoxScore={playback.liveBoxScore} isPlaying={playback.isPlaying} />

          {pendingCoachsCall ? (
            <CoachsCall
              quarterJustFinished={pendingCoachsCall.quarterJustFinished}
              currentStyle={matchInProgress ? getGameStyle(matchInProgress, pendingCoachsCall.side) : "Balanced"}
              onChoose={chooseCoachsCall}
            />
          ) : (
            <div className="card flex flex-wrap items-center gap-2">
              {playback.isPlaying ? (
                <button onClick={playback.pause} className="rounded-lg bg-base-700 px-4 py-2 text-sm font-medium hover:bg-base-600">
                  Pause
                </button>
              ) : (
                <button onClick={playback.play} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-dark">
                  {playback.currentIndex < 0 ? "Play" : "Resume"}
                </button>
              )}
              <div className="flex items-center gap-1">
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    onClick={() => playback.setSpeed(s)}
                    className={`rounded-lg px-3 py-2 text-xs font-medium ${
                      playback.speed === s ? "bg-accent text-white" : "bg-base-800 text-slate-300 hover:bg-base-700"
                    }`}
                  >
                    {s}x
                  </button>
                ))}
              </div>
              <button
                onClick={playback.skipQuarter}
                disabled={playback.isComplete}
                className="ml-auto rounded-lg bg-base-700 px-4 py-2 text-sm font-medium hover:bg-base-600 disabled:opacity-40"
                title="Instantly reveal the rest of this quarter's already-simulated events"
              >
                Sim Quarter
              </button>
              <button onClick={skipRestOfMatch} className="rounded-lg bg-base-700 px-4 py-2 text-sm font-medium hover:bg-base-600">
                Skip to Full Time
              </button>
              <button onClick={playback.restart} className="rounded-lg bg-base-800 px-4 py-2 text-sm text-slate-400 hover:bg-base-700">
                Restart
              </button>
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <TeamStatBars label={homeTeam.name} otherLabel={awayTeam.name} own={teamTotals(playback.liveBoxScore, homeIds)} other={teamTotals(playback.liveBoxScore, awayIds)} />
            <PlayByPlay events={result.events.slice(0, playback.currentIndex + 1)} />
          </div>
        </>
      )}
    </div>
  );
}

function ScoreBlock({
  name,
  goals,
  behinds,
  points,
  align,
}: {
  name: string;
  goals: number;
  behinds: number;
  points: number;
  align: "left" | "right";
}) {
  return (
    <div className={align === "left" ? "text-left" : "text-right"}>
      <div className="text-sm text-slate-400">{name}</div>
      <div className="text-3xl font-bold tabular-nums">{points}</div>
      <div className="text-xs text-slate-500 tabular-nums">
        {goals}.{behinds}
      </div>
    </div>
  );
}

function teamTotals(box: Record<number, BoxScoreLine>, ids: Set<number>) {
  const totals: Record<string, number> = {};
  for (const key of TEAM_STAT_KEYS) totals[key] = 0;
  for (const [idStr, line] of Object.entries(box)) {
    if (!ids.has(Number(idStr))) continue;
    for (const key of TEAM_STAT_KEYS) totals[key] += line[key];
  }
  return totals;
}

function TeamStatBars({
  label,
  otherLabel,
  own,
  other,
}: {
  label: string;
  otherLabel: string;
  own: Record<string, number>;
  other: Record<string, number>;
}) {
  return (
    <div className="card">
      <div className="mb-3 text-xs uppercase tracking-wide text-slate-400">
        {label} <span className="text-slate-600">vs</span> {otherLabel}
      </div>
      <div className="space-y-2">
        {TEAM_STAT_KEYS.map((key) => {
          const total = own[key] + other[key];
          const pct = total === 0 ? 50 : (own[key] / total) * 100;
          return (
            <div key={key}>
              <div className="mb-0.5 flex justify-between text-xs tabular-nums text-slate-400">
                <span>{own[key]}</span>
                <span className="capitalize text-slate-500">{key}</span>
                <span>{other[key]}</span>
              </div>
              <div className="flex h-1.5 overflow-hidden rounded-full bg-base-700">
                <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                <div className="h-full bg-info" style={{ width: `${100 - pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PlayByPlay({ events }: { events: MatchResult["events"] }) {
  const recent = [...events].reverse().slice(0, 40);
  return (
    <div className="card">
      <div className="mb-3 text-xs uppercase tracking-wide text-slate-400">Play by play</div>
      <div className="max-h-64 space-y-1 overflow-y-auto text-sm">
        {recent.length === 0 && <div className="text-slate-500">Kick-off coming up…</div>}
        {recent.map((ev) => (
          <div key={ev.tick} className="flex gap-2 text-slate-300">
            <span className="w-10 shrink-0 tabular-nums text-slate-500">Q{ev.quarter}</span>
            <span>{ev.description}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
