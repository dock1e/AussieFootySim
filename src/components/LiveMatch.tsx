import { useEffect, useMemo, useRef, useState } from "react";
import { CLUBS, clubByName } from "../types/club";
import { playerFullName, type Player } from "../types/player";
import { getPlayersByClub } from "../data/loadPlayers";
import { onGroundPlayers, type MatchTeam } from "../engine/team";
import { autoFillLineup, isLineupComplete, lineupToMatchTeam } from "../engine/selection";
import {
  simulateMatch,
  startMatch,
  simulateQuarter,
  setGameStyle,
  getGameStyle,
  setLineFocus,
  getLineFocus,
  lineFeedbackFor,
  matchResultSoFar,
  attemptInterchange,
  fitnessFor,
  type MatchResult,
  type MatchInProgress,
  type BoxScoreLine,
} from "../engine/match";
import type { LineCoachFocus } from "../engine/lineCoaching";
import { ASSISTANT_COACH_POOL } from "../data/assistantCoachPool";
import { MATCH_DAY_COACH_ROLES, type MatchDayCoachRole } from "../types/coach";
import type { Side } from "../engine/zones";
import { mulberry32 } from "../engine/rng";
import { fantasyPointsFor } from "../engine/ratings";
import { quarterlyPoints, type QuarterPoints } from "../engine/summary";
import { groundForMatch } from "../data/clubGrounds";
import { DEFAULT_GAME_STYLE, type TeamPlan, type GameStyle } from "../engine/tactics";
import { useMatchPlayback, type PlaybackSpeed, type MatchPlayback } from "../hooks/useMatchPlayback";
import { useGameStore } from "../store/useGameStore";
import { useSelectionStore } from "../store/useSelectionStore";
import { useSaveStore } from "../store/useSaveStore";
import { GroundView } from "./GroundView";
import { FullTimeResult } from "./FullTimeResult";
import { MatchPreparation } from "./MatchPreparation";
import { QuarterTimeDecisionRoom } from "./QuarterTimeDecisionRoom";
import { ClubBadgeByName } from "./ClubBadge";
import { PlayerMatchDrawer } from "./PlayerMatchDrawer";

const SPEEDS: PlaybackSpeed[] = [0.5, 1, 2, 4, 8, 16];

const TEAM_STAT_KEYS = ["disposals", "marks", "tackles", "clearances", "hitouts"] as const;

type Stage = "setup" | "prep";

export function LiveMatch({ onCockpitActiveChange }: { onCockpitActiveChange?: (active: boolean) => void } = {}) {
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
   * to mid-match — Aug 2026, feeds `GroundView`'s (formerly `MatchCanvas`'s)
   * `homeStyle`/`awayStyle` props (see engine/ground.ts's `gameStyleAnchorBias`) so the
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
   * Sep 2026 round 84 — [[Match-Day Line Coach Direction]]. Same "single-slot, the human coach's own
   * club" shape as `talentScout` — see `SaveGameData.lineCoaches`'s own doc comment. Round 85 — read
   * ONLY here now; `assignLineCoach` moved to `SelectionCommittee.tsx`, since a hire made mid-match had
   * no retroactive effect on the match already in progress. This panel just displays whoever's
   * currently assigned (frozen at kickoff) alongside their live feedback/focus.
   */
  const lineCoaches = useSaveStore((s) => s.lineCoaches);
  /** [[Interchange Rotation]], round 48 — read broadly (every club, not just myClub) so resolveTeam can thread whichever side's own saved overrides through symmetrically; in practice only the human coach's own club ever has any (see Selection Committee's new eligibility editor). */
  const allEligibility = useSelectionStore((s) => s.eligibility);

  /**
   * Fixture-driven ground selection (Aug 2026, Phase 10 round 14 — Tyler:
   * "Build just the smaller scope fixture") — this screen has no fixture/
   * round of its own (an ad-hoc "pick any two clubs" friendly, a fresh
   * random seed every time), so `groundForMatch` is called with just the
   * home club's id, which always resolves to that club's *primary* real
   * ground (see that function's own doc comment for why round-based
   * exceptions deliberately don't fire here).
   *
   * Sep 2026 round 104 — [[Venue-Accurate Ground Renderer]]: `groundForMatch`
   * now returns a real `AFLStadium` (`data/stadiums.ts`), not the old
   * pixel-based `GroundConfig`. The `setActiveGround`/`useEffect` pairing
   * that used to live here is gone too — `GroundView` now owns syncing
   * `engine/ground.ts`'s active-stadium state to whatever `venue` prop it's
   * given (see its own venue-sync effect), so this screen just resolves the
   * venue and passes it straight through as a prop, same as `homeTeam`/
   * `awayTeam` below.
   */
  const homeClubId = clubByName(homeClub)?.ClubID;
  const venue = groundForMatch(homeClubId ?? -1);

  /** Uses the coach's own Selection Committee lineup when it's their club and it's complete; every other club falls back to the same real, suitability-aware auto-fill (`autoFillLineup`) an AI club gets in season simulation now — see engine/season.ts's `buildTeams` and [[Tactics and Positional Play]] — rather than the old coarse OVR-only `pickBest22`. */
  function resolveTeam(clubName: string): MatchTeam {
    const clubPlayers = getPlayersByClub(clubName);
    const eligibilityOverrides = allEligibility[clubName];
    if (clubName === myClub && myLineup && isLineupComplete(myLineup)) {
      return lineupToMatchTeam(clubName, myLineup, clubPlayers, eligibilityOverrides);
    }
    return lineupToMatchTeam(clubName, autoFillLineup(clubPlayers), clubPlayers, eligibilityOverrides);
  }

  const homeTeam = useMemo(() => resolveTeam(homeClub), [homeClub, myClub, myLineup, allEligibility]);
  const awayTeam = useMemo(() => resolveTeam(awayClub), [awayClub, myClub, myLineup, allEligibility]);
  const homeIds = useMemo(() => new Set(homeTeam.players.map((p) => p.PlayerID)), [homeTeam]);
  const awayIds = useMemo(() => new Set(awayTeam.players.map((p) => p.PlayerID)), [awayTeam]);
  const homeIsCustom = homeClub === myClub && !!myLineup && isLineupComplete(myLineup);
  const awayIsCustom = awayClub === myClub && !!myLineup && isLineupComplete(myLineup);

  const playback = useMatchPlayback(result, homeIds, awayIds);

  /** Which side (if any) the user is actually coaching this game — a Coach's Call only ever applies to them; the AI opponent has no UI to make its own calls (ROADMAP.md gap #22). */
  const mySide: "home" | "away" | null = homeTeam.name === myClub ? "home" : awayTeam.name === myClub ? "away" : null;

  /**
   * Sep 2026 round 84 — [[Match-Day Line Coach Direction]]. Resolves `lineCoaches` (the human
   * coach's own club-wide assignment) into the plain `role -> ovr/99` map `startMatch`'s
   * `homeLineCoachEffectiveness`/`awayLineCoachEffectiveness` options expect — match.ts itself has
   * no `Coach`/coach-pool dependency (see lineCoaching.ts's own top comment), so that resolution
   * happens here. Only ever non-empty for `mySide` — an AI opponent (or the other side, when
   * neither is the user's club) always plays with every line at the flat, unassigned baseline,
   * same as it always has for `homeCondition`/`homePlan` opting out.
   */
  function lineCoachEffectivenessForSide(side: "home" | "away"): Partial<Record<MatchDayCoachRole, number>> {
    if (side !== mySide) return {};
    const effectiveness: Partial<Record<MatchDayCoachRole, number>> = {};
    for (const role of MATCH_DAY_COACH_ROLES) {
      const coachId = lineCoaches[role];
      if (coachId === undefined) continue;
      const coach = ASSISTANT_COACH_POOL.find((c) => c.id === coachId);
      if (coach) effectiveness[role] = coach.ratings[role].ovr / 99;
    }
    return effectiveness;
  }

  function kickOff(homePlan: TeamPlan, awayPlan: TeamPlan) {
    const seed = Math.floor(Math.random() * 1_000_000_000);
    setLastSeed(seed);
    setHomeStyle(homePlan.gameStyle);
    setAwayStyle(awayPlan.gameStyle);
    const homeLineCoachEffectiveness = lineCoachEffectivenessForSide("home");
    const awayLineCoachEffectiveness = lineCoachEffectivenessForSide("away");

    if (!mySide) {
      // Neither side is the user's own club (e.g. watching two AI clubs
      // play) - no one to offer a Coach's Call to, so simulate the whole
      // match up front exactly like every Match-tab game did before this
      // feature existed.
      const fresh = simulateMatch(homeTeam, awayTeam, mulberry32(seed), seed, { homePlan, awayPlan, homeLineCoachEffectiveness, awayLineCoachEffectiveness, stadium: venue });
      setResult(fresh);
      setMatchInProgress(null);
      setQuartersSimulated(4);
      return;
    }

    const match = startMatch(homeTeam, awayTeam, mulberry32(seed), seed, { homePlan, awayPlan, homeLineCoachEffectiveness, awayLineCoachEffectiveness, stadium: venue });
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

  /**
   * Quarter-time manual interchange ([[Interchange Rotation]], round 48
   * Slice 1) — `QuarterTimeInterchange`'s own click-to-arm UI only ever
   * offers an already-eligibility-gated swap, so `attemptInterchange`
   * rejecting it here would only mean a genuine bug, not a real user
   * mistake to surface; logged rather than silently swallowed either way.
   * `matchInProgress`/`homeTeam`/`awayTeam` are mutated in place (the same
   * `MatchTeam` object references `startMatch` was handed at kick-off — see
   * `attemptInterchange`'s own doc comment), so the only thing actually
   * needed to make the swap visible is a re-render; re-deriving `result`
   * from the now-current `matchInProgress` is the exact same "something
   * changed inside the live match" signal `chooseCoachsCall`/
   * `skipRestOfMatch` already use for this.
   */
  function handleInterchange(side: "home" | "away", outgoingId: number, incomingId: number) {
    if (!matchInProgress) return;
    const outcome = attemptInterchange(matchInProgress, side, outgoingId, incomingId);
    if (!outcome.ok) {
      console.warn("attemptInterchange rejected a swap the UI should already have prevented:", outcome.reason);
      return;
    }
    setResult(matchResultSoFar(matchInProgress));
  }

  /**
   * Sep 2026 round 84 — [[Match-Day Line Coach Direction]]. `setLineFocus` mutates `matchInProgress`
   * in place (same pattern `setGameStyle` already uses), so — same as `handleInterchange` above —
   * the only thing needed to make the change visible is a re-render; re-deriving `result` from the
   * now-current `matchInProgress` is the same "something changed inside the live match" signal
   * `chooseCoachsCall`/`handleInterchange` already use for this. Deliberately does NOT auto-advance
   * the quarter or resume playback the way `chooseCoachsCall` does — a line-coach focus change isn't
   * "the" decision that ends the break the way picking a game style is; the coach can set as many
   * (or as few) line focuses as they like before actually choosing a Coach's Call option.
   */
  function handleLineFocusChange(side: "home" | "away", role: MatchDayCoachRole, focus: LineCoachFocus) {
    if (!matchInProgress) return;
    setLineFocus(matchInProgress, side, role, focus);
    setResult(matchResultSoFar(matchInProgress));
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

  /**
   * Sep 2026 — [[LiveMatch Cockpit Rebuild]]. `App.tsx`'s cockpit shell
   * (`isCockpitScreen`, round 99's non-scrolling `h-screen` treatment,
   * extended this round to the Match screen) needs to know precisely when
   * THIS component is actually showing the new fixed-height cockpit JSX
   * below, as opposed to the club-picker setup screen, MatchPreparation, or
   * FullTimeResult — all three of which stay ordinary scrollable screens.
   * `showCockpit` mirrors the exact condition the return statements below
   * gate on; the effect fires it up to the parent, and tears it back down on
   * every path that leaves the cockpit JSX (including unmount, e.g.
   * navigating to a different tab mid-match).
   */
  const showCockpit = !!result && !(playback.isComplete && quartersSimulated >= 4 && !pendingCoachsCall);
  useEffect(() => {
    onCockpitActiveChange?.(showCockpit);
    return () => onCockpitActiveChange?.(false);
  }, [showCockpit, onCockpitActiveChange]);

  // See useFantasyHistory's own doc comment (above teamTotals/TeamStatBars,
  // where ScoreBlock/LivePlayerStats used to be) for why this is a rolling
  // real-time window, not a tick count.
  const fantasyHistory = useFantasyHistory(playback.liveBoxScore, result?.seed);

  if (playback.isComplete && result && quartersSimulated >= 4 && !pendingCoachsCall) {
    return <FullTimeResult result={result} homeTeam={homeTeam} awayTeam={awayTeam} onNewMatch={newMatchup} />;
  }

  if (stage === "prep" && !result) {
    return <MatchPreparation homeTeam={homeTeam} awayTeam={awayTeam} onBack={() => setStage("setup")} onKickOff={kickOff} />;
  }

  if (!result) {
    return (
      <div className="space-y-4">
        <div className="card flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5">
            <select
              className="rounded-lg border border-base-600 bg-base-900 px-3 py-2 text-sm"
              value={homeClub}
              onChange={(e) => setHomeClub(e.target.value)}
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
            @ {venue.commonName}
          </span>
          <button
            onClick={() => setStage("prep")}
            disabled={homeClub === awayClub}
            className="ml-auto rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-40"
          >
            Continue to Match Preparation
          </button>
        </div>

        <div className="card text-sm text-slate-400">
          Pick two clubs and continue to Match Preparation to set tactics, a tagger, and a game
          style (or just kick off with the defaults). {myClub} fields whatever's set on the
          Selection tab once it's a complete lineup; every other club fields the same real,
          suitability-aware auto-fill an AI club gets in season simulation. The match runs against
          a fresh random seed every time.
        </div>
      </div>
    );
  }

  // Sep 2026 — [[LiveMatch Cockpit Rebuild]]: everything below only renders once a match exists
  // (live, paused, or mid-break). The old club-picker card above is gone the moment a match starts,
  // reclaiming the vertical space the fixed-height cockpit needs — "New match-up" (still real,
  // working functionality) rides along as a small corner link in the new ScoreboardBand instead of
  // vanishing. "Your"/"their" default to home/away when spectating an AI-vs-AI match with no mySide,
  // the same optional-mySide treatment lineFeedbackFor/line-coach code above already gives it.
  const yourSide: Side = mySide ?? "home";
  const theirSide: Side = yourSide === "home" ? "away" : "home";
  const yourTeam = yourSide === "home" ? homeTeam : awayTeam;
  const theirTeam = theirSide === "home" ? homeTeam : awayTeam;
  const yourIds = yourSide === "home" ? homeIds : awayIds;
  const theirIds = theirSide === "home" ? homeIds : awayIds;
  // Spoiler-safe truncation for quarterlyPoints — same idiom this file
  // already uses for PlayByPlay/PlayerMatchStatsModal below: an AI-vs-AI
  // match's `result.events` holds the WHOLE match up front, gated only by
  // `playback.currentIndex` for what's actually been revealed.
  const revealedResult = { ...result, events: result.events.slice(0, playback.currentIndex + 1) };

  // Sep 2026 round 103 — [[Full-Time Review and Unified Player Drawer]]'s shared drawer's own
  // Previous/Next roster: both teams combined (your side first), sorted by live fantasy points —
  // the same ordering `LeftTeamTable`/`DangerMen` already sort by, so Prev/Next tracks the same
  // "who's most involved right now" read the rest of this cockpit already uses.
  const drawerRoster = [
    ...yourTeam.players.map((player) => ({ player, side: yourSide })),
    ...theirTeam.players.map((player) => ({ player, side: theirSide })),
  ]
    .map((entry) => ({ ...entry, fp: playback.liveBoxScore[entry.player.PlayerID] ? fantasyPointsFor(playback.liveBoxScore[entry.player.PlayerID]) : 0 }))
    .sort((a, b) => b.fp - a.fp)
    .map(({ player, side }) => ({ player, side }));

  return (
    <div className="flex flex-col gap-3 lg:h-full lg:min-h-0">
      <ScoreboardBand
        homeTeam={homeTeam}
        awayTeam={awayTeam}
        playback={playback}
        ticksPerQuarter={result.ticksPerQuarter}
        quarterPoints={quarterlyPoints(revealedResult, homeIds, awayIds)}
        isBreak={!!pendingCoachsCall}
        onSimQuarter={playback.skipQuarter}
        onSkipFullTime={skipRestOfMatch}
        onNewMatchup={newMatchup}
        seed={lastSeed}
      />

      {!pendingCoachsCall && (
        <YourMoversBand
          team={yourTeam}
          side={yourSide}
          liveBoxScore={playback.liveBoxScore}
          deltaFor={fantasyHistory.deltaFor}
          sparklineFor={fantasyHistory.sparklineFor}
          onSelectPlayer={(p, s) => setSelectedPlayer({ player: p, side: s })}
        />
      )}

      {/* Sep 2026 — [[Quarter-Time Decision Room]]: replaces the old scrolling stack of
          `DetailedStatsTable` + `QuarterTimeInterchange` + `LineCoachPanel` + `CoachsCall` (all four
          remain intact and exported for any other call site) with one fixed-height, non-scrolling
          3-column cockpit. Every prop below is the exact same real data/handler the old stack already
          wired — `chooseCoachsCall`/`handleInterchange` are unchanged, just called once at Confirm
          instead of immediately on click; see the component's own doc comment and the design note. */}
      {pendingCoachsCall ? (
        <QuarterTimeDecisionRoom
          side={pendingCoachsCall.side}
          quarterJustFinished={pendingCoachsCall.quarterJustFinished}
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          result={result}
          fitnessFor={(side, playerId) => (matchInProgress ? fitnessFor(matchInProgress, side, playerId) : 100)}
          feedbackFor={(role) => (matchInProgress ? lineFeedbackFor(matchInProgress.ctx, pendingCoachsCall.side, role) : "")}
          focusFor={(role) => (matchInProgress ? getLineFocus(matchInProgress, pendingCoachsCall.side, role) : "Default")}
          onFocusChange={(role, focus) => handleLineFocusChange(pendingCoachsCall.side, role, focus)}
          lineCoaches={lineCoaches}
          currentStyle={matchInProgress ? getGameStyle(matchInProgress, pendingCoachsCall.side) : "Balanced"}
          onChoose={chooseCoachsCall}
          onInterchange={(outgoingId, incomingId) => handleInterchange(pendingCoachsCall.side, outgoingId, incomingId)}
        />
      ) : (
        <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[392px_minmax(0,1fr)_316px]">
          <LeftTeamTable
            team={yourTeam}
            side={yourSide}
            liveBoxScore={playback.liveBoxScore}
            fitnessFor={matchInProgress ? (playerId) => fitnessFor(matchInProgress, yourSide, playerId) : undefined}
            deltaFor={fantasyHistory.deltaFor}
            onSelectPlayer={(p, s) => setSelectedPlayer({ player: p, side: s })}
          />

          <div className="flex min-h-0 flex-col gap-2 overflow-hidden">
            {/* Sep 2026 [[LiveMatch Cockpit Rebuild]] bugfix: this was `shrink-0`, which let
                MatchCanvas render at its natural width-driven height (up to ~635px at this
                column's ~836px width) regardless of how much vertical room the cockpit actually
                had left after the fixed-150px play-by-play strip and the speed-controls row —
                confirmed live via getBoundingClientRect() during verification: content height
                exceeded the column's budget and the column's own `overflow-hidden` silently
                clipped the play-by-play/speed rows out of view entirely. `min-h-0 flex-1` makes
                this wrapper take exactly the remaining flex space instead, so MatchCanvas's own
                `h-full` (see its doc comment) has a real, definite height to fill. */}
            <div className="min-h-0 flex-1">
              <GroundView
                home={homeTeam}
                away={awayTeam}
                venue={venue}
                event={playback.currentEvent}
                nextEvent={result.events[playback.currentIndex + 1] ?? null}
                liveBoxScore={playback.liveBoxScore}
                isPlaying={playback.isPlaying}
                homeStyle={homeStyle}
                awayStyle={awayStyle}
                onSelectPlayer={(p, s) => setSelectedPlayer({ player: p, side: s })}
              />
            </div>
            <div className="card min-h-0 !p-2 lg:h-[150px] lg:shrink-0">
              <PlayByPlay events={result.events.slice(0, playback.currentIndex + 1)} />
            </div>
            <div className="card flex shrink-0 flex-wrap items-center gap-2 !py-2">
              {playback.isPlaying ? (
                <button onClick={playback.pause} className="rounded-lg bg-base-700 px-3 py-1.5 text-xs font-medium hover:bg-base-600">
                  Pause
                </button>
              ) : (
                <button onClick={playback.play} className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark">
                  {playback.currentIndex < 0 ? "Play" : "Resume"}
                </button>
              )}
              <div className="flex items-center gap-1">
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    onClick={() => playback.setSpeed(s)}
                    className={`rounded-lg px-2 py-1.5 text-[11px] font-medium ${
                      playback.speed === s ? "bg-primary text-white" : "bg-base-800 text-slate-300 hover:bg-base-700"
                    }`}
                  >
                    {s}x
                  </button>
                ))}
              </div>
              <button onClick={playback.restart} className="ml-auto rounded-lg bg-base-800 px-3 py-1.5 text-xs text-slate-400 hover:bg-base-700">
                Restart
              </button>
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-3 overflow-hidden">
            <TeamStatBars label={yourTeam.name} otherLabel={theirTeam.name} own={teamTotals(playback.liveBoxScore, yourIds)} other={teamTotals(playback.liveBoxScore, theirIds)} />
            <DangerMen team={theirTeam} side={theirSide} liveBoxScore={playback.liveBoxScore} onSelectPlayer={(p, s) => setSelectedPlayer({ player: p, side: s })} />
          </div>
        </div>
      )}

      {selectedPlayer && (
        <PlayerMatchDrawer
          player={selectedPlayer.player}
          side={selectedPlayer.side}
          line={playback.liveBoxScore[selectedPlayer.player.PlayerID]}
          events={result.events.slice(0, playback.currentIndex + 1)}
          position={(selectedPlayer.side === "home" ? homeTeam : awayTeam).positions?.get(selectedPlayer.player.PlayerID)}
          onGround={(selectedPlayer.side === "home" ? homeTeam : awayTeam).onGround?.has(selectedPlayer.player.PlayerID)}
          fitness={matchInProgress ? fitnessFor(matchInProgress, selectedPlayer.side, selectedPlayer.player.PlayerID) : undefined}
          roster={drawerRoster}
          onSelect={(p, s) => setSelectedPlayer({ player: p, side: s })}
          onClose={() => setSelectedPlayer(null)}
        />
      )}
    </div>
  );
}

/**
 * Sep 2026 — [[LiveMatch Cockpit Rebuild]]. Replaces the old `ScoreBlock`
 * (simple score display) and `LivePlayerStats` (a full mirrored table on
 * BOTH sides of the ground) with the cockpit's new pieces: `ScoreboardBand`,
 * `YourMoversBand`, `LeftTeamTable`, and `DangerMen`. `LivePlayerStats`'
 * own D/M/T/CLR/HO/G.B/[FIT]/SC column set and live-FP sort are the direct
 * precedent for `LeftTeamTable` below (narrower column set per Tyler's new
 * spec: Position/Name/D/M/T/G, FP with a delta, fitness as a bar) and for
 * `DangerMen` (same live-FP sort, condensed to a top-4 list rather than a
 * full mirrored table for the opposing side — see the design note's
 * judgment call #2 for why the second table is gone, not just narrower).
 *
 * No count-up/flash or sparkline precedent existed anywhere in this
 * codebase (grepped for recharts/d3/Chart.js/framer-motion/CountUp — none
 * installed, none used); `AnimatedNumber` and `Sparkline` below are small,
 * dependency-free replacements — the former a `requestAnimationFrame` tween
 * in the same idiom `GroundView.tsx` (formerly `MatchCanvas.tsx`) already
 * uses throughout for its own dot/ball animation, the latter plain inline
 * SVG bars in the same spirit
 * as `FullTimeResult.tsx`'s own hand-rolled `MarginChart` polyline.
 */
function AnimatedNumber({ value, className = "" }: { value: number; className?: string }) {
  const [display, setDisplay] = useState(value);
  const [flashing, setFlashing] = useState(false);
  const prevRef = useRef(value);

  useEffect(() => {
    if (value === prevRef.current) return;
    const from = prevRef.current;
    const to = value;
    prevRef.current = value;
    setFlashing(true);
    const DURATION_MS = 500;
    const start = performance.now();
    let raf = 0;
    function step(now: number) {
      const t = Math.min(1, (now - start) / DURATION_MS);
      setDisplay(Math.round(from + (to - from) * t));
      if (t < 1) raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
    const flashTimer = setTimeout(() => setFlashing(false), DURATION_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(flashTimer);
    };
  }, [value]);

  return <span className={`tabular-nums transition-colors duration-300 ${flashing ? "text-accent" : ""} ${className}`}>{display}</span>;
}

/** 8-bar sparkline of recent scoring rate — see this section's own doc comment above for why this is hand-rolled SVG, not a library. */
function Sparkline({ bars }: { bars: number[] }) {
  const width = 64;
  const height = 20;
  const gap = 2;
  const count = Math.max(1, bars.length);
  const barWidth = (width - gap * (count - 1)) / count;
  const max = Math.max(1, ...bars);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-5 w-16 shrink-0" aria-hidden="true">
      {bars.map((v, i) => {
        const h = Math.max(1, (v / max) * height);
        return <rect key={i} x={i * (barWidth + gap)} y={height - h} width={barWidth} height={h} rx={0.5} className="fill-primary" />;
      })}
    </svg>
  );
}

/** A filled bar, not a bare number — Tyler's own ask for the new left team table. Bands match `StatusPill.tsx`'s existing `fitnessBand` (90/75/55) so this bar and that pill never disagree about what counts as fresh/flat/heavy legs. */
function FitnessBar({ value }: { value: number }) {
  const tone = value >= 75 ? "bg-good" : value >= 55 ? "bg-warn" : "bg-bad";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-base-700" title={`Fitness ${Math.round(value)}`}>
      <div className={`h-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

const SNAPSHOT_INTERVAL_MS = 15_000;
const ROLLING_WINDOW_SAMPLES = 20; // 20 x 15s = 5 real minutes

/**
 * "Since the last look" for the Your Movers band and the left table's FP
 * delta — Sep 2026, [[LiveMatch Cockpit Rebuild]]'s design note, judgment
 * call #5: a rolling REAL-TIME (wall-clock) window, not a tick count. Ticks
 * have no fixed real-world duration (this engine has never modelled one —
 * `match.ts`'s own tick-budget doc comment discloses it as a fiction) and
 * playback speed spans a 32x range (0.5x-16x), so a tick-based window would
 * mean wildly different real "recency" depending on how fast the user is
 * watching. Sampling on a fixed real-world interval sidesteps that: "last N
 * samples" and "last N*15s of real time" are the same thing by
 * construction, and a ring buffer capped at `ROLLING_WINDOW_SAMPLES + 1`
 * naturally reads as "since kickoff" while a match is younger than 5 real
 * minutes (fewer samples exist yet) rather than showing an empty delta.
 * Resets on `matchSeed` change (`result?.seed`, not `result` itself) — the
 * exact same reset trigger `useMatchPlayback`'s own effect already uses —
 * so a "New match-up" doesn't drag the previous match's deltas along.
 */
function useFantasyHistory(liveBoxScore: Record<number, BoxScoreLine>, matchSeed: number | null | undefined) {
  const historyRef = useRef<Record<number, number>[]>([]);
  const liveBoxScoreRef = useRef(liveBoxScore);
  liveBoxScoreRef.current = liveBoxScore;
  const [, forceRender] = useState(0);

  useEffect(() => {
    historyRef.current = [];
  }, [matchSeed]);

  useEffect(() => {
    function sample() {
      const fp: Record<number, number> = {};
      for (const [idStr, line] of Object.entries(liveBoxScoreRef.current)) {
        fp[Number(idStr)] = fantasyPointsFor(line);
      }
      historyRef.current = [...historyRef.current, fp].slice(-(ROLLING_WINDOW_SAMPLES + 1));
      forceRender((n) => n + 1);
    }
    sample(); // an immediate first sample so a delta/sparkline exists from the first render, not just after the first interval
    const id = setInterval(sample, SNAPSHOT_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  function deltaFor(playerId: number): number {
    const h = historyRef.current;
    if (h.length === 0) return 0;
    const line = liveBoxScoreRef.current[playerId];
    const current = line ? fantasyPointsFor(line) : 0;
    return Math.round(current - (h[0][playerId] ?? 0));
  }

  function sparklineFor(playerId: number): number[] {
    const h = historyRef.current;
    const bars: number[] = [];
    for (let i = 1; i < h.length; i++) bars.push(Math.max(0, (h[i][playerId] ?? 0) - (h[i - 1][playerId] ?? 0)));
    return bars.slice(-8);
  }

  return { deltaFor, sparklineFor };
}

/**
 * Row 2 — the 78px scoreboard band. Home/away score display is the direct
 * successor to the old `ScoreBlock` (badge + name + score), just bigger
 * (Tyler: 40px Barlow Condensed) and with a `"lg"` badge (`ClubBadge.tsx`).
 *
 * "Time remaining" is deliberately NOT a fabricated mm:ss countdown — see
 * the design note's "no fake game-clock" finding: this engine has never
 * modelled a tick's real-world duration, and playback speed makes any
 * invented figure meaningless besides. Shown honestly instead as ticks
 * remaining in the current quarter, real numbers derived from `ctx.tick`
 * (accumulates across the whole match, confirmed by reading match.ts's
 * quarter loop fresh — quarter boundaries are just multiples of
 * `ticksPerQuarter`) and the real `ticksPerQuarter` constant (still 130,
 * confirmed fresh from `match.ts`'s `DEFAULT_TICKS_PER_QUARTER` — Tyler's
 * own "672" example was illustrative of the UI shape, not a literal figure).
 */
function ScoreboardBand({
  homeTeam,
  awayTeam,
  playback,
  ticksPerQuarter,
  quarterPoints,
  isBreak,
  onSimQuarter,
  onSkipFullTime,
  onNewMatchup,
  seed,
}: {
  homeTeam: MatchTeam;
  awayTeam: MatchTeam;
  playback: MatchPlayback;
  ticksPerQuarter: number;
  quarterPoints: QuarterPoints[];
  isBreak: boolean;
  onSimQuarter: () => void;
  onSkipFullTime: () => void;
  onNewMatchup: () => void;
  seed: number | null;
}) {
  const quarter = playback.currentEvent?.quarter;
  const currentTick = playback.currentEvent?.tick ?? 0;
  const totalTicks = ticksPerQuarter * 4;
  const ticksIntoQuarter = quarter ? currentTick - (quarter - 1) * ticksPerQuarter : 0;
  const ticksRemaining = quarter ? Math.max(0, ticksPerQuarter - ticksIntoQuarter) : ticksPerQuarter;
  const statusLabel = isBreak ? "BREAK" : quarter ? `LIVE · Q${quarter}` : "PRE-MATCH";
  /**
   * Sep 2026 [[LiveMatch Cockpit Rebuild]] bugfix, caught live: `quarterlyPoints` (engine/summary.ts)
   * returns each quarter's CUMULATIVE score up to and including that quarter — correct for its
   * original caller, FullTimeResult.tsx, where every quarter's events already exist. Called live
   * with a spoiler-safe truncated `revealedResult` (this file's own doc comment above), a quarter
   * that hasn't been reached yet has no events of its own to add, so its "cumulative total" comes
   * out identical to the current quarter's — e.g. mid-Q2 showed "Q2 13-13 / Q3 13-13 / Q4 13-13",
   * reading as if Q3 and Q4 had already finished level. Clamped here rather than in
   * `quarterlyPoints` itself, since that function's real semantics are correct and still used
   * as-is by FullTimeResult; only this live, partial-match call site needs the not-yet-played
   * quarters forced back to 0-0.
   */
  const displayQuarterPoints = quarterPoints.map((q) => (quarter && q.quarter <= quarter ? q : { ...q, homePoints: 0, awayPoints: 0, margin: 0 }));

  return (
    <div className="card flex flex-wrap items-center gap-3 lg:h-[78px] lg:shrink-0 lg:flex-nowrap lg:py-0">
      <div className="flex items-center gap-2 text-left">
        <ClubBadgeByName name={homeTeam.name} size="lg" />
        <div>
          <div className="max-w-[120px] truncate text-xs text-slate-400">{homeTeam.name}</div>
          <div className="font-display text-[40px] font-bold leading-none tabular-nums">{playback.liveScore.homePoints}</div>
          <div className="text-[10px] text-slate-500 tabular-nums">
            {playback.liveScore.homeGoals}.{playback.liveScore.homeBehinds}
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-1 px-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide">
          {!isBreak && quarter && <span className="h-2 w-2 animate-pulse rounded-full bg-bad" />}
          <span className={isBreak ? "text-warn" : "text-slate-300"}>{statusLabel}</span>
          {quarter && <span className="font-normal normal-case text-slate-500">· {ticksRemaining} ticks left</span>}
        </div>
        <div className="h-1.5 w-full max-w-[220px] overflow-hidden rounded-full bg-base-700">
          <div className="h-full bg-primary" style={{ width: `${totalTicks ? (currentTick / totalTicks) * 100 : 0}%` }} />
        </div>
        <div className="font-mono text-[10px] text-slate-500">
          TICK {currentTick}/{totalTicks}
        </div>
      </div>

      <div className="flex items-center gap-2 text-right">
        <div>
          <div className="max-w-[120px] truncate text-xs text-slate-400">{awayTeam.name}</div>
          <div className="font-display text-[40px] font-bold leading-none tabular-nums">{playback.liveScore.awayPoints}</div>
          <div className="text-[10px] text-slate-500 tabular-nums">
            {playback.liveScore.awayGoals}.{playback.liveScore.awayBehinds}
          </div>
        </div>
        <ClubBadgeByName name={awayTeam.name} size="lg" />
      </div>

      <div className="hidden items-center gap-3 border-l border-base-700 pl-3 lg:flex">
        <div className="flex gap-2 text-[10px] tabular-nums text-slate-400">
          {displayQuarterPoints.map((q) => (
            <span key={q.quarter} className="flex flex-col items-center">
              <span className="text-slate-600">Q{q.quarter}</span>
              <span>
                {q.homePoints}-{q.awayPoints}
              </span>
            </span>
          ))}
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={onSimQuarter}
            disabled={playback.isComplete || isBreak}
            title="Instantly reveal the rest of this quarter's already-simulated events"
            className="rounded-lg bg-base-700 px-2.5 py-1.5 text-[11px] font-medium hover:bg-base-600 disabled:opacity-40"
          >
            Sim to Quarter Time
          </button>
          <button
            onClick={onSkipFullTime}
            disabled={isBreak}
            className="rounded-lg bg-base-700 px-2.5 py-1.5 text-[11px] font-medium hover:bg-base-600 disabled:opacity-40"
          >
            Skip to Full Time
          </button>
        </div>
      </div>

      <div className="flex flex-col items-end gap-0.5 text-right">
        <button onClick={onNewMatchup} className="text-[10px] text-slate-500 underline decoration-dotted hover:text-slate-300">
          New match-up
        </button>
        <span className="text-[9px] text-slate-600">seed {seed}</span>
      </div>
    </div>
  );
}

/**
 * Row 3 — "Your Movers · Last 5 Minutes." The 5 shown are ranked by recent
 * FP momentum (`deltaFor`, see `useFantasyHistory` above), not overall
 * score — `LeftTeamTable` below already covers "who's had the best match
 * overall"; this band answers "who's hot right now," which is a genuinely
 * different, complementary question. "Positional/matchup subtitle" shows
 * the player's own position + club, not a fabricated head-to-head opponent
 * — see the design note's judgment call #6: no matchup-tracking (who's
 * directly opposed to whom) exists anywhere in this engine.
 */
function YourMoversBand({
  team,
  side,
  liveBoxScore,
  deltaFor,
  sparklineFor,
  onSelectPlayer,
}: {
  team: MatchTeam;
  side: Side;
  liveBoxScore: Record<number, BoxScoreLine>;
  deltaFor: (playerId: number) => number;
  sparklineFor: (playerId: number) => number[];
  onSelectPlayer: (player: Player, side: Side) => void;
}) {
  const movers = onGroundPlayers(team)
    .map((p) => ({ player: p, line: liveBoxScore[p.PlayerID], delta: deltaFor(p.PlayerID) }))
    .sort((a, b) => b.delta - a.delta || (b.line ? fantasyPointsFor(b.line) : 0) - (a.line ? fantasyPointsFor(a.line) : 0))
    .slice(0, 5);

  return (
    <div className="card shrink-0">
      <div className="mb-2 text-xs uppercase tracking-wide text-slate-400">Your movers · last 5 minutes</div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {movers.map(({ player, line, delta }) => (
          <button
            key={player.PlayerID}
            onClick={() => onSelectPlayer(player, side)}
            className="flex flex-col gap-1 rounded-lg border border-base-700 bg-base-800 p-2 text-left hover:border-primary"
            title={`Click for ${playerFullName(player)}'s match stats`}
          >
            <div className="flex items-center justify-between gap-1">
              <span className="truncate text-xs font-semibold">{player.lname}</span>
              {delta > 0 && <span className="shrink-0 rounded-full bg-good/20 px-1.5 py-0.5 text-[10px] font-semibold text-good">+{delta}</span>}
            </div>
            <div className="truncate text-[10px] text-slate-500">
              {team.positions?.get(player.PlayerID) ?? "—"} · {team.name}
            </div>
            <div className="flex items-end justify-between gap-2">
              <AnimatedNumber value={line ? Math.round(fantasyPointsFor(line)) : 0} className="text-[34px] font-bold leading-none" />
              <Sparkline bars={sparklineFor(player.PlayerID)} />
            </div>
            <div className="grid grid-cols-4 gap-1 border-t border-base-700 pt-1 text-center text-[9px] tabular-nums text-slate-400">
              <span>
                {line?.disposals ?? 0}
                <div className="text-slate-600">DISP</div>
              </span>
              <span>
                {line?.marks ?? 0}
                <div className="text-slate-600">MARKS</div>
              </span>
              <span>
                {line?.contestedPoss ?? 0}
                <div className="text-slate-600">CONT W</div>
              </span>
              <span>
                {line?.goals ?? 0}
                <div className="text-slate-600">GOALS</div>
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Left column, 392px — the live team table, direct successor to
 * `LivePlayerStats` but with Tyler's narrower new column set (Position,
 * Name, D/M/T/G, FP with a coloured delta, fitness as a bar) rather than
 * the old wider D/M/T/CLR/HO/G.B/[FIT]/SC. Reuses the exact same live-safe
 * `fantasyPointsFor` sort and click-to-inspect row pattern.
 */
function LeftTeamTable({
  team,
  side,
  liveBoxScore,
  fitnessFor,
  deltaFor,
  onSelectPlayer,
}: {
  team: MatchTeam;
  side: Side;
  liveBoxScore: Record<number, BoxScoreLine>;
  fitnessFor?: (playerId: number) => number;
  deltaFor: (playerId: number) => number;
  onSelectPlayer: (player: Player, side: Side) => void;
}) {
  const rows = onGroundPlayers(team)
    .map((p) => {
      const line = liveBoxScore[p.PlayerID];
      return { player: p, line, sc: line ? fantasyPointsFor(line) : 0 };
    })
    .sort((a, b) => b.sc - a.sc);

  return (
    <div className="card flex min-h-0 flex-col !px-2 lg:h-full">
      <div className="mb-2 truncate px-1 text-xs uppercase tracking-wide text-slate-400" title={team.name}>
        {team.name} · live
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full text-[11px] tabular-nums">
          <thead className="sticky top-0 bg-base-800 text-slate-500">
            <tr>
              <th className="pb-1 text-left font-medium">Pos</th>
              <th className="pb-1 text-left font-medium">Player</th>
              <th className="pb-1 text-center font-medium" title="Disposals">
                D
              </th>
              <th className="pb-1 text-center font-medium" title="Marks">
                M
              </th>
              <th className="pb-1 text-center font-medium" title="Tackles">
                T
              </th>
              <th className="pb-1 text-center font-medium" title="Goals">
                G
              </th>
              <th className="pb-1 text-right font-medium" title="Live fantasy score, coloured by change in the last 5 minutes">
                FP
              </th>
              {fitnessFor && (
                <th className="pb-1 text-right font-medium" title="In-match fitness">
                  FIT
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ player, line, sc }, i) => {
              const fitness = fitnessFor?.(player.PlayerID);
              const delta = deltaFor(player.PlayerID);
              return (
                <tr
                  key={player.PlayerID}
                  onClick={() => onSelectPlayer(player, side)}
                  className={`cursor-pointer hover:bg-base-700 ${i === 0 && sc > 0 ? "text-accent" : "text-slate-300"}`}
                  title={`Click for ${playerFullName(player)}'s match stats`}
                >
                  <td className="py-0.5 text-left text-slate-500">{team.positions?.get(player.PlayerID) ?? "—"}</td>
                  <td className="max-w-[90px] truncate py-0.5" title={playerFullName(player)}>
                    {player.lname}
                  </td>
                  <td className="text-center">{line?.disposals ?? 0}</td>
                  <td className="text-center">{line?.marks ?? 0}</td>
                  <td className="text-center">{line?.tackles ?? 0}</td>
                  <td className="text-center">{line?.goals ?? 0}</td>
                  <td className={`text-right font-semibold ${delta > 0 ? "text-good" : ""}`}>
                    {Math.round(sc)}
                    {delta > 0 && <span className="ml-1 text-[9px] font-normal text-good">+{delta}</span>}
                  </td>
                  {fitnessFor && (
                    <td className="w-12 py-0.5 pl-2">
                      <FitnessBar value={fitness ?? 100} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Right column — "Their Danger Men": the opposing side's top 4 by the same live-safe FP sort `LeftTeamTable` uses, condensed to a short list rather than a second full mirrored table (design note judgment call #2). Each row opens the same in-match stats drawer as everything else. */
function DangerMen({
  team,
  side,
  liveBoxScore,
  onSelectPlayer,
}: {
  team: MatchTeam;
  side: Side;
  liveBoxScore: Record<number, BoxScoreLine>;
  onSelectPlayer: (player: Player, side: Side) => void;
}) {
  const rows = onGroundPlayers(team)
    .map((p) => {
      const line = liveBoxScore[p.PlayerID];
      return { player: p, sc: line ? fantasyPointsFor(line) : 0 };
    })
    .sort((a, b) => b.sc - a.sc)
    .slice(0, 4);

  return (
    <div className="card">
      <div className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-400">
        <ClubBadgeByName name={team.name} size="sm" />
        Their danger men
      </div>
      <div className="space-y-1.5">
        {rows.map(({ player, sc }) => (
          <button
            key={player.PlayerID}
            onClick={() => onSelectPlayer(player, side)}
            className="flex w-full items-center justify-between rounded-lg px-1.5 py-1 text-left text-xs hover:bg-base-700"
            title={`Click for ${playerFullName(player)}'s match stats`}
          >
            <span className="truncate">
              <span className="mr-1.5 text-[10px] text-slate-500">{team.positions?.get(player.PlayerID) ?? "—"}</span>
              {playerFullName(player)}
            </span>
            <span className="shrink-0 font-semibold tabular-nums">{Math.round(sc)}</span>
          </button>
        ))}
        {rows.length === 0 && <div className="text-xs text-slate-500">No data yet.</div>}
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
      <div className="mb-2 flex items-center justify-between text-xs uppercase tracking-wide text-slate-400">
        <span>Team differential</span>
        <span className="flex items-center gap-1">
          <ClubBadgeByName name={label} size="sm" />
          <span className="text-slate-600">vs</span>
          <ClubBadgeByName name={otherLabel} size="sm" />
        </span>
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
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-1.5 shrink-0 text-xs uppercase tracking-wide text-slate-400">Play by play</div>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-1 overflow-y-auto text-sm">
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

// Sep 2026 round 103 — [[Full-Time Review and Unified Player Drawer]]: the click-to-inspect modal
// that used to live here (`PlayerMatchStatsModal`, private to this file) has been promoted into the
// shared, exported `PlayerMatchDrawer.tsx` — reused from here, `FullTimeResult.tsx`, and
// `QuarterTimeDecisionRoom.tsx`'s interchange grid instead of three divergent click experiences. Its
// old "Match Totals" 13-stat grid is deliberately not carried over verbatim — the new drawer's
// "Match stats" tab intentionally trims to Tyler's own "four stat tiles" ask, with the fuller
// per-quarter breakdown available on the drawer's own "By quarter" tab instead.
