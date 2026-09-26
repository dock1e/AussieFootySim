import type { Player } from "../types/player.ts";
import { REAL_DRAFT_HISTORY, draftHistoryFor } from "../data/realDraftHistory.ts";

/**
 * `draft_capital_score` — round 125/126, [[End-of-2026 Player Database Refresh]].
 *
 * Schema.md's "Age & draft provenance (Aug 2026 fix)" section documents a `draft_capital_score`
 * signal (`avg_career_games(draft_type, pick) / 186.23 * 100`, smoothed with a shrinkage
 * estimator toward a power-law fit) that `POT`'s blended-upside formula already depends on — but
 * that lookup table only ever existed inside an offline, uncommitted generation script (confirmed
 * by grepping `app/scripts/` and every prior reference to it in `draft.ts`/`positionSwitch.ts`/
 * `progression.ts`'s own doc comments, all of which say the same thing: "no `draft_capital_score`
 * table exists anywhere in this codebase"). This file builds it for real, as committed,
 * re-runnable code, reusing `data/realDraftHistory.ts`'s own real 18-year (2008-2025) draftguru.com.au
 * dataset — ~2,700 real picks with real career-games-to-date figures — rather than inventing a new
 * data source.
 *
 * **Why a fit, not just a per-pick average**: most individual pick numbers (especially National
 * Draft picks past the first round, and every Rookie/Pre-Season/Mid-Season pick) only have a
 * handful of historical examples in 18 years — a raw average would swing wildly on one outlier
 * career (a bust at pick 3, a champion at pick 55). Schema.md's own documented fix is a shrinkage
 * estimator (`weight = n / (n + 12)`) blending each pick's own empirical average toward a smoothed
 * curve fit across all picks of that draft type — reproduced here exactly, with the curve itself a
 * log-log (power-law) least-squares fit of games-vs-pick-number, since AFL career length is
 * well-known to fall off roughly as a power law with draft position (a handful of elite top picks,
 * a long tail of fringe rookie-list players).
 */

type CapitalDraftType = "National" | "Rookie" | "Pre-Season" | "Mid-Season";

/** Player.draft_draftType's free-text strings, mapped onto realDraftHistory.ts's own DraftHistoryEntry.draftType union. Anything else (FA/Trade/Post-Draft/etc, or an unrecognised string) has no meaningful "pick number" concept and returns `null` from `draftCapitalScore`. */
function toCapitalDraftType(playerDraftType: string): CapitalDraftType | null {
  switch (playerDraftType) {
    case "National Draft":
      return "National";
    case "Rookie Draft":
      return "Rookie";
    case "Pre-Season Draft":
      return "Pre-Season";
    case "Mid-Season Draft":
      return "Mid-Season";
    default:
      return null;
  }
}

interface PickStat {
  n: number;
  meanGames: number;
}

/** `(draftType, pickNumber) -> {n, meanGames}` across the full real 2008-2025 history — the raw empirical input the shrinkage fit below smooths. Only rows with a real numbered pick count (`pickNumber != null`) and a draftType this file models contribute. */
function rawPickStats(): Map<CapitalDraftType, Map<number, PickStat>> {
  const byType = new Map<CapitalDraftType, Map<number, number[]>>();
  for (const entry of REAL_DRAFT_HISTORY) {
    if (entry.pickNumber == null) continue;
    const type = entry.draftType as CapitalDraftType;
    if (type !== "National" && type !== "Rookie" && type !== "Pre-Season" && type !== "Mid-Season") continue;
    if (!byType.has(type)) byType.set(type, new Map());
    const byPick = byType.get(type)!;
    if (!byPick.has(entry.pickNumber)) byPick.set(entry.pickNumber, []);
    byPick.get(entry.pickNumber)!.push(entry.games);
  }
  const out = new Map<CapitalDraftType, Map<number, PickStat>>();
  for (const [type, byPick] of byType) {
    const stats = new Map<number, PickStat>();
    for (const [pick, games] of byPick) {
      stats.set(pick, { n: games.length, meanGames: games.reduce((a, b) => a + b, 0) / games.length });
    }
    out.set(type, stats);
  }
  return out;
}

/**
 * Log-log least-squares power-law fit (`games = a * pick^b`) across every `(pick, meanGames)` pair
 * for one draft type — pick 0 excluded (undefined log), and any pick with `meanGames <= 0`
 * excluded the same way. Returns a function evaluating the fitted curve at any pick number.
 */
function fitPowerLaw(stats: Map<number, PickStat>): (pick: number) => number {
  const points = [...stats.entries()].filter(([pick, s]) => pick > 0 && s.meanGames > 0);
  if (points.length < 2) {
    const fallback = points[0]?.[1]?.meanGames ?? 0;
    return () => fallback;
  }
  const xs = points.map(([pick]) => Math.log(pick));
  const ys = points.map(([, s]) => Math.log(s.meanGames));
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  const b = den === 0 ? 0 : num / den;
  const lnA = meanY - b * meanX;
  const a = Math.exp(lnA);
  return (pick: number) => a * Math.pow(Math.max(1, pick), b);
}

/** Shrinkage weight toward the fitted curve — Schema.md's own documented constant (`n / (n + 12)`), reused verbatim rather than re-picked. */
const FIT_SHRINKAGE_DIVISOR = 12;

let cachedCurves: Map<CapitalDraftType, { stats: Map<number, PickStat>; fit: (pick: number) => number }> | null = null;

function curvesFor(): Map<CapitalDraftType, { stats: Map<number, PickStat>; fit: (pick: number) => number }> {
  if (cachedCurves) return cachedCurves;
  const raw = rawPickStats();
  const out = new Map<CapitalDraftType, { stats: Map<number, PickStat>; fit: (pick: number) => number }>();
  for (const [type, stats] of raw) {
    out.set(type, { stats, fit: fitPowerLaw(stats) });
  }
  cachedCurves = out;
  return out;
}

/** Smoothed, shrinkage-blended average career games for a given real draft type + pick number — Schema.md's `avg_career_games(draft_type, pick)`, now real code. `null` for a draft type this file doesn't model (FA/Trade/Post-Draft/etc) or a pick number with zero historical data of any kind. */
export function avgCareerGamesByPick(draftType: string, pickNumber: number): number | null {
  const type = toCapitalDraftType(draftType);
  if (type == null) return null;
  const curve = curvesFor().get(type);
  if (!curve) return null;
  const fitted = curve.fit(pickNumber);
  const empirical = curve.stats.get(pickNumber);
  if (!empirical) return fitted;
  const weight = empirical.n / (empirical.n + FIT_SHRINKAGE_DIVISOR);
  return weight * empirical.meanGames + (1 - weight) * fitted;
}

/** The smoothed National-pick-1 value — today's real equivalent of Schema.md's hardcoded `186.23` reference ceiling, computed fresh off the real dataset rather than a frozen constant so it stays correct if `realDraftHistory.ts` is ever extended with more years. */
export function nationalPick1Ceiling(): number {
  return avgCareerGamesByPick("National Draft", 1) ?? 186.23;
}

/**
 * `draft_capital_score` for a real player — `avgCareerGamesByPick / nationalPick1Ceiling * 100`,
 * clipped `[0, 100]`, exactly Schema.md's documented formula. `null` when the player's own
 * `draft_draftType` isn't one this file models (FA/Trade/Post-Draft/undrafted-placeholder) or no
 * historical data exists for that exact pick — callers (see `ratingGeneration.ts`) fall back to
 * the attribute-only upside path in that case, same as Schema's own documented 128-player fallback.
 */
export function draftCapitalScore(p: Pick<Player, "draft_draftType" | "draft_pick">): number | null {
  const avg = avgCareerGamesByPick(p.draft_draftType, p.draft_pick);
  if (avg == null) return null;
  const ceiling = nationalPick1Ceiling();
  if (ceiling <= 0) return null;
  return Math.max(0, Math.min(100, (avg / ceiling) * 100));
}

/**
 * Real, current (as of the Aug 2026 draftguru.com.au scrape) career games for a named real
 * player — the max across every matching `draftHistoryFor` row rather than a sum, since
 * `DraftHistoryEntry.games` is documented as a cumulative-to-scrape-time snapshot, not a
 * per-row delta (see `realDraftHistory.ts`'s own file-level caveat: summing would double-count a
 * player who appears on more than one year's page). Returns `null` when no real draft record
 * exists at all (the 128 players whose `draft_pick` is still MODELLED) — callers fall back to
 * `stat_GM` or another proxy in that case, since draftguru simply has nothing to offer.
 */
export function realCareerGamesFor(realFullName: string): number | null {
  const rows = draftHistoryFor(realFullName);
  if (rows.length === 0) return null;
  return Math.max(...rows.map((r) => r.games));
}
