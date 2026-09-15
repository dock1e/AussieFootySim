import { useState } from "react";
import { playerFullName, type Player } from "../types/player";
import type { Position } from "../types/archetype";
import type { MatchTeam } from "../engine/team";
import { benchPlayers } from "../engine/team";
import type { MatchEvent, MatchResult, BoxScoreLine } from "../engine/match";
import { CONTEST_STAT_FIELDS } from "../engine/match";
import type { Side } from "../engine/zones";
import { MATCH_DAY_COACH_ROLES, gradeForOvr, type MatchDayCoachRole } from "../types/coach";
import {
  focusesFor,
  recommendedFocusFor,
  LINE_FEEDBACK_LOW_THRESHOLD,
  LINE_FEEDBACK_HIGH_THRESHOLD,
  type LineCoachFocus,
} from "../engine/lineCoaching";
import {
  lineQuarterWinRates,
  playerLinesByQuarter,
  quarterlyPoints,
  forwardEntryOriginThirds,
  type LineQuarterWinRate,
  type SubStatQuarterLine,
  type ForwardEntryOriginThirds,
} from "../engine/summary";
import { gameStyleModelledImpact, type GameStyle } from "../engine/tactics";
import type { ContestType } from "../engine/contestTypes";
import { COACHS_CALL_OPTIONS } from "./CoachsCall";
import { ASSISTANT_COACH_POOL } from "../data/assistantCoachPool";
import { GROUND_ROW_POSITIONS } from "./SelectionGround";
import { groupByPosition } from "./MatchPreparation";
import { PlayerMatchDrawer } from "./PlayerMatchDrawer";

/**
 * Quarter-Time Decision Room — Sep 2026, [[Quarter-Time Decision Room]]. Replaces the old scrolling
 * quarter-time takeover (`DetailedStatsTable` + `QuarterTimeInterchange` + `LineCoachPanel` +
 * `CoachsCall`, stacked) with a fixed-height, no-scroll 3-column cockpit of its own, rendered by
 * `LiveMatch.tsx` in the exact same `pendingCoachsCall`-gated slot. Full design record, including
 * the "what's real vs. disclosed derived proxy" section every number on this screen traces back to:
 * see the design note above.
 *
 * Behaviour change from the old takeover, disclosed in the design note: choosing a Coach's Call
 * option and staging an interchange no longer apply immediately — both are held in local state here
 * and only committed (via the same `onChoose`/`onInterchange` callbacks the old takeover already
 * used) when the coach hits "Resume Q{n}"/"Confirm & Resume". Line-coach focus changes are the one
 * exception, kept live exactly as round 84 shipped and disclosed them.
 */

type HighlightTarget = { kind: "focus"; role: MatchDayCoachRole; focus: LineCoachFocus } | { kind: "style"; style: GameStyle } | { kind: "interchange"; playerId: number } | null;

interface StagedSwap {
  outgoingId: number;
  incomingId: number;
}

export interface QuarterTimeDecisionRoomProps {
  side: Side;
  quarterJustFinished: 1 | 2 | 3;
  homeTeam: MatchTeam;
  awayTeam: MatchTeam;
  result: MatchResult;
  /** Real in-match fitness — see `engine/match.ts`'s own `fitnessFor` (round 48). */
  fitnessFor: (side: Side, playerId: number) => number;
  focusFor: (role: MatchDayCoachRole) => LineCoachFocus;
  onFocusChange: (role: MatchDayCoachRole, focus: LineCoachFocus) => void;
  /** One-sentence feedback per role for THIS side — the exact same real, already-resolved signal `LineCoachPanel.tsx`'s own `feedbackFor` prop renders as a quote (`engine/match.ts`'s `lineFeedbackFor`). Reused here unchanged so the "their quote" Tyler asked for is real, not invented. */
  feedbackFor: (role: MatchDayCoachRole) => string;
  lineCoaches: Partial<Record<MatchDayCoachRole, number>>;
  currentStyle: GameStyle;
  /** Same contract as the old takeover's `CoachsCall.onChoose` — sets the style AND advances/resumes. Now only ever called once, at Confirm. */
  onChoose: (style: GameStyle) => void;
  /** Same contract as the old takeover's `QuarterTimeInterchange.onInterchange`. Now called once per staged swap, in order, at Confirm — never on a bare cell click. */
  onInterchange: (outgoingId: number, incomingId: number) => void;
}

// --- Real-data problem/recommendation engine -----------------------------------------------------

const FATIGUE_BAD_CUTOFF = 45; // same "bad" cutoff QuarterTimeInterchange.tsx's own fitnessColour already uses

const PROBLEM_HEADLINE: Partial<Record<string, string>> = {
  "Defensive Line:markContested": "Leaking contested marks in defence",
  "Defensive Line:groundBall": "Losing the hard-ball scraps in defence",
  "Defensive Line:tackle": "Missing tackles down back",
  "Forward Line:markLead": "Not winning it on the lead",
  "Forward Line:markContested": "Losing contested marks forward",
  "Forward Line:tackle": "No forward-half pressure",
  "Midfield:clearance": "Getting smashed at the clearances",
  "Midfield:groundBall": "Losing the hard-ball gets",
  "Ruck and Stoppage:ruck": "Beaten in the ruck",
  "Ruck and Stoppage:markContested": "Getting out-marked around the ground",
};

/** The one Coach's Call style most associated with each line's own problem — Ruck and Stoppage deliberately has none (no GameStyle lever targets it directly). */
const STYLE_LEVER_FOR_ROLE: Partial<Record<MatchDayCoachRole, GameStyle>> = {
  "Defensive Line": "Defensive Flood",
  Midfield: "Attack the Middle",
  "Forward Line": "Forward Press",
};

function worstSubStat(subRates: Partial<Record<ContestType, SubStatQuarterLine>>): ContestType | null {
  let worst: ContestType | null = null;
  let worstRate = Infinity;
  for (const [stat, line] of Object.entries(subRates) as [ContestType, SubStatQuarterLine][]) {
    if (line.rate < worstRate) {
      worstRate = line.rate;
      worst = stat;
    }
  }
  return worst;
}

function bestSubStat(subRates: Partial<Record<ContestType, SubStatQuarterLine>>): ContestType | null {
  let best: ContestType | null = null;
  let bestRate = -Infinity;
  for (const [stat, line] of Object.entries(subRates) as [ContestType, SubStatQuarterLine][]) {
    if (line.rate > bestRate) {
      bestRate = line.rate;
      best = stat;
    }
  }
  return best;
}

function topQuarterPerformer(team: MatchTeam, quarter: number, events: MatchEvent[], stat: keyof BoxScoreLine): { player: Player; value: number } | null {
  const ids = team.players.map((p) => p.PlayerID);
  const byPlayer = playerLinesByQuarter(events, ids);
  let best: { player: Player; value: number } | null = null;
  for (const p of team.players) {
    const q = byPlayer[p.PlayerID]?.find((l) => l.quarter === quarter);
    const value = (q?.line[stat] as number) ?? 0;
    if (value > 0 && (!best || value > best.value)) best = { player: p, value };
  }
  return best;
}

interface LeverChip {
  label: string;
  highlight: HighlightTarget;
}
interface ProblemCard {
  id: string;
  headline: string;
  costLabel: string;
  costTone: "bad" | "warn";
  evidence: [string, string];
  levers: LeverChip[];
  severity: number;
}
interface DontTouchCard {
  headline: string;
  costLabel: string;
  evidence: [string, string];
}

function lineFocusLevers(role: MatchDayCoachRole): LeverChip[] {
  const levers: LeverChip[] = focusesFor(role)
    .filter((f) => f !== "Default")
    .map((focus) => {
      const highlight: HighlightTarget = { kind: "focus", role, focus };
      return { label: focus, highlight };
    });
  const style = STYLE_LEVER_FOR_ROLE[role];
  if (style) {
    const opt = COACHS_CALL_OPTIONS.find((o) => o.style === style)!;
    const highlight: HighlightTarget = { kind: "style", style };
    levers.push({ label: opt.label, highlight });
  }
  return levers;
}

/** Tyler's own spec names "which third of the ground their inside 50s came from" as an evidence source — real, computed via `forwardEntryOriginThirds` (walks real possession-spell start zones, no fabricated attribution). Phrased as a plain count/percentage breakdown, never a causal claim beyond what the split itself shows. */
function forwardEntryThirdsEvidence(thirds: ForwardEntryOriginThirds): string {
  if (thirds.total === 0) return "No clean read on where their entries started this quarter.";
  const pct = (n: number) => Math.round((n / thirds.total) * 100);
  const biggest =
    thirds.forward >= thirds.midfield && thirds.forward >= thirds.defensive
      ? `their forward third (${pct(thirds.forward)}%)`
      : thirds.midfield >= thirds.defensive
        ? `midfield (${pct(thirds.midfield)}%)`
        : `deep in their defensive third (${pct(thirds.defensive)}%)`;
  return `${thirds.total} inside-50s this quarter, most starting from ${biggest}`;
}

function lineProblemsFor(myWinRates: LineQuarterWinRate[], theirWinRates: LineQuarterWinRate[], theirTeam: MatchTeam, quarter: number, events: MatchEvent[], theirSide: Side): ProblemCard[] {
  const out: ProblemCard[] = [];
  for (const entry of myWinRates) {
    if (entry.blended >= LINE_FEEDBACK_LOW_THRESHOLD) continue;
    const stat = worstSubStat(entry.subRates);
    if (!stat) continue;
    const mine = entry.subRates[stat]!;
    const theirs = theirWinRates.find((r) => r.role === entry.role)?.subRates[stat];
    // Defensive Line's second evidence line is ground-thirds (Tyler's own spec names this specifically
    // for "their inside 50s"); every other line uses the opponent's top performer at that sub-stat.
    let secondLine: string;
    if (entry.role === "Defensive Line") {
      secondLine = forwardEntryThirdsEvidence(forwardEntryOriginThirds(events, quarter, theirSide));
    } else {
      const top = topQuarterPerformer(theirTeam, quarter, events, CONTEST_STAT_FIELDS[stat].wins);
      secondLine = top ? `${playerFullName(top.player)} led with ${top.value} for ${theirTeam.name} this quarter` : `${theirTeam.name} dominated this contest all quarter`;
    }
    out.push({
      id: `${entry.role}:${stat}`,
      headline: PROBLEM_HEADLINE[`${entry.role}:${stat}`] ?? `${entry.role} is struggling at the contest`,
      costLabel: `${mine.wins}-${theirs?.wins ?? 0}`,
      costTone: mine.rate < 0.3 ? "bad" : "warn",
      evidence: [`${Math.round(mine.rate * 100)}% win rate at ${stat} this quarter`, secondLine],
      levers: lineFocusLevers(entry.role),
      severity: 0.5 - mine.rate,
    });
  }
  return out;
}

function fatigueProblem(myTeam: MatchTeam, side: Side, quarter: number, events: MatchEvent[], fitnessFor: (side: Side, playerId: number) => number): ProblemCard | null {
  const onGroundIds = myTeam.onGround ? [...myTeam.onGround] : myTeam.players.map((p) => p.PlayerID);
  let worst: { player: Player; fitness: number; position?: Position } | null = null;
  for (const id of onGroundIds) {
    const player = myTeam.players.find((p) => p.PlayerID === id);
    if (!player) continue;
    const fitness = fitnessFor(side, id);
    if (fitness < FATIGUE_BAD_CUTOFF && (!worst || fitness < worst.fitness)) {
      worst = { player, fitness, position: myTeam.positions?.get(id) };
    }
  }
  if (!worst) return null;
  const q = playerLinesByQuarter(events, [worst.player.PlayerID])[worst.player.PlayerID]?.find((l) => l.quarter === quarter);
  const disposals = q?.line.disposals ?? 0;
  const tackles = q?.line.tackles ?? 0;
  return {
    id: `fatigue:${worst.player.PlayerID}`,
    headline: `${worst.player.lname}'s legs are gone`,
    costLabel: `${Math.round(worst.fitness)}% fitness`,
    costTone: worst.fitness < 30 ? "bad" : "warn",
    evidence: [
      `Still logged ${disposals} disposals and ${tackles} tackles this quarter despite it`,
      `Playing ${worst.position ?? "on ground"} — a fresh leg on the interchange bench could relieve them`,
    ],
    levers: [{ label: `Interchange ${worst.player.lname}`, highlight: { kind: "interchange", playerId: worst.player.PlayerID } }],
    severity: (FATIGUE_BAD_CUTOFF - worst.fitness) / FATIGUE_BAD_CUTOFF,
  };
}

function forwardEfficiencyProblem(myTeam: MatchTeam, quarter: number, events: MatchEvent[]): ProblemCard | null {
  const ids = myTeam.players.map((p) => p.PlayerID);
  const byPlayer = playerLinesByQuarter(events, ids);
  let shots = 0;
  let goals = 0;
  let leader: { player: Player; shots: number; goals: number } | null = null;
  for (const p of myTeam.players) {
    const q = byPlayer[p.PlayerID]?.find((l) => l.quarter === quarter);
    if (!q) continue;
    shots += q.line.shotsAtGoal;
    goals += q.line.goals;
    if (q.line.shotsAtGoal >= 2 && (!leader || q.line.shotsAtGoal > leader.shots)) leader = { player: p, shots: q.line.shotsAtGoal, goals: q.line.goals };
  }
  if (shots < 3) return null;
  const conversion = goals / shots;
  if (conversion >= 0.4) return null;
  return {
    id: "forward-efficiency",
    headline: "Wasting our chances in front of goal",
    costLabel: `${goals}/${shots} shots`,
    costTone: conversion < 0.25 ? "bad" : "warn",
    evidence: [
      `${Math.round(conversion * 100)}% conversion this quarter`,
      leader ? `${playerFullName(leader.player)}: ${leader.goals} from ${leader.shots} shots` : "No single forward dominating the chances",
    ],
    levers: [
      { label: "Focus on Leading", highlight: { kind: "focus", role: "Forward Line", focus: "Focus on Leading" } },
      { label: "Focus on Contested Marking", highlight: { kind: "focus", role: "Forward Line", focus: "Focus on Contested Marking" } },
    ],
    severity: (0.4 - conversion) * 2,
  };
}

function dontTouchCard(myWinRates: LineQuarterWinRate[], myTeam: MatchTeam, quarter: number, events: MatchEvent[]): DontTouchCard | null {
  const best = [...myWinRates].filter((r) => r.blended > LINE_FEEDBACK_HIGH_THRESHOLD).sort((a, b) => b.blended - a.blended)[0];
  if (!best) return null;
  const stat = bestSubStat(best.subRates);
  const top = stat ? topQuarterPerformer(myTeam, quarter, events, CONTEST_STAT_FIELDS[stat].wins) : null;
  return {
    headline: `${best.role} is doing its job`,
    costLabel: `${Math.round(best.blended * 100)}% win rate`,
    evidence: [`Comfortably on top at the contest this quarter`, top ? `${playerFullName(top.player)} leading the way with ${top.value}` : `Even contribution right across the line`],
  };
}

// --- Small presentational bits --------------------------------------------------------------------

function fitnessColour(value: number): string {
  return value >= 70 ? "bg-good" : value >= 45 ? "bg-warn" : "bg-bad";
}

function MiniBar({ value, colourClass }: { value: number; colourClass: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-base-700">
      <div className={`h-full ${colourClass}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

/** A single tiny modelled-impact bar — zero-centred, ±40 range (comfortably covers the real -25..+35 table the design note computes), red<->green by sign of `goodWhenPositive ? value : -value`. */
function ImpactBar({ label, value, goodWhenPositive }: { label: string; value: number; goodWhenPositive: boolean }) {
  const clamped = Math.max(-40, Math.min(40, value));
  const pct = (Math.abs(clamped) / 40) * 50;
  const isGood = (goodWhenPositive && value > 0) || (!goodWhenPositive && value < 0);
  const colour = value === 0 ? "bg-slate-500" : isGood ? "bg-good" : "bg-bad";
  return (
    <div className="flex items-center gap-1.5 text-[9px]">
      <span className="w-14 shrink-0 text-slate-500">{label}</span>
      <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-base-700">
        <div className="absolute left-1/2 top-0 h-full w-px bg-base-600" />
        <div className={`absolute top-0 h-full ${colour}`} style={value >= 0 ? { left: "50%", width: `${pct}%` } : { right: "50%", width: `${pct}%` }} />
      </div>
      <span className="w-9 shrink-0 text-right tabular-nums text-slate-400">
        {value > 0 ? "+" : ""}
        {Math.round(value * 10) / 10}%
      </span>
    </div>
  );
}

export function QuarterTimeDecisionRoom({
  side,
  quarterJustFinished,
  homeTeam,
  awayTeam,
  result,
  fitnessFor,
  focusFor,
  onFocusChange,
  feedbackFor,
  lineCoaches,
  currentStyle,
  onChoose,
  onInterchange,
}: QuarterTimeDecisionRoomProps) {
  const [selectedStyle, setSelectedStyle] = useState<GameStyle>(currentStyle);
  const [armedBenchId, setArmedBenchId] = useState<number | null>(null);
  const [stagedSwaps, setStagedSwaps] = useState<StagedSwap[]>([]);
  const [highlighted, setHighlighted] = useState<HighlightTarget>(null);
  /** Sep 2026 round 103 — [[Full-Time Review and Unified Player Drawer]]'s "in the interchange grid" click surface. Always `myTeam`/`side` here — this screen never shows the opponent's own interchange grid. */
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);

  const theirSide: Side = side === "home" ? "away" : "home";
  const myTeam = side === "home" ? homeTeam : awayTeam;
  const theirTeam = side === "home" ? awayTeam : homeTeam;
  const homeIds = new Set(homeTeam.players.map((p) => p.PlayerID));
  const awayIds = new Set(awayTeam.players.map((p) => p.PlayerID));

  const myWinRates = lineQuarterWinRates(result.events, quarterJustFinished, myTeam);
  const theirWinRates = lineQuarterWinRates(result.events, quarterJustFinished, theirTeam);

  const problems = [
    ...lineProblemsFor(myWinRates, theirWinRates, theirTeam, quarterJustFinished, result.events, theirSide),
    fatigueProblem(myTeam, side, quarterJustFinished, result.events, fitnessFor),
    forwardEfficiencyProblem(myTeam, quarterJustFinished, result.events),
  ]
    .filter((p): p is ProblemCard => p !== null)
    .sort((a, b) => b.severity - a.severity)
    .slice(0, 3);
  const dontTouch = dontTouchCard(myWinRates, myTeam, quarterJustFinished, result.events);

  const cumulative = quarterlyPoints(result, homeIds, awayIds).find((q) => q.quarter === quarterJustFinished);
  const myPoints = cumulative ? (side === "home" ? cumulative.homePoints : cumulative.awayPoints) : 0;
  const theirPoints = cumulative ? (side === "home" ? cumulative.awayPoints : cumulative.homePoints) : 0;
  const margin = myPoints - theirPoints;
  const marginLabel = margin === 0 ? "Level" : margin > 0 ? `Up ${margin}` : `Down ${Math.abs(margin)}`;
  const worstProblem = problems[0];
  const contextChip = worstProblem ? `${marginLabel} · ${worstProblem.headline.toLowerCase()} (${worstProblem.costLabel})` : `${marginLabel} at the last break`;

  function commitAndResume() {
    for (const swap of stagedSwaps) onInterchange(swap.outgoingId, swap.incomingId);
    onChoose(selectedStyle);
  }

  function resetStaging() {
    setStagedSwaps([]);
    setArmedBenchId(null);
    setSelectedStyle(currentStyle);
  }

  const stagedOutgoingIds = new Set(stagedSwaps.map((swap) => swap.outgoingId));
  const stagedIncomingIds = new Set(stagedSwaps.map((s) => s.incomingId));

  return (
    <div className="flex flex-col gap-2 lg:min-h-0 lg:flex-1 lg:overflow-hidden">
      {/* --- Top bar --------------------------------------------------------------------------- */}
      <div className="card flex flex-wrap items-center gap-3 !py-2.5">
        <span className="rounded-lg bg-primary px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-white">
          Quarter Time · Q{quarterJustFinished} → Q{quarterJustFinished + 1}
        </span>
        <span className="text-sm font-semibold text-slate-200">
          {myTeam.name} <span className="tabular-nums text-primary-light">{myPoints}</span>
          <span className="mx-1.5 text-slate-600">–</span>
          <span className="tabular-nums text-slate-400">{theirPoints}</span> {theirTeam.name}
        </span>
        <span className="rounded-lg bg-bad/15 px-2.5 py-1 text-xs font-semibold text-bad" title="This break's real context — a real stat differential, never a fabricated point cost">
          {contextChip}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-1" title={`${quarterJustFinished} of 4 quarters complete`}>
            {[1, 2, 3, 4].map((q) => (
              <span key={q} className={`h-1.5 w-6 rounded-full ${q <= quarterJustFinished ? "bg-primary" : "bg-base-700"}`} />
            ))}
          </div>
          <button onClick={commitAndResume} className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark">
            Resume Q{quarterJustFinished + 1}
          </button>
        </div>
      </div>

      <div className="grid gap-2 lg:min-h-0 lg:flex-1 lg:grid-cols-[404px_minmax(0,1fr)_396px]">
        {/* --- LEFT: What's Hurting Us ------------------------------------------------------- */}
        <div className="flex min-h-0 flex-col gap-2 overflow-hidden">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">What's Hurting Us</div>
          {problems.length === 0 && <div className="card flex-1 text-xs italic text-slate-500">Nothing standout yet — every line's around 50/50 this quarter.</div>}
          {problems.map((p) => (
            <div key={p.id} className="card min-h-0 space-y-1.5 !py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-200">{p.headline}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${p.costTone === "bad" ? "bg-bad/20 text-bad" : "bg-warn/20 text-warn"}`}>{p.costLabel}</span>
              </div>
              <div className="space-y-0.5 text-[10.5px] text-slate-400">
                <div>{p.evidence[0]}</div>
                <div>{p.evidence[1]}</div>
              </div>
              {p.levers.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {p.levers.map((lever) => (
                    <button
                      key={lever.label}
                      onClick={() => setHighlighted(lever.highlight)}
                      className="rounded-full bg-base-700 px-2 py-0.5 text-[10px] font-medium text-slate-300 hover:bg-primary hover:text-white"
                    >
                      {lever.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
          {dontTouch && (
            <div className="card min-h-0 space-y-1.5 border-good/40 bg-good/5 !py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-good">✓ {dontTouch.headline}</span>
                <span className="shrink-0 rounded-full bg-good/20 px-2 py-0.5 text-[10px] font-bold tabular-nums text-good">{dontTouch.costLabel}</span>
              </div>
              <div className="space-y-0.5 text-[10.5px] text-slate-400">
                <div>{dontTouch.evidence[0]}</div>
                <div>{dontTouch.evidence[1]}</div>
              </div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-good/80">Don't touch this</div>
            </div>
          )}
        </div>

        {/* --- MIDDLE: Line coaches + Coach's Call --------------------------------------------- */}
        <div className="flex min-h-0 flex-col gap-2 overflow-hidden">
          <div className="grid grid-cols-2 gap-2 lg:min-h-0 lg:flex-1">
            {MATCH_DAY_COACH_ROLES.map((role) => {
              const winRate = myWinRates.find((r) => r.role === role);
              const subRatesAsNumbers: Partial<Record<ContestType, number>> = {};
              for (const [stat, line] of Object.entries(winRate?.subRates ?? {}) as [ContestType, SubStatQuarterLine][]) {
                subRatesAsNumbers[stat] = line.rate;
              }
              const recommended = recommendedFocusFor(role, subRatesAsNumbers);
              const current = focusFor(role);
              const assignedCoachId = lineCoaches[role];
              const assignedCoach = assignedCoachId !== undefined ? ASSISTANT_COACH_POOL.find((c) => c.id === assignedCoachId) : undefined;
              return (
                <div key={role} className="card flex min-h-0 flex-col gap-1 !p-2">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-300">{role}</span>
                    <span className="truncate text-[9.5px] text-slate-500">{assignedCoach ? `${assignedCoach.name} — ${gradeForOvr(assignedCoach.ratings[role].ovr)}` : "Baseline"}</span>
                  </div>
                  <p className="line-clamp-2 text-[11px] italic text-slate-300">&ldquo;{feedbackFor(role)}&rdquo;</p>
                  <div className="flex flex-wrap gap-1">
                    {focusesFor(role).map((focus) => {
                      const isCurrent = focus === current;
                      const isRecommended = focus === recommended && !isCurrent;
                      const isHighlighted = highlighted?.kind === "focus" && highlighted.role === role && highlighted.focus === focus;
                      return (
                        <button
                          key={focus}
                          onClick={() => onFocusChange(role, focus)}
                          className={`rounded-full px-2 py-0.5 text-[9.5px] font-semibold transition-colors ${
                            isCurrent
                              ? "bg-primary text-white"
                              : isRecommended
                                ? "border border-good text-good"
                                : "bg-base-700 text-slate-300 hover:bg-base-600"
                          } ${isHighlighted ? "ring-2 ring-white" : ""}`}
                        >
                          {isRecommended && "★ "}
                          {focus}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Coach's Call</div>
          <div className="grid grid-cols-5 gap-1.5">
            {COACHS_CALL_OPTIONS.map((opt) => {
              const impact = gameStyleModelledImpact(opt.style);
              const isSelected = opt.style === selectedStyle;
              const isHighlighted = highlighted?.kind === "style" && highlighted.style === opt.style;
              return (
                <button
                  key={opt.style}
                  onClick={() => setSelectedStyle(opt.style)}
                  className={`flex flex-col gap-1 rounded-lg border p-1.5 text-left transition-colors ${
                    isSelected ? "border-primary bg-primary/10" : "border-base-600 bg-base-900 hover:bg-base-800"
                  } ${isHighlighted ? "ring-2 ring-white" : ""}`}
                >
                  <span className="truncate text-[10.5px] font-semibold text-slate-200">
                    {opt.label}
                    {opt.style === currentStyle && <span className="ml-1 font-normal text-slate-500">(current)</span>}
                  </span>
                  <ImpactBar label="Our score" value={impact.ourScoring} goodWhenPositive={true} />
                  <ImpactBar label="Their score" value={impact.theirScoring} goodWhenPositive={false} />
                  <ImpactBar label="Fitness cost" value={impact.fitnessCost} goodWhenPositive={false} />
                </button>
              );
            })}
          </div>
        </div>

        {/* --- RIGHT: Interchange + staging ----------------------------------------------------- */}
        <InterchangePanel
          team={myTeam}
          fitnessFor={(playerId) => fitnessFor(side, playerId)}
          armedBenchId={armedBenchId}
          stagedSwaps={stagedSwaps}
          stagedOutgoingIds={stagedOutgoingIds}
          stagedIncomingIds={stagedIncomingIds}
          highlighted={highlighted}
          onArmBench={(id) => setArmedBenchId((cur) => (cur === id ? null : id))}
          onStage={(outgoingId, incomingId) => {
            setStagedSwaps((cur) => [...cur, { outgoingId, incomingId }]);
            setArmedBenchId(null);
          }}
          onReset={resetStaging}
          onConfirm={commitAndResume}
          onViewPlayer={setSelectedPlayer}
        />
      </div>

      {selectedPlayer && (
        <PlayerMatchDrawer
          player={selectedPlayer}
          side={side}
          line={result.boxScore[selectedPlayer.PlayerID]}
          events={result.events.filter((ev) => ev.quarter <= quarterJustFinished)}
          position={myTeam.positions?.get(selectedPlayer.PlayerID)}
          onGround={myTeam.onGround?.has(selectedPlayer.PlayerID)}
          fitness={fitnessFor(side, selectedPlayer.PlayerID)}
          roster={myTeam.players.map((player) => ({ player, side }))}
          onSelect={(player) => setSelectedPlayer(player)}
          onClose={() => setSelectedPlayer(null)}
        />
      )}
    </div>
  );
}

function InterchangePanel({
  team,
  fitnessFor,
  armedBenchId,
  stagedSwaps,
  stagedOutgoingIds,
  stagedIncomingIds,
  highlighted,
  onArmBench,
  onStage,
  onReset,
  onConfirm,
  onViewPlayer,
}: {
  team: MatchTeam;
  fitnessFor: (playerId: number) => number;
  armedBenchId: number | null;
  stagedSwaps: StagedSwap[];
  stagedOutgoingIds: Set<number>;
  stagedIncomingIds: Set<number>;
  highlighted: HighlightTarget;
  onArmBench: (id: number) => void;
  onStage: (outgoingId: number, incomingId: number) => void;
  onReset: () => void;
  onConfirm: () => void;
  /** Sep 2026 round 103 — opens the shared player drawer. On-ground cells only fire this while idle (no bench player armed) — that click is otherwise dead real-estate today; bench cards keep their primary click for arming, so their own jumper-number badge is the nested affordance instead (see that JSX's own comment). */
  onViewPlayer: (player: Player) => void;
}) {
  if (!team.onGround || !team.positions || !team.interchangeEligibility) {
    return <div className="card text-xs italic text-slate-500">No real Selection Committee position data for {team.name} — nothing to interchange within.</div>;
  }

  const byPosition = groupByPosition(team);
  const bench = benchPlayers(team).filter((p) => !stagedIncomingIds.has(p.PlayerID));
  const armedBench = armedBenchId !== null ? bench.find((p) => p.PlayerID === armedBenchId) : undefined;
  const armedEligible = armedBench ? team.interchangeEligibility.get(armedBench.PlayerID) : undefined;

  const seen = new Map<Position, number>();
  function nextOccupant(pos: Position): Player | undefined {
    const list = byPosition.get(pos) ?? [];
    const i = seen.get(pos) ?? 0;
    seen.set(pos, i + 1);
    return list[i];
  }

  return (
    <div className="flex min-h-0 flex-col gap-2 overflow-hidden">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Interchange</div>
      <div className="space-y-2 rounded-lg border border-black/30 bg-[#0f2a1a] p-2 lg:min-h-0 lg:flex-1 lg:overflow-hidden">
        <div className="grid grid-cols-3 gap-1">
          {GROUND_ROW_POSITIONS.flatMap((row) =>
            row.positions.map((pos, i) => {
              const player = nextOccupant(pos);
              const isStagedOut = player ? stagedOutgoingIds.has(player.PlayerID) : false;
              const stagedFor = player ? stagedSwaps.find((s) => s.outgoingId === player.PlayerID) : undefined;
              const incomingName = stagedFor ? team.players.find((p) => p.PlayerID === stagedFor.incomingId)?.lname : undefined;
              const eligible = !!armedBench && !!player && !isStagedOut && !!armedEligible?.has(pos);
              // Sep 2026 round 103 — [[Full-Time Review and Unified Player Drawer]]: while idle (no
              // bench player armed) this cell's click was previously dead real-estate (`clickable`
              // required `armedBench`) — that idle click now opens the shared drawer instead. The
              // moment a bench player IS armed, the cell reverts to its existing arm/stage job — same
              // button, disambiguated by armed state, exactly like its own dimming already is.
              const viewable = !armedBench && !!player;
              const disabled = !player || (!!armedBench && !eligible);
              const isHighlighted = highlighted?.kind === "interchange" && player?.PlayerID === highlighted.playerId;
              return (
                <button
                  key={`${row.label}-${i}`}
                  type="button"
                  disabled={disabled}
                  onClick={() => {
                    if (armedBench && eligible && player) onStage(player.PlayerID, armedBench.PlayerID);
                    else if (viewable && player) onViewPlayer(player);
                  }}
                  title={
                    player
                      ? armedBench
                        ? `${pos} — ${player.fname} ${player.lname}`
                        : `${pos} — ${player.fname} ${player.lname} — click to view stats`
                      : pos
                  }
                  className={`flex h-[54px] flex-col items-center justify-center gap-0.5 rounded-lg border-2 px-1 text-center transition-colors ${
                    isStagedOut
                      ? "border-bad bg-bad/10"
                      : armedBench
                        ? eligible
                          ? "cursor-pointer border-accent bg-accent/10"
                          : "cursor-not-allowed border-base-700 opacity-30"
                        : viewable
                          ? "cursor-pointer border-base-600 bg-base-800/90 hover:border-slate-400"
                          : "border-base-600 bg-base-800/90"
                  } ${isHighlighted ? "ring-2 ring-white" : ""}`}
                >
                  <span className="text-[8px] font-semibold uppercase tracking-wide text-slate-400">{pos}</span>
                  {player ? (
                    <>
                      <span className="max-w-full truncate text-[10px] font-semibold leading-tight text-slate-100">#{player.jumperNumber} {player.lname}</span>
                      <span className="w-9">
                        <MiniBar value={fitnessFor(player.PlayerID)} colourClass={fitnessColour(fitnessFor(player.PlayerID))} />
                      </span>
                      {incomingName && <span className="text-[8px] font-semibold text-primary-light">→ {incomingName}</span>}
                    </>
                  ) : (
                    <span className="text-lg leading-none text-slate-600">—</span>
                  )}
                </button>
              );
            }),
          )}
        </div>

        {bench.length > 0 && (
          <div className="border-t border-white/10 pt-1.5">
            <div className="mb-1 text-center text-[9px] uppercase tracking-wide text-slate-400">
              {armedBench ? `${armedBench.lname} armed — click a highlighted position` : "Click a bench player to arm a swap"}
            </div>
            <div className="flex flex-wrap justify-center gap-1">
              {bench.map((p) => {
                const isArmed = armedBenchId === p.PlayerID;
                const isHighlighted = highlighted?.kind === "interchange" && highlighted.playerId === p.PlayerID;
                return (
                  <button
                    key={p.PlayerID}
                    type="button"
                    onClick={() => onArmBench(p.PlayerID)}
                    className={`flex items-center gap-1 rounded-lg border-2 px-1.5 py-0.5 text-[10px] transition-colors ${
                      isArmed ? "border-accent bg-accent/10" : "border-base-600 bg-base-800/90 hover:bg-base-700"
                    } ${isHighlighted ? "ring-2 ring-white" : ""}`}
                  >
                    <span className="flex items-center gap-1 text-slate-200">
                      {/* Sep 2026 round 103 — this card's own click always arms/disarms (the primary
                          interaction), so the jumper number is its own nested `role="button"` span —
                          can't nest a real `<button>` inside one, same reasoning `PlayerLink`'s own
                          `as="span"` doc comment gives — opening the shared drawer without disturbing it. */}
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          onViewPlayer(p);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            onViewPlayer(p);
                          }
                        }}
                        title={`View ${p.fname} ${p.lname}'s stats`}
                        className="cursor-pointer rounded bg-base-900/70 px-1 tabular-nums text-slate-400 hover:text-primary-light"
                      >
                        #{p.jumperNumber}
                      </span>
                      {p.lname}
                    </span>
                    <span className="w-8">
                      <MiniBar value={fitnessFor(p.PlayerID)} colourClass={fitnessColour(fitnessFor(p.PlayerID))} />
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="card min-h-0 space-y-1.5 !p-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Staged Changes</div>
        {stagedSwaps.length === 0 ? (
          <div className="text-[10.5px] italic text-slate-500">No changes staged yet.</div>
        ) : (
          <ul className="space-y-0.5 text-[10.5px] text-slate-300">
            {stagedSwaps.map((s, i) => {
              const out = team.players.find((p) => p.PlayerID === s.outgoingId);
              const inc = team.players.find((p) => p.PlayerID === s.incomingId);
              return (
                <li key={i}>
                  {out?.lname} → {inc?.lname} ({team.positions?.get(s.outgoingId)})
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex gap-2 pt-1">
          <button onClick={onReset} className="flex-1 rounded-lg bg-base-800 px-3 py-1.5 text-xs text-slate-400 hover:bg-base-700">
            Reset
          </button>
          <button onClick={onConfirm} className="flex-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-dark">
            Confirm & Resume
          </button>
        </div>
      </div>
    </div>
  );
}
