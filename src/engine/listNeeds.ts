import type { Player } from "../types/player.ts";
import { CLUBS } from "../types/club.ts";
import { getPlayersByClub } from "../data/loadPlayers.ts";
import { ARCHETYPE_LINE, summariseLines, bandForGap, type Line, type LineBand, type LineSummary } from "../data/lines.ts";
import { LINE_TARGETS } from "./team.ts";
import type { Archetype } from "../types/archetype.ts";

/**
 * List Needs report — Engine.md "List Needs report": a dedicated
 * needs-diagnosis screen, deliberately sitting before Contracts/Trade/Draft
 * so later decisions read against a stated diagnosis rather than the coach
 * inferring needs from a bare roster grid.
 *
 * Two numbers this file has to define that Engine.md names but doesn't pin
 * down exactly, flagged the same "deliberately roughed in" way as every
 * other un-specified constant in this project:
 *
 * 1. **"Ideal" listed count per line.** Engine.md's own example is `8/14`
 *    for Midfield — a list-depth target, distinct from `team.ts`'s
 *    `LINE_TARGETS` (the on-field *match-day* quota: 6/7/7/2). A naive
 *    2x-the-match-day-quota guess (12/14/14/4) was tried first and rejected
 *    after checking it against the real 751-player dataset: `Midfield` only
 *    has 2 of the 14 archetypes mapped to it (`lines.ts`'s own
 *    `ARCHETYPE_LINE`), so every single real club sits well under a 14
 *    target — the report would read "short at midfield" for all 18 clubs,
 *    always, which carries no signal. `computeLeagueIdealListedCounts()`
 *    below instead takes the league's own current average listed count per
 *    line as "ideal" — self-calibrating to however the archetype
 *    distribution actually falls (confirmed empirically: this lands
 *    Midfield's ideal at ~8, matching Engine.md's own live-observed example
 *    almost exactly), and it stays sane if the underlying player pool ever
 *    changes (trades, drafts, a re-run `npm run build:data`) rather than
 *    drifting stale like a hand-picked constant would.
 * 2. **The "best-23 quality" bar.** A player counts as best-23-standard if
 *    their `OVR` is at or above the *current* league-wide average OVR —
 *    computed fresh from the `playersByClub` map passed in (the same shape
 *    `data/loadPlayers.ts`'s own `LEAGUE_AVERAGE_OVR` constant is built
 *    from, but recomputed here rather than importing that fixed constant
 *    directly, so this module stays correct if it's ever handed a league
 *    that isn't literally the current real 18 clubs — e.g. a test's
 *    synthetic pool, or a future post-trade/post-draft mutated pool once
 *    Phase 4's persistence layer exists). Deliberately *not* capped at the
 *    line's on-field quota (`LINE_TARGETS`):
 *    Engine.md's own framing is "how many of [the listed players] are
 *    actually best-23 standard," i.e. an individual quality bar per player,
 *    not "how many could literally fit in today's run-on 22" — a club with
 *    9 quality-bar-clearing midfielders genuinely is deep at the position,
 *    that's a real, worth-showing signal, not something to truncate at 7.
 *    The on-field quota is instead what "starters short" (in the shape
 *    verdict below) is measured against.
 *
 * Club-wide **strategy label** (`Rebuild`/`Balanced`/`Contend` — the same
 * label [[Engine#Trade AI & valuation model]] says drives every AI club's
 * trade behaviour, not built yet, see ROADMAP.md) is "derived from average
 * list age plus top-10 OVR quality" per Engine.md, again without an exact
 * formula given. `computeLeagueStrategies()` z-scores both measures across
 * the current 18-club league (quality weighted full, age weighted at half)
 * and buckets at +/-0.5 — checked against the real dataset, this splits the
 * league exactly 6/6/6 across the three labels, a healthy spread rather
 * than a degenerate all-one-bucket result.
 */

export type ClubStrategy = "Rebuild" | "Balanced" | "Contend";

const LINE_NOUN: Record<Line, string> = {
  Midfield: "a midfielder",
  Forwards: "a forward",
  Defence: "a defender",
  Ruck: "a ruck",
};

export interface LineNeedsSummary extends LineSummary {
  band: LineBand;
  listed: number; // same number as `players.length`, named directly for display convenience
  ideal: number;
  qualityCount: number; // "best-23 quality" — see doc comment point 2
  starterQuota: number; // team.ts's LINE_TARGETS for this line
  verdict: string; // e.g. "1 starter short · 6 bodies short of shape", or "Healthy"
}

export interface RecommendedAction {
  priority: "HIGH PRIORITY" | "PRIORITY";
  /** Every action is draft-capital-shaped for now — Contracts/Trade don't exist yet (ROADMAP.md) to generate "re-sign"/"trade for" style recommendations instead. Kept as an explicit field rather than an implicit assumption so this type doesn't need reshaping once those screens exist. */
  category: "DRAFT";
  line: Line;
  text: string;
}

export interface AgeProfile {
  listSize: number;
  avgAge: number;
  young: number; // <= 22
  prime: number; // 23-29
  veteran: number; // >= 30
  /** Engine.md's Trade AI section: the trade window's legal list-size band, confirmed live as 24-46. Shown here even though Trade Period itself isn't built yet (ROADMAP.md) — it's a real, cheap, useful signal on its own. */
  legalSize: boolean;
}

export interface ListNeedsReport {
  clubName: string;
  strategy: ClubStrategy;
  headline: string;
  lines: LineNeedsSummary[];
  ageProfile: AgeProfile;
  recommendedActions: RecommendedAction[];
}

/** League's own current average listed count per line, rounded — see doc comment point 1. */
export function computeLeagueIdealListedCounts(playersByClub: ReadonlyMap<string, Player[]>): Record<Line, number> {
  const totals: Record<Line, number> = { Midfield: 0, Forwards: 0, Defence: 0, Ruck: 0 };
  const clubCount = playersByClub.size || 1;
  for (const players of playersByClub.values()) {
    for (const p of players) {
      totals[ARCHETYPE_LINE[p.archetype as Archetype]]++;
    }
  }
  return {
    Midfield: Math.round(totals.Midfield / clubCount),
    Forwards: Math.round(totals.Forwards / clubCount),
    Defence: Math.round(totals.Defence / clubCount),
    Ruck: Math.round(totals.Ruck / clubCount),
  };
}

function ageProfileFor(players: Player[]): AgeProfile {
  const listSize = players.length;
  const avgAge = listSize ? players.reduce((s, p) => s + p.Age, 0) / listSize : 0;
  return {
    listSize,
    avgAge,
    young: players.filter((p) => p.Age <= 22).length,
    prime: players.filter((p) => p.Age >= 23 && p.Age <= 29).length,
    veteran: players.filter((p) => p.Age >= 30).length,
    legalSize: listSize >= 24 && listSize <= 46,
  };
}

function top10Ovr(players: Player[]): number {
  const top = [...players].sort((a, b) => b.OVR - a.OVR).slice(0, 10);
  return top.length ? top.reduce((s, p) => s + p.OVR, 0) / top.length : 0;
}

/** Average OVR across every player in every club passed in — see doc comment point 2 for why this is recomputed from `playersByClub` rather than importing `data/loadPlayers.ts`'s fixed `LEAGUE_AVERAGE_OVR` constant. */
function leagueAverageOvr(playersByClub: ReadonlyMap<string, Player[]>): number {
  const all = [...playersByClub.values()].flat();
  return all.length ? all.reduce((s, p) => s + p.OVR, 0) / all.length : 0;
}

function meanStd(xs: number[]): { mean: number; std: number } {
  const mean = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  const variance = xs.reduce((a, x) => a + (x - mean) ** 2, 0) / (xs.length || 1);
  return { mean, std: Math.sqrt(variance) };
}

/** Computes every club's strategy label together, since the z-scoring needs the whole league's current distribution — see this file's doc comment. */
export function computeLeagueStrategies(playersByClub: ReadonlyMap<string, Player[]>): Map<string, ClubStrategy> {
  const rows = [...playersByClub.entries()].map(([name, players]) => ({
    name,
    quality: top10Ovr(players),
    age: players.length ? players.reduce((s, p) => s + p.Age, 0) / players.length : 0,
  }));
  const { mean: qMean, std: qStd } = meanStd(rows.map((r) => r.quality));
  const { mean: aMean, std: aStd } = meanStd(rows.map((r) => r.age));

  const result = new Map<string, ClubStrategy>();
  for (const r of rows) {
    const qualityZ = qStd === 0 ? 0 : (r.quality - qMean) / qStd;
    const ageZ = aStd === 0 ? 0 : (r.age - aMean) / aStd;
    const contendScore = qualityZ + 0.5 * ageZ;
    const strategy: ClubStrategy = contendScore > 0.5 ? "Contend" : contendScore < -0.5 ? "Rebuild" : "Balanced";
    result.set(r.name, strategy);
  }
  return result;
}

/** Builds every club's full player list, keyed by name — the shared input `computeLeagueStrategies`/`computeLeagueIdealListedCounts` both need since they read the whole league at once, not just one club. */
export function buildLeaguePlayersByClub(): Map<string, Player[]> {
  const map = new Map<string, Player[]>();
  for (const club of CLUBS) map.set(club.name, getPlayersByClub(club.name));
  return map;
}

function verdictFor(line: Line, listed: number, ideal: number, qualityCount: number, starterQuota: number, eliteCount: number): string {
  const clauses: string[] = [];
  if (qualityCount < starterQuota) {
    const n = starterQuota - qualityCount;
    clauses.push(`${n} starter${n === 1 ? "" : "s"} short`);
  }
  if (listed < ideal) {
    const n = ideal - listed;
    clauses.push(`${n} bod${n === 1 ? "y" : "ies"} short of shape`);
  }
  if (eliteCount === 0) {
    clauses.push("no elite (84+)");
  }
  return clauses.length ? clauses.join(" · ") : "Healthy";
}

function recommendedActionsFor(lines: LineNeedsSummary[]): RecommendedAction[] {
  const scored = lines
    .map((l) => {
      const starterDeficit = Math.max(0, l.starterQuota - l.qualityCount);
      const bodyDeficit = Math.max(0, l.ideal - l.listed);
      const score = starterDeficit * 2 + bodyDeficit; // starter shortfalls matter more than raw depth
      return { line: l, starterDeficit, bodyDeficit, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, 3).map((s): RecommendedAction => {
    const noun = LINE_NOUN[s.line.line];
    const priority: RecommendedAction["priority"] = s.starterDeficit > 0 ? "HIGH PRIORITY" : "PRIORITY";
    const followUp =
      s.starterDeficit > 0
        ? "Add depth and a long-term project here."
        : "Not urgent, but the cupboard thins out fast if a couple of these move on.";
    const text = `Use draft capital on ${noun} — ${s.line.listed}/${s.line.ideal} listed, ${s.line.qualityCount}/${s.line.starterQuota} best-23 quality. ${followUp}`;
    return { priority, category: "DRAFT", line: s.line.line, text };
  });
}

/**
 * Full List Needs report for one club. `playersByClub` must cover the whole
 * league (see `buildLeaguePlayersByClub`) since the strategy label and the
 * "ideal" line targets are both computed relative to the current league,
 * not just this one club's own roster.
 */
export function computeListNeeds(clubName: string, playersByClub: ReadonlyMap<string, Player[]>): ListNeedsReport {
  const players = playersByClub.get(clubName) ?? [];
  const ideals = computeLeagueIdealListedCounts(playersByClub);
  const strategies = computeLeagueStrategies(playersByClub);
  const leagueAvgOvr = leagueAverageOvr(playersByClub);
  const summaries = summariseLines(players, leagueAvgOvr);

  const lines: LineNeedsSummary[] = summaries.map((s) => {
    const qualityCount = s.players.filter((p) => p.OVR >= leagueAvgOvr).length;
    const starterQuota = LINE_TARGETS[s.line];
    const ideal = ideals[s.line];
    return {
      ...s,
      band: bandForGap(s.gapToLeague),
      ideal,
      qualityCount,
      starterQuota,
      listed: s.players.length,
      verdict: verdictFor(s.line, s.players.length, ideal, qualityCount, starterQuota, s.elite.length),
    };
  });

  const strategy = strategies.get(clubName) ?? "Balanced";
  const worst = [...lines]
    .map((l) => ({ l, score: Math.max(0, l.starterQuota - l.qualityCount) * 2 + Math.max(0, l.ideal - l.listed) }))
    .sort((a, b) => b.score - a.score)[0];
  const headline =
    worst && worst.score > 0
      ? `Your list grades out as ${strategy.toLowerCase()}, and ${worst.l.line.toLowerCase()} stocks are thin.`
      : `Your list grades out as ${strategy.toLowerCase()}, and the list looks in good shape across the park.`;

  return {
    clubName,
    strategy,
    headline,
    lines,
    ageProfile: ageProfileFor(players),
    recommendedActions: recommendedActionsFor(lines),
  };
}
