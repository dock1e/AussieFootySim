import { useEffect, useMemo, useRef, useState } from "react";
import { CLUBS, clubByName } from "../types/club";
import { playerFullName, type Player } from "../types/player";
import { getPlayersByClub } from "../data/loadPlayers";
import type { MatchTeam } from "../engine/team";
import { autoFillLineup, isLineupComplete, lineupToMatchTeam } from "../engine/selection";
import {
  simulateMatch,
  startMatch,
  simulateQuarter,
  setGameStyle,
  getGameStyle,
  matchResultSoFar,
  type MatchResult,
  type MatchInProgress,
  type MatchEvent,
  type BoxScoreLine,
  CONTEST_STAT_FIELDS,
} from "../engine/match";
import type { ContestType } from "../engine/contestTypes";
import { ZONE_NAMES, ZONES, ownZone, type Side, type Zone } from "../engine/zones";
import { mulberry32 } from "../engine/rng";
import { fantasyPointsFor } from "../engine/ratings";
import { setActiveGround } from "../engine/ground";
import { groundForMatch } from "../data/clubGrounds";
import { DEFAULT_GAME_STYLE, type TeamPlan, type GameStyle } from "../engine/tactics";
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

  /**
   * Each side's current game style, kept in sync with whatever `kickOff`
   * actually started the match with and whatever a Coach's Call changes it
   * to mid-match — Aug 2026, feeds `MatchCanvas`'s new `homeStyle`/
   * `awayStyle` props (see engine/ground.ts's `gameStyleAnchorBias`) so the
   * ground rendering's positional shape actually reflects the chosen game
   * style, not just its disposal/contest-rating effects. Deliberately local
   * state here rather than reading back through `matchInProgress` (which
   * only exists for an interactive match — see `getGameStyle`'s other call
   * site below) so a non-interactive AI-vs-AI game (no `matchInProgress` at
   * all) still renders its own fixed-for-the-whole-match style correctly.
   */
  const [homeStyle, setHomeStyle] = useState<GameStyle>(DEFAULT_GAME_STYLE);
  const [awayStyle, setAwayStyle] = useState<GameStyle>(DEFAULT_GAME_STYLE);

  /**
   * Click-to-inspect player stats (Aug 2026, Tyler: "In the match sim and at
   * half time I want to be able to click on a player and see their
   * statistics and how they're influencing the game... so that as a coach we
   * can make decisions on what to do next") — available any time `result`
   * exists, which covers both cases in his ask without needing separate
   * plumbing: mid-match is just this screen while playing/paused, and half
   * time is just this same screen sitting on the Q2 Coach's Call. Holds the
   * clicked `Player` plus which `side` they're on (needed to mirror the zone
   * breakdown into *their own* attacking-direction terms — see
   * `PlayerMatchStatsModal`'s own doc comment) rather than re-deriving side
   * from `homeIds`/`awayIds` again on every render.
   */
  const [selectedPlayer, setSelectedPlayer] = useState<{ player: Player; side: Side } | null>(null);

  const myClub = useGameStore((s) => s.myClub);
  const myLineup = useSelectionStore((s) => s.lineupFor(myClub));

  /**
   * Fixture-driven ground selection (Aug 2026, Phase 10 round 14 — Tyler:
   * "Build just the smaller scope fixture") — this screen has no fixture/
   * round of its own (an ad-hoc "pick any two clubs" friendly, a fresh
   * random seed every time), so `groundForMatch` is called with just the
   * home club's id, which always resolves to that club's *primary* real
   * ground (see that function's own doc comment for why round-based
   * exceptions deliberately don't fire here). `activeGroundName` is a pure
   * re-derivation for display only, not a read-back of engine state — kept
   * in sync with `setActiveGround` below by construction, since both come
   * from the exact same `groundForMatch` call.
   */
  const homeClubId = clubByName(homeClub)?.ClubID;
  const activeGround = groundForMatch(homeClubId ?? -1);
  useEffect(() => {
    setActiveGround(activeGround);
  }, [activeGround]);

  /** Uses the coach's own Selection Committee lineup when it's their club and it's complete; every other club falls back to the same real, suitability-aware auto-fill (`autoFillLineup`) an AI club gets in season simulation now — see engine/season.ts's `buildTeams` and [[Tactics and Positional Play]] — rather than the old coarse OVR-only `pickBest22`. */
  function resolveTeam(clubName: string): MatchTeam {
    const clubPlayers = getPlayersByClub(clubName);
    if (clubName === myClub && myLineup && isLineupComplete(myLineup)) {
      return lineupToMatchTeam(clubName, myLineup, clubPlayers);
    }
    return lineupToMatchTeam(clubName, autoFillLineup(clubPlayers), clubPlayers);
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
    setHomeStyle(homePlan.gameStyle);
    setAwayStyle(awayPlan.gameStyle);

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
    setHomeStyle(DEFAULT_GAME_STYLE);
    setAwayStyle(DEFAULT_GAME_STYLE);
  }

  function chooseCoachsCall(style: GameStyle) {
    if (!matchInProgress || !pendingCoachsCall) return;
    setGameStyle(matchInProgress, pendingCoachsCall.side, style);
    if (pendingCoachsCall.side === "home") setHomeStyle(style);
    else setAwayStyle(style);
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
        <span className="text-xs text-slate-500" title="Fixture-driven ground selection (Phase 10 round 14) - the home club's real primary ground, since this screen has no fixture round to check exceptions against">
          @ {activeGround.name}
        </span>
        {!result ? (
          <button
            onClick={() => setStage("prep")}
            disabled={homeClub === awayClub}
            className="ml-auto rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-40"
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
          Selection tab once it's a complete lineup; every other club fields the same real,
          suitability-aware auto-fill an AI club gets in season simulation. The match runs against
          a fresh random seed every time.
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

          <div className="grid grid-cols-1 gap-4 md:grid-cols-[205px_minmax(0,1fr)_205px]">
            <LivePlayerStats
              team={homeTeam}
              liveBoxScore={playback.liveBoxScore}
              onSelectPlayer={(p) => setSelectedPlayer({ player: p, side: "home" })}
            />
            <MatchCanvas
              home={homeTeam}
              away={awayTeam}
              event={playback.currentEvent}
              nextEvent={result.events[playback.currentIndex + 1] ?? null}
              liveBoxScore={playback.liveBoxScore}
              isPlaying={playback.isPlaying}
              homeStyle={homeStyle}
              awayStyle={awayStyle}
            />
            <LivePlayerStats
              team={awayTeam}
              liveBoxScore={playback.liveBoxScore}
              onSelectPlayer={(p) => setSelectedPlayer({ player: p, side: "away" })}
            />
          </div>

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
                <button onClick={playback.play} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark">
                  {playback.currentIndex < 0 ? "Play" : "Resume"}
                </button>
              )}
              <div className="flex items-center gap-1">
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    onClick={() => playback.setSpeed(s)}
                    className={`rounded-lg px-3 py-2 text-xs font-medium ${
                      playback.speed === s ? "bg-primary text-white" : "bg-base-800 text-slate-300 hover:bg-base-700"
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

          {selectedPlayer && (
            <PlayerMatchStatsModal
              player={selectedPlayer.player}
              side={selectedPlayer.side}
              line={playback.liveBoxScore[selectedPlayer.player.PlayerID]}
              events={result.events.slice(0, playback.currentIndex + 1)}
              onClose={() => setSelectedPlayer(null)}
            />
          )}
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

/**
 * Live per-player stat sidebar — Aug 2026 (Tyler, live testing): "we have a
 * lot of screen real estate to the left and right [of the ground]... down
 * the left we could have the Melbourne players statistics and down the
 * right the Collingwood players statistics," referencing footypig.com's
 * live-scores ticker as a style example. That reference page has ~11
 * columns (D/M/T/CP/CLR/HO/G.B/CLG/DE/TOG/SC); this only shows the ones
 * genuinely backed by real tracked data (`match.ts`'s `BoxScoreLine`) rather
 * than inventing the rest — no clanger/turnover tracking exists in this
 * engine at all, and neither disposal efficiency nor time-on-ground are
 * tracked per player, so CLG/DE/TOG are left out rather than faked. SC
 * (fantasy points) *is* real: `ratings.ts`'s `fantasyPointsFor` is a pure
 * function of `BoxScoreLine` totals with no whole-match normalisation step,
 * so — unlike `computeAussieFootySimRatings`, which rescales against the *entire*
 * match's final point pool and can't mean anything read mid-match — it's
 * safe to recompute live, every tick, from `liveBoxScore` alone. Sorted by
 * that live fantasy score, same "who's actually having a good game right
 * now" ordering footypig's own SC-sorted list uses.
 *
 * Rows are clickable (Aug 2026, Tyler's click-to-inspect ask, see
 * `PlayerMatchStatsModal`) — `onSelectPlayer` is optional purely so this
 * component doesn't need a dummy no-op handler at any future call site that
 * genuinely doesn't want the feature; every current caller (both of
 * LiveMatch's own sidebars) always passes one.
 */
function LivePlayerStats({
  team,
  liveBoxScore,
  onSelectPlayer,
}: {
  team: MatchTeam;
  liveBoxScore: Record<number, BoxScoreLine>;
  onSelectPlayer?: (player: Player) => void;
}) {
  const rows = team.players
    .map((p) => {
      const line = liveBoxScore[p.PlayerID];
      return { player: p, line, sc: line ? fantasyPointsFor(line) : 0 };
    })
    .sort((a, b) => b.sc - a.sc);

  return (
    <div className="card flex h-full flex-col !px-2">
      <div className="mb-2 truncate px-1 text-xs uppercase tracking-wide text-slate-400" title={team.name}>
        {team.name}
      </div>
      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-[11px] tabular-nums">
          <thead className="sticky top-0 bg-base-800 text-slate-500">
            <tr>
              <th className="pb-1 text-left font-medium">Player</th>
              <th className="pb-1 text-right font-medium" title="Disposals">
                D
              </th>
              <th className="pb-1 text-right font-medium" title="Marks">
                M
              </th>
              <th className="pb-1 text-right font-medium" title="Tackles">
                T
              </th>
              <th className="pb-1 text-right font-medium" title="Clearances">
                CLR
              </th>
              <th className="pb-1 text-right font-medium" title="Hitouts">
                HO
              </th>
              <th className="pb-1 text-right font-medium" title="Goals.Behinds">
                G.B
              </th>
              <th className="pb-1 text-right font-medium" title="Live fantasy score">
                SC
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ player, line, sc }, i) => (
              <tr
                key={player.PlayerID}
                onClick={() => onSelectPlayer?.(player)}
                className={`${i === 0 && sc > 0 ? "text-accent" : "text-slate-300"} ${onSelectPlayer ? "cursor-pointer hover:bg-base-700" : ""}`}
                title={onSelectPlayer ? `Click for ${playerFullName(player)}'s match stats` : undefined}
              >
                <td className="max-w-[64px] truncate py-0.5" title={playerFullName(player)}>
                  {player.lname}
                </td>
                <td className="text-right">{line?.disposals ?? 0}</td>
                <td className="text-right">{line?.marks ?? 0}</td>
                <td className="text-right">{line?.tackles ?? 0}</td>
                <td className="text-right">{line?.clearances ?? 0}</td>
                <td className="text-right">{line?.hitouts ?? 0}</td>
                <td className="text-right">
                  {line?.goals ?? 0}.{line?.behinds ?? 0}
                </td>
                <td className="text-right font-semibold">{Math.round(sc)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
                <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                <div className="h-full bg-info" style={{ width: `${100 - pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Newest-first play-by-play feed. Two real bugs fixed here Aug 2026, both
 * reported live by Tyler after actually watching matches on his own
 * machine:
 *
 * 1. Rows keyed on `ev.tick` could repeat visibly (e.g. "Daicos clears it
 *    for Collingwood" showing several times with unrelated events in
 *    between) — confirmed live by pulling the rendered DOM directly, not
 *    just from the screenshots. Root cause: `match.ts`'s `runStoppage`
 *    always logs *two* events (a hit-out, then its clearance) sharing one
 *    `ctx.tick`, so `key={ev.tick}` collided on every single stoppage —
 *    combined with this list re-ordering (newest-first) and growing every
 *    tick, duplicate keys are exactly the scenario React's own reconciler
 *    handles worst, and it showed up as stale/repeated row content. Fixed
 *    by keying on each event's own stable original index into the full
 *    `events` array instead — always unique, since events are only ever
 *    appended, never reordered or removed.
 * 2. The *sort* here was already newest-first (index 0 = most recent), but
 *    nothing kept the scrollable box actually showing that top row, so a
 *    user who'd scrolled at all would watch new rows arrive "underneath"
 *    their view and have to scroll back up to find them — which reads
 *    exactly like "newest should be at the top" from the outside even
 *    though the sort itself was correct. Fixed by pinning `scrollTop` to 0
 *    whenever a new event is revealed.
 */
function PlayByPlay({ events }: { events: MatchResult["events"] }) {
  const recent = events
    .map((ev, i) => ({ ev, i }))
    .reverse()
    .slice(0, 40);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [events.length]);

  return (
    <div className="card">
      <div className="mb-3 text-xs uppercase tracking-wide text-slate-400">Play by play</div>
      <div ref={scrollRef} className="max-h-64 space-y-1 overflow-y-auto text-sm">
        {recent.length === 0 && <div className="text-slate-500">Kick-off coming up…</div>}
        {recent.map(({ ev, i }) => (
          <div key={i} className="flex gap-2 text-slate-300">
            <span className="w-10 shrink-0 tabular-nums text-slate-500">Q{ev.quarter}</span>
            <span>{ev.description}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Which contest types get their own row in the modal below, and in what order — every `ContestType` CONTEST_STAT_FIELDS knows about, in roughly the order a coach thinks about them (marking situations, then the ball-on-the-ground/tackling scrap, then stoppages). */
const CONTEST_STAT_DISPLAY: { type: ContestType; label: string }[] = [
  { type: "markContested", label: "Contested Marking" },
  { type: "markLead", label: "Marking on a Lead" },
  { type: "groundBall", label: "Hard Ball Gets" },
  { type: "tackle", label: "Tackling" },
  { type: "clearance", label: "Clearances" },
  { type: "ruck", label: "Ruck Contests" },
];

/**
 * Aug 2026 (Tyler, live testing against a real Daicos screenshot): the
 * original single `TOUCH_STATS` set — disposals+marks+tackles+hitouts+
 * clearances all lumped together under "Where They're Getting Touches" —
 * summed to 13 for a match line reading 7 disposals, when only 7 of those 13
 * were actually the player *having the ball*. His diagnosis was exactly
 * right: a tackle is you stopping the *opponent* who has the ball, and a
 * hitout is a ruckman tapping it away, not retaining it — neither is a
 * "touch" in the sense the label claimed, even though both are genuinely
 * useful to know the location of. Rather than drop that information (Tyler:
 * "certainly we want to know where this player is involved in the
 * contests"), split it into two correctly-scoped, separately-labelled sets
 * instead of one misleading combined one:
 *
 * `POSSESSION_STATS` — the player genuinely had the ball: a disposal (kick
 * or handball out), a mark (caught it), or a clearance (won it clean from a
 * stoppage). Clearances and disposals never fire on the same statDelta event
 * (`match.ts`'s `runStoppage` credits a clearance at the stoppage itself;
 * any later kick/handball is always a separate, later event), so summing
 * these three's *event* count (via `.some()`, not adding the three numbers)
 * never double-counts one moment as two.
 *
 * `CONTEST_ONLY_STATS` — the player was genuinely involved but didn't come
 * away with the ball: a tackle (brought the opponent down) or a hitout (tapped
 * it, didn't retain it). Disjoint from `POSSESSION_STATS` by definition (an
 * event is either "I've got it" or "I don't, but I'm still part of this
 * contest") — the two zone charts below never share an event, so their totals
 * add back up to the original combined number with nothing lost.
 */
const POSSESSION_STATS = new Set<keyof BoxScoreLine>(["disposals", "marks", "clearances"]);
const CONTEST_ONLY_STATS = new Set<keyof BoxScoreLine>(["tackles", "hitouts"]);

/** Buckets every event where any of `statSet` fired for `player` into *their own* attacking-direction zone (`ownZone` — so "Forward 50" always means their forward 50, regardless of home/away or which raw zone the event was logged under). Shared by both the possession and contest-only charts below — same counting rule, different input set. */
function zoneCountsFor(player: Player, side: Side, events: MatchEvent[], statSet: Set<keyof BoxScoreLine>): Partial<Record<Zone, number>> {
  const counts: Partial<Record<Zone, number>> = {};
  for (const ev of events) {
    const matched = ev.statDeltas.some((d) => d.playerId === player.PlayerID && statSet.has(d.stat));
    if (!matched) continue;
    const z = ownZone(side, ev.zone);
    counts[z] = (counts[z] ?? 0) + 1;
  }
  return counts;
}

/**
 * Click-to-inspect match stats (Aug 2026, Tyler: "I want to be able to click
 * on a player and see their statistics and how they're influencing the
 * game — where they are getting their touches... what are their contest
 * stats: ie, won 100% of contested marking situations, won 10% of marking
 * on a lead, won 0% of hard ball get contests etc... so that as a coach we
 * can make decisions on what to do next"). Deliberately a separate, smaller
 * component from `PlayerDetailModal` rather than reusing it — that modal is
 * a season-long player-profile view (attributes/contract/condition/
 * scouting/season totals), none of which is what a coach needs mid-match;
 * this one is entirely match-scoped: the live box score line plus the two
 * new pieces of data this same round's engine changes made possible for the
 * first time (per-contest-type win rates, and a zone breakdown of genuine
 * touches — see `CONTEST_STAT_FIELDS`/`touchZoneCounts` above).
 *
 * `line` can be `undefined` (a player who hasn't been involved in a single
 * statDelta yet, early in a quarter) — every read below falls back to 0/'—'
 * rather than crashing.
 */
function PlayerMatchStatsModal({
  player,
  side,
  line,
  events,
  onClose,
}: {
  player: Player;
  side: Side;
  line: BoxScoreLine | undefined;
  events: MatchEvent[];
  onClose: () => void;
}) {
  const possessionZoneCounts = zoneCountsFor(player, side, events, POSSESSION_STATS);
  const contestOnlyZoneCounts = zoneCountsFor(player, side, events, CONTEST_ONLY_STATS);
  const maxPossessionZoneCount = Math.max(1, ...ZONES.map((z) => possessionZoneCounts[z] ?? 0));
  const maxContestOnlyZoneCount = Math.max(1, ...ZONES.map((z) => contestOnlyZoneCounts[z] ?? 0));
  const hasContestOnlyActivity = ZONES.some((z) => (contestOnlyZoneCounts[z] ?? 0) > 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-card border border-base-600 bg-base-800 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-display text-2xl italic">
              #{player.jumperNumber} {playerFullName(player)}
            </div>
            <div className="text-xs text-slate-400">
              {player.archetype} &middot; {player.Team}
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg bg-base-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-base-600" aria-label="Close">
            Close
          </button>
        </div>

        <div className="mt-4">
          <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Contest Stats</div>
          <div className="space-y-1.5">
            {CONTEST_STAT_DISPLAY.map(({ type, label }) => {
              const fields = CONTEST_STAT_FIELDS[type];
              const attempts = line?.[fields.attempts] ?? 0;
              const wins = line?.[fields.wins] ?? 0;
              const pct = attempts > 0 ? Math.round((wins / attempts) * 100) : null;
              return (
                <div key={type} className="flex items-center justify-between text-sm">
                  <span className="text-slate-300">{label}</span>
                  <span className="tabular-nums">
                    {pct === null ? (
                      <span className="text-slate-500">No attempts yet</span>
                    ) : (
                      <>
                        {/* Round 16 (Aug 2026), Tyler: red should highlight "players or stats of
                            interest where players are excelling," not colour every number
                            regardless of value — this used to be text-accent-light unconditionally,
                            even for a 0% win rate. Now only a genuinely strong win rate (>=65%,
                            i.e. clearly winning more often than not) gets the highlight colour;
                            anything else reads as a plain, neutral number. */}
                        <span className={`font-semibold ${pct >= 65 ? "text-accent-light" : "text-slate-200"}`}>{pct}%</span>{" "}
                        <span className="text-slate-500">
                          ({wins}/{attempts})
                        </span>
                      </>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-1.5 text-[11px] text-slate-500">Win rate for each contest type this player has actually contested so far this match.</div>
        </div>

        <div className="mt-4">
          <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Where They're Winning the Ball</div>
          <div className="space-y-1.5">
            {ZONES.map((z) => {
              const count = possessionZoneCounts[z] ?? 0;
              const pct = (count / maxPossessionZoneCount) * 100;
              return (
                <div key={z}>
                  <div className="mb-0.5 flex items-center justify-between text-xs">
                    <span className="text-slate-400">{ZONE_NAMES[z]}</span>
                    <span className="tabular-nums font-semibold">{count}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-base-700">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-1.5 text-[11px] text-slate-500">
            Genuine possessions only (disposals, marks, clearances), in {player.Team}'s own attacking direction — "Forward 50" always means their forward 50.
          </div>
        </div>

        {hasContestOnlyActivity && (
          <div className="mt-4">
            <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Where They're Involved (Tackles &amp; Hitouts)</div>
            <div className="space-y-1.5">
              {ZONES.map((z) => {
                const count = contestOnlyZoneCounts[z] ?? 0;
                const pct = (count / maxContestOnlyZoneCount) * 100;
                return (
                  <div key={z}>
                    <div className="mb-0.5 flex items-center justify-between text-xs">
                      <span className="text-slate-400">{ZONE_NAMES[z]}</span>
                      <span className="tabular-nums font-semibold">{count}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-base-700">
                      <div className="h-full rounded-full bg-slate-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-1.5 text-[11px] text-slate-500">
              Contests this player was part of without necessarily coming away with the ball — a tackle stops the opponent who has it, a hitout taps it rather than retains it.
            </div>
          </div>
        )}

        <div className="mt-4">
          <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Match Totals</div>
          <div className="grid grid-cols-4 gap-2 text-center text-xs">
            {(
              [
                ["D", line?.disposals ?? 0],
                ["K", line?.kicks ?? 0],
                ["HB", line?.handballs ?? 0],
                ["M", line?.marks ?? 0],
                ["T", line?.tackles ?? 0],
                ["CLR", line?.clearances ?? 0],
                ["HO", line?.hitouts ?? 0],
                ["CP", line?.contestedPoss ?? 0],
                ["FF", line?.freeKicksFor ?? 0],
                ["FA", line?.freeKicksAgainst ?? 0],
                ["G", line?.goals ?? 0],
                ["B", line?.behinds ?? 0],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-lg bg-base-900 py-1.5">
                <div className="tabular-nums text-base font-semibold text-slate-200">{value}</div>
                <div className="text-slate-500">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
