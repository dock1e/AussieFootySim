import { mulberry32 } from "./rng.ts";
import { seedMorale } from "./morale.ts";
import type { ClubStrategy } from "./listNeeds.ts";
import type { Player } from "../types/player.ts";
import { playerFullName } from "../types/player.ts";
import { CLUBS, clubByName } from "../types/club.ts";

/**
 * Contracts, salary cap & free agency — Phase 4 Slice 3 (ROADMAP.md).
 * Engine.md "Contracts, salary cap & free agency" is the source spec; this
 * file implements its confirmed reference-site figures and formulas close
 * to verbatim, with a handful of disclosed simplifications noted inline
 * below (and summarised in ROADMAP.md's gap list) wherever the vault leaves
 * an exact number or mechanic unstated. Deliberately scoped to Contracts
 * only — Trade Period, National Draft, Combine, and Position Switch are
 * separate, not-yet-built Off-Season Hub steps (see User Interface.md).
 *
 * Framework-free and deterministic (mulberry32, never Math.random) — the
 * same rule every other engine/*.ts file follows (Engine.md "Simulation
 * core: zero DOM/browser dependencies"). Every mutation-shaped function here
 * (`reSign`/`delist`/`signFreeAgent`/`simulateLeagueContracts`) returns a
 * *new* player/array rather than mutating its input; splicing the result
 * back into the live pool is the caller's job (see useContractStore.ts),
 * matching engine/progression.ts's own pure-transform convention.
 */

// ---------------------------------------------------------------------------
// Free agency status
// ---------------------------------------------------------------------------

export type FreeAgencyStatus = "Signed" | "OOC" | "RFA" | "UFA";

/**
 * Real AFL ties RFA/UFA eligibility to an official service-time ruling this
 * project has no equivalent data for (club-nomination history, delisted-
 * and-redrafted status, etc.) — Engine.md states each status's *effect*
 * ("RFA: current club can match any rival bid", "UFA: cannot be matched")
 * but not the exact eligibility formula. Disclosed simplification: total
 * experience is approximated as `currentYear - draft_year`, loosely
 * following the real headline threshold (8 years' experience unlocks
 * unrestricted status); under that but still out of contract reads as RFA
 * down to 4 years, and plain OOC below that — a young/fringe-list player
 * simply out of contract with no special free-agency rights, matching
 * Engine.md's own three-way vocabulary ("OOC — no special status").
 */
const UFA_EXPERIENCE_YEARS = 8;
const RFA_EXPERIENCE_YEARS = 4;

export function experienceYears(player: Pick<Player, "draft_year">, currentYear: number): number {
  return Math.max(0, currentYear - player.draft_year);
}

export function freeAgencyStatus(player: Pick<Player, "expired_year" | "draft_year">, currentYear: number): FreeAgencyStatus {
  if (player.expired_year >= currentYear) return "Signed";
  const exp = experienceYears(player, currentYear);
  if (exp >= UFA_EXPERIENCE_YEARS) return "UFA";
  if (exp >= RFA_EXPERIENCE_YEARS) return "RFA";
  return "OOC";
}

/** Engine.md's confirmed reference-site re-sign probabilities — used for both the cap forecast and the rival-club AI simulation below. */
export const RE_SIGN_PROBABILITY: Record<Exclude<FreeAgencyStatus, "Signed">, number> = {
  RFA: 0.7,
  OOC: 0.55,
  UFA: 0.25,
};

// ---------------------------------------------------------------------------
// Salary cap
// ---------------------------------------------------------------------------

/**
 * Engine.md's confirmed reference-site cap figures, adopted directly since
 * Configuration.md leaves the actual dollar figure "optional... totalValue
 * is tracked per player regardless of whether a cap is enforced".
 * `SALARY_FLOOR_PCT` isn't given an exact figure anywhere in the vault
 * beyond "a Floor pass/fail flag exists" — 92.5% is a reasonable, disclosed
 * value in line with real-world soft-floor conventions, not a confirmed
 * reference-site number.
 */
export const SALARY_CAP = 18_500_000;
export const SALARY_FLOOR_PCT = 0.925;
/** Engine.md's confirmed reference-site football department spending ceiling. */
export const FOOTBALL_DEPT_CEILING = 1_600_000;

/** "...+ rookie pad of 4 picks x $120k per draft year" — Engine.md's cap-forecast formula, verbatim. */
const ROOKIE_PAD_PICKS = 4;
const ROOKIE_PAD_PER_PICK = 120_000;
const ROOKIE_PAD = ROOKIE_PAD_PICKS * ROOKIE_PAD_PER_PICK;

/** Sum of `totalValue` across every currently-signed (non-OOC, non-delisted) player at `clubName` as of `year` — a club's actual cap hit at that point in time. */
export function committedWages(players: readonly Player[], clubName: string, year: number): number {
  return players
    .filter((p) => p.Team === clubName && !p.delisted && p.expired_year >= year)
    .reduce((sum, p) => sum + p.totalValue, 0);
}

/** Sum of `totalValue x re-sign probability` across `clubName`'s players who read as OOC/RFA/UFA when evaluated at `asOfYear` — the forecast formula's "re-sign estimate" term. */
export function reSignEstimate(players: readonly Player[], clubName: string, asOfYear: number): number {
  return players
    .filter((p) => p.Team === clubName && !p.delisted && p.expired_year < asOfYear)
    .reduce((sum, p) => {
      const status = freeAgencyStatus(p, asOfYear);
      return status === "Signed" ? sum : sum + p.totalValue * RE_SIGN_PROBABILITY[status];
    }, 0);
}

export interface CapForecast {
  committedNow: number;
  /** Forecast committed wages one year out: next year's still-live contracts + a re-sign estimate off *today's* free agents + one year's rookie pad. */
  yr1: number;
  /**
   * Forecast two years out. `reSignEstimate` at `currentYear + 1` already
   * naturally accumulates both today's still-unresolved free agents (their
   * `expired_year` is still `< currentYear + 1`) *and* the cohort newly
   * expiring during year+1 — so this doesn't double-count against `yr1`,
   * it's a clean recursive extension of the same formula one step further
   * out. Engine.md states the formula's shape but not its exact multi-year
   * recursion, so this is a disclosed, principled reading rather than a
   * literal spec quote — see ROADMAP.md's Phase 4 Slice 3 gaps.
   */
  yr2: number;
  floorMet: boolean;
  headroom: number;
}

export function capForecast(players: readonly Player[], clubName: string, currentYear: number): CapForecast {
  const committedNow = committedWages(players, clubName, currentYear);
  const yr1 = committedWages(players, clubName, currentYear + 1) + reSignEstimate(players, clubName, currentYear) + ROOKIE_PAD;
  const yr2 = committedWages(players, clubName, currentYear + 2) + reSignEstimate(players, clubName, currentYear + 1) + ROOKIE_PAD * 2;
  return {
    committedNow,
    yr1,
    yr2,
    floorMet: committedNow >= SALARY_CAP * SALARY_FLOOR_PCT,
    headroom: SALARY_CAP - committedNow,
  };
}

export interface ClubCapRow {
  clubName: string;
  listSize: number;
  wages: number;
  capPct: number;
  floorMet: boolean;
  headroom: number;
  yr1: number;
  yr2: number;
}

/** One row per club (List size / Wages / Cap% / Floor flag / Headroom / YR+1 / YR+2) — User Interface.md's "Salary Cap Breakdown" table, built in one call. */
export function allClubCapRows(players: readonly Player[], currentYear: number): ClubCapRow[] {
  return CLUBS.map((club) => {
    const listSize = players.filter((p) => p.Team === club.name && !p.delisted).length;
    const forecast = capForecast(players, club.name, currentYear);
    return {
      clubName: club.name,
      listSize,
      wages: forecast.committedNow,
      capPct: forecast.committedNow / SALARY_CAP,
      floorMet: forecast.floorMet,
      headroom: forecast.headroom,
      yr1: forecast.yr1,
      yr2: forecast.yr2,
    };
  });
}

// ---------------------------------------------------------------------------
// Compensation picks
// ---------------------------------------------------------------------------

export type CompensationBand = "End of 1st" | "Early 2nd" | "Mid 2nd" | "Late 2nd";

/**
 * Real AFL awards a club a banded compensation pick when it loses a player
 * to UFA (never RFA — an RFA departure can always be matched, so no
 * compensation applies). Engine.md names "Compensation picks" as a real
 * mechanic without spelling out exact bands; these four tiers are a
 * reasonable, disclosed approximation against Configuration.md's own
 * confirmed `totalValue` percentile table (median ~$477k, p75 ~$709k, p90
 * ~$1,032k, p99 ~$1,794k). Below the bottom band, real AFL doesn't award
 * compensation at all for a minor free agent — modelled here as `null`.
 *
 * Modelled only as a banded value + League Activity notification, NOT a
 * literal draft-pick object a club can spend — there's no pick-inventory
 * system yet since the National Draft itself isn't built (see ROADMAP.md's
 * Phase 4 Slice 3 gaps).
 */
export function compensationPickBand(lostPlayerTotalValue: number): CompensationBand | null {
  if (lostPlayerTotalValue >= 1_800_000) return "End of 1st";
  if (lostPlayerTotalValue >= 1_050_000) return "Early 2nd";
  if (lostPlayerTotalValue >= 750_000) return "Mid 2nd";
  if (lostPlayerTotalValue >= 480_000) return "Late 2nd";
  return null;
}

// ---------------------------------------------------------------------------
// Free-agency interest score
// ---------------------------------------------------------------------------

export interface InterestFactor {
  label: string;
  value: number;
}

export interface InterestResult {
  score: number;
  factors: InterestFactor[];
}

/**
 * "Free-agency interest score" — Engine.md's confirmed additive factor
 * list: Recent finals success (+12), Low morale at current club (+8),
 * Premiership window open (+7), Long-tenured one-club player (-7). Grounded
 * against real, already-modelled signals wherever one exists; where it
 * doesn't (no season-by-season club history is persisted anywhere yet — see
 * ROADMAP.md gap #35's own note), a disclosed proxy is used instead, noted
 * per factor below.
 */
export function interestScore(
  player: Player,
  biddingClubName: string,
  currentYear: number,
  strategies: ReadonlyMap<string, ClubStrategy>,
  currentSeasonTop8: ReadonlySet<string> | null,
): InterestResult {
  const factors: InterestFactor[] = [];

  // No persisted season-history log exists (only whichever season is
  // currently in progress, if any — see engine/season.ts) — approximated
  // via the *current* season's ladder position when one exists; omitted
  // entirely (no factor, not a guessed zero) when there's no season to check.
  if (currentSeasonTop8?.has(biddingClubName)) {
    factors.push({ label: "Recent finals success", value: 12 });
  }

  // The player's own seeded/live morale (engine/morale.ts). "Low" reads as
  // the bottom third of morale's own 60-75 seed range, since nothing in
  // this codebase yet models morale dipping below 60 — a relative, not
  // absolute, reading, disclosed here rather than silently assuming a <50
  // threshold that could never fire.
  const mor = player.morale ?? seedMorale(player);
  if (mor < 66) {
    factors.push({ label: "Low morale at current club", value: 8 });
  }

  // Premiership window — proxied via the bidding club's own
  // engine/listNeeds.ts `computeLeagueStrategies` label.
  if (strategies.get(biddingClubName) === "Contend") {
    factors.push({ label: "Premiership window open", value: 7 });
  }

  // Long-tenured one-club player — no club-history log exists to check
  // "never transferred", so proxied via OriginClub === Team (drafted by and
  // still at the same club) combined with 8+ years' experience.
  if (player.OriginClub === player.Team && experienceYears(player, currentYear) >= UFA_EXPERIENCE_YEARS) {
    factors.push({ label: "Long-tenured one-club player", value: -7 });
  }

  return { score: factors.reduce((s, f) => s + f.value, 0), factors };
}

// ---------------------------------------------------------------------------
// Listing helpers
// ---------------------------------------------------------------------------

/** `clubName`'s own out-of-contract players (any of OOC/RFA/UFA) — User Interface.md's "Your Out-of-Contract Players" list. */
export function freeAgentsFor(players: readonly Player[], clubName: string, currentYear: number): Player[] {
  return players.filter((p) => p.Team === clubName && !p.delisted && freeAgencyStatus(p, currentYear) !== "Signed");
}

/** Every OTHER club's out-of-contract players — User Interface.md's "Free Agency Market" list. */
export function allFreeAgents(players: readonly Player[], excludeClubName: string, currentYear: number): Player[] {
  return players.filter((p) => p.Team !== excludeClubName && !p.delisted && freeAgencyStatus(p, currentYear) !== "Signed");
}

// ---------------------------------------------------------------------------
// Negotiation
// ---------------------------------------------------------------------------

export interface ReSignTerms {
  years: number;
  salaryPerYear: number;
}

/** A free agent's "stated ask" for negotiation purposes — their current `totalValue`, per Configuration.md's own framing that market value is "the number contract offers should negotiate around". */
export function statedAsk(player: Pick<Player, "totalValue">): number {
  return player.totalValue;
}

export type OfferOutcome = { result: "accepted" } | { result: "countered"; counterSalaryPerYear: number } | { result: "rejected" };

/**
 * Deterministic offer evaluation — no RNG here, since a negotiation the
 * coach is actually making calls in should feel legible and skill-based
 * rather than a hidden dice roll (the AI-vs-AI rival simulation below is
 * where genuine chance belongs, since Tyler isn't the one making those
 * calls). Within 5% of the ask (at or above) accepts outright; more than
 * 30% under gets a flat rejection (not worth countering); anything between
 * gets a counter splitting the gap. The 3-offer cap (User Interface.md) is
 * enforced by refusing to counter on the final allowed offer — accept or
 * reject only.
 */
export function evaluateOffer(player: Pick<Player, "totalValue">, offerSalaryPerYear: number, offersUsed: number, maxOffers = 3): OfferOutcome {
  const ask = statedAsk(player);
  if (offerSalaryPerYear >= ask * 0.95) return { result: "accepted" };
  if (offerSalaryPerYear < ask * 0.7 || offersUsed >= maxOffers - 1) return { result: "rejected" };
  const counter = Math.round((offerSalaryPerYear + ask) / 2 / 1000) * 1000;
  return { result: "countered", counterSalaryPerYear: counter };
}

// ---------------------------------------------------------------------------
// Pure transforms
// ---------------------------------------------------------------------------

/**
 * AFL's contract/trade period sits in October — see Engine.md's Off-Season
 * Hub sequencing (Grand Final -> List Needs -> Combine -> Contracts ->
 * Trade -> Draft, all inside the same October-December off-season window).
 * Used as a fixed, reasonable signed/expired month-day for every contract
 * this file writes, since there's no finer-grained in-fiction calendar.
 */
const CONTRACT_WINDOW_MONTH = 10;
const CONTRACT_WINDOW_DAY = 1;

/** Returns a NEW player object with an updated contract — never mutates `player`. Splicing the result back into the live pool is the caller's job (see useContractStore.ts). */
export function reSign(player: Player, terms: ReSignTerms, currentYear: number): Player {
  return {
    ...player,
    signed_year: currentYear,
    signed_month: CONTRACT_WINDOW_MONTH,
    signed_day: CONTRACT_WINDOW_DAY,
    expired_year: currentYear + terms.years,
    expired_month: CONTRACT_WINDOW_MONTH,
    expired_day: CONTRACT_WINDOW_DAY,
    totalValue: terms.salaryPerYear,
  };
}

/** Flags a player `delisted` — see Player.delisted's own doc comment for exactly what this does and doesn't do. */
export function delist(player: Player): Player {
  return { ...player, delisted: true };
}

/** A free-agency signing: re-signs the player under new terms AND moves them to `signingClubName`. */
export function signFreeAgent(player: Player, signingClubName: string, terms: ReSignTerms, currentYear: number): Player {
  const club = clubByName(signingClubName);
  const resigned = reSign(player, terms, currentYear);
  return { ...resigned, Team: signingClubName, ClubID: club?.ClubID ?? player.ClubID };
}

// ---------------------------------------------------------------------------
// League Activity + rival-club AI simulation
// ---------------------------------------------------------------------------

export type LeagueActivityKind = "resigned" | "delisted" | "signed";

export interface LeagueActivityEntry {
  id: string;
  day: number;
  kind: LeagueActivityKind;
  playerId: number;
  playerName: string;
  /** The player's club after this event (their new club for a "signed" entry). */
  clubName: string;
  /** Only set for "signed" — the club they left, so a free-agency poach can show "ClubB signs Player from ClubA" rather than just "Player joins ClubB". */
  fromClubName?: string;
  detail: string;
}

/**
 * One simulated "day" of rival-club (every club except `myClub`) contract
 * activity — the "Let Assistant Manage" bulk action. Deterministic given
 * `seed` (mulberry32, never Math.random, matching every other stochastic
 * engine/*.ts step). Each currently-OOC/RFA/UFA rival player gets a single
 * weighted coin-flip at `RE_SIGN_PROBABILITY[status]` to stay; on failure
 * they're delisted and logged as lost to free agency. A deliberately
 * simplified stand-in for a real 17-club negotiation market — no bidding
 * *between* rival clubs for the same player is modelled (a disclosed
 * simplification, see ROADMAP.md's Phase 4 Slice 3 gaps).
 */
export function simulateLeagueContracts(
  players: readonly Player[],
  myClub: string,
  currentYear: number,
  day: number,
  seed: number,
): { players: Player[]; activity: LeagueActivityEntry[] } {
  const rng = mulberry32(seed);
  const activity: LeagueActivityEntry[] = [];

  const next = players.map((p) => {
    if (p.Team === myClub || p.delisted) return p;
    const status = freeAgencyStatus(p, currentYear);
    if (status === "Signed") return p;

    const name = playerFullName(p);
    const stays = rng() < RE_SIGN_PROBABILITY[status];

    if (stays) {
      const years = 2 + Math.floor(rng() * 3); // 2-4 years, a reasonable AI re-sign length
      const resigned = reSign(p, { years, salaryPerYear: p.totalValue }, currentYear);
      activity.push({
        id: `${p.PlayerID}-d${day}`,
        day,
        kind: "resigned",
        playerId: p.PlayerID,
        playerName: name,
        clubName: p.Team,
        detail: `${name} (${status}) re-signs with ${p.Team} for ${years} year${years === 1 ? "" : "s"}.`,
      });
      return resigned;
    }

    activity.push({
      id: `${p.PlayerID}-d${day}`,
      day,
      kind: "delisted",
      playerId: p.PlayerID,
      playerName: name,
      clubName: p.Team,
      detail: status === "UFA" ? `${name} leaves ${p.Team} as an unrestricted free agent.` : `${p.Team} parts ways with ${name} (${status}).`,
    });
    return delist(p);
  });

  return { players: next, activity };
}
