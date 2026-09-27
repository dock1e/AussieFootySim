/**
 * Round C143 — [[End-of-2026 Player Database Refresh]] roster-movement backfill. A GENERALIZED,
 * extensible event log of real-world AFL list changes, keyed on `Player.realFullName` (the same
 * frozen join key `realDraftHistory.ts`/`real2026SeasonStats.ts` use — see that field's own doc
 * comment in `types/player.ts` for why this must never be the LIVE `fname`/`lname` pair: Tyler's
 * disclosed future plan to scramble player/club names for AFL licensing protection means this file
 * has to keep working after a full rename pass, and `realFullName` is exactly the field designed
 * to survive that).
 *
 * WHY THIS EXISTS NOW rather than waiting: the real 2026 AFL National Draft, trade period, and
 * free agency period have NOT happened yet in the real world as of this round (Sep 27 2026) — they
 * are still upcoming. Rather than write another one-off ingestion script once that data lands
 * later this year, this round builds the reusable data model + pipeline now, proven against the
 * real 2024-2026 retirement/delisting/injury data that IS already available: `RosterMovementType`
 * below deliberately includes `'Drafted' | 'Traded' | 'FreeAgencySigning'` even though no rows of
 * those types exist yet — adding that future data is meant to be "append rows here, re-run
 * `scripts/applyRosterMovements.ts`," not new plumbing.
 *
 * TWO SOURCES FEED THIS ROUND'S DATA:
 *
 * 1. **18 confirmed real 2026 season-ending injuries** among the 41 players who had no real 2026
 *    senior AFL stat row (`real2026SeasonStats.ts`'s 157-player gap, round C142) but also weren't
 *    explained by a retirement/delisting (see #2 below). Sourced from SEN.com.au's "AFL 2026
 *    Injury Hub: Saints recruit a chance to face old mob" (club-by-club injury list, last updated
 *    04/08/2026 per club) at
 *    https://www.sen.com.au/news/2026/01/22/afl-2026-injury-hub-returning-players-your-clubs-injury-list,
 *    cross-checked against AFL.com.au's "Medical room: The full AFL injury list, Grand Final"
 *    (dated Sep 23 2026) at https://www.afl.com.au/news/1619440/copy-medical-room-the-full-afl-injury-list-pf,
 *    which independently corroborates Jack Payne and Henry Smith still carrying "Season" status
 *    through to the Grand Final. Tom Green, Josh Kelly, and Nic Martin were also confirmed directly
 *    by Tyler. All 18 are marked genuinely season-ending, not just a multi-week estimate.
 *
 * 2. **Real 2024-2026 retirements/delistings**, sourced from draftguru.com.au's `/years/<YYYY>/
 *    retirements-delistings` pages (2024, 2025, and 2026 editions). Tyler supplied a flat,
 *    ~200-name list merging all 3 years' tables WITHOUT preserving which year, which club, or
 *    Retired-vs-Delisted for each name (a real limitation of the source hand-off, disclosed here
 *    rather than guessed past). This file's own build step (see `/tmp`-style one-off join used to
 *    produce the array below — reproducible via any script joining that flat list against
 *    `players_master.csv`'s `realFullName` values and `real2026StatsFor`'s 157-player gap set)
 *    found **93 of those ~200 names** land inside the 157-gap set and match a current
 *    `players_master.csv` player by EXACT `realFullName` string (no fuzzy/nickname matching
 *    attempted, per Tyler's own instruction) — not the ~116 Tyler's own prior research estimated.
 *    That gap is disclosed, not papered over: Tyler's 116 figure most likely came from a broader
 *    or manual matching pass run directly against the original per-year draftguru pages (which may
 *    have used per-name year/club context, or accepted safe nickname variants, that the merged
 *    flat list handed to this round doesn't preserve) — a future round revisiting the original
 *    per-year pages directly, rather than this consolidated flat list, could close that gap
 *    further. Every one of these 93 is typed `'Delisted'` rather than split into Retired/Delisted:
 *    the original per-table breakdown (which draftguru table each name came from) was not
 *    preserved in the flat hand-off, so 'Delisted' is used as the disclosed generic placeholder
 *    (the more common real-world case of the two) rather than fabricating which table a name came
 *    from. `year: 2026` on every one of these 93 rows is similarly a disclosed placeholder (the
 *    year this backfill batch was researched/ingested), NOT a claim that all 93 retired/were
 *    delisted specifically in calendar 2026 — the source list spans 2024-2026 with no
 *    per-name year preserved. Refining both the Retired/Delisted split and the real per-name year
 *    is an open follow-up, noted in the design note addendum and ROADMAP.md.
 *
 * KNOWN NAME-COLLISION, DELIBERATELY SKIPPED: "Bailey Williams" / "Bailey J. Williams" — Schema.md
 * (the "SuperCoach trend recalibration" section) already documents that `players_master.csv`
 * genuinely contains two different real Bailey Williamses (West Coast's "Bailey J. Williams" and
 * Western Bulldogs' "Bailey Williams") that a prior round deliberately left unmatched rather than
 * guess which is which. Neither name is included in `REAL_ROSTER_MOVEMENTS` below, for the same
 * reason (and, as it happens, neither the West Coast nor Bulldogs Bailey Williams matched this
 * round's strict join anyway — West Coast's "Bailey J. Williams" IS in the 157-gap set but is not
 * on the flat retirement/delisting list under that exact name, and Bulldogs' "Bailey Williams" has
 * a real 2026 stat row and was never in the gap set to begin with).
 *
 * The remaining ~24 players in the 157-gap set are neither a confirmed injury nor a retirement/
 * delisting match — of those, Tyler's own research named 22 as still fully unexplained as of this
 * round (see `real2026StatsFor`'s own gap-set commentary and the design note for the full list);
 * a further handful (e.g. "Joe Daniher", "Dustin Martin") are well-known current players whose gap
 * membership is more likely a `real2026SeasonStats.ts` extraction/name-matching gap than a genuine
 * absence — also disclosed as open, not guessed at. None of these players are given a
 * `RosterMovementEntry` here; they stay implicitly `'Active'` (no entry = no status change) until a
 * future round resolves them one way or the other.
 */

export type RosterMovementType =
  | "Retired"
  | "Delisted"
  | "Injured"
  // Not used by any row yet — included now so the real 2026 draft/trade/free-agency period,
  // once it concludes in the real world, is ingested by adding rows of these types and re-running
  // `scripts/applyRosterMovements.ts`, not by inventing new plumbing under time pressure later.
  | "Drafted"
  | "Traded"
  | "FreeAgencySigning";

export interface RosterMovementEntry {
  /** Matched against `Player.realFullName` — same join-key discipline as `realDraftHistory.ts`/`real2026SeasonStats.ts`. */
  realFullName: string;
  type: RosterMovementType;
  /** The real-world year this movement is recorded against. See the file-level doc comment for the disclosed year-precision gap on the 93 retirement/delisting backfill rows. */
  year: number;
  /** Club at time of movement, when known/relevant. Omitted for the retirement/delisting backfill rows (not preserved in the flat source hand-off). */
  club?: string;
  /** e.g. an injury type ("knee"), or "delisted" / "retired". */
  detail?: string;
  /** Short citation for where this row's status came from. */
  source: string;
}

/** SEN.com.au's "AFL 2026 Injury Hub" (club-by-club list, last updated 04/08/2026), cross-checked against AFL.com.au's Sep 23 2026 Grand Final "Medical room" injury list — see file-level doc comment for both URLs. */
const INJURY_HUB_SOURCE = "SEN Injury Hub 04/08/2026 (cross-checked AFL.com.au Medical Room, Sep 23 2026)";

/**
 * draftguru.com.au's 2024/2025/2026 `/years/<YYYY>/retirements-delistings` pages, merged into one
 * flat name list by Tyler and joined against `players_master.csv` here — see file-level doc
 * comment for the disclosed Retired-vs-Delisted and per-name-year gaps this source carries.
 */
const RETIREMENT_DELISTING_SOURCE = "draftguru.com.au 2024-2026 retirements/delistings (year/type sub-classification not preserved in this round's flat source list)";

export const REAL_ROSTER_MOVEMENTS: RosterMovementEntry[] = [
  // --- 18 confirmed real 2026 season-ending injuries ---
  { realFullName: "Tom Green", type: "Injured", year: 2026, club: "GWS Giants", detail: "knee (season-ending)", source: `${INJURY_HUB_SOURCE} — also confirmed directly by Tyler` },
  { realFullName: "Josh Kelly", type: "Injured", year: 2026, club: "GWS Giants", detail: "hip (season-ending)", source: `${INJURY_HUB_SOURCE} — also confirmed directly by Tyler` },
  { realFullName: "Nic Martin", type: "Injured", year: 2026, club: "Essendon", detail: "knee (season-ending)", source: `${INJURY_HUB_SOURCE} — also confirmed directly by Tyler` },
  { realFullName: "Jack Payne", type: "Injured", year: 2026, club: "Brisbane Lions", detail: "knee (season-ending)", source: INJURY_HUB_SOURCE },
  { realFullName: "Henry Smith", type: "Injured", year: 2026, club: "Brisbane Lions", detail: "foot (season-ending)", source: INJURY_HUB_SOURCE },
  { realFullName: "Jesse Motlop", type: "Injured", year: 2026, club: "Carlton", detail: "knee (season-ending)", source: INJURY_HUB_SOURCE },
  { realFullName: "Harry O'Farrell", type: "Injured", year: 2026, club: "Carlton", detail: "knee (season-ending)", source: INJURY_HUB_SOURCE },
  { realFullName: "Darcy Jones", type: "Injured", year: 2026, club: "GWS Giants", detail: "knee (season-ending)", source: INJURY_HUB_SOURCE },
  { realFullName: "Jed Adams", type: "Injured", year: 2026, club: "Melbourne", detail: "knee (season-ending)", source: INJURY_HUB_SOURCE },
  { realFullName: "Jackson Archer", type: "Injured", year: 2026, club: "North Melbourne", detail: "knee (season-ending)", source: INJURY_HUB_SOURCE },
  { realFullName: "Sam Powell-Pepper", type: "Injured", year: 2026, club: "Port Adelaide", detail: "training block (soft-tissue/conditioning, treated as season-ending)", source: INJURY_HUB_SOURCE },
  { realFullName: "Josh Sinn", type: "Injured", year: 2026, club: "Port Adelaide", detail: "shoulder (season-ending)", source: INJURY_HUB_SOURCE },
  { realFullName: "Tom Sims", type: "Injured", year: 2026, club: "Richmond", detail: "toe (season-ending)", source: INJURY_HUB_SOURCE },
  { realFullName: "Elliott Himmelberg", type: "Injured", year: 2026, club: "Gold Coast Suns", detail: "knee (season-ending)", source: INJURY_HUB_SOURCE },
  { realFullName: "Noah Long", type: "Injured", year: 2026, club: "West Coast Eagles", detail: "knee (season-ending)", source: INJURY_HUB_SOURCE },
  { realFullName: "Riley Garcia", type: "Injured", year: 2026, club: "Western Bulldogs", detail: "hamstring (season-ending)", source: INJURY_HUB_SOURCE },
  { realFullName: "Reef McInnes", type: "Injured", year: 2026, club: "Collingwood", detail: "knee (season-ending)", source: INJURY_HUB_SOURCE },
  { realFullName: "Lewis Hayes", type: "Injured", year: 2026, club: "Essendon", detail: "knee (season-ending)", source: INJURY_HUB_SOURCE },

  // --- 93 real 2024-2026 retirements/delistings (strict exact-realFullName join against the
  // 157-player real2026SeasonStats.ts gap set — see file-level doc comment for the disclosed
  // Retired-vs-Delisted and per-name-year gaps). Alphabetical by realFullName. ---
  { realFullName: "Aaron Francis", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Alex Cincotta", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Alex Sexton", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Angus McLennan", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Anthony Scott", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Arie Schoenmaker", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Ben Hobbs", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Ben Paton", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Bobby Hill", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Brandon Ryan", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Brodie Smith", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Brynn Teakle", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Caleb Mitchell", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Caleb Poulter", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Callan Ward", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Callum Jamieson", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Cameron Guthrie", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Charlie Dean", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Chris Burgess", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Darcy Tucker", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "David Swallow", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Dom Sheed", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Dylan Shiel", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Dylan Williams", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Geordie Payne", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Harry Boyd", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Hugh Jackson", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Ivan Soldo", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Jack Billings", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Jack Henderson", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Jack Petruccelle", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Jacob Bauer", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Jacob Blight", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Jacob Koschitzke", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "James Aish", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "James Harmes", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Jason Johannisen", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Jaxon Binns", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Jayden Hunt", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Jed Bews", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Jed McEntee", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Jeremy Finlayson", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Jeremy McGovern", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Jimmy Webster", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Jye Menzie", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Kaleb Smith", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Kallan Dawson", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Kamdyn McIntosh", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Kieran Strachan", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Lachlan Keeffe", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Lachlan Murphy", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Liam Jones", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Liam McMahon", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Luamon Lual", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Lucas Camporeale", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Luke Breust", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Mani Liddy", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Matt Crouch", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Michael Walters", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Mitch Duncan", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Oleg Markov", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Orazio Fantasia", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Oscar McInerney", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Oskar Smartt", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Quinton Narkle", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Robbie Fox", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Robert Hansen", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Rory Atkins", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Ryan Burton", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Sam Day", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Sam Docherty", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Sam Frost", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Seamus Mitchell", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Sean Lemmens", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Steven May", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Taj Woewodin", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Taylor Adams", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Taylor Duryea", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Ted Clohesy", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Thomson Dow", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Todd Goldstein", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Tom Berry", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Tom Fullarton", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Tom Mitchell", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Travis Boak", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Tyler Brockman", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Tyson Stengle", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Will Hoskin-Elliott", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Will Phillips", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Will White", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Willie Rioli", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Zaine Cordy", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
  { realFullName: "Zak Jones", type: "Delisted", year: 2026, source: RETIREMENT_DELISTING_SOURCE },
];

let byName: Map<string, RosterMovementEntry[]> | null = null;

/**
 * All roster-movement entries for a real player, matched by exact `Player.realFullName`.
 * Returns `undefined` for a player with no recorded movement (implicitly `'Active'`) — same
 * "absence means the default case" idiom as `real2026StatsFor`. A player can carry more than one
 * entry over time (e.g. drafted, then years later delisted); `applyRosterMovements.ts` is
 * responsible for picking the most recent by `year` when writing `Player.realStatus`.
 */
export function rosterMovementsFor(realFullName: string): RosterMovementEntry[] | undefined {
  if (!byName) {
    byName = new Map();
    for (const entry of REAL_ROSTER_MOVEMENTS) {
      const list = byName.get(entry.realFullName) ?? [];
      list.push(entry);
      byName.set(entry.realFullName, list);
    }
  }
  return byName.get(realFullName);
}
