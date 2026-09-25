import type { Player } from "../../../types/player";
import { POSITIONS, suitabilityFor, type Archetype, type Position, type Suitability } from "../../../types/archetype";
import { CLUBS, clubById } from "../../../types/club";
import type { MatchTeam } from "../../../engine/team";
import type { Season } from "../../../engine/season";
import { roundsForClub } from "../../../engine/fixture";
import { groundForMatch } from "../../../data/clubGrounds";
import { getPlayersByClub } from "../../../data/loadPlayers";
import { tacticGroupForSlot, type GameStyle, type Tactic, type TeamPlan } from "../../../engine/tactics";
import { COACHS_CALL_OPTIONS } from "../../CoachsCall";
import { FALL, RISE, WARN } from "../shared";

/**
 * Match Day flow (round 128, `Match Day Flow.dc.html`) — the pure data side of the six pre-match steps.
 * Everything here reads real engine/store values; nothing is invented for display.
 */

// ---------------------------------------------------------------------------------------------------
// Slots. `POSITIONS` indices, laid out forward-at-the-top like the reference's line-up grid.

/** FP FF FP / HFF CHF HFF / ROV R RR / W C W / HBF CHB HBF / BP FB BP. */
export const FORWARD_UP_SLOTS: number[] = [16, 15, 17, 12, 14, 13, 11, 9, 10, 6, 7, 8, 3, 5, 4, 1, 0, 2];
export const INT_SLOTS: number[] = POSITIONS.reduce<number[]>((acc, p, i) => (p === "INT" ? [...acc, i] : acc), []);
export const ROLE_LINES: { name: string; slots: number[] }[] = [
  { name: "FORWARDS", slots: [16, 15, 17, 12, 14, 13] },
  { name: "MIDFIELD & RUCK", slots: [11, 9, 10, 6, 7, 8] },
  { name: "BACKS", slots: [3, 5, 4, 1, 0, 2] },
];

export const POSITION_FULL: Record<Position, string> = {
  FP: "Forward pocket",
  FF: "Full forward",
  HFF: "Half-forward flank",
  CHF: "Centre half-forward",
  R: "Ruck",
  ROV: "Rover",
  RR: "Ruck-rover",
  W: "Wing",
  C: "Centre",
  HBF: "Half-back flank",
  CHB: "Centre half-back",
  BP: "Back pocket",
  FB: "Full back",
  INT: "Interchange",
};

// ---------------------------------------------------------------------------------------------------
// Positional fit. The engine rates fit in four tiers (`suitabilityFor`), not a percentage, so the flow
// shows the tier word. The bar width is only a visual for the tier.

export interface FitTier {
  suitability: Suitability;
  word: string;
  color: string;
  bar: number;
  rank: number;
}

const TIERS: Record<Suitability, Omit<FitTier, "suitability">> = {
  "Very suitable": { word: "Ideal", color: RISE, bar: 100, rank: 3 },
  "Somewhat suitable": { word: "Good", color: WARN, bar: 66, rank: 2 },
  "Barely suitable": { word: "Poor", color: FALL, bar: 34, rank: 1 },
  "Not suitable": { word: "No fit", color: FALL, bar: 10, rank: 0 },
};

export function fitTier(p: Player, pos: Position): FitTier {
  const s = suitabilityFor(p.archetype as Archetype, pos);
  return { suitability: s, ...TIERS[s] };
}

/** Out of position = the same "Barely/Not suitable" test `engine/disgruntlement.ts` uses. */
export function isOutOfPosition(p: Player, pos: Position): boolean {
  return fitTier(p, pos).rank <= 1;
}

// ---------------------------------------------------------------------------------------------------
// Roles. Short descriptions of each engine tactic, written from what `engine/tactics.ts` and
// `engine/movement.ts` actually do with it.

export const TACTIC_BLURB: Record<Tactic, string> = {
  "Run Two Ways": "Works hard both ends of the ground. No bias.",
  Attacking: "Goes forward when the ball leaves the contest. Better with the ball, weaker tackling.",
  Defensive: "Stays goal-side of the play. Tackles harder, gets less of the ball.",
  Tagging: "Shadows one opponent. Set the target each week on the Opposition step.",
  "Leading Target": "Leads hard at the ball carrier. Stronger on marks on the lead.",
  "Contested Marking": "Wrestles for front position and marks in traffic.",
  "Bring Ball to Ground": "Brings the ball down for the smalls rather than marking it himself.",
  "General Forward": "Plays a standard forward role. No bias.",
  "Free Role": "Roams the forward half, not tied to his opponent.",
  Crumbing: "Stays at ground level and hunts the spill from marking contests.",
  "Lead-Up Target": "Leads up to the wing and presents on the move.",
  "High Press": "Tackles and locks the ball in the forward half.",
  "Follow the Ball": "Rucks, then follows up around the ground.",
  "Aerial Target": "Drops forward as a marking option. Stronger overhead, fewer clean hitouts.",
  "Hold Position": "Stays at the stoppage. Cleaner hitouts, covers less ground.",
  "Defensive Shoulder": "Holds the space goal-side of his man. Strong in the air, beaten on the lead.",
  "Play in Front": "Plays in front to beat leads and read the kick.",
  "Third Man Up": "Leaves his man to crash stoppages and marking contests.",
  "Run off Man": "Runs and carries out of defence, leaving his opponent free.",
  "General Defender": "Plays on his man first. No bias.",
};

/** Game style labels and blurbs — the same list the break screen's Coach's Call uses. */
export function styleLabel(style: GameStyle): string {
  return COACHS_CALL_OPTIONS.find((o) => o.style === style)?.label ?? style;
}
export function styleBlurb(style: GameStyle): string {
  return COACHS_CALL_OPTIONS.find((o) => o.style === style)?.blurb ?? "";
}

// ---------------------------------------------------------------------------------------------------
// Fixture.

export type FixtureChoice = { kind: "season"; round: number } | { kind: "friendly"; opponent: string };

export interface FixtureRow {
  round: number;
  opponentId: number;
  opponent: string;
  isHome: boolean;
  homeClubId: number;
  awayClubId: number;
  venue: string;
  /** e.g. "W 92–71", from your side. Null while unplayed. */
  result: { outcome: "W" | "L" | "D"; score: string } | null;
}

export function seasonFixtureRows(season: Season, myClubId: number): FixtureRow[] {
  return roundsForClub(season.fixture, myClubId).map((m) => {
    const isHome = m.homeClubId === myClubId;
    const opponentId = isHome ? m.awayClubId : m.homeClubId;
    const played = season.played.find((p) => p.round === m.round && p.homeClubId === m.homeClubId && p.awayClubId === m.awayClubId);
    let result: FixtureRow["result"] = null;
    if (played) {
      const us = isHome ? played.result.home.points : played.result.away.points;
      const them = isHome ? played.result.away.points : played.result.home.points;
      result = { outcome: us > them ? "W" : us < them ? "L" : "D", score: `${us}–${them}` };
    }
    return {
      round: m.round,
      opponentId,
      opponent: clubById(opponentId)?.name ?? "?",
      isHome,
      homeClubId: m.homeClubId,
      awayClubId: m.awayClubId,
      venue: groundForMatch(m.homeClubId, m.round, season.fixture).commonName,
      result,
    };
  });
}

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** "2nd · 4–0 · 131.4%" (draws shown only when there are any). */
export function ladderLine(season: Season, clubId: number): string {
  const i = season.ladder.findIndex((r) => r.clubId === clubId);
  if (i < 0) return "—";
  const r = season.ladder[i];
  if (r.played === 0) return `${ordinal(i + 1)} · no games yet`;
  const record = r.draws ? `${r.wins}–${r.losses}–${r.draws}` : `${r.wins}–${r.losses}`;
  return `${ordinal(i + 1)} · ${record} · ${r.percentage.toFixed(1)}%`;
}

/** The last time these two clubs met this season, from your side. */
export function lastMetLine(season: Season, myClubId: number, oppId: number): string {
  const met = season.played
    .filter((p) => (p.homeClubId === myClubId && p.awayClubId === oppId) || (p.homeClubId === oppId && p.awayClubId === myClubId))
    .sort((a, b) => b.round - a.round)[0];
  if (!met) return "Not yet this season";
  const us = met.homeClubId === myClubId ? met.result.home.points : met.result.away.points;
  const them = met.homeClubId === myClubId ? met.result.away.points : met.result.home.points;
  const m = Math.abs(us - them);
  const how = us === them ? "drew" : `${us > them ? "won" : "lost"} by ${m} ${m === 1 ? "point" : "points"}`;
  return `Rd ${met.round} · ${how}`;
}

// ---------------------------------------------------------------------------------------------------
// Opposition.

/** One per-game rate from a player's real 2025 totals. */
function perGame(total: number, games: number): number {
  return games > 0 ? total / games : 0;
}

/** "Averages 29.4 disposals and 6.1 clearances (2025)." — his two stand-out real 2025 per-game numbers. */
export function dangerNote(p: Player): string {
  const g = p.stat_GM;
  if (!g) return "No 2025 games on record.";
  const cands: { v: number; text: string; weight: number }[] = [
    { v: perGame(p.stat_DI, g), text: "disposals", weight: 1 / 22 },
    { v: perGame(p.stat_CL, g), text: "clearances", weight: 1 / 5 },
    { v: perGame(p.stat_GL, g), text: "goals", weight: 1 / 1.6 },
    { v: perGame(p.stat_HO, g), text: "hitouts", weight: 1 / 25 },
    { v: perGame(p.stat_MK, g), text: "marks", weight: 1 / 6 },
    { v: perGame(p.stat_TK, g), text: "tackles", weight: 1 / 4.5 },
    { v: perGame(p.stat_CM, g), text: "contested marks", weight: 1 / 1.5 },
  ];
  const top = cands
    .filter((c) => c.v > 0)
    .sort((a, b) => b.v * b.weight - a.v * a.weight)
    .slice(0, 2);
  if (top.length === 0) return "No 2025 stats on record.";
  return `Averages ${top.map((c) => `${c.v.toFixed(1)} ${c.text}`).join(" and ")} (2025).`;
}

const MIRROR: Partial<Record<Position, Position>> = {
  FB: "FF",
  FF: "FB",
  BP: "FP",
  FP: "BP",
  CHB: "CHF",
  CHF: "CHB",
  HBF: "HFF",
  HFF: "HBF",
  C: "C",
  W: "W",
  R: "R",
  RR: "RR",
  ROV: "ROV",
};
const MIDFIELD_POSITIONS: Position[] = ["C", "ROV", "RR", "W"];

export interface DangerMan {
  player: Player;
  pos: Position | undefined;
  avgFp: number;
  note: string;
  /** Your player in the mirrored position (the default match-up), if any. */
  matchup: { player: Player; pos: Position } | null;
  /** Their most dangerous midfielder — the one the flow suggests tagging. */
  adviseTag: boolean;
}

export function dangerMen(opp: MatchTeam, ours: MatchTeam, avgFpOf: (p: Player) => number, count = 4): DangerMan[] {
  const onGround = opp.players.filter((p) => opp.positions?.get(p.PlayerID) !== "INT");
  const ranked = onGround.map((p) => ({ p, avg: avgFpOf(p) })).sort((a, b) => b.avg - a.avg).slice(0, count);
  const used = new Set<number>();
  let advised = false;
  return ranked.map(({ p, avg }) => {
    const pos = opp.positions?.get(p.PlayerID);
    const want = pos ? MIRROR[pos] : undefined;
    const mine = want ? ours.players.find((q) => ours.positions?.get(q.PlayerID) === want && !used.has(q.PlayerID)) : undefined;
    if (mine) used.add(mine.PlayerID);
    const adviseTag = !advised && !!pos && MIDFIELD_POSITIONS.includes(pos);
    if (adviseTag) advised = true;
    return { player: p, pos, avgFp: avg, note: dangerNote(p), matchup: mine && want ? { player: mine, pos: want } : null, adviseTag };
  });
}

/**
 * Who can run a tag: only a player whose role menu includes Tagging — a midfield slot, or a bench
 * player whose archetype plays in the midfield group (that's the check `sanitizePlan` applies before a
 * match). Best man-markers first.
 */
export function taggerCandidates(ours: MatchTeam, count = 6): Player[] {
  return ours.players
    .filter((p) => tacticGroupForSlot(ours.positions?.get(p.PlayerID), p.archetype as Archetype) === "Midfield")
    .sort((a, b) => b.manMarking - a.manMarking)
    .slice(0, count);
}

/** A club's real 2025 team rates, ranked against every club (1 = most). */
export interface ScoutRow {
  label: string;
  value: string;
  note: string;
}

type TeamRates = { cp: number; cl: number; tk: number; mk: number; gl: number; ki: number; hb: number };

let ratesCache: Map<string, TeamRates> | null = null;
function allTeamRates(): Map<string, TeamRates> {
  if (ratesCache) return ratesCache;
  ratesCache = new Map();
  for (const c of CLUBS) {
    const ps = getPlayersByClub(c.name).filter((p) => p.stat_GM > 0 && p.stat_DI > 0);
    const games = ps.reduce((a, p) => a + p.stat_GM, 0);
    const rate = (f: (p: Player) => number) => (games > 0 ? (22 * ps.reduce((a, p) => a + f(p), 0)) / games : 0);
    ratesCache.set(c.name, {
      cp: rate((p) => p.stat_CP),
      cl: rate((p) => p.stat_CL),
      tk: rate((p) => p.stat_TK),
      mk: rate((p) => p.stat_MK),
      gl: rate((p) => p.stat_GL),
      ki: rate((p) => p.stat_KI),
      hb: rate((p) => p.stat_HB),
    });
  }
  return ratesCache;
}

export function scoutingRows(club: string): ScoutRow[] {
  const all = allTeamRates();
  const mine = all.get(club);
  if (!mine) return [];
  const rankOf = (key: keyof TeamRates) => 1 + [...all.values()].filter((r) => r[key] > mine[key]).length;
  const metrics: { key: keyof TeamRates; label: string; unit: string }[] = [
    { key: "cp", label: "Contested possessions", unit: "a game" },
    { key: "cl", label: "Clearances", unit: "a game" },
    { key: "tk", label: "Tackles", unit: "a game" },
    { key: "mk", label: "Marks", unit: "a game" },
    { key: "gl", label: "Goals", unit: "a game" },
  ];
  const ranked = metrics.map((m) => ({ ...m, rank: rankOf(m.key) })).sort((a, b) => a.rank - b.rank).slice(0, 2);
  const rows: ScoutRow[] = ranked.map((m) => ({
    label: m.label,
    value: ordinal(m.rank),
    note: `${mine[m.key].toFixed(1)} ${m.unit} from this list's 2025 numbers.`,
  }));
  const ratio = mine.hb > 0 ? mine.ki / mine.hb : 0;
  rows.push({
    label: "Kick : handball",
    value: `${ratio.toFixed(2)} : 1`,
    note: ratio < 1.25 ? "Handball-heavy. Pressure the receiver." : ratio > 1.5 ? "Kick-first. They go long by foot." : "An even mix of foot and hand.",
  });
  return rows;
}

// ---------------------------------------------------------------------------------------------------
// This week's plan.

/** Standing plan + this week's style + tags → the plan the match actually kicks off with. */
export function weeklyPlan(standing: TeamPlan, weekStyle: GameStyle | null, tags: Map<number, number>): TeamPlan {
  const tactics = new Map(standing.tactics);
  for (const [targetId, taggerId] of tags) tactics.set(taggerId, { tactic: "Tagging", taggingTargetId: targetId });
  return { gameStyle: weekStyle ?? standing.gameStyle, tactics };
}
