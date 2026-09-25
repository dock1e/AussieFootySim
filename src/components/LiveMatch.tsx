import { useEffect, useMemo, useState } from "react";
import { CLUBS, clubByName } from "../types/club";
import type { Player } from "../types/player";
import type { Position } from "../types/archetype";
import { getPlayersByClub, leagueAverageOvr } from "../data/loadPlayers";
import { cloneMatchTeam, interchangesUpTo, teamAtEvent, type Cover, type MatchTeam } from "../engine/team";
import { friendlyTimeslot, type Timeslot } from "../engine/fixture";
import { autoFillLineup, defaultCovers, emptyLineup, lineupToMatchTeam, validCovers, type Lineup } from "../engine/selection";
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
import { aiTeamPlan, defaultTeamPlan, gameStyleModelledImpact, DEFAULT_GAME_STYLE, type GameStyle } from "../engine/tactics";
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
import { GamePlanStep } from "./matchday/flow/GamePlanStep";
import { useScoutPick } from "./matchday/flow/useScoutPick";
import { FixtureStep } from "./matchday/flow/FixtureStep";
import { OppositionStep, type WeeklyChange } from "./matchday/flow/OppositionStep";
import { useTogProjection } from "./matchday/flow/useTogProjection";
import {
  dangerMen,
  isTaggable,
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
  const setLineup = useSelectionStore((s) => s.setLineup);
  const autoFill = useSelectionStore((s) => s.autoFill);
  const allEligibility = useSelectionStore((s) => s.eligibility);
  const myEligibility = allEligibility[myClub];
  const storedCovers = useSelectionStore((s) => s.covers[myClub]);
  const setCovers = useSelectionStore((s) => s.setCovers);
  const lastWeek = useSelectionStore((s) => s.lastWeek[myClub]);
  const setLastWeek = useSelectionStore((s) => s.setLastWeek);

  const standingPlan = useTeamPlanStore((s) => s.plans[myClub]) ?? defaultTeamPlan();
  const setStandingStyle = useTeamPlanStore((s) => s.setGameStyle);
  const setPositionTactic = useTeamPlanStore((s) => s.setPositionTactic);

  const season = useSeasonStore((s) => s.season);
  const seasonTeams = useSeasonStore((s) => s.teams);
  const recordLiveRound = useSeasonStore((s) => s.recordLiveRound);
  const year = useSaveStore((s) => s.year);

  // Match Day flow v2: opening Match Day always lands on Fixture.
  const [step, setStep] = useState<FlowStep>(() => initialStep ?? 0);
  const [friendlyOpponent, setFriendlyOpponent] = useState(() => CLUBS.find((c) => c.name !== myClub)?.name ?? CLUBS[0].name);
  /** This week only: opponent PlayerID → your tagger's PlayerID. Cleared whenever the fixture changes. */
  const [tags, setTags] = useState<Map<number, number>>(new Map());

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
  const when: Timeslot = nextRow ? nextRow.when : friendlyTimeslot(oppClubId);
  const flowVenue = useMemo(
    () => (nextRow && season ? groundForMatch(nextRow.homeClubId, nextRow.round, season.fixture) : groundForMatch(myClubId)),
    [nextRow, season, myClubId],
  );
  const homeVenue = useMemo(() => groundForMatch(myClubId).commonName, [myClubId]);
  // A new week (the next round moved on) starts with no tags.
  const weekKey = nextRow ? `r${nextRow.round}` : `f${friendlyOpponent}`;
  const [tagsWeek, setTagsWeek] = useState(weekKey);
  if (tagsWeek !== weekKey) {
    setTagsWeek(weekKey);
    setTags(new Map());
  }

  // --- The plan: covers (who relieves whom) -----------------------------------------------------------
  // A club with no saved covers uses the ones derived from its line-up and old per-position rotations.
  const effectiveCovers = useMemo(
    () => storedCovers ?? defaultCovers(lineup, myPlayers, myEligibility),
    [storedCovers, lineup, myPlayers, myEligibility],
  );
  const liveCovers = useMemo(() => validCovers(lineup, effectiveCovers), [lineup, effectiveCovers]);
  function setCover(resterId: number, cover: Cover | null) {
    setCovers(myClub, { ...effectiveCovers, [resterId]: cover });
  }
  /** Every line-up change also drops covers the new line-up no longer supports. */
  function changeLineup(next: Lineup) {
    setLineup(myClub, next);
    if (storedCovers) setCovers(myClub, validCovers(next, storedCovers));
  }

  /**
   * Your side is always your saved line-up (topped up by `lineupToMatchTeam` if it isn't full yet);
   * the opponent is its season team when there is one, else the same suitability-aware auto-fill an AI
   * club gets in season simulation.
   */
  const flowMine = useMemo(
    () => lineupToMatchTeam(myClub, savedLineup ?? autoFillLineup(myPlayers), myPlayers, myEligibility, liveCovers),
    [myClub, savedLineup, myPlayers, myEligibility, liveCovers],
  );
  const flowOpp = useMemo(() => {
    const fromSeason = nextRow ? seasonTeams?.get(oppClubId) : undefined;
    if (fromSeason) return fromSeason;
    const players = getPlayersByClub(oppName);
    return lineupToMatchTeam(oppName, autoFillLineup(players), players, allEligibility[oppName]);
  }, [nextRow, seasonTeams, oppClubId, oppName, allEligibility]);
  const oppPlan = useMemo(() => aiTeamPlan(getPlayersByClub(oppName), leagueAverageOvr()), [oppName]);
  /** Only valid tags reach the match: a taggable target, tagged by an on-field non-ruck starter. */
  const validTags = useMemo(() => {
    const out = new Map<number, number>();
    for (const [target, tagger] of tags) {
      const tPos = flowOpp.positions?.get(target);
      const gPos = flowMine.positions?.get(tagger);
      if (isTaggable(tPos) && gPos && gPos !== "INT" && gPos !== "R") out.set(target, tagger);
    }
    return out;
  }, [tags, flowOpp, flowMine]);
  const minePlan = useMemo(() => weeklyPlan(standingPlan, null, validTags), [standingPlan, validTags]);

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
    // "Last week's team" and "Changes vs last week" read this snapshot of what took the field.
    setLastWeek(myClub, { lineup: [...lineup], gameStyle: standingPlan.gameStyle });
    setStep(4);
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
    setRecordedRound(null);
    setStep(to);
  }
  const newMatchup = () => leaveMatch(0);

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

  // --- Flow view-model (steps 1-4) -------------------------------------------------------------------
  const avgFpOfPlayer = (p: Player) => {
    const inSave = seasonAvgFpMap.get(p.PlayerID)?.fantasyPoints;
    return inSave !== undefined && inSave > 0 ? inSave : baselineFpAverage(p);
  };
  const danger = useMemo(() => dangerMen(flowOpp, flowMine, avgFpOfPlayer), [flowOpp, flowMine, seasonAvgFpMap]); // eslint-disable-line react-hooks/exhaustive-deps
  const taggers = useMemo(() => taggerCandidates(flowMine), [flowMine]);
  const scout = useMemo(() => scoutingRows(oppName), [oppName]);
  const filled = lineup.filter((id) => id !== null).length;
  const myAbbr = clubAbbr(myClub);
  const oppAbbr = clubAbbr(oppName);
  const roundLabel = nextRow ? `Round ${nextRow.round}` : "Friendly";
  const homeAway = iAmHome ? "Home" : "Away";
  const style = standingPlan.gameStyle;

  // Changes vs last week: team in/out, tags, style.
  const changes: WeeklyChange[] = [];
  if (lastWeek) {
    const before = new Set(lastWeek.lineup.filter((id): id is number => id !== null));
    const now = lineup.filter((id): id is number => id !== null);
    const ins = now.filter((id) => !before.has(id)).map((id) => myById.get(id)?.lname ?? "?");
    const outs = [...before].filter((id) => !now.includes(id)).map((id) => myById.get(id)?.lname ?? "?");
    if (ins.length || outs.length) changes.push({ kind: "TEAM", text: [ins.length ? `In: ${ins.join(", ")}` : "", outs.length ? `Out: ${outs.join(", ")}` : ""].filter(Boolean).join(" · ") });
  }
  for (const [targetId, taggerId] of validTags) {
    const tagger = myById.get(taggerId);
    const target = flowOpp.players.find((p) => p.PlayerID === targetId);
    if (!tagger || !target) continue;
    changes.push({ kind: "TAG", text: `${tagger.lname} (${flowMine.positions?.get(taggerId)}) → tags ${target.fname} ${target.lname}` });
  }
  if (lastWeek && lastWeek.gameStyle !== style) changes.push({ kind: "STYLE", text: `${styleLabel(lastWeek.gameStyle)} → ${styleLabel(style)}` });

  function setTag(targetId: number, taggerId: number | null) {
    setTags((cur) => {
      const next = new Map([...cur].filter(([, t]) => t !== taggerId));
      if (taggerId === null) next.delete(targetId);
      else next.set(targetId, taggerId);
      return next;
    });
  }

  const condition = nextRow && season ? season.condition : undefined;
  const planKey = JSON.stringify([
    lineup,
    liveCovers,
    [...standingPlan.tactics].map(([id, t]) => [id, t.tactic]),
    [...(standingPlan.positionTactics ?? [])].map(([k, t]) => [k, t.tactic]),
    oppName,
    iAmHome,
    flowVenue.commonName,
    nextRow?.round ?? null,
  ]);
  // Game plan: projected time on ground against this week's opponent (real simulated matches).
  const projectionKey = step === 3 && !active ? JSON.stringify([planKey, style]) : "";
  const projection = useTogProjection(
    projectionKey ? { mine: flowMine, opp: flowOpp, mineIsHome: iAmHome, minePlan: standingPlan, oppPlan, stadium: flowVenue, condition } : null,
    projectionKey,
  );
  // Opposition and Game plan: the scout plays this week's match out in every style.
  const scoutKey = (step === 2 || step === 3) && !active ? planKey : "";
  const scoutPick = useScoutPick(
    scoutKey ? { mine: flowMine, opp: flowOpp, mineIsHome: iAmHome, minePlan: minePlan, oppPlan, stadium: flowVenue, condition } : null,
    scoutKey,
  );

  // --- Stepper ---------------------------------------------------------------------------------------
  const locked = !!active && !atFullTime;
  const scoreSub = active && result ? `${playback.liveScore.homePoints} – ${playback.liveScore.awayPoints}` : "Ready";
  const nTags = validTags.size;
  const steps: StepInfo[] = [
    { sub: nextRow ? `Rd ${nextRow.round} · ${oppAbbr}` : `Friendly · ${oppAbbr}`, disabled: locked },
    { sub: `${filled}/23 picked`, disabled: locked },
    { sub: nTags ? plural(nTags, "tag") : "No tags", disabled: locked },
    { sub: styleLabel(style), disabled: locked },
    { sub: scoreSub },
  ];
  function goStep(s: FlowStep) {
    if (active) {
      if (s < 4 && atFullTime) leaveMatch(s);
      return;
    }
    if (s === 4) kickOff();
    else setStep(s);
  }
  const contextLine = `${nextRow ? `ROUND ${nextRow.round}` : "FRIENDLY"} · ${myAbbr} V ${oppAbbr} · ${flowVenue.commonName.toUpperCase()} · ${when.label.toUpperCase()}`;
  const stepper = <FlowStepper step={active ? 4 : step} steps={steps} contextLine={contextLine} onGo={goStep} />;

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
    const NEXT = ["Pick the team", `Scout ${oppName}`, "Game plan", "First bounce"];
    const coveredCount = Object.keys(liveCovers).length;
    const HINT = [
      `${roundLabel} · ${flowVenue.commonName} · ${when.label} · ${homeAway}`,
      lineupStat(lineup, myById),
      changes.length ? `${plural(changes.length, "change")} vs last week` : "Playing last week's plan",
      `${coveredCount}/18 have relief · ${styleLabel(style)}`,
    ];
    return (
      <div className="flex flex-col gap-3">
        {stepper}
        {step === 0 && (
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
            friendlyWhen={(club) => friendlyTimeslot(clubByName(club)?.ClubID ?? 0)}
            card={{
              roundLabel: roundLabel.toUpperCase(),
              opponent: oppName,
              venue: flowVenue.commonName,
              homeAway,
              when: when.label,
              night: when.night,
              ladder: season ? ladderLine(season, oppClubId) : "No season in progress",
              lastMet: season ? lastMetLine(season, myClubId, oppClubId) : "—",
              carriedFrom: nextRow && nextRow.round > 1 ? nextRow.round - 1 : null,
            }}
          />
        )}
        {step === 1 && (
          <SelectionStep
            players={myPlayers}
            lineup={lineup}
            onChange={changeLineup}
            onAutoPick={() => {
              autoFill(myClub, myPlayers);
              if (storedCovers) setCovers(myClub, validCovers(useSelectionStore.getState().lineupFor(myClub) ?? lineup, storedCovers));
            }}
            onLastWeek={lastWeek ? () => changeLineup(lastWeek.lineup) : null}
          />
        )}
        {step === 2 && (
          <OppositionStep
            opponent={oppName}
            subtitle={`${roundLabel} · ${flowVenue.commonName} · ${when.label}`}
            howTheyPlay={`${styleLabel(oppPlan.gameStyle)}. ${styleBlurb(oppPlan.gameStyle)}`}
            danger={danger}
            taggers={taggers}
            taggerSlot={(p) => flowMine.positions?.get(p.PlayerID) ?? ""}
            tags={validTags}
            onTag={setTag}
            scout={scout}
            scoutPick={scoutPick.pick}
            scoutPending={scoutPick.pending}
            planStyle={style}
            onUseStyle={(st) => setStandingStyle(myClub, st)}
            changes={changes}
            onClearTags={() => setTags(new Map())}
          />
        )}
        {step === 3 && (
          <GamePlanStep
            lineup={lineup}
            byId={myById}
            plan={standingPlan}
            covers={liveCovers}
            onStyle={(st) => setStandingStyle(myClub, st)}
            onCover={setCover}
            onRole={(id, pos: Position, tactic) => setPositionTactic(myClub, id, pos, { tactic })}
            tog={projection.tog}
            projecting={projection.pending}
            scoutStyle={scoutPick.pick?.style ?? null}
            lastWeekStyle={lastWeek?.gameStyle ?? null}
          />
        )}
        <FlowFooter
          showBack={step > 0}
          onBack={() => setStep((step - 1) as FlowStep)}
          hint={HINT[step]}
          nextLabel={NEXT[step]}
          onNext={() => (step === 3 ? kickOff() : setStep((step + 1) as FlowStep))}
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

  // Your side's starting 18 — the bench strip highlights a starter who's resting.
  const kickoffMine = active ? (mySide === "home" ? active.homeAtBounce : active.awayAtBounce) : null;
  const startingIds = new Set(kickoffMine?.onGround ?? []);

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
              styleChip={(() => {
                const st = mySide === "home" ? homeStyle : awayStyle;
                const im = gameStyleModelledImpact(st);
                const sg = (v: number) => `${v > 0 ? "+" : ""}${Math.round(v)}%`;
                return { label: styleLabel(st), detail: st === "Balanced" ? "no bias" : `us ${sg(im.ourScoring)} · them ${sg(im.theirScoring)}` };
              })()}
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
                night={when.night}
                startingIds={startingIds}
              />
            </section>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 400px), 1fr))", gap: 12 }}>
            <MoversWidget team={yourTeam} side={yourSide} events={revealedEvents} ticksPerQuarter={tpq} fantasyMetrics={fantasyMetrics} onSelect={selectOnGround} />
            <PlayByPlayWidget events={revealedEvents} ticksPerQuarter={tpq} homeTeam={homeTeam} awayTeam={awayTeam} homeIds={homeIds} yourSide={yourSide} />
            <DangerMenWidget theirTeam={theirTeam} ourTeam={yourTeam} ourSide={yourSide} fantasyMetrics={fantasyMetrics} fitnessOf={fitnessOf} onSelect={selectOnGround} tags={validTags} />
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
