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
 *    honours callout. Each distinct honour TYPE is counted once per real season it was won (a
 *    repeated tag like "AA: 2023, 2024, 2025, 2026" counts 4), weighted by `HONOUR_WEIGHTS` below —
 *    Brownlow (the game's own highest individual honour) weighted heaviest, full All-Australian
 *    blazers/Coleman/Norm Smith next, then best-and-fairest/Rising Star/AFLPA-1st-tier honours,
 *    then the lesser AA40 (wider 40-man squad, not the actual 23-man team) and flag-only
 *    Premiership tags lightest (a flag is a team honour with a large lucky/context component, not
 *    pure individual quality — included at low weight rather than left out entirely, since Tyler's
 *    own brief explicitly names "Norm Smith Medal + premiership tags... already tagged" as an input).
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

/** Weight per distinct honour-tag TYPE in `DraftHistoryEntry.awards`, applied once per real season year that tag lists. Anything not in this table (unrecognised/未-tagged text) contributes 0 — deliberately conservative rather than guessing at an unknown tag's intended weight. */
const HONOUR_WEIGHTS: Readonly<Record<string, number>> = {
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

/** `"AA: 2023, 2024; Coleman: 2022"` -> `{AA: 2, Coleman: 1}` — a plain count of years listed per honour type, not a lookup of what year it is now (Tyler's own steer: pedigree/honours are lifetime signals here, not "won it recently"). */
function parseAwardCounts(awards: string): Record<string, number> {
  const counts: Record<string, number> = {};
  if (!awards) return counts;
  for (const clause of awards.split(";")) {
    const m = /^\s*([^:]+):\s*(.+)$/.exec(clause);
    if (!m) continue;
    const label = m[1].trim();
    const years = m[2]
      .split(",")
      .map((y) => y.trim())
      .filter(Boolean);
    counts[label] = (counts[label] ?? 0) + years.length;
  }
  return counts;
}

/**
 * Career honours score for a real player, merged across every `realDraftHistory.ts` row that
 * mentions them (a player traded/delisted-and-rerookied has more than one row — see that file's own
 * file-level caveat — and each row's `awards` text is a cumulative-to-scrape-time snapshot, so this
 * takes the MAX count per honour type across rows rather than summing, avoiding double-counting the
 * same honour years repeated verbatim on more than one row). `0` for a player with no real draft
 * history row at all (the ~128-201 players — see design note — whose `draft_pick` is still
 * MODELLED), same documented fallback every other draft-history-dependent formula in this codebase
 * already uses.
 */
export function honoursScoreFor(realFullName: string | undefined): number {
  if (!realFullName) return 0;
  const rows = draftHistoryFor(realFullName);
  if (rows.length === 0) return 0;
  const merged: Record<string, number> = {};
  for (const row of rows) {
    const counts = parseAwardCounts(row.awards);
    for (const [label, n] of Object.entries(counts)) {
      merged[label] = Math.max(merged[label] ?? 0, n);
    }
  }
  let score = 0;
  for (const [label, n] of Object.entries(merged)) {
    score += (HONOUR_WEIGHTS[label] ?? 0) * n;
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
 * The full bounded prestige nudge for one player, in raw-composite points (see this file's own doc
 * comment for units and the cap rationale). Combines all three real signals above; nothing here
 * reads free-text narrative directly.
 */
export function prestigeBonusFor(p: Player): number {
  const honours = honoursScoreFor(p.realFullName);
  const pedigree = draftPedigreeBonusFor(p);
  const milestone = careerMilestoneBonusFor(careerGamesFor(p));
  const raw = honours * PRESTIGE_SCALE + pedigree + milestone;
  return Math.max(-PRESTIGE_CAP, Math.min(PRESTIGE_CAP, raw));
}
