import { useEffect, useMemo, useRef, useState } from "react";
import { CLUBS, clubByName } from "../types/club";
import { playerFullName, type Player } from "../types/player";
import { getPlayersByClub } from "../data/loadPlayers";
import { onGroundPlayers, benchPlayers, type MatchTeam } from "../engine/team";
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
  type MatchEvent,
} from "../engine/match";
import type { LineCoachFocus } from "../engine/lineCoaching";
import { ASSISTANT_COACH_POOL } from "../data/assistantCoachPool";
import { MATCH_DAY_COACH_ROLES, type MatchDayCoachRole } from "../types/coach";
import type { Side } from "../engine/zones";
import { mulberry32 } from "../engine/rng";
import { fantasyPointsFor } from "../engine/ratings";
import { quarterlyPoints, type QuarterPoints } from "../engine/summary";
import { seasonPlayerTotals, toAverageMap } from "../engine/seasonSummary";
import {
  computeFantasyMetrics,
  curveGeometryFor,
  ribbonWindowTicks,
  FANTASY_COLOR,
  type PlayerMatchFantasyMetrics,
} from "../engine/fantasyEngine";
import { groundForMatch } from "../data/clubGrounds";
import { DEFAULT_GAME_STYLE, type TeamPlan, type GameStyle } from "../engine/tactics";
import { useMatchPlayback, type PlaybackSpeed, type MatchPlayback } from "../hooks/useMatchPlayback";
import { useGameStore } from "../store/useGameStore";
import { useSelectionStore } from "../store/useSelectionStore";
import { useSaveStore } from "../store/useSaveStore";
import { useSeasonStore } from "../store/useSeasonStore";
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
  /** Sep 2026 round 112 — [[Match Day Fantasy Layer]] Section B's cross-highlight: hovering a `LiveBoard`
   * row highlights its ground node and vice versa. Lifted here (not local to either component) since
   * both `LiveBoard` and `GroundView` are siblings in the render tree below. */
  const [hoveredPlayerId, setHoveredPlayerId] = useState<number | null>(null);

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

  // Sep 2026 round 112 — [[Match Day Fantasy Layer]]: replaces the old `useFantasyHistory` wall-clock
  // ring buffer. Every ribbon/board/drawer number for this match now comes from one pass over the
  // revealed events via `engine/fantasyEngine.ts`'s `computeFantasyMetrics` — see that module's own doc
  // comment and the vault note for why this is match-time based rather than real-wall-clock based.
  const season = useSeasonStore((s) => s.season);
  // Raw totals computed once here, not separately inside `seasonAvgFpMap` and again at the drawer's own
  // `seasonTotals` prop — `benchmarkPlayer` (the drawer's "Vs every archetype") needs the RAW map (it
  // calls `toAverageMap` on it itself), while the ribbon/board's pace numbers want the pre-averaged one;
  // sharing one underlying `seasonPlayerTotals(season)` scan avoids paying for that season-wide reduce
  // twice per render on a screen that re-renders every tick.
  const seasonTotals = useMemo(() => (season ? seasonPlayerTotals(season) : undefined), [season]);
  const seasonAvgFpMap = useMemo(() => (seasonTotals ? toAverageMap(seasonTotals) : new Map()), [seasonTotals]);
  const seasonAvgFpOf = (playerId: number) => seasonAvgFpMap.get(playerId)?.fantasyPoints ?? 0;
  const revealedEvents = result ? result.events.slice(0, playback.currentIndex + 1) : [];
  const allMatchIds = [...homeIds, ...awayIds];
  const fantasyMetrics: Map<number, PlayerMatchFantasyMetrics> = result
    ? computeFantasyMetrics(
        {
          events: revealedEvents,
          ticksPerQuarter: result.ticksPerQuarter,
          stadium: venue,
          lines: playback.liveBoxScore,
          fitnessOf: (id) => (matchInProgress ? fitnessFor(matchInProgress, homeIds.has(id) ? "home" : "away", id) : 100),
          seasonAvgFpOf,
        },
        allMatchIds,
      )
    : new Map();

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
          style (or just start with the defaults). {myClub} fields whatever's set on the
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
  // the same ordering `LiveBoard`/`DangerMen` already sort by, so Prev/Next tracks the same
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
        <MomentumRibbon
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          yourSide={yourSide}
          events={revealedEvents}
          ticksPerQuarter={result.ticksPerQuarter}
          fantasyMetrics={fantasyMetrics}
          seasonAvgFpOf={seasonAvgFpOf}
          hoveredPlayerId={hoveredPlayerId}
          onHoverPlayer={setHoveredPlayerId}
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
        <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[460px_minmax(0,1fr)_316px]">
          <LiveBoard
            team={yourTeam}
            side={yourSide}
            otherTeam={theirTeam}
            otherSide={theirSide}
            liveBoxScore={playback.liveBoxScore}
            fantasyMetrics={fantasyMetrics}
            fitnessOf={(side, playerId) => (matchInProgress ? fitnessFor(matchInProgress, side, playerId) : 100)}
            hoveredPlayerId={hoveredPlayerId}
            selectedPlayerId={selectedPlayer?.player.PlayerID ?? null}
            onHoverPlayer={setHoveredPlayerId}
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
                highlightedPlayerId={hoveredPlayerId ?? selectedPlayer?.player.PlayerID ?? null}
                onHoverPlayer={setHoveredPlayerId}
                fantasyMetrics={fantasyMetrics}
                ticksPerQuarter={result.ticksPerQuarter}
              />
            </div>
            {/* Sep 2026 round 113 — [[Match Day Fantasy Layer Revision 2]] R2.4: was 150px; the two
                horizontal bench-pill strips that used to sit under GroundView (`BenchStrip`, now
                deleted — the bench moved onto the ground itself, see GroundView.tsx's own R2.4 notes)
                are gone, and R2.4 explicitly asks for their reclaimed row to go to this panel: "the
                play-by-play panel... grows to fill it." 150 + the brief's own ~48px estimate = 198. */}
            <div className="card min-h-0 !p-2 lg:h-[198px] lg:shrink-0">
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

      {/* Sep 2026 round 112 — the drawer's own `fitness` prop below was found live while verifying the new
          "Fitness now" nerd tile (Section C item 3): it fell back to `undefined` (tile shows "—") for an
          AI-vs-AI match, the ONLY fitness consumer in this file that didn't — every sibling call
          (`fitnessOf` above, `LineCoachPanel`'s `fitnessFor`, `QuarterTimeDecisionRoom`'s `fitnessOf`)
          falls back to 100 when there's no interactive `matchInProgress` (see this file's own
          `matchInProgress` doc comment: it "stays null for an AI-vs-AI game", which is most matches Tyler
          watches that aren't his own club's). Pre-existing since round 103's original drawer wiring, not
          something this round introduced — just newly, prominently exposed by round 112's own new tile.
          Fixed to match the file's own convention rather than inventing a different fallback. */}
      {selectedPlayer && (
        <PlayerMatchDrawer
          player={selectedPlayer.player}
          side={selectedPlayer.side}
          line={playback.liveBoxScore[selectedPlayer.player.PlayerID]}
          events={result.events.slice(0, playback.currentIndex + 1)}
          position={(selectedPlayer.side === "home" ? homeTeam : awayTeam).positions?.get(selectedPlayer.player.PlayerID)}
          onGround={(selectedPlayer.side === "home" ? homeTeam : awayTeam).onGround?.has(selectedPlayer.player.PlayerID)}
          fitness={matchInProgress ? fitnessFor(matchInProgress, selectedPlayer.side, selectedPlayer.player.PlayerID) : 100}
          fantasyMetrics={fantasyMetrics.get(selectedPlayer.player.PlayerID)}
          seasonAvgFp={seasonAvgFpOf(selectedPlayer.player.PlayerID)}
          seasonTotals={seasonTotals}
          roster={drawerRoster}
          onSelect={(p, s) => setSelectedPlayer({ player: p, side: s })}
          onClose={() => setSelectedPlayer(null)}
        />
      )}
    </div>
  );
}

type RibbonScope = "mine" | "both" | "watchlist";

// Sep 2026 round 113 — [[Match Day Fantasy Layer Revision 2]] R2.1: the whole point of these constants
// is that NOTHING about the ribbon's total height can vary with content ever again. 44 (title row +
// scope-filter row, 22 each) + 22 (column headers) + 5*27 (body rows) = 201, reserved on the outer
// container from first mount, pre-match included — R2.1's own literal arithmetic.
const RIBBON_HEADER_HEIGHT = 44;
const RIBBON_COLHEADER_HEIGHT = 22;
const RIBBON_ROW_HEIGHT = 27;
const RIBBON_ROW_COUNT = 5;
const RIBBON_BODY_HEIGHT = RIBBON_ROW_HEIGHT * RIBBON_ROW_COUNT;
const RIBBON_TOTAL_HEIGHT = RIBBON_HEADER_HEIGHT + RIBBON_COLHEADER_HEIGHT + RIBBON_BODY_HEIGHT;
const RIBBON_GRID_COLUMNS = "22px 118px 52px 40px 138px 1fr 62px";

interface RibbonRow {
  player: Player;
  side: Side;
  rank: number;
  /** Live: real Δ5/FP/curve/paceDelta/whatChanged from `fantasyMetrics`. Pre-match: `undefined` — the row reads off `seasonAvg` instead (below), same slot, same key, no remount when the match starts and this stops being undefined. */
  m: PlayerMatchFantasyMetrics | undefined;
  seasonAvg: number;
  /** Live only: `m.delta5 > 0`. A "mover" gets full-colour Δ/what-changed; everyone else (including every pre-match row) renders at the R2.2 "dim, honest, stable" filler treatment rather than disappearing. */
  isMover: boolean;
}

/**
 * Sep 2026 round 112 — [[Match Day Fantasy Layer]] Section A. Replaces `YourMoversBand`/the old
 * `useFantasyHistory` wall-clock strip outright. Every number comes from `fantasyMetrics`
 * (`engine/fantasyEngine.ts`'s `computeFantasyMetrics`, one pass over the real event log) and
 * `curveGeometryFor` — no separately-sampled series. "Watchlist" has no data model anywhere in this
 * codebase yet (no "add to watchlist" affordance exists) — the scope filter is real and switchable, but
 * that option honestly renders an empty state rather than faking a list; disclosed in the vault note.
 *
 * Sep 2026 round 113 — [[Match Day Fantasy Layer Revision 2]] R2.1/R2.2 rewrite: pre-match and live used
 * to be two structurally different returns (different header row count, a variable-height "nothing's
 * moved"/"no season average" sentence, a `rows.length` that could be 0-5) — exactly the reflow R2.1
 * reported. Now ONE fixed-201px shape at every tick from first mount: always both header rows, always
 * the column-header row, always up to `RIBBON_ROW_COUNT` absolutely-positioned body slots (`top:
 * rank*27px`, CSS-transitioned — R2.2's "animate rank changes... never re-mount the list", keyed by
 * `player.PlayerID` so React reuses the same DOM node across a re-sort rather than tearing it down).
 * Ranking is unified too: live mode no longer FILTERS to `delta5 > 0` (that's what made the strip 0-5
 * rows and let a departing mover pop out of the DOM) — it sorts the WHOLE candidate pool by
 * `(delta5 desc, fp desc)` and takes the top 5 regardless of sign, styling anyone with `delta5 <= 0` as
 * a dim "filler" row per R2.2 rather than omitting them. A real mover fading below 0 over successive
 * ticks now visibly dims and slides down in rank instead of vanishing.
 */
function MomentumRibbon({
  homeTeam,
  awayTeam,
  yourSide,
  events,
  ticksPerQuarter,
  fantasyMetrics,
  seasonAvgFpOf,
  hoveredPlayerId,
  onHoverPlayer,
  onSelectPlayer,
}: {
  homeTeam: MatchTeam;
  awayTeam: MatchTeam;
  yourSide: Side;
  events: MatchEvent[];
  ticksPerQuarter: number;
  fantasyMetrics: Map<number, PlayerMatchFantasyMetrics>;
  seasonAvgFpOf: (playerId: number) => number;
  hoveredPlayerId: number | null;
  onHoverPlayer: (id: number | null) => void;
  onSelectPlayer: (player: Player, side: Side) => void;
}) {
  const [scope, setScope] = useState<RibbonScope>("mine");
  const matchStarted = events.length > 0;
  const theirSide: Side = yourSide === "home" ? "away" : "home";
  const teamFor = (side: Side) => (side === "home" ? homeTeam : awayTeam);

  const candidateSides: Side[] = scope === "both" ? [yourSide, theirSide] : scope === "mine" ? [yourSide] : [];
  const candidates = candidateSides.flatMap((side) => onGroundPlayers(teamFor(side)).map((player) => ({ player, side })));

  const windowTicks = ribbonWindowTicks(ticksPerQuarter);
  const windowMinutes = Math.round((windowTicks * 30) / ticksPerQuarter);

  const rows: RibbonRow[] = (
    matchStarted
      ? candidates
          .map(({ player, side }) => ({ player, side, m: fantasyMetrics.get(player.PlayerID) }))
          .filter((r): r is { player: Player; side: Side; m: PlayerMatchFantasyMetrics } => !!r.m)
          .sort((a, b) => b.m.delta5 - a.m.delta5 || b.m.fp - a.m.fp)
          .slice(0, RIBBON_ROW_COUNT)
          .map((r, i) => ({ player: r.player, side: r.side, rank: i, m: r.m, seasonAvg: seasonAvgFpOf(r.player.PlayerID), isMover: r.m.delta5 > 0 }))
      : candidates
          .map(({ player, side }) => ({ player, side, seasonAvg: seasonAvgFpOf(player.PlayerID) }))
          .sort((a, b) => b.seasonAvg - a.seasonAvg)
          .slice(0, RIBBON_ROW_COUNT)
          .map((r, i) => ({ player: r.player, side: r.side, rank: i, m: undefined, seasonAvg: r.seasonAvg, isMover: false }))
  ) as RibbonRow[];

  return (
    <div className="shrink-0 overflow-hidden rounded-card border" style={{ height: RIBBON_TOTAL_HEIGHT, background: FANTASY_COLOR.headerBg, borderColor: FANTASY_COLOR.hairline }}>
      <div className="flex items-center px-2 text-[9px] font-semibold uppercase tracking-[0.07em]" style={{ height: RIBBON_COLHEADER_HEIGHT, color: FANTASY_COLOR.inkLabel }}>
        {matchStarted ? `Momentum · last ${windowMinutes} min` : "Projected output"}
      </div>
      <div className="flex items-center gap-1 px-2" style={{ height: RIBBON_COLHEADER_HEIGHT, background: FANTASY_COLOR.columnHeaderBg }}>
        {([
          ["mine", "My 22"],
          ["both", "Both teams"],
          ["watchlist", "Watchlist"],
        ] as [RibbonScope, string][]).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setScope(value)}
            className="rounded px-1.5 text-[9px] font-medium uppercase tracking-wide"
            style={{
              color: scope === value ? FANTASY_COLOR.inkPrimary : FANTASY_COLOR.inkLabel,
              background: scope === value ? "rgba(124,92,240,0.25)" : "transparent",
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        className="grid items-center px-2 text-[9px] font-semibold uppercase tracking-[0.07em]"
        style={{ height: RIBBON_COLHEADER_HEIGHT, gridTemplateColumns: RIBBON_GRID_COLUMNS, color: FANTASY_COLOR.inkLabel, background: FANTASY_COLOR.columnHeaderBg, gap: 6 }}
      >
        <span />
        <span>Player</span>
        <span className="text-right">Δ 5 min</span>
        <span className="text-right">FP</span>
        <span>Curve</span>
        <span>{matchStarted ? "What changed" : ""}</span>
        <span className="text-right">Proj</span>
      </div>
      <div className="relative" style={{ height: RIBBON_BODY_HEIGHT }}>
        {rows.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center px-3 text-center text-xs" style={{ color: FANTASY_COLOR.inkTertiary }}>
            {scope === "watchlist" ? "Nothing on your watchlist yet — no add-to-watchlist screen exists yet." : "No players in this scope."}
          </div>
        )}
        {rows.map(({ player, side, rank, m, seasonAvg, isMover }) => {
          const geometry = curveGeometryFor(matchStarted ? events : [], player.PlayerID, ticksPerQuarter);
          const isHovered = hoveredPlayerId === player.PlayerID;
          const dim = !matchStarted || !isMover;
          const numberInk = dim ? FANTASY_COLOR.inkLabel : FANTASY_COLOR.inkTertiary;
          return (
            <button
              key={player.PlayerID}
              onClick={() => onSelectPlayer(player, side)}
              onMouseEnter={() => onHoverPlayer(player.PlayerID)}
              onMouseLeave={() => onHoverPlayer(null)}
              className="absolute left-0 right-0 grid w-full items-center px-2 text-left"
              style={{
                top: rank * RIBBON_ROW_HEIGHT,
                height: RIBBON_ROW_HEIGHT,
                gridTemplateColumns: RIBBON_GRID_COLUMNS,
                gap: 6,
                background: isHovered ? "rgba(124,92,240,0.12)" : rank % 2 ? FANTASY_COLOR.altRowBg : FANTASY_COLOR.rowBg,
                borderTop: `1px solid ${FANTASY_COLOR.hairline}`,
                transition: "top 180ms ease, opacity 180ms ease",
              }}
            >
              <span className="font-mono text-[11px]" style={{ color: FANTASY_COLOR.inkLabel }}>
                {rank + 1}
              </span>
              <span className="truncate text-[12px] font-semibold" style={{ fontFamily: "Barlow, sans-serif", color: FANTASY_COLOR.inkPrimary }}>
                {player.lname} <span style={{ color: FANTASY_COLOR.inkLabel }}>{teamFor(side).positions?.get(player.PlayerID) ?? ""}</span>
              </span>
              {matchStarted && m ? (
                <>
                  <span className="text-right font-mono text-[13px] tabular-nums" style={{ color: dim ? FANTASY_COLOR.inkLabel : m.delta5 < 0 ? FANTASY_COLOR.loss : FANTASY_COLOR.gain }}>
                    {dim ? "—" : `${m.delta5 > 0 ? "+" : ""}${Math.round(m.delta5)}`}
                  </span>
                  <span className="text-right font-mono text-[12px] tabular-nums" style={{ color: numberInk }}>
                    {Math.round(m.fp)}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <FpCurveSvg geometry={geometry} />
                    <span className="font-mono text-[9.5px] tabular-nums" style={{ color: dim ? FANTASY_COLOR.inkLabel : m.paceDelta > 0 ? FANTASY_COLOR.gain : m.paceDelta <= -15 ? FANTASY_COLOR.loss : FANTASY_COLOR.inkTertiary }}>
                      {m.paceDelta > 0 && !dim ? "+" : ""}
                      {dim ? "—" : m.paceDelta}
                    </span>
                  </span>
                  <span className="truncate text-[11px]" style={{ color: dim ? FANTASY_COLOR.inkLabel : FANTASY_COLOR.inkSecondary }}>
                    {m.whatChanged || "—"}
                  </span>
                  <span className="text-right font-mono text-[12px] tabular-nums" style={{ color: numberInk }}>
                    {Math.round(m.proj)}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-right font-mono text-[13px] tabular-nums" style={{ color: FANTASY_COLOR.inkLabel }}>
                    —
                  </span>
                  <span className="text-right font-mono text-[12px] tabular-nums" style={{ color: FANTASY_COLOR.inkLabel }}>
                    —
                  </span>
                  <FpCurveSvg geometry={geometry} />
                  <span className="truncate text-[11px]" style={{ color: FANTASY_COLOR.inkLabel }}>
                    Season avg
                  </span>
                  <span className="text-right font-mono text-[12px] font-semibold tabular-nums" style={{ color: FANTASY_COLOR.inkTertiary }}>
                    {seasonAvg.toFixed(1)}
                  </span>
                </>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The ribbon's FP curve — fixed 112x20 CSS px, viewBox "0 0 130 20". Deliberately hard `width`/`height`
 * attributes (real CSS pixels, not a percentage or flex-basis) rather than a `w-full`/flex-stretched
 * class — the brief's own warning: "an earlier attempt failed here... a cumulative line stretched wide
 * is visually a straight line". Verified live at 1280/1440/1920px viewport widths (acceptance #3).
 */
function FpCurveSvg({ geometry }: { geometry: import("../engine/fantasyEngine").CurveGeometry }) {
  const { points, recentPoints, quarterGridlinesX } = geometry;
  const basePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  const recentPath = recentPoints.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(" ");
  return (
    <svg width={112} height={20} viewBox="0 0 130 20" style={{ display: "block", flexShrink: 0 }} aria-hidden="true">
      {quarterGridlinesX.map((x, i) => (
        <line key={i} x1={x} y1={0} x2={x} y2={20} stroke="#fff" strokeOpacity={i === 1 ? 0.14 : 0.07} strokeWidth={1} />
      ))}
      {basePath && <path d={basePath} fill="none" stroke={FANTASY_COLOR.accentLine} strokeWidth={1.4} />}
      {recentPath && <path d={recentPath} fill="none" stroke={FANTASY_COLOR.accentSegment} strokeWidth={2} />}
      {points
        .filter((p) => p.isGoal)
        .map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={1.9} fill={FANTASY_COLOR.goal} />
        ))}
    </svg>
  );
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

type ColumnSetName = "fantasy" | "disposal" | "contest" | "role";

interface BoardRow {
  player: Player;
  line: BoxScoreLine | undefined;
  m: PlayerMatchFantasyMetrics | undefined;
  fitness: number;
  isBench: boolean;
}

interface BoardColumn {
  key: string;
  label: string;
  title: string;
  value: (r: BoardRow) => number;
  format?: (v: number) => string;
}

const BOARD_COLUMN_SETS: Record<ColumnSetName, BoardColumn[]> = {
  fantasy: [
    { key: "fp", label: "FP", title: "Live fantasy points", value: (r) => r.m?.fp ?? 0, format: (v) => Math.round(v).toString() },
    { key: "delta5", label: "Δ5", title: "Fantasy points in the last 5 minutes", value: (r) => r.m?.delta5 ?? 0, format: (v) => (v > 0 ? `+${Math.round(v)}` : Math.round(v).toString()) },
    { key: "fpPerMin", label: "FP/MIN", title: "Fantasy points per minute on ground", value: (r) => r.m?.fpPerMin ?? 0, format: (v) => v.toFixed(2) },
    { key: "proj", label: "PROJ", title: "Rotation-aware projected final fantasy points", value: (r) => r.m?.proj ?? 0, format: (v) => Math.round(v).toString() },
    { key: "tog", label: "TOG", title: "Time on ground", value: (r) => r.m?.tog ?? 0, format: (v) => `${Math.round(v)}%` },
  ],
  disposal: [
    { key: "kicks", label: "K", title: "Kicks", value: (r) => r.line?.kicks ?? 0 },
    { key: "handballs", label: "HB", title: "Handballs", value: (r) => r.line?.handballs ?? 0 },
    { key: "disposals", label: "D", title: "Disposals", value: (r) => r.line?.disposals ?? 0 },
    { key: "marks", label: "M", title: "Marks", value: (r) => r.line?.marks ?? 0 },
    { key: "contestedPoss", label: "Cont", title: "Contested possessions", value: (r) => r.line?.contestedPoss ?? 0 },
    {
      key: "efficiency",
      label: "Eff%",
      title: "Disposal efficiency — (disposals minus turnovers) / disposals",
      value: (r) => (r.line && r.line.disposals > 0 ? ((r.line.disposals - r.line.turnovers) / r.line.disposals) * 100 : 0),
      format: (v) => `${Math.round(v)}%`,
    },
  ],
  contest: [
    { key: "tackles", label: "T", title: "Tackles", value: (r) => r.line?.tackles ?? 0 },
    { key: "clearances", label: "CLR", title: "Clearances", value: (r) => r.line?.clearances ?? 0 },
    { key: "hitouts", label: "HO", title: "Hitouts", value: (r) => r.line?.hitouts ?? 0 },
    { key: "groundBallWins", label: "HBG", title: "Hard ball gets", value: (r) => r.line?.groundBallWins ?? 0 },
    { key: "spoils", label: "1%ers", title: "One-percenters (spoils)", value: (r) => r.line?.spoils ?? 0 },
  ],
  role: [
    { key: "cba", label: "CBA%", title: "Centre bounce attendance", value: (r) => r.m?.cba ?? 0, format: (v) => `${Math.round(v)}%` },
    { key: "kickIns", label: "KI", title: "Kick-ins taken", value: (r) => r.m?.kickIns ?? 0 },
    { key: "tog", label: "TOG", title: "Time on ground", value: (r) => r.m?.tog ?? 0, format: (v) => `${Math.round(v)}%` },
    { key: "longestStint", label: "STINT", title: "Longest unbroken stint on ground", value: (r) => r.m?.longestStintMinutes ?? 0, format: (v) => `${Math.round(v)}m` },
    { key: "fitness", label: "FIT", title: "In-match fitness", value: (r) => r.fitness, format: (v) => `${Math.round(v)}%` },
  ],
};

const COLUMN_SET_LABELS: { key: ColumnSetName; label: string }[] = [
  { key: "fantasy", label: "Fantasy" },
  { key: "disposal", label: "Disposal" },
  { key: "contest", label: "Contest" },
  { key: "role", label: "Role" },
];

/** Triggers a browser download — CSV export footer action, [[Match Day Fantasy Layer]] Section B. */
function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((r) => r.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Sep 2026 round 112 — [[Match Day Fantasy Layer]] Section B. Replaces `LeftTeamTable` outright: the
 * rail is now THE only live board (the old "Your Movers" strip duplicated this same data — see the
 * vault note). All 23 (18 on-ground + 5 interchange, the 2026 AFL rule change — see `MatchTeam.players`'
 * own doc comment) per side, bench always last regardless of sort, 4 switchable column sets,
 * click-to-sort with shift-click tiebreak, CSV export, cross-highlight with the ground view via
 * `hoveredPlayerId`/`onHoverPlayer`.
 *
 * Sep 2026 round 112 comment correction, round 113: this previously said "4 bench" — round 112's own
 * verify script had already found 5 (`onGround=18, bench=5`) the same round this comment was written;
 * the doc comment just never got updated to match. See [[Match Day Fantasy Layer Revision 2]] R2.4's
 * own disclosure for the fuller account (also the brief's separate "22"/"26" figures, both stale echoes
 * of the pre-round-112 22-man-squad assumption — ROADMAP's round 112 section, gap #92).
 *
 * R2.4 asked to "remove the INT rows from the left rail entirely... a display state on the existing
 * row, not a re-parenting of the row." Checking `rowsFor` below against that: it already is — a rotated
 * player's `PlayerID` never changes rows or tables, `team.positions.get(id)` already flips to the
 * literal string `"INT"` the instant `match.ts`'s interchange swap fires (both the automatic
 * fitness-triggered rotation and a manual Coach's Call swap — see `match.ts`'s own
 * `performInterchangeSwap`), and `onGroundPlayers`/`benchPlayers` read the SAME live `team.onGround` Set
 * that swap mutates, so `isBench`/sort position update on the very next render with no add/remove. The
 * one real gap was cosmetic — "a muted INT" — fixed below (the position cell dims specifically for a
 * bench row). The actual duplication R2.4 was flagging turned out to be cross-component: these same 5
 * players ALSO rendered as a second, separate pill strip under the ground (`GroundView.tsx`'s old
 * `BenchStrip`) — removed this round; see that file's own R2.4 notes.
 */
function LiveBoard({
  team,
  side,
  otherTeam,
  otherSide,
  liveBoxScore,
  fantasyMetrics,
  fitnessOf,
  hoveredPlayerId,
  selectedPlayerId,
  onHoverPlayer,
  onSelectPlayer,
}: {
  team: MatchTeam;
  side: Side;
  otherTeam: MatchTeam;
  otherSide: Side;
  liveBoxScore: Record<number, BoxScoreLine>;
  fantasyMetrics: Map<number, PlayerMatchFantasyMetrics>;
  fitnessOf: (side: Side, playerId: number) => number;
  hoveredPlayerId: number | null;
  selectedPlayerId: number | null;
  onHoverPlayer: (id: number | null) => void;
  onSelectPlayer: (player: Player, side: Side) => void;
}) {
  const [columnSet, setColumnSet] = useState<ColumnSetName>("fantasy");
  const [sort, setSort] = useState<{ column: string; direction: 1 | -1 }>({ column: "fp", direction: -1 });
  const [tiebreak, setTiebreak] = useState<{ column: string; direction: 1 | -1 } | null>(null);

  function rowsFor(t: MatchTeam, s: Side): BoardRow[] {
    const onGround = onGroundPlayers(t).map((player) => ({
      player,
      line: liveBoxScore[player.PlayerID],
      m: fantasyMetrics.get(player.PlayerID),
      fitness: fitnessOf(s, player.PlayerID),
      isBench: false,
    }));
    const bench = benchPlayers(t).map((player) => ({
      player,
      line: liveBoxScore[player.PlayerID],
      m: fantasyMetrics.get(player.PlayerID),
      fitness: fitnessOf(s, player.PlayerID),
      isBench: true,
    }));
    return [...onGround, ...bench];
  }

  const columns = BOARD_COLUMN_SETS[columnSet];
  const columnByKey = (key: string) => columns.find((c) => c.key === key);

  function sortRows(rows: BoardRow[]): BoardRow[] {
    const primary = columnByKey(sort.column) ?? columns[0];
    const secondary = tiebreak ? columnByKey(tiebreak.column) : undefined;
    return [...rows].sort((a, b) => {
      if (a.isBench !== b.isBench) return a.isBench ? 1 : -1; // bench always last, regardless of sort
      const pa = primary.value(a);
      const pb = primary.value(b);
      if (pa !== pb) return (pa - pb) * sort.direction;
      if (secondary) {
        const sa = secondary.value(a);
        const sb = secondary.value(b);
        if (sa !== sb) return (sa - sb) * tiebreak!.direction;
      }
      return 0;
    });
  }

  function handleHeaderClick(key: string, shiftKey: boolean) {
    if (shiftKey) {
      setTiebreak((prev) => (prev && prev.column === key ? { column: key, direction: -prev.direction as 1 | -1 } : { column: key, direction: -1 }));
      return;
    }
    setSort((prev) => (prev.column === key ? { column: key, direction: -prev.direction as 1 | -1 } : { column: key, direction: -1 }));
  }

  function exportCsv() {
    const header = ["Team", "Pos", "Player", ...columns.map((c) => c.label)];
    const body: string[][] = [];
    for (const [t, s] of [
      [team, side],
      [otherTeam, otherSide],
    ] as [MatchTeam, Side][]) {
      for (const row of rowsFor(t, s)) {
        body.push([
          t.name,
          t.positions?.get(row.player.PlayerID) ?? "",
          playerFullName(row.player),
          ...columns.map((c) => {
            const v = c.value(row);
            return c.format ? c.format(v) : Math.round(v).toString();
          }),
        ]);
      }
    }
    downloadCsv(`match-fantasy-board-${columnSet}.csv`, [header, ...body]);
  }

  const rows = sortRows(rowsFor(team, side));

  return (
    <div className="card flex min-h-0 flex-col !px-2 lg:h-full" style={{ background: FANTASY_COLOR.pageBg }}>
      <div className="mb-1.5 flex shrink-0 items-center justify-between gap-2 px-1">
        <div className="truncate text-xs uppercase tracking-wide" style={{ color: FANTASY_COLOR.inkLabel }} title={team.name}>
          {team.name} · live
        </div>
        <div className="flex shrink-0 gap-0.5 rounded-md p-0.5" style={{ background: FANTASY_COLOR.columnHeaderBg }}>
          {COLUMN_SET_LABELS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => {
                setColumnSet(key);
                setSort({ column: BOARD_COLUMN_SETS[key][0].key, direction: -1 });
                setTiebreak(null);
              }}
              className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
              style={{ color: columnSet === key ? FANTASY_COLOR.inkPrimary : FANTASY_COLOR.inkLabel, background: columnSet === key ? "rgba(124,92,240,0.3)" : "transparent" }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <table className="w-full text-[11px]" style={{ fontFamily: "'IBM Plex Mono', monospace" }}>
          <thead className="sticky top-0 z-10" style={{ background: FANTASY_COLOR.columnHeaderBg }}>
            <tr>
              <th className="w-8 py-1 text-left text-[9px] font-medium uppercase tracking-wide" style={{ color: FANTASY_COLOR.inkLabel }}>
                Pos
              </th>
              <th className="py-1 text-left text-[9px] font-medium uppercase tracking-wide" style={{ color: FANTASY_COLOR.inkLabel, fontFamily: "Barlow, sans-serif" }}>
                Player
              </th>
              {columns.map((c) => (
                <th
                  key={c.key}
                  onClick={(e) => handleHeaderClick(c.key, e.shiftKey)}
                  title={`${c.title} — click to sort, shift-click for tiebreak`}
                  className="cursor-pointer select-none whitespace-nowrap py-1 pl-2 text-right text-[9px] font-medium uppercase tracking-[0.07em]"
                  style={{ color: sort.column === c.key || tiebreak?.column === c.key ? FANTASY_COLOR.inkPrimary : FANTASY_COLOR.inkLabel }}
                >
                  {c.label}
                  {sort.column === c.key && (sort.direction === -1 ? " ▾" : " ▴")}
                  {tiebreak?.column === c.key && (tiebreak.direction === -1 ? " ▾" : " ▴")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const isHovered = hoveredPlayerId === row.player.PlayerID;
              const isSelected = selectedPlayerId === row.player.PlayerID;
              return (
                <tr
                  key={row.player.PlayerID}
                  onClick={() => onSelectPlayer(row.player, side)}
                  onMouseEnter={() => onHoverPlayer(row.player.PlayerID)}
                  onMouseLeave={() => onHoverPlayer(null)}
                  className="cursor-pointer tabular-nums"
                  style={{
                    background: isSelected ? "rgba(124,92,240,0.22)" : isHovered ? "rgba(124,92,240,0.12)" : row.isBench ? FANTASY_COLOR.columnHeaderBg : i % 2 ? FANTASY_COLOR.altRowBg : FANTASY_COLOR.rowBg,
                    borderTop: row.isBench && !rows[i - 1]?.isBench ? `1px solid ${FANTASY_COLOR.hairline}` : undefined,
                  }}
                >
                  <td className="py-0.5 text-left" style={{ color: FANTASY_COLOR.inkLabel, opacity: row.isBench ? 0.6 : 1 }}>
                    {team.positions?.get(row.player.PlayerID) ?? "—"}
                  </td>
                  <td className="max-w-[90px] truncate py-0.5 font-semibold" title={playerFullName(row.player)} style={{ fontFamily: "Barlow, sans-serif", color: FANTASY_COLOR.inkPrimary }}>
                    {row.player.lname}
                  </td>
                  {columns.map((c) => {
                    const v = c.value(row);
                    return (
                      <td key={c.key} className="py-0.5 pl-2 text-right" style={{ color: FANTASY_COLOR.inkTertiary }}>
                        {c.format ? c.format(v) : Math.round(v)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mt-1.5 flex shrink-0 justify-end border-t px-1 pt-1.5" style={{ borderColor: FANTASY_COLOR.hairline }}>
        <button onClick={exportCsv} className="rounded px-2 py-1 text-[10px] font-medium uppercase tracking-wide" style={{ color: FANTASY_COLOR.inkTertiary, background: FANTASY_COLOR.columnHeaderBg }}>
          CSV export
        </button>
      </div>
    </div>
  );
}

/** Right column — "Their Danger Men": the opposing side's top 4 by the same live-safe FP sort `LiveBoard` uses, condensed to a short list rather than a second full mirrored table (design note judgment call #2). Each row opens the same in-match stats drawer as everything else. */
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
        {recent.length === 0 && <div className="text-slate-500">First bounce coming up…</div>}
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
