import type { Player } from "../types/player.ts";
import { ageOnePlayer, ovrRawComposite, ovrFromRawComposite } from "./progression.ts";
import { combinedRecordFor, type RecordCategory, type RecordRow } from "./records.ts";
import type { SeasonArchiveEntry } from "./seasonSummary.ts";
import type { Season } from "./season.ts";
import { SEASON_ROUNDS } from "./fixture.ts";

/**
 * Round 118 — [[Club Theme System]] Player Career screen. The brief (`Club Theme System.dc.html`
 * lines 215-334) wants an "OVR by season" arc with an ACTUAL history line, a PROJECTED (dashed)
 * forward line, and a PROJECTED PEAK tile with a tier label, plus an "All-Time Chase" section showing
 * 2 records the player is closing in on with a projected final rank/value.
 *
 * **The one real gap this screen hits, disclosed rather than papered over**: nothing in this codebase
 * persists a player's OVR/POT *at the end of each past season* — `SeasonArchiveEntry` is stats-only
 * (see `seasonSummary.ts`), and `Player.OVR` is a single live, mutated-in-place field with no history.
 * So there is no honest way to plot "ACTUAL OVR" for any season before today — the UI (`CareerProfile.tsx`)
 * reduces the "actual" side of the chart to a single current-day point rather than fabricating a
 * backward trend. What THIS file provides instead is a genuine, computed FORWARD projection, built
 * entirely from real, already-shipped mechanics:
 *
 * - `projectOvrTrajectory` repeats `progression.ts`'s exact, deterministic (no RNG) `ageOnePlayer` step
 *   year-by-year on a single player, and converts each year's resulting attribute set into an OVR-shaped
 *   number using the SAME z-score formula `recomputeOVR` uses (`ovrRawComposite`/`ovrFromRawComposite`)
 *   — but frozen against TODAY's league population stats rather than re-deriving a new population mean/
 *   stdDev for every future year. That's a disclosed approximation: it doesn't model the whole league
 *   aging together (everyone else's OVR drifts too, in reality), so a projected OVR many years out reads
 *   slightly optimistic/pessimistic relative to a population that's also moving. It's still a real
 *   number from the real formula, not an invented curve.
 * - `ovrTierFor` is a new bucketing function (grep of the whole codebase turned up no existing OVR-tier
 *   ladder to reuse) — disclosed as this file's own invention, not a scraped/real AFL convention, same
 *   status as `engine/seasonGrading.ts`'s own A+-E cutoffs.
 * - `topRecordChasesFor` generalizes `records.ts`'s own `bestAllTimeStandingFor` (which finds a player's
 *   single BEST standing across every `RecordCategory`) into a top-2 variant, reusing `combinedRecordFor`
 *   rather than re-deriving any ranking logic, plus a linear per-game-rate projection to a final value/
 *   rank — grounded in `estimatedRemainingGames`, which itself reads off the SAME forward OVR trajectory
 *   (a player's chase horizon ends when their projected OVR falls into decline, not an arbitrary
 *   hardcoded retirement age).
 */

// --- OVR tier bucketing ----------------------------------------------------------------------

export interface OvrTier {
  label: string;
  minOvr: number;
}

/**
 * New for round 118 — no existing OVR-tier ladder anywhere in the codebase (confirmed by grep). OVR is
 * z-scored to a population mean of 50 with stdDev ~13 and clipped to [28,99] (`progression.ts`'s
 * `recomputeOVR`), so these cutoffs are pitched relative to that same distribution: "Elite" starts
 * around the ~97th percentile (mean + ~2 stdDev), "Star" around the ~85th, "Quality" around the 50th
 * (league-average two-way starter), "Solid" a shade below average, everything else "Depth". Ordered
 * best-to-worst; the first band an OVR is `>=` is the tier assigned.
 */
const OVR_TIERS: readonly OvrTier[] = [
  { label: "Elite", minOvr: 88 },
  { label: "Star", minOvr: 78 },
  { label: "Quality", minOvr: 62 },
  { label: "Solid", minOvr: 50 },
  { label: "Depth", minOvr: 0 },
];

export function ovrTierFor(ovr: number): string {
  for (const tier of OVR_TIERS) {
    if (ovr >= tier.minOvr) return tier.label;
  }
  return "Depth";
}

// --- Forward OVR trajectory --------------------------------------------------------------------

export interface ProjectedYear {
  year: number;
  age: number;
  ovr: number;
}

export interface OvrTrajectory {
  /** One entry per projected year, starting the year AFTER `currentYear` (today's OVR is the chart's separate "actual" point, not repeated here). */
  years: ProjectedYear[];
  peak: ProjectedYear & { tier: string };
}

/**
 * Projects `player`'s OVR forward `yearsForward` seasons using the real `ageOnePlayer` off-season step,
 * converting each resulting attribute set to an OVR-shaped number via `ovrRawComposite`/
 * `ovrFromRawComposite` frozen against `populationStats` (today's league, computed once by the caller
 * via `populationOvrStats` — see this file's own doc comment for why that's a disclosed
 * approximation). `developmentMultiplier` defaults to `1` (no coach/performance boost assumed for a
 * hypothetical future with no known coach or performance signal yet).
 */
export function projectOvrTrajectory(player: Player, currentYear: number, populationStats: { mean: number; stdDev: number }, yearsForward = 10): OvrTrajectory {
  const years: ProjectedYear[] = [];
  let current = player;
  for (let i = 1; i <= yearsForward; i++) {
    current = ageOnePlayer(current, 1);
    const ovr = ovrFromRawComposite(ovrRawComposite(current), populationStats);
    years.push({ year: currentYear + i, age: current.Age, ovr });
  }
  let peak = years[0];
  for (const y of years) if (y.ovr > peak.ovr) peak = y;
  return { years, peak: { ...peak, tier: ovrTierFor(peak.ovr) } };
}

// --- All-Time Chase (top-2 record standings + projection) --------------------------------------

export interface RecordChase {
  category: RecordCategory;
  row: RecordRow;
  /** Games this save has actually recorded for the player (see `simCareerSpan`/`allTimePlayerTotals` — not re-derived here, passed in by the caller who already has it). Used as the per-game-rate denominator. */
  gamesPlayed: number;
  projectedFinalValue: number;
  projectedFinalRank: number;
  /** The value of the #1 all-time standing in this category, for a "gap to the top" readout. */
  topValue: number;
  topName: string;
}

/**
 * Generalizes `records.ts`'s `bestAllTimeStandingFor` (which finds a player's single BEST standing)
 * into a `topN` (default 2, matching the brief's "All-Time Chase" 2-row layout) variant — reuses
 * `combinedRecordFor` for the actual ranking rather than re-deriving it. Each returned chase also gets
 * a linear per-game-rate projection: `(row.value / gamesPlayed) * estimatedRemainingGames`, added to the
 * current value, then re-ranked against the same category's real top-100 to estimate a final rank. This
 * is a straight-line extrapolation — it doesn't model form decline, injury, or an actual retirement
 * decision — but it's grounded in a real per-game rate and a real remaining-games horizon
 * (`estimatedRemainingGames`), not an invented number.
 */
export function topRecordChasesFor(
  playerId: number,
  gamesPlayed: number,
  estimatedRemainingGames: number,
  categoryOrder: readonly RecordCategory[],
  seasonArchives: readonly SeasonArchiveEntry[],
  liveSeason: Season | null,
  topN = 2,
): RecordChase[] {
  const WORTH_CHASING_TOP_N = 100;
  const standings: { category: RecordCategory; row: RecordRow }[] = [];
  for (const category of categoryOrder) {
    const rows = combinedRecordFor(category, seasonArchives, liveSeason, WORTH_CHASING_TOP_N);
    const row = rows.find((r) => r.player?.PlayerID === playerId);
    if (row) standings.push({ category, row });
  }
  standings.sort((a, b) => a.row.rank - b.row.rank);

  return standings.slice(0, topN).map(({ category, row }) => {
    const perGame = gamesPlayed > 0 ? row.value / gamesPlayed : 0;
    const projectedFinalValue = Math.round(row.value + perGame * estimatedRemainingGames);
    const rows = combinedRecordFor(category, seasonArchives, liveSeason, WORTH_CHASING_TOP_N);
    let projectedFinalRank = row.rank;
    for (const r of rows) {
      if (r.player?.PlayerID !== playerId && r.value <= projectedFinalValue) {
        projectedFinalRank = r.rank;
        break;
      }
    }
    const top = rows[0];
    return {
      category,
      row,
      gamesPlayed,
      projectedFinalValue,
      projectedFinalRank,
      topValue: top?.value ?? row.value,
      topName: top?.name ?? row.name,
    };
  });
}

/**
 * How many more games (real `SEASON_ROUNDS`-sized seasons) a player has left, derived from their own
 * forward OVR trajectory rather than a hardcoded retirement age: the horizon runs until projected OVR
 * first drops more than `DECLINE_THRESHOLD` below its own projected peak, capped at `MAX_SEASONS` so a
 * player who never meaningfully declines within the projection window (a young player still on the way
 * up) doesn't get an unbounded games-remaining figure. A minimum of one season is always returned —
 * even a player at/past their peak still has at least a season of football left in this model.
 */
export function estimatedRemainingGames(trajectory: OvrTrajectory): number {
  const DECLINE_THRESHOLD = 6; // OVR points below peak that counts as "meaningfully declined"
  const MAX_SEASONS = 10;
  const peakOvr = trajectory.peak.ovr;
  let seasons = trajectory.years.findIndex((y) => y.ovr <= peakOvr - DECLINE_THRESHOLD) + 1;
  if (seasons <= 0) seasons = Math.min(MAX_SEASONS, trajectory.years.length);
  seasons = Math.max(1, Math.min(MAX_SEASONS, seasons));
  return seasons * SEASON_ROUNDS;
}
