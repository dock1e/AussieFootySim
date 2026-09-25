import { useEffect, useMemo, useState } from "react";
import { CLUBS, clubByName } from "../types/club";
import type { Player } from "../types/player";
import { getPlayersByClub } from "../data/loadPlayers";
import type { MatchTeam } from "../engine/team";
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
import { seasonPlayerTotals, toAverageMap } from "../engine/seasonSummary";
import { computeFantasyMetrics, type PlayerMatchFantasyMetrics } from "../engine/fantasyEngine";
import { groundForMatch } from "../data/clubGrounds";
import { DEFAULT_GAME_STYLE, type TeamPlan, type GameStyle } from "../engine/tactics";
import { useMatchPlayback, type PlaybackSpeed } from "../hooks/useMatchPlayback";
import { useGameStore } from "../store/useGameStore";
import { useSelectionStore } from "../store/useSelectionStore";
import { useSaveStore } from "../store/useSaveStore";
import { useSeasonStore } from "../store/useSeasonStore";
import { GroundView } from "./GroundView";
import { Scoreboard, StatStrip, TransportBar, breakLabel, clubAbbr, gameClock, nextBreakName, quarterGoalsBehinds } from "./matchday/shared";
import { LiveBoard, MoversWidget, PlayByPlayWidget, DangerMenWidget, baselineFpAverage } from "./matchday/LiveWidgets";
import { useMatchStoryStore } from "../store/useMatchStoryStore";
import { generateMatchCoachesVotes } from "../engine/coachesVotes";
import { FullTimeResult } from "./FullTimeResult";
import { MatchPreparation } from "./MatchPreparation";
import { QuarterTimeDecisionRoom } from "./QuarterTimeDecisionRoom";
import { PlayerMatchDrawer } from "./PlayerMatchDrawer";

const SPEEDS: PlaybackSpeed[] = [0.5, 1, 2, 4, 8, 16];

const TEAM_STAT_KEYS = ["disposals", "marks", "tackles", "clearances", "hitouts"] as const;

type Stage = "setup" | "prep";

export function LiveMatch({
  onCockpitActiveChange,
  onContinue,
}: {
  onCockpitActiveChange?: (active: boolean) => void;
  /** Match Day v2 (spec §3, critique D8): full time's primary action — back to the post-round Dashboard. */
  onContinue?: () => void;
} = {}) {
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
  /**
   * Match Day v2 (critique B7): selecting a player from the board, a mover, a danger-man match-up or a
   * dot rings him on the ground with a label; that is separate from the full stats drawer, which opens
   * from the ground header's "View stats" link (or from the break/full-time screens as before).
   */
  const [groundSel, setGroundSel] = useState<{ player: Player; side: Side } | null>(null);
  function selectOnGround(player: Player, side: Side) {
    setGroundSel((cur) => (cur?.player.PlayerID === player.PlayerID ? null : { player, side }));
  }
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

  // Match Day v2: the live, break and full-time screens are ordinary scrolling pages in the shared
  // app shell (spec §1-§3 layouts stack top to bottom), so this screen never asks App.tsx for the old
  // fixed-height cockpit shell any more. Kept as a prop so App.tsx's wiring needs no change.
  useEffect(() => {
    onCockpitActiveChange?.(false);
  }, [onCockpitActiveChange]);

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
  // Match Day v2 (critique B1): with no in-save season average yet (a friendly before any season, or a
  // player yet to play), pace falls back to his real 2025 fantasy average rather than 0 — otherwise
  // "pace vs average" silently equals FP.
  const playerById = useMemo(() => new Map([...homeTeam.players, ...awayTeam.players].map((p) => [p.PlayerID, p])), [homeTeam, awayTeam]);
  const seasonAvgFpOf = (playerId: number) => {
    const inSave = seasonAvgFpMap.get(playerId)?.fantasyPoints;
    if (inSave !== undefined && inSave > 0) return inSave;
    const p = playerById.get(playerId);
    return p ? baselineFpAverage(p) : 0;
  };
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

  // Match Day v2 (critique D6): coaches' votes alongside best on ground. A season match already carries
  // its ballots; this friendly doesn't, so the engine's own procedural ballots are generated for it once
  // the whole match exists.
  const friendlyVotes = useMemo(() => (result && quartersSimulated >= 4 ? generateMatchCoachesVotes(result, homeTeam, awayTeam) : null), [result, quartersSimulated, homeTeam, awayTeam]);

  if (playback.isComplete && result && quartersSimulated >= 4 && !pendingCoachsCall) {
    return (
      <FullTimeResult
        result={result}
        homeTeam={homeTeam}
        awayTeam={awayTeam}
        onNewMatch={newMatchup}
        myClub={mySide ? myClub : undefined}
        venueName={venue.commonName}
        coachesVotes={friendlyVotes ?? undefined}
        onContinue={(stories) => {
          if (stories.length > 0) {
            useMatchStoryStore.getState().publish({
              matchLabel: `${homeTeam.name} ${result.home.points} – ${result.away.points} ${awayTeam.name}`,
              stories,
              at: Date.now(),
            });
          }
          onContinue?.();
        }}
        onReplay={playback.restart}
      />
    );
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
            className="ml-auto rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-40"
            style={{ background: "var(--acc)", color: "var(--on)" }}
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

  // Everything below renders once a match exists (live, paused or at a break). "Your"/"their" default
  // to home/away when spectating an AI-vs-AI match with no `mySide`.
  const yourSide: Side = mySide ?? "home";
  const theirSide: Side = yourSide === "home" ? "away" : "home";
  const yourTeam = yourSide === "home" ? homeTeam : awayTeam;
  const theirTeam = theirSide === "home" ? homeTeam : awayTeam;
  const yourIds = yourSide === "home" ? homeIds : awayIds;
  const theirIds = theirSide === "home" ? homeIds : awayIds;

  // Drawer's Previous/Next roster: both teams, your side first, sorted by live fantasy points.
  const drawerRoster = [
    ...yourTeam.players.map((player) => ({ player, side: yourSide })),
    ...theirTeam.players.map((player) => ({ player, side: theirSide })),
  ]
    .map((entry) => ({ ...entry, fp: playback.liveBoxScore[entry.player.PlayerID] ? fantasyPointsFor(playback.liveBoxScore[entry.player.PlayerID]) : 0 }))
    .sort((a, b) => b.fp - a.fp)
    .map(({ player, side }) => ({ player, side }));

  const fitnessOf = (side: Side, playerId: number) => (matchInProgress ? fitnessFor(matchInProgress, side, playerId) : 100);

  // --- Scoreboard view-model (spec §0) --------------------------------------------------------------
  const tpq = result.ticksPerQuarter;
  const isBreak = !!pendingCoachsCall;
  const quarter = isBreak ? pendingCoachsCall.quarterJustFinished : (playback.currentEvent?.quarter ?? 1);
  const clock = gameClock(playback.currentEvent?.tick ?? 0, quarter, tpq);
  const started = playback.currentIndex >= 0;
  const gb = quarterGoalsBehinds(revealedEvents, homeIds, awayIds);
  const segments = [0, 1, 2, 3].map((i) => (isBreak ? (i < quarter ? 100 : 0) : i < quarter - 1 ? 100 : i === quarter - 1 ? (started ? clock.fraction * 100 : 0) : 0)) as [number, number, number, number];
  const yourPts = yourSide === "home" ? playback.liveScore.homePoints : playback.liveScore.awayPoints;
  const theirPts = yourSide === "home" ? playback.liveScore.awayPoints : playback.liveScore.homePoints;
  const breakSituation = yourPts === theirPts ? "Scores level" : yourPts > theirPts ? `${clubAbbr(yourTeam.name)} by ${yourPts - theirPts}` : `${clubAbbr(theirTeam.name)} by ${theirPts - yourPts}`;
  const status = isBreak ? breakLabel(quarter) : started ? `LIVE · Q${quarter} ${clock.elapsed}` : "Q1 00:00";
  const statusSub = isBreak ? breakSituation : started ? `${clock.left} left in the quarter` : "Press Play for the first bounce";

  const scoreboard = (
    <Scoreboard
      home={{ name: homeTeam.name, goals: playback.liveScore.homeGoals, behinds: playback.liveScore.homeBehinds, points: playback.liveScore.homePoints }}
      away={{ name: awayTeam.name, goals: playback.liveScore.awayGoals, behinds: playback.liveScore.awayBehinds, points: playback.liveScore.awayPoints }}
      status={status}
      statusSub={statusSub}
      live={!isBreak && started}
      segments={segments}
      quarters={gb}
      currentQuarter={isBreak || !started ? -1 : quarter - 1}
    />
  );

  const yourTotals = teamTotals(playback.liveBoxScore, yourIds);
  const theirTotals = teamTotals(playback.liveBoxScore, theirIds);

  return (
    <div className="flex flex-col gap-3">
      {scoreboard}

      {pendingCoachsCall ? (
        <QuarterTimeDecisionRoom
          side={pendingCoachsCall.side}
          quarterJustFinished={pendingCoachsCall.quarterJustFinished}
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          result={result}
          fitnessFor={fitnessOf}
          feedbackFor={(role) => (matchInProgress ? lineFeedbackFor(matchInProgress.ctx, pendingCoachsCall.side, role) : "")}
          focusFor={(role) => (matchInProgress ? getLineFocus(matchInProgress, pendingCoachsCall.side, role) : "Default")}
          onFocusChange={(role, focus) => handleLineFocusChange(pendingCoachsCall.side, role, focus)}
          lineCoaches={lineCoaches}
          currentStyle={matchInProgress ? getGameStyle(matchInProgress, pendingCoachsCall.side) : "Balanced"}
          onChoose={chooseCoachsCall}
          onInterchange={(outgoingId, incomingId) => handleInterchange(pendingCoachsCall.side, outgoingId, incomingId)}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-stretch gap-3">
            <StatStrip
              title="TEAM DIFFERENTIAL · MATCH"
              homeName={yourTeam.name}
              awayName={theirTeam.name}
              items={TEAM_STAT_KEYS.map((k) => ({ label: TEAM_STAT_LABELS[k], home: yourTotals[k], away: theirTotals[k] }))}
            />
            <TransportBar
              playing={playback.isPlaying}
              onTogglePlay={playback.isPlaying ? playback.pause : playback.play}
              speeds={SPEEDS}
              speed={playback.speed}
              onSpeed={(v) => playback.setSpeed(v as PlaybackSpeed)}
              nextBreak={nextBreakName(quarter)}
              onSimToBreak={playback.skipQuarter}
              onSimToFullTime={skipRestOfMatch}
              onRestart={playback.restart}
              onNewMatchup={newMatchup}
              seed={lastSeed}
              disabled={playback.isComplete && quartersSimulated >= 4}
            />
          </div>

          <div className="md-live-row flex flex-wrap items-stretch gap-3">
            <LiveBoard
              team={yourTeam}
              side={yourSide}
              liveBoxScore={playback.liveBoxScore}
              fantasyMetrics={fantasyMetrics}
              fitnessOf={fitnessOf}
              selectedPlayerId={groundSel?.player.PlayerID ?? null}
              hoveredPlayerId={hoveredPlayerId}
              onHoverPlayer={setHoveredPlayerId}
              onSelect={selectOnGround}
            />
            <section
              data-screen-label="Ground"
              className="md-ground"
              style={{ flex: "2.4 1 560px", minWidth: 0, background: "color-mix(in oklch, var(--deep) 25%, #0b1410)", border: "1px solid rgba(255,255,255,.07)", borderRadius: 14, overflow: "hidden", display: "flex", flexDirection: "column" }}
            >
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
                onSelectPlayer={selectOnGround}
                highlightedPlayerId={hoveredPlayerId}
                selectedPlayerId={groundSel?.player.PlayerID ?? null}
                onOpenSelected={groundSel ? () => setSelectedPlayer(groundSel) : undefined}
                onHoverPlayer={setHoveredPlayerId}
                fantasyMetrics={fantasyMetrics}
                ticksPerQuarter={tpq}
                yourSide={yourSide}
              />
            </section>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 400px), 1fr))", gap: 12 }}>
            <MoversWidget team={yourTeam} side={yourSide} events={revealedEvents} ticksPerQuarter={tpq} fantasyMetrics={fantasyMetrics} onSelect={selectOnGround} />
            <PlayByPlayWidget events={revealedEvents} ticksPerQuarter={tpq} homeTeam={homeTeam} awayTeam={awayTeam} homeIds={homeIds} yourSide={yourSide} />
            <DangerMenWidget theirTeam={theirTeam} ourTeam={yourTeam} ourSide={yourSide} fantasyMetrics={fantasyMetrics} fitnessOf={fitnessOf} onSelect={selectOnGround} />
          </div>
        </>
      )}

      {selectedPlayer && (
        <PlayerMatchDrawer
          player={selectedPlayer.player}
          side={selectedPlayer.side}
          line={playback.liveBoxScore[selectedPlayer.player.PlayerID]}
          events={revealedEvents}
          position={(selectedPlayer.side === "home" ? homeTeam : awayTeam).positions?.get(selectedPlayer.player.PlayerID)}
          onGround={(selectedPlayer.side === "home" ? homeTeam : awayTeam).onGround?.has(selectedPlayer.player.PlayerID)}
          fitness={fitnessOf(selectedPlayer.side, selectedPlayer.player.PlayerID)}
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

const TEAM_STAT_LABELS: Record<(typeof TEAM_STAT_KEYS)[number], string> = {
  disposals: "Disposals",
  marks: "Marks",
  tackles: "Tackles",
  clearances: "Clearances",
  hitouts: "Hitouts",
};

function teamTotals(box: Record<number, BoxScoreLine>, ids: Set<number>) {
  const totals: Record<string, number> = {};
  for (const key of TEAM_STAT_KEYS) totals[key] = 0;
  for (const [idStr, line] of Object.entries(box)) {
    if (!ids.has(Number(idStr))) continue;
    for (const key of TEAM_STAT_KEYS) totals[key] += line[key];
  }
  return totals;
}
