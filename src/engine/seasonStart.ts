import type { Player } from "../types/player.ts";
import { CLUBS, clubByName } from "../types/club.ts";
import { buildRealDraftees, draftPlayer } from "./draft.ts";
import {
  CLUB_MOVES_2026,
  CONTRACT_EXTENSIONS_2026,
  DEPARTURES_2026,
  DRAFTEES_2026,
  NAME_ALIASES,
  NOT_IN_DATABASE,
  OFF_SEASON_2026_PROGRESS,
  PICK_TRADES_2026,
  type ClubMove,
  type ContractExtension,
  type Departure,
  type Draftee,
} from "../data/realOffSeason2026.ts";

/** The real off-season as one value — injectable so tests can exercise moves and draftees before the real ones exist. */
export interface OffSeasonLog {
  departures: readonly Departure[];
  clubMoves: readonly ClubMove[];
  draftees: readonly Draftee[];
  extensions: readonly ContractExtension[];
}

export const REAL_OFF_SEASON_2026: OffSeasonLog = { departures: DEPARTURES_2026, clubMoves: CLUB_MOVES_2026, draftees: DRAFTEES_2026, extensions: CONTRACT_EXTENSIONS_2026 };
import { REAL_FUTURE_PICKS_2027, REAL_FUTURE_PICKS_2028 } from "./draftPicks.ts";
import { realSeniorCoachesFor } from "../data/realSeniorCoaches2026.ts";
import { generatedPlayers, setGeneratedBaseline } from "../data/loadPlayers.ts";
import { CURRENT_SEASON_YEAR } from "../config.ts";

/**
 * 2027 season start (Tyler, Oct 2 2026: "set up the game so that it starts from the 2027 season ... the
 * coaches, assistant coaches, player lists etc which represent the 2027 AFL season").
 *
 * The player database (`players_master.csv`) is the real END-OF-2026 database: real 2026 stats and
 * awards already drive every rating (End-of-2026 Player Database Refresh, rounds C142-C160). A 2026
 * start uses it as-is. A 2027 start runs it through the real 2026 off-season
 * (`data/realOffSeason2026.ts`) at boot, in this order:
 *
 * 1. **Departures** — every real retirement/delisting before the 2027 season leaves its club (`delisted`,
 *    the same flag the in-game delisting uses, so the record stays for history): this log's rows, plus
 *    any earlier real Retired/Delisted status already recorded on the player (`realStatus`, round C143).
 * 2. **Club moves** — trades and free-agency signings change club; a reported contract length replaces
 *    the old contract (last season covered = 2026 + years), otherwise the deal travels with him.
 * 3. **Draftees** — real 2026 National/Rookie/Pre-season/Category B draftees are built from the real
 *    prospect database (`buildRealDraftees`) and drafted to their real club and pick.
 * 4. **Contract extensions** reported in the log.
 * 5. **Lapsed contracts** — anyone still on a list whose contract ended in 2026 or earlier must have
 *    re-signed in reality (he's on a 2027 list), but the database doesn't know for how long. Disclosed
 *    default: through 2028 if he's in the top half of his club's list by OVR, otherwise through 2027.
 *    Counted in the report; a real `ContractExtension` row overrides it.
 * 6. **Age** — every existing player is a year older. Ratings are NOT progressed: they already reflect
 *    the real 2026 season.
 *
 * Pure and deterministic. `prepareStartingWorld` (called once at app boot from `main.tsx`) applies it to
 * the live pool when the game starts in 2027; a 2026 start is a no-op.
 */

export interface StartWorldReport {
  startYear: number;
  departures: number;
  /** Departures whose name didn't match any player. */
  unmatchedDepartures: string[];
  /** Departures applied from an earlier recorded real status rather than this log. */
  earlierRealDepartures: number;
  clubMoves: number;
  unmatchedClubMoves: string[];
  draftees: number;
  /** Draftees with no real prospect record behind their ratings. */
  genericDraftees: string[];
  extensions: number;
  unmatchedExtensions: string[];
  /** Players given the default contract (step 5). */
  defaultExtensions: number;
  /** Active list size per club after everything. */
  listSizes: Record<string, number>;
}

const START_2027 = 2027;
const SEASON_BEFORE = START_2027 - 1;

function resolveName(name: string): string {
  return NAME_ALIASES[name] ?? name;
}

function draftTypeLabel(d: Draftee["draft"]): string {
  switch (d) {
    case "National":
      return "National Draft";
    case "Rookie":
      return "Rookie Draft";
    case "Pre-season":
      return "Pre-Season Draft";
    default:
      return "Category B Rookie";
  }
}

export function buildStartingPlayers(base: readonly Player[], startYear: number, log: OffSeasonLog = REAL_OFF_SEASON_2026): { players: Player[]; report: StartWorldReport } {
  const report: StartWorldReport = {
    startYear,
    departures: 0,
    unmatchedDepartures: [],
    earlierRealDepartures: 0,
    clubMoves: 0,
    unmatchedClubMoves: [],
    draftees: 0,
    genericDraftees: [],
    extensions: 0,
    unmatchedExtensions: [],
    defaultExtensions: 0,
    listSizes: {},
  };
  if (startYear < START_2027) {
    for (const c of CLUBS) report.listSizes[c.name] = base.filter((p) => p.Team === c.name && !p.delisted).length;
    return { players: [...base], report };
  }

  const players = base.map((p) => ({ ...p }));
  const byName = new Map<string, Player>();
  for (const p of players) if (p.realFullName && !p.delisted) byName.set(p.realFullName, p);

  // 1. Departures.
  for (const d of log.departures) {
    const p = byName.get(resolveName(d.realFullName));
    if (!p) {
      if (!NOT_IN_DATABASE.has(d.realFullName)) report.unmatchedDepartures.push(`${d.realFullName} (${d.club})`);
      continue;
    }
    p.delisted = true;
    p.realStatus = d.type;
    p.realStatusYear = String(SEASON_BEFORE);
    p.realStatusReason = d.type === "Retired" ? "retired" : "delisted";
    p.realStatusSource = d.source;
    report.departures++;
  }
  for (const p of players) {
    if (p.delisted) continue;
    if ((p.realStatus === "Retired" || p.realStatus === "Delisted") && Number(p.realStatusYear || SEASON_BEFORE) <= SEASON_BEFORE) {
      p.delisted = true;
      report.earlierRealDepartures++;
    }
  }

  // 2. Club moves.
  for (const m of log.clubMoves) {
    const p = byName.get(resolveName(m.realFullName));
    const to = clubByName(m.toClub);
    if (!p || !to) {
      report.unmatchedClubMoves.push(`${m.realFullName} (${m.fromClub} -> ${m.toClub})`);
      continue;
    }
    p.Team = to.name;
    p.ClubID = to.ClubID;
    p.delisted = false;
    if (m.years) p.expired_year = SEASON_BEFORE + m.years;
    report.clubMoves++;
  }

  // 3. Draftees.
  if (log.draftees.length > 0) {
    const built = buildRealDraftees(
      log.draftees.map((d) => resolveName(d.realFullName)),
      players,
      START_2027,
      START_2027 * 7919 + log.draftees.length,
    );
    report.genericDraftees = built.generic;
    built.players.forEach((prospect, i) => {
      const d = log.draftees[i];
      const drafted = draftPlayer(prospect, d.club, d.pick, SEASON_BEFORE);
      players.push({ ...drafted, draft_draftType: draftTypeLabel(d.draft), expired_year: SEASON_BEFORE + 2 });
      report.draftees++;
    });
  }

  // 4. Contract extensions.
  for (const e of log.extensions) {
    const p = byName.get(resolveName(e.realFullName));
    if (!p) {
      report.unmatchedExtensions.push(`${e.realFullName} (${e.club})`);
      continue;
    }
    p.expired_year = e.throughYear;
    report.extensions++;
  }

  // 5. Lapsed contracts (default, disclosed) and 6. age.
  const draftedIds = new Set(players.slice(base.length).map((p) => p.PlayerID));
  const medianOvr = new Map<string, number>();
  for (const c of CLUBS) {
    const ovrs = players.filter((p) => p.Team === c.name && !p.delisted).map((p) => p.OVR).sort((a, b) => a - b);
    medianOvr.set(c.name, ovrs[Math.floor(ovrs.length / 2)] ?? 0);
  }
  for (const p of players) {
    if (draftedIds.has(p.PlayerID)) continue;
    p.Age = p.Age + 1;
    if (!p.delisted && p.expired_year < START_2027) {
      p.expired_year = p.OVR >= (medianOvr.get(p.Team) ?? 0) ? START_2027 + 1 : START_2027;
      report.defaultExtensions++;
    }
  }

  for (const c of CLUBS) report.listSizes[c.name] = players.filter((p) => p.Team === c.name && !p.delisted).length;
  return { players, report };
}

let prepared: StartWorldReport | null = null;

/**
 * Applies the start-season world to the New Game baseline, once. A no-op for a 2026 start. Returns the
 * build report (also logged to the console in a 2027 start so a preview shows what was applied).
 */
export function prepareStartingWorld(startYear: number = CURRENT_SEASON_YEAR): StartWorldReport | null {
  if (prepared || startYear < START_2027) return prepared;
  const { players, report } = buildStartingPlayers(generatedPlayers(), startYear);
  setGeneratedBaseline(players);
  prepared = report;
  console.info(`[season start] ${startYear} start: ${report.departures + report.earlierRealDepartures} departures, ${report.clubMoves} club moves, ${report.draftees} draftees, ${report.defaultExtensions} default contracts.`, report);
  return report;
}

// --- Readiness -----------------------------------------------------------------------------------

export interface ReadinessItem {
  label: string;
  ready: boolean;
  detail: string;
  /** Required before `RELEASE_START_SEASON` can move to this season. */
  required: boolean;
}

/** Real AFL list sizes: 38-44 primary + up to 6 rookies. Outside this range after the off-season means something's missing. */
const MIN_LIST = 38;
const MAX_LIST = 47;

/**
 * Everything a 2027 start needs and whether it's in yet — the gate for flipping `RELEASE_START_SEASON`.
 * Run `npm run readiness:2027` for a printed version.
 */
export function seasonStartReadiness(base: readonly Player[], startYear: number = START_2027): ReadinessItem[] {
  if (startYear < START_2027) return [{ label: "2026 start", ready: true, detail: "Uses the end-of-2026 database as-is.", required: true }];
  const { report } = buildStartingPlayers(base, startYear);
  const prog = OFF_SEASON_2026_PROGRESS;
  const coaches = realSeniorCoachesFor(startYear);
  const vacant = Object.entries(coaches).filter(([, c]) => c === null).map(([club]) => club);
  const badLists = Object.entries(report.listSizes).filter(([, n]) => n < MIN_LIST || n > MAX_LIST);
  const knownPickIds = new Set([...REAL_FUTURE_PICKS_2027, ...REAL_FUTURE_PICKS_2028].map((p) => p.id));
  const badPickTrades = PICK_TRADES_2026.filter((t) => !knownPickIds.has(t.pickId)).map((t) => t.pickId);
  return [
    {
      label: "Retirements & delistings",
      ready: prog.delistingsComplete && report.unmatchedDepartures.length === 0,
      detail: `${report.departures} applied from the log, ${report.earlierRealDepartures} from earlier real status.${report.unmatchedDepartures.length ? ` Unmatched: ${report.unmatchedDepartures.join(", ")}.` : ""}${prog.delistingsComplete ? "" : " Delistings still arriving (final lists lodged around the drafts)."}`,
      required: true,
    },
    {
      label: "Free agency",
      ready: prog.freeAgencyComplete,
      detail: `${CLUB_MOVES_2026.filter((m) => m.type !== "Traded").length} signings entered. Runs 2-9 Oct 2026.`,
      required: true,
    },
    {
      label: "Trade period",
      ready: prog.tradePeriodComplete && report.unmatchedClubMoves.length === 0 && badPickTrades.length === 0,
      detail: `${CLUB_MOVES_2026.filter((m) => m.type === "Traded").length} player trades and ${PICK_TRADES_2026.length} pick trades entered. Runs 5-14 Oct 2026.${report.unmatchedClubMoves.length ? ` Unmatched players: ${report.unmatchedClubMoves.join(", ")}.` : ""}${badPickTrades.length ? ` Unknown pick ids: ${badPickTrades.join(", ")}.` : ""}`,
      required: true,
    },
    {
      label: "National Draft",
      ready: prog.nationalDraftComplete,
      detail: `${DRAFTEES_2026.filter((d) => d.draft === "National").length} National draftees entered. 19-20 Nov 2026.${report.genericDraftees.length ? ` No prospect record (generic ratings): ${report.genericDraftees.join(", ")}.` : ""}`,
      required: true,
    },
    {
      label: "Rookie & pre-season drafts",
      ready: prog.rookieDraftComplete,
      detail: `${DRAFTEES_2026.filter((d) => d.draft !== "National").length} entered. 23 Nov 2026.`,
      required: true,
    },
    {
      label: "List sizes",
      ready: badLists.length === 0,
      detail: badLists.length ? `Outside ${MIN_LIST}-${MAX_LIST}: ${badLists.map(([c, n]) => `${c} ${n}`).join(", ")}.` : `Every club within ${MIN_LIST}-${MAX_LIST}.`,
      required: true,
    },
    {
      label: "Senior coaches",
      ready: prog.seniorCoachesConfirmed,
      detail: vacant.length ? `Vacant (start vacant per Tyler's steer until appointed): ${vacant.join(", ")}.` : "All 18 appointed.",
      required: true,
    },
    {
      label: "Assistant coaches",
      ready: prog.assistantCoachesConfirmed,
      detail: "2027 assistant appointments are announced through Oct-Dec; the talent pool still reflects 2026 roles.",
      required: true,
    },
    {
      label: "Contracts",
      ready: true,
      detail: `${report.extensions} real extensions entered; ${report.defaultExtensions} players on the disclosed default (step 5).`,
      required: false,
    },
    {
      label: "2026 annual reports",
      ready: prog.financialYear2026Reports,
      detail: "Published Dec 2026 - Mar 2027. Until then club finances calibrate to the 2025 reports.",
      required: false,
    },
  ];
}
