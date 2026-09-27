import type { Player } from "../types/player.ts";
import type { Archetype } from "../types/archetype.ts";
import { AttributeZScorer } from "./attributeGeneration.ts";
import { REAL_2026_SEASON_STATS } from "../data/real2026SeasonStats.ts";
import { careerHistoryFor } from "../data/realCareerHistory.ts";
import { recencyWeightedSeasonStats } from "./recencyForm.ts";
import { type RatedAttribute } from "../types/player.ts";
import { honoursScoreFor } from "./prestige.ts";
import { OVR_Z_MULTIPLIER, rawAttributeCompositeFor } from "./progression.ts";
import { blendedPotentialFor } from "./ratingGeneration.ts";
import { qualifiesForProvenTrajectory, PROVEN_TRAJECTORY_GAMES_BONUS } from "./provenTrajectory.ts";

/**
 * Round C148 — [[End-of-2026 Player Database Refresh]] deliverable 1: reconstruct what a real
 * player's `OVR` would have read AS OF any past real season, to validate the SHAPE (not exact value)
 * of a real rise-then-decline career against Tyler's own recalled anchors (Cripps/Oliver) and a few
 * other proven decliners (Dustin Martin).
 *
 * **Method, exactly as the round's own brief specifies**: run that season's real per-game rates
 * through the SAME `AttributeZScorer` formula every current attribute is generated from
 * (`attributesForExternalRow`), then z-score the resulting raw composite against a FIXED reference
 * population baseline — **today's current 594-player population's raw-composite mean/stdDev**, not a
 * true same-year historical league population (this dataset only has today's 825 players' own
 * histories, not everyone who played in e.g. 2016 — there is no real same-year population to build
 * instead). Recency-blending (`recencyForm.ts`) is applied here too, exactly as it is for the current
 * 2026 read, so a reconstructed year N's composite reflects the same "last up to 3 seasons up to and
 * including N" blend the live formula uses — the historical reconstruction and the live formula are
 * the SAME mechanism run at a different `uptoYear`, not two different implementations that might
 * silently disagree.
 *
 * **Disclosed limitation**: this reconstructs the raw-composite/OVR SHAPE only — it does not attempt
 * to reconstruct `archetype` (assumed constant at the player's CURRENT archetype for every past year,
 * since no historical archetype-classification data exists) or apply the small-sample shrinkage /
 * prestige-decay mechanisms with period-accurate archetype population means (the fixed CURRENT
 * archetype means are reused for every past year too, same "fixed reference baseline" simplification
 * as the population OVR stats). This is why the round's own brief asks for SHAPE validation
 * ("directionally correct, not exact-match-required") rather than treating reconstructed numbers as
 * a literal historical database.
 */

const scorer = new AttributeZScorer(REAL_2026_SEASON_STATS);

/** Today's (2026) raw-composite population mean/stdDev — the fixed reference baseline every reconstructed year is z-scored against (see this file's doc comment). Computed once, lazily, from the live 825-player pool passed in by the caller. */
export interface ReconstructionBaseline {
  mean: number;
  stdDev: number;
}

/**
 * Round C149 — reuses `progression.ts`'s `rawAttributeCompositeFor` (the fixed-share
 * primary/overall blend, see that function's own doc comment) instead of maintaining a second,
 * driftable copy of the composite formula here. Previously this file re-implemented the OLD flat
 * x3/x1.5/x1 weighted-mean formula inline — confirmed still in sync today only by construction, not
 * by any shared code, which is exactly the kind of duplication this round's fix removes.
 */
function rawCompositeFromAttributes(attrs: Record<RatedAttribute, number>, archetype: Archetype, prestige: number): number {
  return rawAttributeCompositeFor(attrs, archetype) + prestige;
}

/** One reconstructed real season's OVR-shaped read for one player. */
export interface ReconstructedYear {
  year: number;
  games: number;
  rawComposite: number;
  ovr: number;
  /** Round C151 — see `reconstructHistoricalOvr`'s own doc comment for the (disclosed, approximate) method. */
  pot: number;
}

/**
 * Reconstructs a player's OVR-shaped read for every real season on file in `realCareerHistory.ts`
 * (ascending), using the player's CURRENT `archetype`/`realFullName` and the fixed `baseline`
 * (see this file's doc comment). `[]` if the player has no real career history on file at all.
 *
 * **Round C151 — `pot` added, deliverable 1 of that round's brief ("extend it if it doesn't already
 * expose per-year POT, not just OVR").** Reuses `ratingGeneration.ts`'s real, live `blendedPotentialFor`
 * directly (not a re-derived copy) against each reconstructed year's `ovr`, so a future change to that
 * formula automatically flows through here too. Three inputs it needs that this file cannot exactly
 * reconstruct per-year are approximated, disclosed rather than silently assumed, in keeping with this
 * file's existing "SHAPE not exact-match" mandate:
 *
 * 1. **Real career games as of that year** — summed from `careerHistoryFor`'s own per-season `games`
 *    field for every row up to and including `year` (a real, checkable cumulative count, just not the
 *    same-source `realDraftHistory.ts` scrape `careerGamesFor` uses for the CURRENT read).
 * 2. **Age as of that year** — `p`'s CURRENT `Age` minus `(HONOUR_DECAY_CURRENT_YEAR - year)`. `p` must
 *    now also carry `Age`/`potentialTall`/`potentialMid`/`draft_pick`/`draft_draftType` (every field
 *    `blendedPotentialFor`/`qualifiesForProvenTrajectory` actually read) — widened from the previous
 *    narrower `Pick<Player, ...>` this file's OVR-only reconstruction needed.
 * 3. **`qualifiesForProvenTrajectory` as of that year** — checked using `year`'s OWN reconstructed
 *    `rawComposite` (via that function's new `rawCompositeOverride` param) against the SAME fixed
 *    `baseline`/archetype-stats every other year uses. The honour check itself is NOT year-gated here,
 *    unlike `honoursScoreFor` above — a simplification matching this file's existing "fixed current
 *    archetype/reference population for every past year" convention, not a new one invented for POT
 *    alone.
 */
export function reconstructHistoricalOvr(
  p: Pick<Player, "realFullName" | "fname" | "lname" | "archetype" | "Age" | "potentialTall" | "potentialMid" | "draft_pick" | "draft_draftType">,
  baseline: ReconstructionBaseline,
  archetypeBaseline?: ReconstructionBaseline,
): ReconstructedYear[] {
  const name = p.realFullName ?? `${p.fname} ${p.lname}`;
  const rows = careerHistoryFor(name);
  const years = rows.map((r) => r.year);
  if (years.length === 0) return [];
  const archetype = p.archetype as Archetype;
  const out: ReconstructedYear[] = [];
  for (const year of years) {
    const blended = recencyWeightedSeasonStats(name, year);
    if (!blended) continue;
    const attrs = scorer.attributesForExternalRow(blended, archetype);
    // Prestige is recomputed AS OF this reconstructed year (currentYear=year), not fixed at its 2026
    // value — an honour not yet won as of `year` correctly contributes 0 that year (honoursScoreFor's
    // own `y > currentYear` guard), and one already won decays relative to `year`, not to 2026. This
    // is what actually lets a young player's early, still-honours-light seasons read lower than their
    // later decorated ones, and a late-career decline show up on TOP of (not masked by) whatever
    // prestige they'd banked by then.
    const prestige = honoursScoreFor(name, year);
    const rawComposite = rawCompositeFromAttributes(attrs, archetype, Math.max(-8, Math.min(8, prestige * 0.55)));
    const z = baseline.stdDev === 0 ? 0 : (rawComposite - baseline.mean) / baseline.stdDev;
    const ovr = Math.max(40, Math.min(110, Math.round(70 + z * OVR_Z_MULTIPLIER)));

    const careerGamesAsOfYear = rows.filter((r) => r.year <= year).reduce((s, r) => s + r.games, 0);
    const ageAsOfYear = p.Age - (2026 - year);
    const pseudoPlayer = { ...p, Age: ageAsOfYear } as Player;
    // rawComposite override: this year's OWN reconstructed composite, not p's current one (see
    // qualifiesForProvenTrajectory's own Round C151 doc comment for why this override exists).
    const proven = qualifiesForProvenTrajectory(pseudoPlayer, baseline, archetypeBaseline, rawComposite);
    const careerGames = careerGamesAsOfYear + (proven ? PROVEN_TRAJECTORY_GAMES_BONUS : 0);
    const pot = blendedPotentialFor(pseudoPlayer, ovr, careerGames, 110, proven);

    out.push({ year, games: blended.games, rawComposite, ovr, pot });
  }
  return out;
}
