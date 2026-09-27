import type { Player } from "../types/player.ts";
import { draftHistoryFor } from "../data/realDraftHistory.ts";
import { draftCapitalScore, realCareerGamesFor } from "./draftCapital.ts";

/**
 * `prestigeBonus` — Round C147, [[End-of-2026 Player Database Refresh]] Step 3, Tyler's binding
 * decision #2 for this round: "Prestige/reputation signal is a bounded, documented nudge on top of
 * the existing stat-based z-score composite — NOT a co-equal input." This file is that nudge,
 * feeding a single additive term into `progression.ts`'s `ovrRawComposite` (see that function's own
 * doc comment for exactly where it's added).
 *
 * **Every input is a real, structured, checkable signal already in this codebase** — nothing here
 * reads free-text "bio write-up" narrative directly:
 *
 * 1. **Named honours** (`honoursScoreFor`) — parsed from `data/realDraftHistory.ts`'s own
 *    `DraftHistoryEntry.awards` semicolon-tag convention (e.g. "AA: 2023, 2024; Brownlow: 2026"),
 *    the exact same field this codebase has used since round 65/66/68 for every scouting-text
 *    honours callout, weighted by `HONOUR_WEIGHTS` below — Brownlow (the game's own highest
 *    individual honour) weighted heaviest, full All-Australian blazers/Coleman/Norm Smith next, then
 *    best-and-fairest/Rising Star/AFLPA-1st-tier honours, then the lesser AA40 (wider 40-man squad,
 *    not the actual 23-man team) and flag-only Premiership tags lightest (a flag is a team honour
 *    with a large lucky/context component, not pure individual quality — included at low weight
 *    rather than left out entirely, since Tyler's own brief explicitly names "Norm Smith Medal +
 *    premiership tags... already tagged" as an input). **Round C148**: each individual honour-YEAR
 *    now DECAYS by real years elapsed since it was won (half-life 6 real seasons — see
 *    `honoursScoreFor`'s own doc comment for the full derivation and why this was a confirmed, not
 *    just suspected, driver of Round C147's "no real decline" problem) — this file's Round C147
 *    version was a flat, never-decaying lifetime sum, which is what let a decorated-but-declined
 *    veteran's `OVR` stay permanently propped up regardless of current real form.
 * 2. **Draft pedigree** (`draftPedigreeBonusFor`) — reuses `draftCapital.ts`'s existing
 *    `draftCapitalScore` (avg-career-games-by-pick, already built for `POT`'s upside term) as the
 *    "was this player a historically elite draft selection" signal Tyler's brief names directly
 *    ("a low, historically-elite pick... is a real, checkable prestige signal"). A small, separately
 *    capped contribution — pedigree is a WEAKER prestige signal than an honour actually won, by
 *    design (a top pick who never delivered shouldn't out-prestige a genuine Brownlow medallist).
 * 3. **Career-games milestones** (`careerMilestoneBonusFor`) — real CAREER games (the same
 *    `realCareerGamesFor`-then-`stat_GM`-fallback signal round 125/126's shrinkage fix already
 *    established as this codebase's one correct "is this a proven, decorated career" proxy),
 *    rewarding 150+/250+/350+ game careers — Tyler's own named "career milestones/games (e.g. 250+
 *    games, multiple best-and-fairests)" ask. Multiple best-and-fairests are already covered by
 *    honour #1 above (`B&F` tag, counted per year), not double-counted here.
 *
 * **Father-son / bloodline, disclosed rather than hand-waved**: this codebase has NO structured
 * father-son or bloodline flag anywhere — `Player.draft_draftType` only distinguishes
 * National/Rookie/Pre-Season/Mid-Season, and Schema.md's own Age/draft-provenance section notes
 * that real father-son and Academy selections are themselves National Draft bids in reality, not a
 * separate draft type this data model tracks. A father-son pick's draft pedigree therefore already
 * flows through `draftPedigreeBonusFor` via its (National Draft) pick number exactly like any other
 * National Draft selection — but the specific "tied to a decorated AFL family name" bloodline
 * narrative itself is NOT a separate structured input this round. Per Tyler's own explicitly allowed
 * fallback ("explicitly disclose that unstructured narrative text itself is not a formula input this
 * round, only the structured honours/pedigree signals extracted from it are"), that narrative signal
 * is disclosed-not-built rather than guessed at with a magic number.
 *
 * **The cap**: `PRESTIGE_CAP` bounds the final nudge to +/-8 raw-composite points (pre-rescale,
 * i.e. in the same units as the 20 `RATED_ATTRIBUTES`/`ovrRawComposite`'s weighted mean) — roughly
 * 0.6 standard deviations of the population's raw composite, enough to move a genuinely
 * borderline player up or down a real OVR band but never enough on its own to turn a middling
 * stat-based player into a top-10 OVR, and never enough to overturn what a real Brownlow-winning
 * STAT LINE already earns on its own (the per-game Brownlow-votes/goals/etc. inputs already feed
 * `confidence`/`xFactor`/etc. directly — this bonus is on top of that, not instead of it). In
 * practice the formula as weighted below only reaches close to the +8 cap for a small handful of
 * the most decorated real players in the database (see `scripts/verify_roundC147_scratch.ts`'s own
 * reported distribution) — nobody is designed to sit AT the cap by construction, it exists as a
 * genuine backstop, not a target.
 */

/** Weight per distinct honour-tag TYPE in `DraftHistoryEntry.awards`, applied once per real season year that tag lists. Anything not in this table (unrecognised/未-tagged text) contributes 0 — deliberately conservative rather than guessing at an unknown tag's intended weight. Exported (Round C148) so `provenTrajectory.ts` can check "does this player have ANY real recognised honour" without re-declaring the same table. */
export const HONOUR_WEIGHTS: Readonly<Record<string, number>> = {
  Brownlow: 3,
  AA: 1.5,
  Coleman: 1.5,
  "Norm Smith": 1.5,
  MVP: 1,
  "B&F": 1,
  "Rising Star": 1,
  "AFLPA 1st": 0.75,
  AFLCA: 0.75,
  Ayres: 0.75,
  Christian: 0.75,
  "AFLCA Young": 0.5,
  AA40: 0.5,
  Prem: 0.4,
};

/** `"AA: 2023, 2024; Coleman: 2022"` -> `{AA: [2023, 2024], Coleman: [2022]}` — the actual YEARS
 * listed per honour type (not just a count), so `honoursScoreFor` below can decay each one by how
 * long ago it was actually won. */
function parseAwardYears(awards: string): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  if (!awards) return out;
  for (const clause of awards.split(";")) {
    const m = /^\s*([^:]+):\s*(.+)$/.exec(clause);
    if (!m) continue;
    const label = m[1].trim();
    const years = m[2]
      .split(",")
      .map((y) => parseInt(y.trim(), 10))
      .filter((y) => !Number.isNaN(y));
    (out[label] ??= []).push(...years);
  }
  return out;
}

/** "This round," for decay purposes — the real 2026 AFL season. Exported so `provenTrajectory.ts`/verify scripts can reference the same constant rather than re-guessing it. */
export const HONOUR_DECAY_CURRENT_YEAR = 2026;

/**
 * Round C148 — [[End-of-2026 Player Database Refresh]]. Tyler's own diagnosis, confirmed directly
 * (`scripts/verify_roundC148_scratch.ts` dumps the actual before/after numbers): this function used
 * to be a flat lifetime sum with NO time-decay — a real Brownlow won in 2017 counted exactly as much
 * in 2026 as one won last year, so a decorated-but-declined veteran's prestige term never shrank,
 * permanently propping up `OVR` regardless of real current form (confirmed the actual driver of
 * Dustin Martin still reading `OVR 102` post-retirement, and a real contributor — alongside the
 * single-season-composite gap `recencyForm.ts` fixes — to Cripps/Oliver reading as "still rising").
 *
 * **The fix**: each individual honour-YEAR (not each honour TYPE) now decays exponentially by real
 * years elapsed since it was won, half-life `HONOUR_HALF_LIFE_YEARS` (6 real seasons) — a Brownlow
 * won 6 years ago contributes half its `HONOUR_WEIGHTS` weight, 12 years ago a quarter, and so on,
 * asymptoting toward (never quite reaching) zero rather than being flatly excluded — a genuine
 * career-defining honour should never read as worth literally NOTHING no matter how long ago, just
 * steadily less. This is why a merely-good current season plus a real honour won recently still
 * reads strongly (as it should), while the SAME honour a decade-plus stale contributes only a small
 * fraction of its original weight — letting current-form decline actually show through instead of
 * being permanently masked by lifetime prestige.
 *
 * **A real, disclosed side effect of moving from count-per-type to sum-per-year**: the old
 * implementation took the MAX count per honour type across a player's multiple `realDraftHistory.ts`
 * rows (guarding against the same years being repeated verbatim on more than one row). This version
 * takes the UNION of years per honour type across rows instead (a `Set`, not a `Math.max`) — strictly
 * more correct for the same reason (still never double-counts an identical year listed twice), and
 * now also correctly captures a case the old MAX-per-row logic could miss: two rows each listing a
 * DIFFERENT subset of a player's real honour years (e.g. row A lists "AA: 2023", a later re-scrape
 * row B lists "AA: 2023, 2024") — the union correctly keeps both 2023 and 2024, where the old
 * per-row max would have kept only whichever row's count was larger.
 */
const HONOUR_HALF_LIFE_YEARS = 6;

/**
 * Career honours score for a real player, decayed by real years since each honour was won (see this
 * function's own doc comment). `currentYear` defaults to `HONOUR_DECAY_CURRENT_YEAR` (this round's
 * real season) — exposed as a parameter so `historicalOvrReconstruction.ts` can reuse this exact
 * function to reconstruct what a player's prestige term would have read as of any past real season
 * (an honour won AFTER `currentYear` is excluded entirely, not decayed "backwards"). `0` for a
 * player with no real draft history row at all (the ~128-201 players — see design note — whose
 * `draft_pick` is still MODELLED), same documented fallback every other draft-history-dependent
 * formula in this codebase already uses.
 */
export function honoursScoreFor(realFullName: string | undefined, currentYear = HONOUR_DECAY_CURRENT_YEAR): number {
  if (!realFullName) return 0;
  const rows = draftHistoryFor(realFullName);
  if (rows.length === 0) return 0;
  const yearsByLabel = new Map<string, Set<number>>();
  for (const row of rows) {
    const parsed = parseAwardYears(row.awards);
    for (const [label, years] of Object.entries(parsed)) {
      if (!yearsByLabel.has(label)) yearsByLabel.set(label, new Set());
      const set = yearsByLabel.get(label)!;
      for (const y of years) set.add(y);
    }
  }
  let score = 0;
  for (const [label, years] of yearsByLabel) {
    const weight = HONOUR_WEIGHTS[label] ?? 0;
    if (weight === 0) continue;
    for (const y of years) {
      if (y > currentYear) continue; // an honour not yet won as of the year we're reconstructing
      const yearsAgo = currentYear - y;
      const decay = Math.pow(0.5, yearsAgo / HONOUR_HALF_LIFE_YEARS);
      score += weight * decay;
    }
  }
  return score;
}

/** Draft-pedigree contribution — `draftCapitalScore` (0-100) is already `POT`'s upside signal; here it's a small, separately-capped ADD to the prestige nudge, deliberately weaker than an honour actually won (see this file's own doc comment). `0` when no real draft record / unmodelled draft type exists, same fallback `draftCapitalScore` itself already documents. */
export function draftPedigreeBonusFor(p: Pick<Player, "draft_draftType" | "draft_pick">): number {
  const score = draftCapitalScore(p);
  if (score == null) return 0;
  return Math.max(0, (score - 50) / 50) * 1.5;
}

/** Career-games-played milestone contribution — Tyler's own named "career milestones/games (e.g. 250+ games)" input. Multiple best-and-fairests are covered by the `B&F` honour tag above, not here (avoids double counting the same real-world fact twice). */
export function careerMilestoneBonusFor(careerGames: number): number {
  if (careerGames >= 350) return 1.5;
  if (careerGames >= 250) return 1;
  if (careerGames >= 150) return 0.5;
  return 0;
}

/** Same real-career-games signal (real draft-history games, falling back to `stat_GM` when no real draft record exists) round 125/126's shrinkage fix established — reproduced here rather than imported from `ratingGeneration.ts` to avoid a circular import (`ratingGeneration.ts` itself will come to depend on this file's `prestigeBonusFor` indirectly via `progression.ts`). */
function careerGamesFor(p: Pick<Player, "realFullName" | "fname" | "lname" | "stat_GM">): number {
  const real = realCareerGamesFor(p.realFullName ?? `${p.fname} ${p.lname}`);
  return real ?? p.stat_GM;
}

const PRESTIGE_SCALE = 0.55;
export const PRESTIGE_CAP = 8;

/**
 * Round C150 — [[End-of-2026 Player Database Refresh]]. Tyler's own diagnosis: Max Gawn (34) and
 * Lachie Neale (33) still read artificially high, because the prestige nudge — even after Round
 * C148's per-honour-YEAR recency decay — has no notion of the PLAYER'S current age, only of how long
 * ago each individual honour was won. A player who keeps winning honours late in their career (an
 * All-Australian or Brownlow at 33/34) can therefore hold the honours term near its lifetime peak
 * indefinitely, which Tyler judged doesn't reflect reality: a lifetime of accumulated reputation
 * shouldn't fully offset the reality of playing your final real seasons, no matter how recently the
 * last honour landed.
 *
 * **The fix**: a separate, ADDITIONAL age-keyed step-function reduction — `prestigeAgeSunsetFor` —
 * applied to the final summed-and-capped prestige value, on top of (not instead of) Round C148's
 * existing per-honour recency decay. This is deliberately a discrete step function keyed on real
 * `Age`, not a continuous curve — Tyler's spec was exact ages (32/33/34), not a smooth taper:
 *   - Age 32: -2 (the sunset first kicks in here)
 *   - Age 33: an ADDITIONAL -3 on top of the age-32 step (-5 cumulative)
 *   - Age 34: an ADDITIONAL -3 on top of that (-8 cumulative)
 *   - Age <32: 0 (no sunset at all)
 * **Age 35+ interpretation (disclosed, not silently assumed)**: Tyler's spec only named ages up to
 * 34. Read literally as a "sunset," not something that reverses, 35+ holds steady at the same -8
 * cumulative reduction as age 34 rather than continuing to compound further or snapping back to 0 —
 * the most literal reading of an unspecified tail, flagged here rather than guessed at silently.
 * **The floor**: per Tyler's explicit instruction, this sunset can only reduce prestige TOWARD zero,
 * never below it, and never past the existing `PRESTIGE_CAP` in the positive direction either — an
 * old honour should never be made to actively hurt a player. The reduction is therefore applied
 * AFTER the existing honours/pedigree/milestone sum and the existing +/-8 cap, and the result is
 * re-clipped into `[0, PRESTIGE_CAP]` when the pre-sunset value was positive (a negative
 * pre-sunset value is left untouched — the sunset only trims a positive reputation bonus, it isn't a
 * new penalty in its own right; see `prestigeBonusFor` for exactly how the two combine).
 */
export function prestigeAgeSunsetFor(age: number): number {
  if (age >= 34) return 8;
  if (age === 33) return 5;
  if (age === 32) return 2;
  return 0;
}

/**
 * The full bounded prestige nudge for one player, in raw-composite points (see this file's own doc
 * comment for units and the cap rationale). Combines all three real signals above, capped at
 * `PRESTIGE_CAP`, then applies Round C150's age sunset (see `prestigeAgeSunsetFor`) on top — a
 * separate, additional reduction from Round C148's honours-recency decay, keyed on the player's
 * current real age rather than how long ago any single honour was won. Nothing here reads free-text
 * narrative directly.
 */
export function prestigeBonusFor(p: Player): number {
  const honours = honoursScoreFor(p.realFullName);
  const pedigree = draftPedigreeBonusFor(p);
  const milestone = careerMilestoneBonusFor(careerGamesFor(p));
  const raw = honours * PRESTIGE_SCALE + pedigree + milestone;
  const capped = Math.max(-PRESTIGE_CAP, Math.min(PRESTIGE_CAP, raw));
  if (capped <= 0) return capped; // sunset only trims a positive reputation bonus, never adds a penalty
  const sunset = prestigeAgeSunsetFor(p.Age);
  return Math.max(0, Math.min(PRESTIGE_CAP, capped - sunset));
}
