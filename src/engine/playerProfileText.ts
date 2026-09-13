import type { Grade } from "./seasonGrading.ts";
import type { SeasonAwards } from "./awards.ts";
import type { SeasonArchiveEntry } from "./seasonSummary.ts";

/**
 * Player Profile honours summary + write-up blurb — round 94 Part 2, [[Season Grading, Post-Season
 * Awards, and Player History]]. The design note's own Part 2 spec covers the season-by-season
 * Grade/Awards columns and club-history interleaving directly in `PlayerProfileModal.tsx`; this file
 * is the two PROSE pieces that sit on top of that data: a header "honours summary" line (Draft Guru's
 * own "Brownlow Medallist, 2x All-Australian..." convention, built here from THIS SAVE's own
 * `engine/awards.ts` winners rather than any real-world scrape) and a new, genuinely separate ask —
 * Tyler: "I also want a section which shows the 1 or 2 sentence player writeup summary on their
 * player profiles."
 *
 * **Why this isn't just `engine/records.ts`'s existing write-up machinery.** That file already has a
 * mature, tested 36/40-template write-up generator (`formatLegendWriteup`/`formatSeasonWriteup`) — but
 * every template is calibrated for a RECORDS-LEADERBOARD TOPPER ("a legend of the game," "one of the
 * competition's true greats," "stands among the all-time greats"). Reusing it verbatim for an
 * arbitrary rostered player — the large majority of whom will never top an all-time category — would
 * read absurdly for a modest 40-game role player. This file instead tiers the blurb by what this
 * round's own new data actually says about the player (their honours, their Season Grade), so the
 * TONE matches the achievement: a genuine honour or an A+/A grade reads as "decorated," a good grade or
 * a lesser honour or a long track record reads as "quality," and everyone else reads as "developing" —
 * proportionate language for every point on the quality spectrum, not just the very top of it.
 *
 * **Scope, disclosed**: deliberately does NOT fold in a real player's `distinguishingFactFor`-style
 * draft-story fact (`records.ts`) — a real player's draft story is already shown a few sections away in
 * `PlayerProfileModal.tsx`'s own existing "Draft & Club History" table, and duplicating it into this
 * blurb too would be redundant on the same page. This blurb is intentionally a SEPARATE, purely
 * achievement-and-tenure-driven read, not a retelling of the draft-night story.
 */

// ---------------------------------------------------------------------------
// Honours summary — the header "Brownlow Medallist, 2x All-Australian..." line
// ---------------------------------------------------------------------------

export type HonourKind = "brownlow" | "normSmith" | "championPlayer" | "finalsMvp" | "aaTeam" | "bestAndFairest" | "aaSquad";

/** Best-to-least prestigious — decides both display order in the summary line and which single kind stands in for "this player's headline honour" wherever only one can be shown (e.g. the profile blurb's tiering below). Disclosed, reasoned ordering, not sourced from anything exact — same status every other "real structure, no exact ranking given" ordering choice in this project gets. */
const HONOUR_PRESTIGE: readonly HonourKind[] = ["brownlow", "normSmith", "aaTeam", "championPlayer", "finalsMvp", "bestAndFairest", "aaSquad"];

/** The 5 "genuinely major" honours — winning any of these is enough on its own to read as a decorated career (see `profileTierFor`). Best & Fairest (a CLUB-level award) and All-Australian Squad-only (explicitly a lesser distinction than making the final Team, see `engine/awards.ts`'s own `AA_SQUAD_QUOTA`/`AA_TEAM_QUOTA` split) are deliberately excluded — real honours, just not by themselves "decorated-career" evidence. */
const MAJOR_HONOUR_KINDS: ReadonlySet<HonourKind> = new Set(["brownlow", "normSmith", "championPlayer", "finalsMvp", "aaTeam"]);

const HONOUR_SINGULAR: Record<HonourKind, string> = {
  brownlow: "Brownlow Medallist",
  normSmith: "Norm Smith Medallist",
  championPlayer: "Champion Player",
  finalsMvp: "Finals MVP",
  aaTeam: "All-Australian",
  bestAndFairest: "Best & Fairest",
  aaSquad: "All-Australian Squad",
};

/** Short tags for a single season's own table cell — see `awardTagsFor` below. A different (shorter) register from `HONOUR_SINGULAR`'s prose labels, same "don't overload one string for two display jobs" convention this codebase already follows elsewhere (e.g. `realDraftHistory.ts`'s full award text vs. `draftTierOf`'s compact pill labels). */
const HONOUR_TAG: Record<HonourKind, string> = {
  brownlow: "Brownlow",
  normSmith: "Norm Smith",
  championPlayer: "Champion Player",
  finalsMvp: "Finals MVP",
  aaTeam: "AA Team",
  bestAndFairest: "B&F",
  aaSquad: "AA Squad",
};

function formatHonourCount(kind: HonourKind, count: number): string {
  const label = HONOUR_SINGULAR[kind];
  return count <= 1 ? label : `${count}x ${label}`;
}

export interface SimHonoursSummary {
  /** "Brownlow Medallist, 2x All-Australian, Norm Smith Medallist" — `null` if this player has never won anything tracked here across `seasonArchives`. */
  text: string | null;
  /** The single most prestigious kind found, or `null` — decides `profileTierFor`'s tone without needing to re-scan every kind a second time. */
  bestKind: HonourKind | null;
  /** `bestKind` is one of the 5 `MAJOR_HONOUR_KINDS` — convenience flag, same value `profileTierFor` derives internally, exposed here so a caller doesn't have to import `MAJOR_HONOUR_KINDS` just to ask this one question. */
  isMajor: boolean;
}

/**
 * Scans every archived season's `awards` for one player, tallies how many times they won each of the 7
 * kinds, and renders a Draft-Guru-style de-duplicated, count-qualified summary line — the design note's
 * own spec: "built by scanning every archived season's awards for this player and de-duplicating into
 * count-qualified labels." `undefined`/missing `archive.awards` (any archive from before round 94) is
 * simply skipped, same "old data doesn't retroactively gain fields" rule every other optional
 * round-94-and-later field in this codebase already follows — there is no way to know what a
 * pre-round-94 season's awards WOULD have been, so none are invented.
 *
 * All-Australian is counted carefully to avoid double-crediting the same season twice: `allAustralianTeam`
 * is a SUBSET of `allAustralianSquad` (`engine/awards.ts`'s own doc comment), so a Team selection is
 * counted as `aaTeam` only — `aaSquad` only accrues for a season where this player made the Squad but
 * NOT the final Team, the genuinely lesser distinction.
 *
 * Deliberately SIM-side only (this save's own `engine/awards.ts` winners) — a real player's separate,
 * already-displayed real-world draftguru honours (`PlayerProfileModal.tsx`'s existing "Career Honours"
 * section) are a different provenance entirely and are never merged in here; the caller labels this
 * line ("In this save:") precisely so the two are never mistaken for one another.
 */
export function simHonoursSummaryFor(playerId: number, seasonArchives: readonly SeasonArchiveEntry[]): SimHonoursSummary {
  const counts = new Map<HonourKind, number>();
  const bump = (k: HonourKind) => counts.set(k, (counts.get(k) ?? 0) + 1);

  for (const archive of seasonArchives) {
    const a = archive.awards;
    if (!a) continue;
    if (a.brownlowMedal?.playerIds.includes(playerId)) bump("brownlow");
    if (a.normSmith?.playerId === playerId) bump("normSmith");
    if (a.championPlayer?.playerIds.includes(playerId)) bump("championPlayer");
    if (a.finalsMvp?.playerIds.includes(playerId)) bump("finalsMvp");
    if (a.allAustralianTeam.includes(playerId)) bump("aaTeam");
    else if (a.allAustralianSquad.includes(playerId)) bump("aaSquad");
    if (Object.values(a.bestAndFairest).some((w) => w.playerIds.includes(playerId))) bump("bestAndFairest");
  }

  if (counts.size === 0) return { text: null, bestKind: null, isMajor: false };
  const present = HONOUR_PRESTIGE.filter((k) => counts.has(k));
  const text = present.map((k) => formatHonourCount(k, counts.get(k)!)).join(", ");
  const bestKind = present[0];
  return { text, bestKind, isMajor: MAJOR_HONOUR_KINDS.has(bestKind) };
}

/**
 * Short per-season award tags for the Career & Season Stats table's own Awards column (one row per
 * year, not aggregated across a career the way `simHonoursSummaryFor` is) — e.g. `["Brownlow", "AA
 * Team"]` for a genuine clean-sweep season. Empty array (not `null`) for a season with no wins,
 * matching this codebase's general "empty collection, not a sentinel" convention for a table cell.
 */
export function awardTagsFor(playerId: number, awards: SeasonAwards): string[] {
  const tags: string[] = [];
  if (awards.brownlowMedal?.playerIds.includes(playerId)) tags.push(HONOUR_TAG.brownlow);
  if (awards.normSmith?.playerId === playerId) tags.push(HONOUR_TAG.normSmith);
  if (awards.allAustralianTeam.includes(playerId)) tags.push(HONOUR_TAG.aaTeam);
  else if (awards.allAustralianSquad.includes(playerId)) tags.push(HONOUR_TAG.aaSquad);
  if (awards.championPlayer?.playerIds.includes(playerId)) tags.push(HONOUR_TAG.championPlayer);
  if (awards.finalsMvp?.playerIds.includes(playerId)) tags.push(HONOUR_TAG.finalsMvp);
  if (Object.values(awards.bestAndFairest).some((w) => w.playerIds.includes(playerId))) tags.push(HONOUR_TAG.bestAndFairest);
  return tags;
}

// ---------------------------------------------------------------------------
// Profile write-up blurb — Tyler's "1 or 2 sentence player writeup summary"
// ---------------------------------------------------------------------------

export type ProfileTier = "decorated" | "quality" | "developing";

/**
 * Tone tier for the profile blurb — see this file's own top doc comment for why this exists instead of
 * reusing `records.ts`'s leaderboard-calibrated templates. A major honour OR an A+/A Season Grade reads
 * as "decorated" regardless of games played (a short, brilliant stretch is still genuinely decorated);
 * short of that, a minor honour (B&F/AA Squad), a B+/B grade, or simply a long track record (60+ games,
 * this project's own `MIN_GAMES_FOR_CAREER_BEST`-adjacent "a real sample" bar — see `development.ts`)
 * reads as "quality"; everything else, including a player with zero games yet, reads as "developing."
 */
export function profileTierFor(bestKind: HonourKind | null, grade: Grade | undefined, gamesPlayed: number): ProfileTier {
  const hasMajorHonour = bestKind !== null && MAJOR_HONOUR_KINDS.has(bestKind);
  const hasTopGrade = grade === "A+" || grade === "A";
  if (hasMajorHonour || hasTopGrade) return "decorated";

  const hasMinorHonour = bestKind !== null; // major already excluded above, so any remaining kind is B&F/AA Squad
  const hasGoodGrade = grade === "B+" || grade === "B";
  if (hasMinorHonour || hasGoodGrade || gamesPlayed >= 60) return "quality";

  return "developing";
}

/** "a" before a consonant-sounding grade (B, C, D), "an" before a vowel-sounding one (A, A+, E) — grade letters read aloud, not spelled out, so E ("ee") needs "an" too. */
function articleFor(grade: Grade): "a" | "an" {
  return grade === "A" || grade === "A+" || grade === "E" ? "an" : "a";
}

/** `honoursText`/`grade`'s combined "here's the headline" clause — falls back gracefully when a decorated-tier player has an A+/A grade but no NAMED award (Season Grade is a rolling-rating percentile, genuinely independent of any vote-based award), and again (defensively; `profileTierFor` should never actually reach "decorated" without one of the two) when neither is present. */
function achievementPhraseFor(honoursText: string | null, grade: Grade | undefined): string {
  if (honoursText) return honoursText;
  if (grade) return `${articleFor(grade)} ${grade} Season Grade at their peak`;
  return "a genuinely strong recent run of form";
}

interface BlurbFrag {
  name: string;
  archetype: string;
  club: string;
  gamesPlayed: number;
  achievement: string;
  /** ", grading as high as a B+ along the way" — empty string when no grade is known yet. */
  gradeSuffix: string;
  /** "14 games into their career" / "yet to make their senior debut" — precomputed once so every "developing"-tier template can use it uniformly regardless of whether `gamesPlayed` is 0. */
  gamesPhrase: string;
}

const DECORATED_TEMPLATES: readonly ((f: BlurbFrag) => string)[] = [
  (f) => `${f.name} has been one of the standout ${f.archetype}s in the competition, headlined by ${f.achievement} across ${f.gamesPlayed} games for ${f.club}.`,
  (f) => `A genuine star at ${f.club}, ${f.name} has ${f.achievement} to show for a decorated career as a ${f.archetype}.`,
  (f) => `${f.name} has cemented their name at ${f.club} — ${f.achievement} across ${f.gamesPlayed} games and counting.`,
  (f) => `Few ${f.archetype}s can match what ${f.name} has done at ${f.club}: ${f.achievement} headlines a genuinely elite career.`,
  (f) => `There's little debate about ${f.name}'s standing at ${f.club} — ${f.achievement} says it all for this ${f.archetype}.`,
];

const QUALITY_TEMPLATES: readonly ((f: BlurbFrag) => string)[] = [
  (f) => `${f.name} is a reliable ${f.archetype} for ${f.club}, ${f.gamesPlayed} games into a solid career.`,
  (f) => `${f.club} lean on ${f.name} as a genuine ${f.archetype} option — ${f.gamesPlayed} games of consistent footy so far.`,
  (f) => `${f.name} has quietly built a dependable career at ${f.club}${f.gradeSuffix}.`,
  (f) => `A trusted name in ${f.club}'s side, ${f.name} has racked up ${f.gamesPlayed} games as a ${f.archetype}.`,
  (f) => `${f.name} has developed into a genuine contributor at ${f.club}, with ${f.gamesPlayed} games as a ${f.archetype} under their belt.`,
];

const DEVELOPING_TEMPLATES: readonly ((f: BlurbFrag) => string)[] = [
  (f) => `${f.name} is still writing their story at ${f.club} — a ${f.archetype} the club will be watching closely as they develop, ${f.gamesPhrase}.`,
  (f) => `Early days for ${f.name} at ${f.club}; the ${f.archetype} tools are there, ${f.gamesPhrase}.`,
  (f) => `${f.name} is a developing ${f.archetype} for ${f.club}, ${f.gamesPhrase} and building a case with every outing.`,
  (f) => `${f.club} added ${f.name} as a ${f.archetype} prospect — ${f.gamesPhrase}, with the runway still ahead of them.`,
  (f) => `${f.name}'s time at ${f.club} is just beginning, ${f.gamesPhrase} as a ${f.archetype} worth checking back in on.`,
];

/** Simple deterministic string hash (djb2-ish) — same "same input always maps to the same template index" role as `records.ts`'s own local `hashKey`, duplicated here rather than imported: a generic string-hash utility isn't worth coupling this file to `records.ts` for. */
function hashKey(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export interface ProfileBlurbInput {
  name: string;
  archetype: string;
  club: string;
  gamesPlayed: number;
  /** This player's Season Grade — pass `highestGradeFor`'s own result (career-best across the save, live season included) so the blurb reflects their peak, same "peak, not current dip" framing the header's own "Highest Grade" stat uses. */
  grade?: Grade;
  honours: SimHonoursSummary;
}

/**
 * The profile's own "1 or 2 sentence player writeup summary" — Tyler's exact ask, worded generally
 * enough ("player profiles") that this is built to work identically for a real or a sim rostered
 * player; the only inputs are this save's own honours/grade/games data, all equally meaningful for
 * either. Deterministic per player (same `hashKey`-seeded selection every other template pool in this
 * codebase uses) so the same player reads the same way across renders, not re-randomized each render.
 */
export function profileSummaryFor(input: ProfileBlurbInput): string {
  const tier = profileTierFor(input.honours.bestKind, input.grade, input.gamesPlayed);
  const frag: BlurbFrag = {
    name: input.name,
    archetype: input.archetype,
    club: input.club,
    gamesPlayed: input.gamesPlayed,
    achievement: achievementPhraseFor(input.honours.text, input.grade),
    gradeSuffix: input.grade ? `, grading as high as ${articleFor(input.grade)} ${input.grade} along the way` : "",
    gamesPhrase: input.gamesPlayed > 0 ? `${input.gamesPlayed} game${input.gamesPlayed === 1 ? "" : "s"} into their career` : "yet to make their senior debut",
  };
  const templates = tier === "decorated" ? DECORATED_TEMPLATES : tier === "quality" ? QUALITY_TEMPLATES : DEVELOPING_TEMPLATES;
  const idx = hashKey(`${input.name}|profile-summary`) % templates.length;
  return templates[idx](frag);
}
