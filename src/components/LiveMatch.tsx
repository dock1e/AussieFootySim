import { useEffect, useMemo, useState } from "react";
import { CLUBS, clubByName } from "../types/club";
import type { Player } from "../types/player";
import type { Position } from "../types/archetype";
import { getPlayersByClub, leagueAverageOvr } from "../data/loadPlayers";
import { cloneMatchTeam, interchangesUpTo, teamAtEvent, type MatchTeam } from "../engine/team";
import { autoFillLineup, emptyLineup, isLineupComplete, lineupToMatchTeam } from "../engine/selection";
import {
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
import type { AFLStadium } from "../data/stadiums";
import { aiTeamPlan, defaultTeamPlan, DEFAULT_GAME_STYLE, type GameStyle } from "../engine/tactics";
import { nextUnplayedRound } from "../engine/season";
import { useMatchPlayback, type PlaybackSpeed } from "../hooks/useMatchPlayback";
import { useGameStore } from "../store/useGameStore";
import { useSelectionStore } from "../store/useSelectionStore";
import { useTeamPlanStore } from "../store/useTeamPlanStore";
import { useSaveStore } from "../store/useSaveStore";
import { useSeasonStore } from "../store/useSeasonStore";
import { GroundView } from "./GroundView";
import { Scoreboard, StatStrip, TransportBar, breakLabel, clubAbbr, gameClock, nextBreakName, quarterGoalsBehinds, plural } from "./matchday/shared";
import { LiveBoard, MoversWidget, PlayByPlayWidget, DangerMenWidget, baselineFpAverage } from "./matchday/LiveWidgets";
import { useMatchStoryStore } from "../store/useMatchStoryStore";
import { generateMatchCoachesVotes } from "../engine/coachesVotes";
import { FullTimeResult } from "./FullTimeResult";
import { QuarterTimeDecisionRoom } from "./QuarterTimeDecisionRoom";
import { PlayerMatchDrawer } from "./PlayerMatchDrawer";
import { FlowFooter, FlowStepper, type FlowStep, type StepInfo } from "./matchday/flow/FlowChrome";
import { SelectionStep, lineupStat } from "./matchday/flow/SelectionStep";
import { RotationsStep, coverageCount } from "./matchday/flow/RotationsStep";
import { RolesStep } from "./matchday/flow/RolesStep";
import { FixtureStep } from "./matchday/flow/FixtureStep";
import { OppositionStep, type WeeklyChange } from "./matchday/flow/OppositionStep";
import { useTogProjection } from "./matchday/flow/useTogProjection";
import {
  dangerMen,
  lastMetLine,
  ladderLine,
  scoutingRows,
  seasonFixtureRows,
  styleBlurb,
  styleLabel,
  taggerCandidates,
  weeklyPlan,
  type FixtureChoice,
} from "./matchday/flow/flowData";

const SPEEDS: PlaybackSpeed[] = [0.5, 1, 2, 4, 8, 16];

const TEAM_STAT_KEYS = ["disposals", "marks", "tackles", "clearances", "hitouts"] as const;

/** Everything a started match needs, frozen at the first bounce so a season round being recorded (which moves the fixture on) can't change the teams under a match already on screen. */
interface ActiveMatch {
  home: MatchTeam;
  away: MatchTeam;
  venue: AFLStadium;
  /** The season round being played, or null for a friendly. */
  round: number | null;
  /** An untouched copy of the coach's own team as it took the field — interchanges mutate `home`/`away`. */
  myTeamAtBounce: MatchTeam;
  /** Both teams as they took the field, replayed forward to the tick on screen (`teamAtEvent`). */
  homeAtBounce: MatchTeam;
  awayAtBounce: MatchTeam;
}

/**
 * Match Day — round 128 rebuilds the pre-match side as the six-step flow from `Match Day Flow.dc.html`:
 * Selection, Rotations and Roles (the standing plan, saved to the Selection/team-plan stores and used
 * every week), then Fixture, Opposition and Match (this week only). The Match step is the Match Day v2
 * live / break / full-time screens, unchanged apart from sitting under the same stepper.
 *
 * With a season running, the Fixture step plays your next round and full time records it into the
 * season (`useSeasonStore.recordLiveRound`), the rest of the round simulating headlessly as before.
 * Without one it's a friendly against any club at your home ground.
 */
export function LiveMatch({
  onCockpitActiveChange,
  onContinue,
  initialStep,
}: {
  onCockpitActiveChange?: (active: boolean) => void;
  /** Match Day v2 (spec §3, critique D8): full time's primary action — back to the post-round Dashboard. */
  onContinue?: () => void;
  /** Where the flow opens. Defaults to Selection until the line-up is full, then Fixture. */
  initialStep?: FlowStep;
} = {}) {
  const myClub = useGameStore((s) => s.myClub);
  const myClubId = clubByName(myClub)?.ClubID ?? -1;
  const myPlayers = useMemo(() => getPlayersByClub(myClub), [myClub]);
  const myById = useMemo(() => new Map(myPlayers.map((p) => [p.PlayerID, p])), [myPlayers]);

  const savedLineup = useSelectionStore((s) => s.lineupFor(myClub));
  const lineup = savedLineup ?? emptyLineup();
  const setSlot = useSelectionStore((s) => s.setSlot);
  const autoFill = useSelectionStore((s) => s.autoFill);
  const allEligibility = useSelectionStore((s) => s.eligibility);
  const setEligibility = useSelectionStore((s) => s.setEligibility);
  const myEligibility = allEligibility[myClub];

  const standingPlan = useTeamPlanStore((s) => s.plans[myClub]) ?? defaultTeamPlan();
  const setStandingStyle = useTeamPlanStore((s) => s.setGameStyle);
  const setStandingTactic = useTeamPlanStore((s) => s.setTactic);

  const season = useSeasonStore((s) => s.season);
  const seasonTeams = useSeasonStore((s) => s.teams);
  const recordLiveRound = useSeasonStore((s) => s.recordLiveRound);
  const year = useSaveStore((s) => s.year);

  const [step, setStep] = useState<FlowStep>(() => initialStep ?? (savedLineup && isLineupComplete(savedLineup) ? 3 : 0));
  const [friendlyOpponent, setFriendlyOpponent] = useState(() => CLUBS.find((c) => c.name !== myClub)?.name ?? CLUBS[0].name);
  /** This week only: opponent PlayerID → your tagger's PlayerID. */
  const [tags, setTags] = useState<Map<number, number>>(new Map());
  const [weekStyle, setWeekStyle] = useState<GameStyle | null>(null);

  const [active, setActive] = useState<ActiveMatch | null>(null);
  const [result, setResult] = useState<MatchResult | null>(null);
  const [lastSeed, setLastSeed] = useState<number | null>(null);
  const [recordedRound, setRecordedRound] = useState<number | null>(null);

  // --- This week's fixture --------------------------------------------------------------------------
  const fixtureRows = useMemo(() => (season ? seasonFixtureRows(season, myClubId) : []), [season, myClubId]);
  const nextRound = season ? nextUnplayedRound(season) : null;
  const nextRow = fixtureRows.find((r) => r.round === nextRound) ?? null;
  const friendlyOnly = !nextRow;
  const choice: FixtureChoice = nextRow ? { kind: "season", round: nextRow.round } : { kind: "friendly", opponent: friendlyOpponent };
  const oppName = nextRow ? nextRow.opponent : friendlyOpponent;
  const oppClubId = clubByName(oppName)?.ClubID ?? -1;
  const iAmHome = nextRow ? nextRow.isHome : true;
  const flowVenue = useMemo(
    () => (nextRow && season ? groundForMatch(nextRow.homeClubId, nextRow.round, season.fixture) : groundForMatch(myClubId)),
    [nextRow, season, myClubId],
  );
  const homeVenue = useMemo(() => groundForMatch(myClubId).commonName, [myClubId]);

  /**
   * Your side is always your saved line-up (topped up by `lineupToMatchTeam` if it isn't full yet);
   * the opponent is its season team when there is one, else the same suitability-aware auto-fill an AI
   * club gets in season simulation.
   */
  const flowMine = useMemo(
    () => lineupToMatchTeam(myClub, savedLineup ?? autoFillLineup(myPlayers), myPlayers, myEligibility),
    [myClub, savedLineup, myPlayers, myEligibility],
  );
  const flowOpp = useMemo(() => {
    const fromSeason = nextRow ? seasonTeams?.get(oppClubId) : undefined;
    if (fromSeason) return fromSeason;
    const players = getPlayersByClub(oppName);
    return lineupToMatchTeam(oppName, autoFillLineup(players), players, allEligibility[oppName]);
  }, [nextRow, seasonTeams, oppClubId, oppName, allEligibility]);
  const oppPlan = useMemo(() => aiTeamPlan(getPlayersByClub(oppName), leagueAverageOvr()), [oppName]);
  const minePlan = useMemo(() => weeklyPlan(standingPlan, weekStyle, tags), [standingPlan, weekStyle, tags]);

  const homeTeam = active?.home ?? (iAmHome ? flowMine : flowOpp);
  const awayTeam = active?.away ?? (iAmHome ? flowOpp : flowMine);
  const venue = active?.venue ?? flowVenue;

  /**
   * Quarter-time Coach's Call (Engine.md "Match-day flow" step 4). Every flow match is the coach's
   * own, so it's always interactive: simulated a quarter at a time with a break between.
   */
  const [matchInProgress, setMatchInProgress] = useState<MatchInProgress | null>(null);
  const [quartersSimulated, setQuartersSimulated] = useState(0);
  const [pendingCoachsCall, setPendingCoachsCall] = useState<{ side: "home" | "away"; quarterJustFinished: 1 | 2 | 3 } | null>(null);

  /** Each side's current game style — feeds `GroundView`'s positional shape (see engine/ground.ts's `gameStyleAnchorBias`). */
  const [homeStyle, setHomeStyle] = useState<GameStyle>(DEFAULT_GAME_STYLE);
  const [awayStyle, setAwayStyle] = useState<GameStyle>(DEFAULT_GAME_STYLE);

  /** Click-to-inspect player stats drawer (live, break and full time). */
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
  /** Hovering a `LiveBoard` row highlights its ground node and vice versa. */
  const [hoveredPlayerId, setHoveredPlayerId] = useState<number | null>(null);

  /** Line coaches (hired from Football Dept.), frozen at kickoff. */
  const lineCoaches = useSaveStore((s) => s.lineCoaches);

  const homeIds = useMemo(() => new Set(homeTeam.players.map((p) => p.PlayerID)), [homeTeam]);
  const awayIds = useMemo(() => new Set(awayTeam.players.map((p) => p.PlayerID)), [awayTeam]);

  const playback = useMatchPlayback(result, homeIds, awayIds);

  // Round 129 — who is on the ground at the tick on screen. A quarter is simulated ahead of playback
  // and interchanges mutate `homeTeam`/`awayTeam` in place, so those describe the end of the quarter;
  // the board, ground and bench rails read these replayed views instead. Only rebuilt when another
  // interchange is revealed, so the objects stay stable between ticks.
  const swapsSeen = active && result ? interchangesUpTo(result.events, playback.currentIndex) : 0;
  const homeView = useMemo(
    () => (active && result ? teamAtEvent(active.homeAtBounce, "home", result.events, playback.currentIndex) : homeTeam),
    [active, result, swapsSeen, homeTeam], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const awayView = useMemo(
    () => (active && result ? teamAtEvent(active.awayAtBounce, "away", result.events, playback.currentIndex) : awayTeam),
    [active, result, swapsSeen, awayTeam], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const mySide: "home" | "away" = homeTeam.name === myClub ? "home" : "away";

  /** The coach's own line-coach assignments as `role -> ovr/99`; the opponent always plays the flat baseline. */
  function lineCoachEffectiveness(): Partial<Record<MatchDayCoachRole, number>> {
    const effectiveness: Partial<Record<MatchDayCoachRole, number>> = {};
    for (const role of MATCH_DAY_COACH_ROLES) {
      const coachId = lineCoaches[role];
      if (coachId === undefined) continue;
      const coach = ASSISTANT_COACH_POOL.find((c) => c.id === coachId);
      if (coach) effectiveness[role] = coach.ratings[role].ovr / 99;
    }
    return effectiveness;
  }

  function kickOff() {
    const seed = Math.floor(Math.random() * 1_000_000_000);
    setLastSeed(seed);
    const mine = cloneMatchTeam(flowMine);
    const opp = cloneMatchTeam(flowOpp);
    const home = iAmHome ? mine : opp;
    const away = iAmHome ? opp : mine;
    const homePlan = iAmHome ? minePlan : oppPlan;
    const awayPlan = iAmHome ? oppPlan : minePlan;
    setHomeStyle(homePlan.gameStyle);
    setAwayStyle(awayPlan.gameStyle);
    const mineLc = lineCoachEffectiveness();
    const condition = nextRow && season ? season.condition : undefined;
    const match = startMatch(home, away, mulberry32(seed), seed, {
      homePlan,
      awayPlan,
      homeLineCoachEffectiveness: iAmHome ? mineLc : {},
      awayLineCoachEffectiveness: iAmHome ? {} : mineLc,
      homeCondition: condition,
      awayCondition: condition,
      stadium: flowVenue,
    });
    simulateQuarter(match, 1);
    setActive({
      home,
      away,
      venue: flowVenue,
      round: nextRow?.round ?? null,
      myTeamAtBounce: cloneMatchTeam(flowMine),
      homeAtBounce: cloneMatchTeam(iAmHome ? flowMine : flowOpp),
      awayAtBounce: cloneMatchTeam(iAmHome ? flowOpp : flowMine),
    });
    setMatchInProgress(match);
    setQuartersSimulated(1);
    setPendingCoachsCall(null);
    setResult(matchResultSoFar(match));
    setRecordedRound(null);
    setGroundSel(null);
    setSelectedPlayer(null);
    setStep(5);
  }

  /** Leaves the match (or its full time) and goes back into the flow. A season round not yet at full time isn't recorded. */
  function leaveMatch(to: FlowStep) {
    setResult(null);
    setActive(null);
    setMatchInProgress(null);
    setQuartersSimulated(0);
    setPendingCoachsCall(null);
    setHomeStyle(DEFAULT_GAME_STYLE);
    setAwayStyle(DEFAULT_GAME_STYLE);
    setGroundSel(null);
    setSelectedPlayer(null);
    if (recordedRound !== null) {
      // That round is on the ladder now; next week's plan starts clean.
      setTags(new Map());
      setWeekStyle(null);
    }
    setRecordedRound(null);
    setStep(to);
  }
  const newMatchup = () => leaveMatch(3);

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

  /** Quarter-time manual interchange — the break screen only offers eligibility-checked swaps, so a rejection here is a bug, logged rather than swallowed. */
  function handleInterchange(side: "home" | "away", outgoingId: number, incomingId: number) {
    if (!matchInProgress) return;
    const outcome = attemptInterchange(matchInProgress, side, outgoingId, incomingId);
    if (!outcome.ok) {
      console.warn("attemptInterchange rejected a swap the UI should already have prevented:", outcome.reason);
      return;
    }
    setResult(matchResultSoFar(matchInProgress));
  }

  /** Line-coach focus changes mutate `matchInProgress` in place; re-deriving `result` re-renders them. */
  function handleLineFocusChange(side: "home" | "away", role: MatchDayCoachRole, focus: LineCoachFocus) {
    if (!matchInProgress) return;
    setLineFocus(matchInProgress, side, role, focus);
    setResult(matchResultSoFar(matchInProgress));
  }

  /** "Sim to full time": simulates every remaining quarter with no further Coach's Call (current style holds), then jumps playback to the end. */
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

  // Detects "playback has caught up to a just-simulated quarter's end" and surfaces the break.
  useEffect(() => {
    if (!matchInProgress || !playback.isComplete || quartersSimulated >= 4 || pendingCoachsCall) return;
    setPendingCoachsCall({ side: mySide, quarterJustFinished: quartersSimulated as 1 | 2 | 3 });
  }, [playback.isComplete, matchInProgress, quartersSimulated, pendingCoachsCall, mySide]);

  // Match Day screens are ordinary scrolling pages in the shared app shell.
  useEffect(() => {
    onCockpitActiveChange?.(false);
  }, [onCockpitActiveChange]);

  const atFullTime = !!result && playback.isComplete && quartersSimulated >= 4 && !pendingCoachsCall;

  // Full time of a season round records it (and simulates the rest of that round). Replaying the
  // playback afterwards doesn't re-record: the round is already played.
  useEffect(() => {
    if (!atFullTime || !active || active.round === null || !result || recordedRound === active.round) return;
    if (recordLiveRound(active.round, result, myClubId, active.myTeamAtBounce)) setRecordedRound(active.round);
  }, [atFullTime, active, result, recordedRound, recordLiveRound, myClubId]);

  // Sep 2026 round 112 — [[Match Day Fantasy Layer]]: replaces the old `useFantasyHistory` wall-clock
  // ring buffer. Every ribbon/board/drawer number for this match now comes from one pass over the
  // revealed events via `engine/fantasyEngine.ts`'s `computeFantasyMetrics` — see that module's own doc
  // comment and the vault note for why this is match-time based rather than real-wall-clock based.
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

  // --- Flow view-model (steps 1-5) -------------------------------------------------------------------
  const avgFpOfPlayer = (p: Player) => {
    const inSave = seasonAvgFpMap.get(p.PlayerID)?.fantasyPoints;
    return inSave !== undefined && inSave > 0 ? inSave : baselineFpAverage(p);
  };
  const danger = useMemo(() => dangerMen(flowOpp, flowMine, avgFpOfPlayer), [flowOpp, flowMine, seasonAvgFpMap]); // eslint-disable-line react-hooks/exhaustive-deps
  const taggers = useMemo(() => taggerCandidates(flowMine), [flowMine]);
  const scout = useMemo(() => scoutingRows(oppName), [oppName]);
  const covered = coverageCount(lineup, myById, myEligibility);
  const filled = lineup.filter((id) => id !== null).length;
  const oppAbbr = clubAbbr(oppName);
  const roundLabel = nextRow ? `Round ${nextRow.round}` : "Friendly";
  const homeAway = iAmHome ? "Home" : "Away";

  const changes: WeeklyChange[] = [];
  for (const [targetId, taggerId] of tags) {
    const tagger = myById.get(taggerId);
    const target = flowOpp.players.find((p) => p.PlayerID === targetId);
    if (!tagger || !target) continue;
    const pos = flowMine.positions?.get(taggerId);
    changes.push({ kind: "TAG", text: `${tagger.lname} (${pos === "INT" || !pos ? "interchange" : pos}) → tags ${target.fname} ${target.lname}` });
  }
  if (weekStyle) changes.push({ kind: "STYLE", text: `${styleLabel(standingPlan.gameStyle)} → ${styleLabel(weekStyle)}` });

  function setTag(targetId: number, taggerId: number | null) {
    setTags((cur) => {
      const next = new Map([...cur].filter(([, t]) => t !== taggerId));
      if (taggerId === null) next.delete(targetId);
      else next.set(targetId, taggerId);
      return next;
    });
  }

  function placeInLineup(slot: number, playerId: number) {
    const from = lineup.findIndex((id) => id === playerId);
    const displaced = lineup[slot];
    setSlot(myClub, slot, playerId);
    if (from >= 0 && from !== slot && displaced !== null) setSlot(myClub, from, displaced);
  }

  // Rotations: projected time on ground against this week's opponent, re-run whenever anything that
  // changes it does. Only computed while that step is open.
  const projectionKey =
    step === 1 && !active
      ? JSON.stringify([
          lineup,
          myEligibility ?? null,
          standingPlan.gameStyle,
          [...standingPlan.tactics].map(([id, t]) => [id, t.tactic]),
          oppName,
          iAmHome,
          flowVenue.commonName,
          nextRow?.round ?? null,
        ])
      : "";
  const projection = useTogProjection(
    projectionKey
      ? {
          mine: flowMine,
          opp: flowOpp,
          mineIsHome: iAmHome,
          minePlan: standingPlan,
          oppPlan,
          stadium: flowVenue,
          condition: nextRow && season ? season.condition : undefined,
        }
      : null,
    projectionKey,
  );

  // --- Stepper ---------------------------------------------------------------------------------------
  const locked = !!active && !atFullTime;
  const scoreSub = active && result ? `${playback.liveScore.homePoints} – ${playback.liveScore.awayPoints}` : "Ready";
  const steps: StepInfo[] = [
    { sub: `${filled}/23 picked`, disabled: locked },
    { sub: `${covered}/18 covered`, disabled: locked },
    { sub: styleLabel(standingPlan.gameStyle), disabled: locked },
    { sub: nextRow ? `Rd ${nextRow.round} · ${oppAbbr}` : `Friendly · ${oppAbbr}`, disabled: locked },
    { sub: changes.length ? plural(changes.length, "change") : "Standing plan", disabled: locked },
    { sub: scoreSub },
  ];
  function goStep(s: FlowStep) {
    if (active) {
      if (s < 5 && atFullTime) leaveMatch(s);
      return;
    }
    if (s === 5) kickOff();
    else setStep(s);
  }
  const stepper = (
    <FlowStepper step={active ? 5 : step} steps={steps} weekLabel={nextRow ? `ROUND ${nextRow.round} VS ${oppAbbr}` : `FRIENDLY VS ${oppAbbr}`} onGo={goStep} />
  );

  if (atFullTime && result) {
    return (
      <div className="flex flex-col gap-3">
        {stepper}
        <FullTimeResult
          result={result}
          homeTeam={homeTeam}
          awayTeam={awayTeam}
          onNewMatch={newMatchup}
          myClub={myClub}
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
      </div>
    );
  }

  if (!active || !result) {
    const NEXT = ["Next · Rotations", "Next · Roles", "Save plan · Pick fixture", `Plan for ${oppName}`, "First bounce"];
    const HINT = [
      lineupStat(lineup, myById),
      `${covered}/18 positions covered by the bench`,
      "Roles save to your standing plan as you change them",
      `${roundLabel} · ${flowVenue.commonName} · ${homeAway}`,
      changes.length ? `${plural(changes.length, "change")} for this match only` : "Playing the standing plan",
    ];
    return (
      <div className="flex flex-col gap-3">
        {stepper}
        {step === 0 && <SelectionStep players={myPlayers} lineup={lineup} onPlace={placeInLineup} onAutoPick={() => autoFill(myClub, myPlayers)} />}
        {step === 1 && (
          <RotationsStep
            lineup={lineup}
            byId={myById}
            overrides={myEligibility}
            onSetRotations={(id, positions: Position[]) => setEligibility(myClub, id, positions)}
            tog={projection.tog}
            projecting={projection.pending}
          />
        )}
        {step === 2 && (
          <RolesStep
            lineup={lineup}
            byId={myById}
            plan={standingPlan}
            overrides={myEligibility}
            onStyle={(s) => setStandingStyle(myClub, s)}
            onTactic={(id, pt) => setStandingTactic(myClub, id, pt)}
          />
        )}
        {step === 3 && (
          <FixtureStep
            myClub={myClub}
            year={year}
            rows={fixtureRows}
            nextRound={nextRow?.round ?? null}
            friendlyOnly={friendlyOnly}
            choice={choice}
            onChoose={(c) => {
              if (c.kind === "friendly") setFriendlyOpponent(c.opponent);
              setTags(new Map());
            }}
            homeVenue={homeVenue}
            card={{
              roundLabel: roundLabel.toUpperCase(),
              opponent: oppName,
              venue: flowVenue.commonName,
              homeAway,
              ladder: season ? ladderLine(season, oppClubId) : "No season in progress",
              lastMet: season ? lastMetLine(season, myClubId, oppClubId) : "—",
            }}
          />
        )}
        {step === 4 && (
          <OppositionStep
            opponent={oppName}
            subtitle={`${roundLabel} · ${flowVenue.commonName} · ${homeAway}`}
            howTheyPlay={`${styleLabel(oppPlan.gameStyle)}. ${styleBlurb(oppPlan.gameStyle)}`}
            danger={danger}
            taggers={taggers}
            tags={tags}
            onTag={setTag}
            standingStyle={standingPlan.gameStyle}
            weekStyle={weekStyle}
            onWeekStyle={setWeekStyle}
            scout={scout}
            changes={changes}
            onReset={() => {
              setTags(new Map());
              setWeekStyle(null);
            }}
          />
        )}
        <FlowFooter
          showBack={step > 0}
          onBack={() => setStep((step - 1) as FlowStep)}
          hint={HINT[step]}
          nextLabel={NEXT[step]}
          onNext={() => (step === 4 ? kickOff() : setStep((step + 1) as FlowStep))}
        />
      </div>
    );
  }

  // Everything below renders once a match exists (live, paused or at a break). "Your"/"their" default
  // to home/away when spectating an AI-vs-AI match with no `mySide`.
  const yourSide: Side = mySide;
  const theirSide: Side = yourSide === "home" ? "away" : "home";
  const yourTeam = yourSide === "home" ? homeView : awayView;
  const theirTeam = theirSide === "home" ? homeView : awayView;
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
      {stepper}
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
                home={homeView}
                away={awayView}
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
            <DangerMenWidget theirTeam={theirTeam} ourTeam={yourTeam} ourSide={yourSide} fantasyMetrics={fantasyMetrics} fitnessOf={fitnessOf} onSelect={selectOnGround} tags={tags} />
          </div>
        </>
      )}

      {selectedPlayer && (
        <PlayerMatchDrawer
          player={selectedPlayer.player}
          side={selectedPlayer.side}
          line={playback.liveBoxScore[selectedPlayer.player.PlayerID]}
          events={revealedEvents}
          position={(selectedPlayer.side === "home" ? homeView : awayView).positions?.get(selectedPlayer.player.PlayerID)}
          onGround={(selectedPlayer.side === "home" ? homeView : awayView).onGround?.has(selectedPlayer.player.PlayerID)}
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
