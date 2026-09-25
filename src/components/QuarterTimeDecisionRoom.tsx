import { useMemo, useState, type CSSProperties } from "react";
import { playerFullName, type Player } from "../types/player";
import type { Position } from "../types/archetype";
import type { MatchTeam } from "../engine/team";
import { benchPlayers, groupByPosition } from "../engine/team";
import type { MatchEvent, MatchResult, BoxScoreLine } from "../engine/match";
import { CONTEST_STAT_FIELDS } from "../engine/match";
import type { Side } from "../engine/zones";
import { MATCH_DAY_COACH_ROLES, gradeForOvr, type MatchDayCoachRole } from "../types/coach";
import { focusesFor, recommendedFocusFor, LINE_FEEDBACK_LOW_THRESHOLD, LINE_FEEDBACK_HIGH_THRESHOLD, type LineCoachFocus } from "../engine/lineCoaching";
import { lineQuarterWinRates, playerLinesByQuarter, forwardEntryOriginThirds, type SubStatQuarterLine } from "../engine/summary";
import { gameStyleModelledImpact, type GameStyle } from "../engine/tactics";
import type { ContestType } from "../engine/contestTypes";
import { fantasyPointsFor } from "../engine/ratings";
import { COACHS_CALL_OPTIONS } from "./CoachsCall";
import { ASSISTANT_COACH_POOL } from "../data/assistantCoachPool";
import { PlayerMatchDrawer } from "./PlayerMatchDrawer";
import { directOpponents } from "./matchday/LiveWidgets";
import {
  BARLOW,
  BreakBar,
  CARD_BG,
  CARD_BORDER,
  COND,
  FALL,
  MONO,
  PANEL_BG,
  RISE,
  StatStrip,
  Stripe,
  WARN,
  breakLabel,
  capitalise,
  fitColor,
  plural,
  sectionLabelStyle,
  type StatStripItem,
} from "./matchday/shared";

/**
 * Break screen — Match Day v2 (`match-day-v2/02-implementation-spec.md` §2, visual source of truth
 * `Match Day v2.dc.html` "Half time"). Rendered by `LiveMatch.tsx` under the shared scoreboard (which
 * carries the break status) whenever a quarter-time / half-time / three-quarter-time break is pending.
 *
 * ONE state model (spec §2): `{ swaps, lines, call }`. The diagnosis fix buttons, the line-instruction
 * chips, the interchange taps and the staged-changes list all read and write this same object, so
 * undoing from any of them updates all of them. Nothing touches the engine until Resume, which applies
 * the swaps (`onInterchange`), then the line focuses (`onFocusChange`), then the coach's call
 * (`onChoose`, which also simulates the next quarter and resumes playback) — in that order, so every
 * staged change is live for the quarter it was staged for.
 */

interface StagedSwap {
  outgoingId: number;
  incomingId: number;
}

interface BreakState {
  swaps: StagedSwap[];
  lines: Record<MatchDayCoachRole, LineCoachFocus>;
  call: GameStyle;
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
  /** One-sentence feedback per role for THIS side (`engine/match.ts`'s `lineFeedbackFor`). */
  feedbackFor: (role: MatchDayCoachRole) => string;
  lineCoaches: Partial<Record<MatchDayCoachRole, number>>;
  currentStyle: GameStyle;
  /** Sets the style AND advances/resumes — called once, last, at Resume. */
  onChoose: (style: GameStyle) => void;
  /** Called once per staged swap at Resume. */
  onInterchange: (outgoingId: number, incomingId: number) => void;
}

// --- Labels ----------------------------------------------------------------------------------------

const ROLE_NAME: Record<MatchDayCoachRole, string> = {
  "Defensive Line": "Defensive line",
  "Forward Line": "Forward line",
  Midfield: "Midfield",
  "Ruck and Stoppage": "Ruck & stoppage",
};

const ROLE_KIND: Record<MatchDayCoachRole, string> = {
  "Defensive Line": "DEF",
  "Forward Line": "FWD",
  Midfield: "MID",
  "Ruck and Stoppage": "RUCK",
};

/** How each contest reads in a sentence ("contested marks", "hitouts"…). */
const CONTEST_NOUN: Record<ContestType, { plural: string; chip: string }> = {
  markLead: { plural: "marks on the lead", chip: "LEAD MARK" },
  markContested: { plural: "contested marks", chip: "CONTESTED MARK" },
  groundBall: { plural: "ground-ball contests", chip: "GROUND BALL" },
  tackle: { plural: "tackle contests", chip: "TACKLE" },
  ruck: { plural: "hitouts", chip: "HITOUT" },
  clearance: { plural: "clearances", chip: "CLEARANCE" },
};

/** Sentence case for a focus chip ("Focus on Leading" → "Focus on leading"), same look as the reference. */
function focusLabel(focus: LineCoachFocus): string {
  return focus === "Default" ? "Default" : focus[0] + focus.slice(1).toLowerCase();
}

const FATIGUE_BAD_CUTOFF = 45;

// --- Diagnosis cards -------------------------------------------------------------------------------

type Tone = "bad" | "warn" | "good";

interface Fix {
  label: string;
  appliedLabel: string;
  isApplied: (s: BreakState) => boolean;
  toggle: (s: BreakState) => BreakState;
}

interface HurtCard {
  id: string;
  title: string;
  chip: string;
  tone: Tone;
  body: string;
  fixes: Fix[];
  severity: number;
  keep?: boolean;
}

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
  const byPlayer = playerLinesByQuarter(events, team.players.map((p) => p.PlayerID));
  let best: { player: Player; value: number } | null = null;
  for (const p of team.players) {
    const q = byPlayer[p.PlayerID]?.find((l) => l.quarter === quarter);
    const value = (q?.line[stat] as number) ?? 0;
    if (value > 0 && (!best || value > best.value)) best = { player: p, value };
  }
  return best;
}

function focusFix(role: MatchDayCoachRole, focus: LineCoachFocus, prefix: string): Fix {
  const text = `${prefix}${focusLabel(focus).toLowerCase()}`;
  return {
    label: text,
    appliedLabel: `✓ ${text}`,
    isApplied: (s) => s.lines[role] === focus,
    toggle: (s) => ({ ...s, lines: { ...s.lines, [role]: s.lines[role] === focus ? "Default" : focus } }),
  };
}

function swapFix(out: Player, inn: Player, innFitness: number): Fix {
  const matches = (w: StagedSwap) => w.outgoingId === out.PlayerID && w.incomingId === inn.PlayerID;
  return {
    label: `Swap ${out.lname} for ${inn.lname} (${Math.round(innFitness)}%)`,
    appliedLabel: `✓ ${inn.lname} on for ${out.lname}`,
    isApplied: (s) => s.swaps.some(matches),
    toggle: (s) =>
      s.swaps.some(matches)
        ? { ...s, swaps: s.swaps.filter((w) => !matches(w)) }
        : { ...s, swaps: [...s.swaps.filter((w) => w.outgoingId !== out.PlayerID && w.incomingId !== inn.PlayerID), { outgoingId: out.PlayerID, incomingId: inn.PlayerID }] },
  };
}

// --- Component -------------------------------------------------------------------------------------

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
  const q = quarterJustFinished;
  const theirSide: Side = side === "home" ? "away" : "home";
  const myTeam = side === "home" ? homeTeam : awayTeam;
  const theirTeam = side === "home" ? awayTeam : homeTeam;
  const events = result.events;

  const initialLines = useMemo(() => Object.fromEntries(MATCH_DAY_COACH_ROLES.map((r) => [r, focusFor(r)])) as Record<MatchDayCoachRole, LineCoachFocus>, []); // eslint-disable-line react-hooks/exhaustive-deps
  const initial: BreakState = { swaps: [], lines: initialLines, call: currentStyle };
  const [state, setState] = useState<BreakState>(initial);
  const [armedBenchId, setArmedBenchId] = useState<number | null>(null);
  const [drawerPlayer, setDrawerPlayer] = useState<Player | null>(null);

  const myFitness = (id: number) => fitnessFor(side, id);
  const playerById = new Map(myTeam.players.map((p) => [p.PlayerID, p]));

  // --- Q{n} IN NUMBERS (critique C4) — this quarter only ----------------------------------------------
  const quarterNumbers = useMemo((): StatStripItem[] => {
    const sumQuarter = (team: MatchTeam) => {
      const lines = playerLinesByQuarter(events, team.players.map((p) => p.PlayerID));
      const t = { clearances: 0, contestedPoss: 0, marksInside50: 0, tackles: 0, goals: 0, behinds: 0 };
      for (const p of team.players) {
        const l = lines[p.PlayerID]?.find((x) => x.quarter === q)?.line;
        if (!l) continue;
        t.clearances += l.clearances;
        t.contestedPoss += l.contestedPoss;
        t.marksInside50 += l.marksInside50;
        t.tackles += l.tackles;
        t.goals += l.goals;
        t.behinds += l.behinds;
      }
      return t;
    };
    const mine = sumQuarter(myTeam);
    const theirs = sumQuarter(theirTeam);
    return [
      { label: "Inside 50s", home: forwardEntryOriginThirds(events, q, side).total, away: forwardEntryOriginThirds(events, q, theirSide).total },
      { label: "Clearances", home: mine.clearances, away: theirs.clearances },
      { label: "Contested poss", home: mine.contestedPoss, away: theirs.contestedPoss },
      { label: "Marks i50", home: mine.marksInside50, away: theirs.marksInside50 },
      { label: "Tackles", home: mine.tackles, away: theirs.tackles },
      { label: "Scoring shots", home: mine.goals + mine.behinds, away: theirs.goals + theirs.behinds },
    ];
  }, [events, q, myTeam, theirTeam, side, theirSide]);

  // --- What's hurting us ----------------------------------------------------------------------------
  const myWinRates = useMemo(() => lineQuarterWinRates(events, q, myTeam), [events, q, myTeam]);
  const theirWinRates = useMemo(() => lineQuarterWinRates(events, q, theirTeam), [events, q, theirTeam]);

  const bench = benchPlayers(myTeam);
  function bestReplacementFor(out: Player): Player | undefined {
    const pos = myTeam.positions?.get(out.PlayerID);
    if (!pos) return undefined;
    return bench
      .filter((b) => myTeam.interchangeEligibility?.get(b.PlayerID)?.has(pos) ?? true)
      .sort((a, b) => myFitness(b.PlayerID) - myFitness(a.PlayerID))[0];
  }

  const cards: HurtCard[] = useMemo(() => {
    const out: HurtCard[] = [];
    const quarterLines = playerLinesByQuarter(events, myTeam.players.map((p) => p.PlayerID));
    const opponents = directOpponents(theirTeam, myTeam);

    // Fatigue: the tiredest on-ground player below the cutoff.
    let tired: { player: Player; fitness: number } | null = null;
    for (const id of myTeam.onGround ?? []) {
      const player = playerById.get(id);
      if (!player) continue;
      const f = myFitness(id);
      if (f < FATIGUE_BAD_CUTOFF && (!tired || f < tired.fitness)) tired = { player, fitness: f };
    }
    if (tired) {
      const line = quarterLines[tired.player.PlayerID]?.find((l) => l.quarter === q)?.line;
      const minding = [...opponents.entries()].find(([, ours]) => ours.PlayerID === tired!.player.PlayerID);
      const mindingPlayer = minding ? theirTeam.players.find((p) => p.PlayerID === minding[0]) : undefined;
      const mindingFp = mindingPlayer ? Math.round(fantasyPointsFor(result.boxScore[mindingPlayer.PlayerID])) : 0;
      const replacement = bestReplacementFor(tired.player);
      out.push({
        id: `fatigue:${tired.player.PlayerID}`,
        title: `${tired.player.lname}'s legs are gone`,
        chip: `${Math.round(tired.fitness)}% FITNESS`,
        tone: tired.fitness < 30 ? "bad" : "warn",
        body:
          `${plural(line?.disposals ?? 0, "disposal")} and ${plural(line?.tackles ?? 0, "tackle")} this quarter.` +
          (mindingPlayer ? ` He is minding ${playerFullName(mindingPlayer)}, who has ${mindingFp} FP.` : ` He is at ${myTeam.positions?.get(tired.player.PlayerID) ?? "his post"} on ${Math.round(tired.fitness)}% fitness.`),
        fixes: replacement ? [swapFix(tired.player, replacement, myFitness(replacement.PlayerID))] : [],
        severity: (FATIGUE_BAD_CUTOFF - tired.fitness) / FATIGUE_BAD_CUTOFF + 0.3,
      });
    }

    // Line contests below the low-feedback threshold.
    for (const entry of myWinRates) {
      if (entry.blended >= LINE_FEEDBACK_LOW_THRESHOLD) continue;
      const stat = worstSubStat(entry.subRates);
      if (!stat) continue;
      const mine = entry.subRates[stat]!;
      const noun = CONTEST_NOUN[stat];
      let second = "";
      if (entry.role === "Defensive Line") {
        const thirds = forwardEntryOriginThirds(events, q, theirSide);
        if (thirds.total > 0) second = ` ${theirTeam.name} went inside 50 ${thirds.total} times this quarter.`;
      } else {
        const top = topQuarterPerformer(theirTeam, q, events, CONTEST_STAT_FIELDS[stat].wins);
        if (top) second = ` ${playerFullName(top.player)} won ${top.value} of them for ${theirTeam.name}.`;
      }
      const subRatesAsNumbers = Object.fromEntries(Object.entries(entry.subRates).map(([k, v]) => [k, v!.rate])) as Partial<Record<ContestType, number>>;
      const rec = recommendedFocusFor(entry.role, subRatesAsNumbers);
      const options = focusesFor(entry.role).filter((f) => f !== "Default");
      const picks = [rec, ...options].filter((f, i, arr): f is LineCoachFocus => !!f && f !== "Default" && arr.indexOf(f) === i).slice(0, 2);
      out.push({
        id: `${entry.role}:${stat}`,
        title: `${ROLE_NAME[entry.role]} losing the ${noun.plural}`,
        chip: `${mine.wins} / ${mine.attempts} WON`,
        tone: mine.rate < 0.3 ? "bad" : "warn",
        body: `We won ${mine.wins} of ${mine.attempts} ${noun.plural} this quarter (${Math.round(mine.rate * 100)}%).${second}`,
        fixes: picks.map((f) => focusFix(entry.role, f, `${ROLE_NAME[entry.role]}: `)),
        severity: 0.5 - mine.rate,
      });
    }

    // Wasted chances in front of goal.
    let shots = 0;
    let goals = 0;
    let multiShotForwards = 0;
    for (const p of myTeam.players) {
      const l = quarterLines[p.PlayerID]?.find((x) => x.quarter === q)?.line;
      if (!l) continue;
      shots += l.shotsAtGoal;
      goals += l.goals;
      if (l.shotsAtGoal >= 2) multiShotForwards++;
    }
    if (shots >= 3 && goals / shots < 0.4) {
      out.push({
        id: "conversion",
        title: "Wasting chances in front of goal",
        chip: `${goals} / ${shots} SHOTS`,
        tone: goals / shots < 0.25 ? "bad" : "warn",
        body: `${Math.round((goals / shots) * 100)}% conversion this quarter` + (multiShotForwards === 0 ? ", and no forward has had more than one shot." : `, with ${plural(multiShotForwards, "player")} taking two or more shots.`),
        fixes: [focusFix("Forward Line", "Focus on Leading", "Forward line: "), focusFix("Forward Line", "Focus on Contested Marking", "Forward line: ")],
        severity: (0.4 - goals / shots) * 2,
      });
    }

    out.sort((a, b) => b.severity - a.severity);
    const problems = out.slice(0, 2);

    // The healthiest line, flagged so the coach doesn't fix what isn't broken.
    const best = [...myWinRates].filter((r) => r.blended > LINE_FEEDBACK_HIGH_THRESHOLD).sort((a, b) => b.blended - a.blended)[0];
    if (best) {
      const stat = bestSubStat(best.subRates);
      const top = stat ? topQuarterPerformer(myTeam, q, events, CONTEST_STAT_FIELDS[stat].wins) : null;
      const line = stat ? best.subRates[stat]! : null;
      problems.push({
        id: `keep:${best.role}`,
        title: `${ROLE_NAME[best.role]} is doing its job`,
        chip: stat ? `${Math.round(best.subRates[stat]!.rate * 100)}% ${CONTEST_NOUN[stat].chip} WIN` : `${Math.round(best.blended * 100)}% WIN RATE`,
        tone: "good",
        body:
          (line && stat ? `We won ${line.wins} of ${line.attempts} ${CONTEST_NOUN[stat].plural} this quarter.` : `On top at the contest this quarter.`) +
          (top ? ` ${playerFullName(top.player)} led the way with ${top.value}.` : ""),
        fixes: [],
        severity: -1,
        keep: true,
      });
    } else if (out.length > 2) {
      problems.push(out[2]);
    }
    return problems;
  }, [events, q, myTeam, theirTeam, myWinRates, theirWinRates, side, result]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Staged list (derived from the one state) --------------------------------------------------
  const staged: { kind: string; text: string; undo: () => void }[] = [];
  for (const w of state.swaps) {
    const out = playerById.get(w.outgoingId);
    const inn = playerById.get(w.incomingId);
    staged.push({
      kind: "SWAP",
      text: `${inn?.lname ?? "?"} on for ${out?.lname ?? "?"} (${myTeam.positions?.get(w.outgoingId) ?? ""})`,
      undo: () => setState((s) => ({ ...s, swaps: s.swaps.filter((x) => x !== w) })),
    });
  }
  for (const role of MATCH_DAY_COACH_ROLES) {
    if (state.lines[role] !== initialLines[role]) {
      staged.push({ kind: ROLE_KIND[role], text: focusLabel(state.lines[role]), undo: () => setState((s) => ({ ...s, lines: { ...s.lines, [role]: initialLines[role] } })) });
    }
  }
  if (state.call !== currentStyle) {
    const opt = COACHS_CALL_OPTIONS.find((o) => o.style === state.call);
    staged.push({ kind: "TEAM", text: opt?.label ?? state.call, undo: () => setState((s) => ({ ...s, call: currentStyle })) });
  }
  const n = staged.length;
  const nextQ = q + 1;

  function resume() {
    for (const w of state.swaps) onInterchange(w.outgoingId, w.incomingId);
    for (const role of MATCH_DAY_COACH_ROLES) if (state.lines[role] !== initialLines[role]) onFocusChange(role, state.lines[role]);
    onChoose(state.call);
  }

  function reset() {
    setState(initial);
    setArmedBenchId(null);
  }

  // --- Styles ---------------------------------------------------------------------------------------
  const toneColor = (t: Tone) => (t === "bad" ? FALL : t === "warn" ? WARN : RISE);
  const chipBtn = (on: boolean, rec: boolean): CSSProperties => ({
    borderRadius: 999,
    padding: "6px 11px",
    cursor: "pointer",
    font: `600 12px ${BARLOW}`,
    whiteSpace: "nowrap",
    border: `1px solid ${on ? "var(--acc)" : rec ? "rgba(79,214,154,.55)" : "rgba(255,255,255,.14)"}`,
    background: on ? "var(--acc)" : "transparent",
    color: on ? "var(--on)" : rec ? RISE : "#c3ccdd",
  });
  const card: CSSProperties = { background: CARD_BG, border: CARD_BORDER, borderRadius: 14 };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-stretch gap-3">
        <StatStrip title={`Q${q} IN NUMBERS`} homeName={myTeam.name} awayName={theirTeam.name} items={quarterNumbers} />
        <BreakBar
          label={`${breakLabel(q)} · Q${nextQ} STARTS WHEN YOU RESUME`}
          summary={n ? staged.map((x) => x.text).join(" · ") : "No changes staged"}
          resumeLabel={`Resume Q${nextQ}${n ? ` · ${plural(n, "change")}` : ""}`}
          onReset={reset}
          onResume={resume}
        />
      </div>

      {/* Decision row (critique C5): hurting · coach's call · staged, in decision order. */}
      <div className="flex flex-wrap items-start gap-3">
        <section data-screen-label="What's hurting us" style={{ flex: "1.3 1 380px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ ...sectionLabelStyle(), padding: "0 2px" }}>WHAT'S HURTING US · RANKED</div>
          {cards.length === 0 && <div style={{ ...card, padding: "12px 14px", font: `500 13px ${BARLOW}`, color: "#aab3c3" }}>Nothing standing out this quarter. Every line is close to even at the contest.</div>}
          {cards.map((h) => {
            const col = toneColor(h.tone);
            return (
              <div key={h.id} style={{ ...card, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: col, flex: "none" }} />
                    <span style={{ font: `700 17px/1.2 ${COND}`, color: "#fff" }}>{capitalise(h.title)}</span>
                  </div>
                  <span style={{ flex: "none", font: `600 10px ${MONO}`, letterSpacing: ".8px", color: col, padding: "3px 7px", borderRadius: 4, border: `1px solid ${col}`, whiteSpace: "nowrap" }}>{h.chip}</span>
                </div>
                <div style={{ font: `500 13px/1.45 ${BARLOW}`, color: "#c3ccdd" }}>{h.body}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {h.fixes.map((f) => {
                    const on = f.isApplied(state);
                    return (
                      <button key={f.label} onClick={() => setState((s) => f.toggle(s))} style={chipBtn(on, !on && h.fixes.length === 1)}>
                        {on ? f.appliedLabel : f.label}
                      </button>
                    );
                  })}
                  {h.keep && <span style={{ font: `600 10px ${MONO}`, letterSpacing: "1px", color: RISE, padding: "6px 0" }}>NO CHANGE NEEDED</span>}
                </div>
              </div>
            );
          })}
        </section>

        <section data-screen-label="Coach's call" style={{ ...card, flex: "1 1 320px", minWidth: 0, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={sectionLabelStyle()}>COACH'S CALL · WHOLE TEAM</div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 52px 52px 52px", gap: 8, padding: "4px 10px", font: `600 9px ${MONO}`, letterSpacing: ".7px", color: "#8f9ab0" }}>
            <span />
            <span style={{ textAlign: "right" }}>OUR SC.</span>
            <span style={{ textAlign: "right" }}>THEIR SC.</span>
            <span style={{ textAlign: "right" }}>FITNESS</span>
          </div>
          {COACHS_CALL_OPTIONS.map((opt) => {
            const on = state.call === opt.style;
            const impact = gameStyleModelledImpact(opt.style);
            const cell = (v: number, goodWhenPositive: boolean) => {
              const r = Math.round(v);
              const col = r === 0 ? "#8f9ab0" : (goodWhenPositive ? r > 0 : r < 0) ? RISE : FALL;
              return (
                <span style={{ textAlign: "right", font: `600 12px ${MONO}`, color: col }}>
                  {r > 0 ? "+" : ""}
                  {r}%
                </span>
              );
            };
            return (
              <button
                key={opt.style}
                role="radio"
                aria-checked={on}
                title={opt.blurb}
                onClick={() => setState((s) => ({ ...s, call: opt.style }))}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1fr) 52px 52px 52px",
                  gap: 8,
                  alignItems: "center",
                  padding: 10,
                  borderRadius: 9,
                  cursor: "pointer",
                  textAlign: "left",
                  border: `1px solid ${on ? "var(--acc)" : "rgba(255,255,255,.06)"}`,
                  background: on ? "color-mix(in oklch, var(--acc) 12%, transparent)" : "rgba(0,0,0,.15)",
                  minHeight: 44,
                }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      flex: "none",
                      border: `2px solid ${on ? "var(--acc)" : "#5d6880"}`,
                      background: on ? "radial-gradient(circle, var(--acc) 0 3px, transparent 3.5px)" : "transparent",
                    }}
                  />
                  <span style={{ font: `600 14px ${BARLOW}`, color: "#eef2f8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {opt.label}
                    {opt.style === currentStyle && <span style={{ color: "#8f9ab0", fontWeight: 500 }}> · now</span>}
                  </span>
                </span>
                {cell(impact.ourScoring, true)}
                {cell(impact.theirScoring, false)}
                {cell(impact.fitnessCost, false)}
              </button>
            );
          })}
        </section>

        <section data-screen-label="Staged changes" style={{ flex: ".8 1 260px", minWidth: 0, background: PANEL_BG, border: "1px solid color-mix(in oklch, var(--acc) 25%, rgba(255,255,255,.07))", borderRadius: 14, overflow: "hidden" }}>
          <Stripe />
          <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={sectionLabelStyle(true)}>
              STAGED FOR Q{nextQ} · {n} CHANGE{n === 1 ? "" : "S"}
            </div>
            {n === 0 && <div style={{ font: `500 13px/1.45 ${BARLOW}`, color: "#aab3c3" }}>Nothing staged. Resuming keeps the current plan.</div>}
            {staged.map((x) => (
              <div key={x.kind + x.text} style={{ display: "grid", gridTemplateColumns: "62px minmax(0,1fr) 20px", gap: 8, alignItems: "center", padding: "8px 0", borderTop: "1px solid rgba(255,255,255,.06)" }}>
                <span style={{ font: `600 9px ${MONO}`, letterSpacing: ".8px", color: "#8f9ab0" }}>{x.kind}</span>
                <span style={{ font: `600 13px/1.35 ${BARLOW}`, color: "#eef2f8" }}>{x.text}</span>
                <button onClick={x.undo} title="Remove" style={{ background: "none", border: 0, color: "#8f9ab0", font: `500 16px ${BARLOW}`, cursor: "pointer", padding: 0 }}>
                  ×
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Line instructions (critique C6, C10): natural-height cards; recommended chips marked ★. */}
      <div style={{ ...sectionLabelStyle(), padding: "4px 2px 0" }}>LINE INSTRUCTIONS</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 12, alignItems: "start" }}>
        {MATCH_DAY_COACH_ROLES.map((role) => {
          const winRate = myWinRates.find((r) => r.role === role);
          const subRates = Object.fromEntries(Object.entries(winRate?.subRates ?? {}).map(([k, v]) => [k, (v as SubStatQuarterLine).rate])) as Partial<Record<ContestType, number>>;
          const recommended = recommendedFocusFor(role, subRates) ?? "Default";
          const coachId = lineCoaches[role];
          const coach = coachId !== undefined ? ASSISTANT_COACH_POOL.find((c) => c.id === coachId) : undefined;
          return (
            <section key={role} style={{ ...card, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span style={{ font: `700 16px ${COND}`, color: "#fff" }}>{ROLE_NAME[role]}</span>
                <span style={{ font: `500 11px ${BARLOW}`, color: "#8f9ab0" }}>
                  {coach ? (
                    <>
                      {coach.name} · <span style={{ color: "var(--accT)", fontWeight: 700 }}>{gradeForOvr(coach.ratings[role].ovr)}</span>
                    </>
                  ) : (
                    "No line coach"
                  )}
                </span>
              </div>
              <div style={{ font: `italic 500 13px/1.4 ${BARLOW}`, color: "#c3ccdd" }}>"{capitalise(feedbackFor(role))}"</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {focusesFor(role).map((focus) => {
                  const on = state.lines[role] === focus;
                  const rec = focus === recommended;
                  const label = rec ? (focus === "Default" ? "Default ★" : `★ ${focusLabel(focus)}`) : focusLabel(focus);
                  return (
                    <button key={focus} onClick={() => setState((s) => ({ ...s, lines: { ...s.lines, [role]: focus } }))} style={chipBtn(on, rec)}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>

      <InterchangePanel
        team={myTeam}
        fitness={myFitness}
        swaps={state.swaps}
        armedBenchId={armedBenchId}
        onArm={(id) => setArmedBenchId((cur) => (cur === id ? null : id))}
        onStage={(outgoingId, incomingId) => {
          setState((s) => ({ ...s, swaps: [...s.swaps.filter((w) => w.outgoingId !== outgoingId && w.incomingId !== incomingId), { outgoingId, incomingId }] }));
          setArmedBenchId(null);
        }}
        onUnstage={(outgoingId) => setState((s) => ({ ...s, swaps: s.swaps.filter((w) => w.outgoingId !== outgoingId) }))}
        onView={setDrawerPlayer}
      />

      {drawerPlayer && (
        <PlayerMatchDrawer
          player={drawerPlayer}
          side={side}
          line={result.boxScore[drawerPlayer.PlayerID]}
          events={events.filter((ev) => ev.quarter <= q)}
          position={myTeam.positions?.get(drawerPlayer.PlayerID)}
          onGround={myTeam.onGround?.has(drawerPlayer.PlayerID)}
          fitness={myFitness(drawerPlayer.PlayerID)}
          roster={myTeam.players.map((player) => ({ player, side }))}
          onSelect={(player) => setDrawerPlayer(player)}
          onClose={() => setDrawerPlayer(null)}
        />
      )}
    </div>
  );
}

// --- Interchange (critiques C7-C9) -----------------------------------------------------------------

/** 6 lines × 3 lanes, back → forward (the oval's attacking direction), filled column by column. */
const TILE_COLUMNS: { label: string; positions: Position[] }[] = [
  { label: "BACK", positions: ["BP", "FB", "BP"] },
  { label: "HALF BACK", positions: ["HBF", "CHB", "HBF"] },
  { label: "CENTRE", positions: ["W", "C", "W"] },
  { label: "RUCK", positions: ["R", "RR", "ROV"] },
  { label: "HALF FWD", positions: ["HFF", "CHF", "HFF"] },
  { label: "FORWARD →", positions: ["FP", "FF", "FP"] },
];

function InterchangePanel({
  team,
  fitness,
  swaps,
  armedBenchId,
  onArm,
  onStage,
  onUnstage,
  onView,
}: {
  team: MatchTeam;
  fitness: (id: number) => number;
  swaps: StagedSwap[];
  armedBenchId: number | null;
  onArm: (id: number) => void;
  onStage: (outgoingId: number, incomingId: number) => void;
  onUnstage: (outgoingId: number) => void;
  onView: (p: Player) => void;
}) {
  if (!team.onGround || !team.positions || !team.interchangeEligibility) {
    return <div style={{ background: CARD_BG, border: CARD_BORDER, borderRadius: 14, padding: "12px 14px", font: `500 13px ${BARLOW}`, color: "#8f9ab0" }}>No position data for {team.name}, so there's nothing to interchange within.</div>;
  }
  const byPosition = groupByPosition(team);
  const bench = benchPlayers(team);
  const playerById = new Map(team.players.map((p) => [p.PlayerID, p]));
  const armed = armedBenchId !== null ? playerById.get(armedBenchId) : undefined;
  const armedEligible = armed ? team.interchangeEligibility.get(armed.PlayerID) : undefined;

  const seen = new Map<Position, number>();
  const tiles = TILE_COLUMNS.flatMap((col) =>
    col.positions.map((pos) => {
      const list = byPosition.get(pos) ?? [];
      const i = seen.get(pos) ?? 0;
      seen.set(pos, i + 1);
      return { pos, player: list[i] as Player | undefined };
    }),
  );

  const hint = armed ? `Now tap the player ${armed.lname} replaces` : "Tap a bench player, then the player to replace. Tap a swapped tile to undo.";

  return (
    <section data-screen-label="Interchange" style={{ background: CARD_BG, border: CARD_BORDER, borderRadius: 14, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={sectionLabelStyle()}>INTERCHANGE · FITNESS</span>
        <span style={{ font: `500 12px ${BARLOW}`, color: armed ? "var(--accT)" : "#8f9ab0" }}>{hint}</span>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "stretch" }}>
        {/* The only sideways scroll on Match Day (spec §4): the pitch keeps 560px on narrow screens. */}
        <div style={{ flex: "4 1 560px", minWidth: 0, overflowX: "auto" }}>
          <div style={{ minWidth: 560, borderRadius: 12, padding: 10, background: "color-mix(in oklch, #2b6a35 22%, #10151f)", border: "1px solid rgba(255,255,255,.06)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(0,1fr))", gap: 6, marginBottom: 6, font: `600 9px ${MONO}`, letterSpacing: ".8px", color: "#8f9ab0", textAlign: "center" }}>
              {TILE_COLUMNS.map((c) => (
                <span key={c.label}>{c.label}</span>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6,minmax(0,1fr))", gridTemplateRows: "repeat(3,auto)", gridAutoFlow: "column", gap: 6 }}>
              {tiles.map(({ pos, player }, i) => {
                if (!player) {
                  return (
                    <div key={i} style={{ minHeight: 64, borderRadius: 9, border: "1px dashed rgba(255,255,255,.08)", padding: "8px 9px", font: `600 9px ${MONO}`, color: "#5d6880" }}>
                      {pos}
                    </div>
                  );
                }
                const swap = swaps.find((w) => w.outgoingId === player.PlayerID);
                const inP = swap ? playerById.get(swap.incomingId) : undefined;
                const show = inP ?? player;
                const fit = fitness(show.PlayerID);
                const eligible = !!armed && !!armedEligible?.has(pos);
                const dim = !!armed && !eligible;
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={dim}
                    title={armed ? (eligible ? `Bring ${armed.lname} on for ${player.lname}` : `${armed.lname} can't play ${pos}`) : swap ? "Tap to undo this swap" : `View ${playerFullName(player)}'s match stats`}
                    onClick={() => {
                      if (armed && eligible) onStage(player.PlayerID, armed.PlayerID);
                      else if (!armed && swap) onUnstage(player.PlayerID);
                      else if (!armed) onView(player);
                    }}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-start",
                      gap: 4,
                      padding: "8px 9px",
                      borderRadius: 9,
                      cursor: dim ? "not-allowed" : "pointer",
                      minHeight: 64,
                      textAlign: "left",
                      minWidth: 0,
                      opacity: dim ? 0.4 : 1,
                      border: `1px solid ${armed && eligible ? "color-mix(in oklch, var(--acc) 45%, transparent)" : fit < 45 && !inP ? "rgba(255,163,122,.55)" : "rgba(255,255,255,.08)"}`,
                      background: inP ? "color-mix(in oklch, var(--acc) 14%, rgba(0,0,0,.25))" : "rgba(0,0,0,.25)",
                    }}
                  >
                    <span style={{ font: `600 9px ${MONO}`, letterSpacing: ".7px", color: "#8f9ab0" }}>{pos}</span>
                    <span style={{ font: `600 13px ${BARLOW}`, color: inP ? "var(--accT)" : "#eef2f8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
                      #{show.jumperNumber} {show.lname}
                      {inP ? " ⇄" : ""}
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
                      <span style={{ flex: 1, height: 4, borderRadius: 2, background: "rgba(255,255,255,.08)", overflow: "hidden" }}>
                        <span style={{ display: "block", height: "100%", width: `${Math.max(0, Math.min(100, fit))}%`, background: fitColor(fit) }} />
                      </span>
                      <span style={{ font: `600 11px ${MONO}`, color: fitColor(fit) }}>{Math.round(fit)}%</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <div style={{ flex: "1 1 200px", display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ font: `600 9px ${MONO}`, letterSpacing: ".8px", color: "#8f9ab0" }}>BENCH · TAP TO ARM</div>
          {bench.map((b) => {
            const used = swaps.find((w) => w.incomingId === b.PlayerID);
            const on = armedBenchId === b.PlayerID;
            const fit = fitness(b.PlayerID);
            return (
              <button
                key={b.PlayerID}
                type="button"
                onClick={() => onArm(b.PlayerID)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: 10,
                  borderRadius: 9,
                  cursor: "pointer",
                  minHeight: 44,
                  border: `1px solid ${on ? "var(--acc)" : "rgba(255,255,255,.08)"}`,
                  background: on ? "color-mix(in oklch, var(--acc) 18%, transparent)" : used ? "color-mix(in oklch, var(--acc) 8%, rgba(0,0,0,.2))" : "rgba(0,0,0,.2)",
                }}
              >
                <span style={{ font: `600 11px ${MONO}`, color: "var(--accT)", width: 26, textAlign: "left" }}>#{b.jumperNumber}</span>
                <span style={{ flex: 1, minWidth: 0, font: `600 13px ${BARLOW}`, color: "#eef2f8", textAlign: "left", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {b.lname}
                  {used ? ` → ${team.positions?.get(used.outgoingId) ?? ""}` : ""}
                </span>
                <span style={{ font: `600 11px ${MONO}`, color: fitColor(fit) }}>{Math.round(fit)}%</span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
