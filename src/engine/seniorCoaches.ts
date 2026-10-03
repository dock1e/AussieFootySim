import type { SeasonArchiveEntry } from "./seasonSummary.ts";
import type { ClubFinanceState } from "../types/clubFinance.ts";
import type { Coach } from "../types/coach.ts";
import { COACH_ROLES } from "../types/coach.ts";
import { CLUBS, clubByName } from "../types/club.ts";
import { ASSISTANT_COACH_POOL } from "../data/assistantCoachPool.ts";
import { realFreeAgentCoachesFor, realSeniorCoachesFor, type RealSeniorCoach } from "../data/realSeniorCoaches2026.ts";
import { coachHistoryByName } from "../data/realCoachHistory.ts";
import { mulberry32 } from "./rng.ts";
import { STARTING_BOARD_CONFIDENCE, boardVerdictFor, historyOf, ladderRankOf, seasonPerformanceFor } from "./clubFinance.ts";
import { decideReview, type BoardReviewOutcome } from "./boardReview.ts";

/**
 * ROADMAP #14 follow-up — every AI club has a senior coach, and every AI board judges theirs by the
 * same rulebook the coach's own board uses (`engine/boardReview.ts`'s `decideReview`: warning below 30,
 * sacked if still below 30 a season later or under 15 at any review, renewal only at 50+).
 *
 * - **Seeded from reality**: a new game starts every club with its real 2026 senior coach
 *   (`data/realSeniorCoaches2026.ts`). The coach's own club's real coach is "replaced" by the coach on
 *   day one and joins the free-agent market.
 * - **AI board confidence** moves on the same `boardVerdictFor` the coach's board uses: that club's real-
 *   scale operating result vs its financial target, and on-field result vs a brief. An AI board's brief
 *   is read from the club's PREVIOUS finish (`aiBoardBrief`), since the full onboarding club context
 *   lives in UI-side narrative code — a disclosed simplification.
 * - **The carousel**: a sacked or not-renewed coach becomes a free agent and sits out at least one
 *   season before another club can hire him. Vacancies are filled from free agents and the real
 *   assistant/ex-coach talent pool (`ASSISTANT_COACH_POOL`), best-rated first with a seeded choice among
 *   the top three. If the coach has just lost their own job, vacancies stay open so the job market can
 *   offer them; they're filled once the coach chooses.
 * - **Cosmetic on the field**: an AI senior coach doesn't change how that club plays (AI clubs' match
 *   tactics aren't modelled per coach). This system is about who's in charge, the board's patience,
 *   and a living job market — disclosed, not implied otherwise.
 */

export interface SeniorCoach {
  /** `real:<name>` for a real 2026 senior coach, `pool:<id>` for someone from the assistant/ex-coach pool. */
  id: string;
  name: string;
  poolCoachId?: number;
  /** First season at this club. */
  sinceYear: number;
  /** Last season the contract covers. */
  contractEndYear: number;
  confidence: number;
  warnedYear?: number;
  /** One-line pedigree for the UI. */
  note?: string;
  /** Record at this club in this save (home and away). */
  wins: number;
  losses: number;
  draws: number;
  premierships: number;
}

export interface FreeAgentCoach {
  coach: SeniorCoach;
  /** Earliest season another club can hire him. */
  availableFrom: number;
  lastClub: string;
}

export interface CoachingChange {
  /** The off-season it happened in (the season just closed). */
  year: number;
  club: string;
  outgoing?: string;
  reason?: "sacked" | "notRenewed" | "replaced";
  incoming?: string;
}

export interface SeniorCoachesState {
  /** Keyed by club name. `null` = vacant. The coach's own club has no entry. */
  clubs: Record<string, SeniorCoach | null>;
  freeAgents: FreeAgentCoach[];
  /** Every coaching change in this save, oldest first. */
  changes: CoachingChange[];
}

function seedContractEnd(clubId: number, year: number): number {
  // year+1..year+3: a real league rarely has more than a couple of senior contracts up in any one off-season.
  // Spread evenly by club id (mulberry32's first draw is too correlated across neighbouring seeds).
  return year + 1 + (clubId % 3);
}

function realNote(historyName: string): string | undefined {
  const h = coachHistoryByName(historyName);
  if (!h) return undefined;
  const pct = h.total.pct.toFixed(0);
  return h.premierships > 0 ? `${h.premierships}x premiership coach, ${pct}% career` : `${h.total.t} games as senior coach, ${pct}% career`;
}

function blankRecord() {
  return { wins: 0, losses: 0, draws: 0, premierships: 0 };
}

function realCoach(real: RealSeniorCoach, clubId: number, year: number): SeniorCoach {
  return {
    id: `real:${real.name}`,
    name: real.name,
    sinceYear: real.sinceYear,
    contractEndYear: real.contractEndYear ?? seedContractEnd(clubId, year),
    confidence: STARTING_BOARD_CONFIDENCE,
    note: real.note ?? (real.historyName ? realNote(real.historyName) : undefined),
    ...blankRecord(),
  };
}

/**
 * A brand-new game's coaching landscape for the season it starts in (`realSeniorCoachesFor(year)`):
 * a real vacancy stays vacant until the first off-season, and the real out-of-work coaches start on the
 * free-agent market (sitting out the start season, like any coach sacked the year before).
 */
export function seedSeniorCoaches(myClub: string, year: number): SeniorCoachesState {
  const table = realSeniorCoachesFor(year);
  const clubs: Record<string, SeniorCoach | null> = {};
  const freeAgents: FreeAgentCoach[] = realFreeAgentCoachesFor(year).map((fa) => ({
    coach: realCoach({ name: fa.name, historyName: fa.historyName, sinceYear: year }, 0, year),
    availableFrom: year + 1,
    lastClub: fa.lastClub,
  }));
  for (const club of CLUBS) {
    const real = table[club.name] ?? null;
    if (club.name === myClub) {
      if (real) freeAgents.push({ coach: realCoach(real, club.ClubID, year), availableFrom: year + 1, lastClub: club.name });
      continue;
    }
    clubs[club.name] = real ? realCoach(real, club.ClubID, year) : null;
  }
  return { clubs, freeAgents, changes: [] };
}

/** An older save (or a fresh store) gets a seeded landscape; the coach's own club never keeps an AI coach. */
export function ensureSeniorCoaches(state: SeniorCoachesState | undefined, myClub: string, year: number): SeniorCoachesState {
  const s = state ?? seedSeniorCoaches(myClub, year);
  if (!(myClub in s.clubs)) return s;
  const { [myClub]: displaced, ...rest } = s.clubs;
  return { ...s, clubs: rest, freeAgents: displaced ? [...s.freeAgents, { coach: displaced, availableFrom: year + 1, lastClub: myClub }] : s.freeAgents };
}

/** An AI board's brief and patience, from where the club finished the season before. */
export function aiBoardBrief(prevRank: number | null): { expectation: string; patience: number } {
  if (prevRank === null) return { expectation: "Finals", patience: 3 };
  if (prevRank <= 2) return { expectation: "Grand Final", patience: 2 };
  if (prevRank <= 4) return { expectation: "Top 4", patience: 2 };
  if (prevRank <= 8) return { expectation: "Finals", patience: 3 };
  if (prevRank <= 13) return { expectation: "Top 8 push", patience: 3 };
  return { expectation: "Development", patience: 4 };
}

/**
 * Every AI board's review at the off-season closing `closingYear`. `clubFinance` must already carry the
 * closed season's history rows (run after `advanceClubFinances`); `archives` must include the closed
 * season. Sacked / not-renewed coaches go to the free-agent market and their clubs fall vacant.
 */
export function reviewAiCoaches(
  state: SeniorCoachesState,
  clubFinance: Readonly<Record<string, ClubFinanceState>>,
  archives: readonly SeasonArchiveEntry[],
  closingYear: number,
): { state: SeniorCoachesState; outcomes: Record<string, BoardReviewOutcome> } {
  const last = archives[archives.length - 1];
  const finished = last?.year === closingYear ? last : undefined;
  const previous = finished ? archives[archives.length - 2] : last;
  const clubs = { ...state.clubs };
  const freeAgents = [...state.freeAgents];
  const changes = [...state.changes];
  const outcomes: Record<string, BoardReviewOutcome> = {};

  for (const [clubName, coach] of Object.entries(state.clubs)) {
    if (!coach) continue;
    const history = historyOf(clubFinance[clubName] ?? { facilityLevels: {}, budget: 0 });
    const row = history[history.length - 1];
    if (!row || row.year !== closingYear) continue;
    const club = clubByName(clubName);
    const perf = seasonPerformanceFor(finished, clubName);
    const prevRank = previous && club ? ladderRankOf(previous, club.ClubID) : null;
    const verdict = boardVerdictFor(clubName, history.slice(0, -1), row, perf, prevRank, aiBoardBrief(prevRank), coach.confidence);
    const decision = decideReview({ confidence: verdict.confidence, warnedYear: coach.warnedYear, contractEndYear: coach.contractEndYear }, closingYear);
    outcomes[clubName] = decision.outcome;

    const ladderRow = finished && club ? finished.ladder.find((r) => r.clubId === club.ClubID) : undefined;
    const updated: SeniorCoach = {
      ...coach,
      confidence: verdict.confidence,
      wins: coach.wins + (ladderRow?.wins ?? 0),
      losses: coach.losses + (ladderRow?.losses ?? 0),
      draws: coach.draws + (ladderRow?.draws ?? 0),
      premierships: coach.premierships + (perf?.premiers ? 1 : 0),
    };

    if (decision.outcome === "sacked" || decision.outcome === "notRenewed") {
      clubs[clubName] = null;
      freeAgents.push({ coach: { ...updated, warnedYear: undefined }, availableFrom: closingYear + 2, lastClub: clubName });
      changes.push({ year: closingYear, club: clubName, outgoing: coach.name, reason: decision.outcome });
    } else if (decision.outcome === "renewed") {
      clubs[clubName] = { ...updated, warnedYear: undefined, contractEndYear: closingYear + decision.renewedYears! };
    } else if (decision.outcome === "warning") {
      clubs[clubName] = { ...updated, warnedYear: closingYear };
    } else {
      clubs[clubName] = { ...updated, warnedYear: undefined };
    }
  }
  return { state: { clubs, freeAgents, changes }, outcomes };
}

/** How strong a senior-coaching candidate looks: real senior record for ex-senior coaches, graded ratings for the talent pool. */
function poolScore(c: Coach): number {
  const top3 = COACH_ROLES.map((r) => c.ratings[r].ovr).sort((a, b) => b - a).slice(0, 3);
  const avg = top3.reduce((s, x) => s + x, 0) / top3.length;
  return avg * 0.75 + (c.source === "historical" ? 8 : c.source === "real-candidate" ? 6 : 0);
}

function freeAgentScore(fa: FreeAgentCoach): number {
  const games = fa.coach.wins + fa.coach.losses + fa.coach.draws;
  const savePct = games > 0 ? (fa.coach.wins + fa.coach.draws / 2) / games : 0.5;
  const real = fa.coach.id.startsWith("real:") ? coachHistoryByName(nameToHistory(fa.coach.name)) : undefined;
  const pct = real ? (real.total.pct / 100 + savePct) / 2 : savePct;
  return 45 + pct * 35 + 3 * (fa.coach.premierships + (real?.premierships ?? 0));
}

function nameToHistory(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts.slice(1).join(" ")}, ${parts[0]}` : name;
}

/**
 * Fills every vacant club (except `skip`) for the season after `closingYear`. `unavailablePoolIds` are
 * talent-pool coaches who can't be appointed (the coach's own hired assistants). Pure and seeded.
 */
export function fillVacancies(state: SeniorCoachesState, closingYear: number, unavailablePoolIds: ReadonlySet<number>, skip?: string): SeniorCoachesState {
  const clubs = { ...state.clubs };
  let freeAgents = [...state.freeAgents];
  const changes = [...state.changes];
  const season = closingYear + 1;
  const employedNames = () => new Set(Object.values(clubs).flatMap((c) => (c ? [c.name] : [])));
  const usedPoolIds = () => new Set(Object.values(clubs).flatMap((c) => (c?.poolCoachId !== undefined ? [c.poolCoachId] : [])));

  const vacant = CLUBS.filter((c) => c.name !== skip && c.name in clubs && clubs[c.name] === null);
  for (const club of vacant) {
    const employed = employedNames();
    const used = usedPoolIds();
    const faNames = new Set(freeAgents.map((f) => f.coach.name));
    const candidates: { score: number; take: () => SeniorCoach }[] = [];
    for (const fa of freeAgents) {
      if (fa.availableFrom > season || fa.lastClub === club.name || employed.has(fa.coach.name)) continue;
      candidates.push({
        score: freeAgentScore(fa),
        take: () => {
          freeAgents = freeAgents.filter((f) => f !== fa);
          return { ...fa.coach, sinceYear: season, confidence: STARTING_BOARD_CONFIDENCE, warnedYear: undefined, ...blankRecord(), contractEndYear: 0 };
        },
      });
    }
    for (const c of ASSISTANT_COACH_POOL) {
      if (unavailablePoolIds.has(c.id) || used.has(c.id) || employed.has(c.name) || faNames.has(c.name)) continue;
      candidates.push({
        score: poolScore(c),
        take: () => ({
          id: `pool:${c.id}`,
          name: c.name,
          poolCoachId: c.id,
          sinceYear: season,
          contractEndYear: 0,
          confidence: STARTING_BOARD_CONFIDENCE,
          note: c.currentAffiliation ?? (c.source === "fictional" ? "First senior job" : undefined),
          ...blankRecord(),
        }),
      });
    }
    if (candidates.length === 0) continue;
    candidates.sort((a, b) => b.score - a.score);
    const rng = mulberry32(closingYear * 1000 + club.ClubID * 31 + 7);
    const pick = candidates[Math.floor(rng() * Math.min(3, candidates.length))];
    const contractYears = 2 + Math.floor(rng() * 3); // a new coach gets 2-4 seasons
    const appointed = { ...pick.take(), contractEndYear: closingYear + contractYears };
    clubs[club.name] = appointed;
    const pending = changes.findIndex((ch) => ch.year === closingYear && ch.club === club.name && !ch.incoming);
    if (pending >= 0) changes[pending] = { ...changes[pending], incoming: appointed.name };
    else changes.push({ year: closingYear, club: club.name, incoming: appointed.name });
  }
  return { clubs, freeAgents, changes };
}

/**
 * The coach takes the job at `newClub` (leaving `oldClub` after being sacked or not renewed): any AI
 * coach at `newClub` is moved on to make way, `oldClub` falls vacant, and every vacancy is filled.
 */
export function coachJoinsClub(state: SeniorCoachesState, oldClub: string, newClub: string, closingYear: number, unavailablePoolIds: ReadonlySet<number>): SeniorCoachesState {
  const { [newClub]: displaced, ...rest } = state.clubs;
  const clubs: Record<string, SeniorCoach | null> = { ...rest, [oldClub]: null };
  const freeAgents = displaced ? [...state.freeAgents, { coach: displaced, availableFrom: closingYear + 1, lastClub: newClub }] : state.freeAgents;
  const changes = [...state.changes];
  if (displaced) changes.push({ year: closingYear, club: newClub, outgoing: displaced.name, reason: "replaced" });
  const vacancy = changes.findIndex((ch) => ch.year === closingYear && ch.club === newClub && !ch.incoming);
  if (vacancy >= 0) changes.splice(vacancy, 1, { ...changes[vacancy], incoming: "you" });
  else changes.push({ year: closingYear, club: newClub, incoming: "you" });
  return fillVacancies({ clubs, freeAgents, changes }, closingYear, unavailablePoolIds);
}

export function changesInYear(state: SeniorCoachesState | undefined, year: number): CoachingChange[] {
  return (state?.changes ?? []).filter((c) => c.year === year);
}
