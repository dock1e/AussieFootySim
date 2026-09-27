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
 * KNOWN NAME-COLLISION, DELIBERATELY SKIPPED (see the Round C143d addendum below for how this was
 * actually resolved — it was never a real join-key collision in this file's own `realFullName`
 * key, just an unexplained gap until footywire research closed it out): "Bailey Williams" /
 * "Bailey J. Williams" — Schema.md
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
 *
 * ROUND C143b ADDENDUM (8 more confirmed entries, same day): Tyler supplied one directly-confirmed
 * fact and 7 more sourced from a full (not flat-merged) fetch of draftguru.com.au's 2024
 * `/years/2024/retirements-delistings` page:
 *
 * - **Nat Fyfe (Fremantle, retired 2025)** is the one directly-confirmed case, and it surfaced a
 *   real join-failure worth flagging for future rounds: Round C143's flat-list join required an
 *   EXACT `realFullName` string match and missed him because draftguru.com.au's source page lists
 *   him as **"Nathan Fyfe"**, while `players_master.csv`'s `realFullName` for this player is
 *   **"Nat Fyfe"** (confirmed directly against the CSV, not assumed). This is a genuine name-variant
 *   mismatch, not a data-quality bug — legal/formal first name vs. common name is a real class of
 *   join failure this exact-match strategy will keep hitting (other likely variants: "Nathan"/"Nat",
 *   "Bradley"/"Brad", "Anthony"/"Tony", etc.). Flagged here as a candidate for a future
 *   fuzzy-match or alias-table pass — deliberately NOT built this round, just documented so it isn't
 *   rediscovered from scratch later.
 * - **7 more exact-realFullName matches** — Brad Crouch, Andrew Gaff, Dyson Heppell, Zach Tuohy
 *   (all `'Retired'`, 2024), and Curtis Taylor, Zane Trew, Alex Witherden (all `'Delisted'`, 2024) —
 *   found by fetching the 2024 draftguru.com.au page directly (not the flat multi-year merge Round
 *   C143 used) and cross-referencing by exact name against the `real2026SeasonStats.ts` gap set.
 *   Unlike the 93 Round C143 rows, these 7 preserve a real per-name year (2024) and a real
 *   Retired-vs-Delisted split, because the direct per-year page fetch (rather than the flat merged
 *   hand-off) retains that information — a small proof-of-concept for the "revisit the original
 *   per-year pages directly" follow-up Round C143 itself proposed above.
 *
 * ROUND C143c ADDENDUM (23 more confirmed entries, cross-referencing the SAME draftguru.com.au 2024
 * page already used for Round C143b, this time a fuller pass): Tyler cross-referenced all 38
 * players Round C143b left as genuinely unresolved against the same
 * `https://www.draftguru.com.au/years/2024/retirements-delistings` page (no new research, no new
 * source — same page, fuller pass, matches identified by exact line position: the Retirements table
 * is every row before the page's "Delistings" heading, the Delistings table is every row after it)
 * and found 23 more exact `realFullName` matches with precise per-name dates and clubs: Alex Keath,
 * Brandon Ellis, Charlie Dixon, Dustin Martin, Dylan Grimes, Jaidyn Stephenson, Jarryd Lyons, Joe
 * Daniher, Marlion Pickett, and Tom Hawkins (all `'Retired'`, 2024), and Brandan Parfitt, Ethan
 * Hughes, Gary Rohan, Jamaine Jones, Josh Rotham, Lachlan Gollant, Luke Edwards, Matthew Taberner,
 * Ned McHenry, Patrick Parnell, Sebastian Ross, Tom Emmett, and Will Hamill (all `'Delisted'`,
 * 2024). Notably this resolves several names Round C143's own doc comment had flagged as "more
 * likely a `real2026SeasonStats.ts` extraction/name-matching gap than a genuine absence" (Joe
 * Daniher, Dustin Martin, Tom Hawkins) — they turn out to be genuine real-world retirements after
 * all, not extraction gaps; that speculation is superseded by this round's confirmed source rows.
 * Like the Round C143b 7, these entries carry a real per-name year (2024) and a real
 * Retired-vs-Delisted split (not the generic `'Delisted'`/`year: 2026` placeholder the original 93
 * Round C143 rows use).
 *
 * ROUND C143d ADDENDUM (footywire.com research on the final 15 names Round C143c left unresolved):
 * Tyler used footywire.com's live current-players list (https://www.footywire.com/afl/footy/
 * ft_players) plus individual player profile/bio pages to research all 15 remaining names,
 * including the "Bailey J. Williams" collision case. A first, useful negative result: ALL 15 names
 * are present on footywire's current 2026 roster list — none of them have actually left the league
 * (no undiscovered retirement/delisting among the 15). Four came back as genuine, sourceable
 * `RosterMovementEntry` cases:
 *
 * - **Lachlan Sholl (Adelaide)** — Delisted, 2026. footywire's own player-biography page (dated
 *   Thu 17 Sep 2026) reads: "Adelaide delists Chayce Jones, Lachie Sholl and Tyler Welsh." This is
 *   a real, very recent (post-2026-season) Adelaide delisting batch that fell in the tail of the
 *   2026 draftguru delistings table Round C143's original flat-list fetch was already suspected of
 *   truncating before reaching Adelaide's section — this footywire find confirms that suspicion
 *   rather than resolving it via draftguru itself. The same bio names two more Adelaide delistings
 *   the same day:
 *   - **Chayce Jones** — also added below as Delisted, 2026, Adelaide, same source. He DOES already
 *     carry a real 2026 `real2026SeasonStats.ts` row (3 games) — not a contradiction: a player can
 *     genuinely play part of a season and still be delisted at its end. `applyRosterMovements.ts`
 *     only ever writes the 4 real-status columns, never touching `stat_*`, so this is safe.
 *   - **Tyler Welsh** — checked against `players_master.csv` by exact name and NOT found at all (no
 *     row under that name). Not added; skipped rather than guessed at. If this player belongs in the
 *     751-player pool under a different name spelling, that's a separate future join-gap, not
 *     assumed here.
 * - **Sam Sturt (Fremantle)** — Injured, 2026, hamstring. footywire's live player-profile "Status"
 *   field reads "Hamstring injury, Expected return: TBC," and his stats page shows 0 games played
 *   for the 2026 season — treated as season-ending in effect (out all year) even though footywire's
 *   own return-estimate field says "TBC" rather than an explicit "Season" designation the way the
 *   SEN Injury Hub sources phrase it elsewhere in this file. Round C143's own doc comment had
 *   already flagged his listing as "hamstring | TBC, not season-ending" and left him unresolved —
 *   this footywire profile page is the missing piece that closes that out.
 * - **Sid Draper (Adelaide)** — Injured, 2026, groin. footywire's player-biography page (dated Thu
 *   15 Jan 2026) quotes Crows coaching director Murray Davis: "Sid Draper remains on light training
 *   duties as he continues to rehab a groin issue," and his stats page shows 0 games played in 2026
 *   — consistent with a season-long injury.
 * - **Tom Doedee (Brisbane Lions)** — Injured, `year: 2024` (when the injury actually happened, not
 *   2026), knee/ACL. footywire's bio: a third ACL reconstruction in March 2024 ("Tom Doedee's AFL
 *   comeback is cruelly denied... tore his anterior cruciate ligament for a third time"), with a
 *   follow-up March 2025 bio entry saying he was "on the verge of returning to play in his first
 *   game in over a year" — but he still shows 0 games played in 2026, meaning that comeback kept
 *   being delayed and he remains out as of this round (see this row's own `detail` field for that
 *   2026-still-out note). Unlike every other `'Injured'` row in this file (all season-scoped to
 *   2026), this is this file's first genuinely multi-year chronic-injury case — `year` records when
 *   the injury itself occurred, not an implied single season out.
 *
 * **Lance Collard (St Kilda) — deliberately left WITHOUT a `RosterMovementEntry`.** footywire's bio
 * page reveals a real, already-adjudicated 2026 AFL Tribunal/Appeals Board disciplinary matter (a
 * guilty finding for a homophobic slur toward an opponent, a sought 10-game suspension for a second
 * such offence reduced on appeal to a 4-match suspension with 2 of those 4 suspended into the
 * following year) — stated here factually and neutrally as a matter of public record, not
 * editorialized. A 4-match suspension only partially explains his 0 games played across the ~19+
 * rounds of the 2026 season taken alone — he'd still have been available for the other rounds — so
 * Round C143d disclosed this as a partial explanation only, not a resolved case.
 *
 * ROUND C143g CLOSURE: Tyler directly confirmed "Consider Lance Collard a fringe player as well. He
 * won't be reselected after his tribunal suspension." Combining the documented Tribunal suspension
 * above with Tyler's judgment call that he won't be recalled to the senior side, Collard is now
 * folded into the same closed/explained fringe-player cohort as the 8 names below — a real,
 * still-technically-active AFL list player who is effectively fringe and won't manage a 2026 senior
 * game, not a formal roster movement. `RosterMovementType` still has no `'Suspended'` case, and one
 * still isn't warranted for a single partially-explanatory data point; he stays implicitly `'Active'`
 * (no entry, `realStatus` blank), same as the other 8. See the Round C143f/g fringe-player addendum
 * below for the full cohort.
 *
 * **"Bailey Williams" / "Bailey J. Williams" — the apparent collision is RESOLVED, not just
 * re-confirmed.** footywire confirms both are real, distinct, fully active 2026 players who each
 * played all 19 games of the season: Bailey Williams (Western Bulldogs, #34, born 10 Oct 1997,
 * 2015 National Draft pick 48, 193 career games) and Bailey J. Williams (West Coast, #32, born 17
 * Apr 2000, 2018 National Draft pick 35, 107 career games). Investigating `players_master.csv`
 * itself (not just Schema.md's prior SuperCoach-spreadsheet note) found the "collision" was never
 * actually present in THIS project's own join key: the CSV already carries them as two distinct
 * rows with two distinct `fname` values — West Coast's row has `fname: "Bailey J."` and Western
 * Bulldogs' has `fname: "Bailey"` — so `realFullName` (`fname + " " + lname`) is already
 * "Bailey J. Williams" vs. "Bailey Williams", two different strings, not one ambiguous name. Every
 * lookup in this codebase (`real2026StatsFor`, `rosterMovementsFor`) is keyed on exact `realFullName`
 * string match, so neither one was ever at risk of resolving to the other player's data — nothing
 * a club-aware tiebreaker needed to fix. Schema.md's prior note describes a DIFFERENT, narrower
 * problem: an external SuperCoach spreadsheet's own "Bailey J. Williams" row couldn't be safely
 * matched against the CSV using name alone in THAT pass, so it was left unmatched there — a
 * one-off external-source join gap, not a defect in this project's own `realFullName` key. The real,
 * remaining reason West Coast's "Bailey J. Williams" still shows up in the `real2026SeasonStats.ts`
 * 157-player gap set is a plain data-completeness gap: he has no row in that file at all, despite
 * playing all 19 real 2026 games per footywire — an extraction gap in the Round C142 stat pull, not
 * a name-collision bug. Deliberately NOT fixed by fabricating a stats row this round (footywire's
 * profile page confirms games played but this round didn't capture his full 23-column per-game stat
 * line) — flagged as a concrete, scoped follow-up for a future round (re-pull his row from the same
 * "AFL 2026 Players DB" spreadsheet Round C142 used, or footywire's own per-game stats table) rather
 * than left as a vague "collision." No `RosterMovementEntry` is added for either name — both are
 * confirmedly `'Active'` — so he mechanically still appears in any "157-gap-set minus
 * `rosterMovementsFor`" computation; that's now a documented, understood data-completeness gap, not
 * an unexplained one.
 *
 * Total after Round C143d: 147 non-Active players (111 Delisted, 21 Injured, 15 Retired) of 751.
 *
 * ROUND C143e ADDENDUM (1 additional entry, Darcy Macpherson — the one name Round C143d's own
 * footywire research brief accidentally missed from the 15-name unresolved list, disclosed in that
 * round's addendum above): checked directly against footywire.com's current 2026 players list
 * (https://www.footywire.com/afl/footy/ft_players) via a JS search across every `pp-` player-profile
 * link on the page — confirmed absent, with the fetch itself corroborated as working correctly by
 * other similar names ("Davies, Hugh", "Draper, Josh") resolving fine in the same pass. Per Tyler's
 * own stated rule for this round — "if they're not on this page then they're no longer active and
 * were delisted" — added as `'Delisted'`, club Gold Coast (per `players_master.csv`), `year: 2026`
 * as a disclosed best estimate (he was presumably still active earlier in 2026, per his presence in
 * the `real2026SeasonStats.ts`/gap-set data derived from mid-2026 sources, so the delisting itself
 * is real but its precise date is not known). This is a NEW, THIRD sourcing method for this file,
 * distinct from the other two: unlike a draftguru.com.au retirements/delistings table (which names a
 * player directly) or a footywire.com bio page (which states a reason in prose), this entry's only
 * evidence is the player's ABSENCE from a live current-roster snapshot — no dated quote, no explicit
 * "delisted" statement anywhere. Every other entry in this file can point to a source that names the
 * player; this one infers status from silence. Flagged here, not blended in, so a future reader
 * doesn't mistake it for having the same evidentiary strength as the dated rows around it.
 *
 * Total after Round C143e: 148 non-Active players (112 Delisted, 21 Injured, 15 Retired) of 751.
 *
 * ROUND C143f CORRECTION to the above: the `year: 2026` inferred-from-absence estimate for Darcy
 * Macpherson was wrong. Tyler confirmed directly that he was delisted in 2024, not 2026 — the row's
 * `year` has been corrected to 2024 and its `source` updated accordingly (see the entry itself).
 * This doesn't change the non-Active head-count (still 148 of 751; he was already counted as
 * Delisted), only the year on this one row.
 *
 * ROUND C143f ADDENDUM (fringe-player cohort closure, no new `RosterMovementEntry` rows): Tyler
 * directly confirmed (2026-09-27) the following 8 names — the remaining entries from Round C143d's
 * "genuinely unexplained" gap-set list, EXCLUDING Lance Collard (at the time, a documented separate
 * partial-suspension explanation — see ROUND C143g below, now folded into this same cohort) and
 * Bailey J. Williams (data-completeness gap, resolved this round in `real2026SeasonStats.ts`
 * instead) — as: "Consider each of these players fringe players who didn't manage to play an AFL
 * game in 2026." They are real, currently-active AFL list players (confirmed present on
 * footywire.com's live current-players list as of Round C143d) who simply have very few career
 * games and did not get a senior game in the real 2026 season — NOT retirements, delistings, or
 * injuries. Per Tyler's instruction this is a closed, explained category: **Alex Dodson, Clay Hall,
 * Cooper Simpson, Hugh Davies, Josh Draper, Lucca Grego, Luke Beecken, Tyrell Dewar.** Deliberately
 * NO `RosterMovementEntry` is added for any of these 8 — they remain `'Active'` (`realStatus`
 * blank/undefined), same as any other player with no recorded movement.
 *
 * ROUND C143g ADDENDUM (Lance Collard joins the cohort, now 9 names): Tyler directly confirmed
 * "Consider Lance Collard a fringe player as well. He won't be reselected after his tribunal
 * suspension." Combining his already-documented Tribunal/Appeals Board suspension (see the Lance
 * Collard note above) with Tyler's judgment that he won't be recalled to the senior side, Collard
 * moves from "documented partial-explanation, still technically open" into this same closed/
 * explained category as the other 8 — a real, still-technically-active AFL list player who is
 * effectively fringe and won't manage a 2026 senior game. The cohort is now **Alex Dodson, Clay
 * Hall, Cooper Simpson, Hugh Davies, Josh Draper, Lucca Grego, Luke Beecken, Tyrell Dewar, and Lance
 * Collard (9 names)**. Same as the other 8, deliberately NO `RosterMovementEntry` is added for
 * Collard — he remains `'Active'` (`realStatus` blank/undefined). This note exists purely so a
 * future round doesn't re-open this as an open research item: the whole 9-name cohort is closed,
 * documentation-only, no data change.
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
  // --- Round C143b: 8 additional confirmed entries (see file-level Round C143b addendum below) ---
  // Nat Fyfe's real-world retirement was confirmed directly by Tyler, but the original Round C143
  // flat-list join (which required an EXACT `realFullName` string match, no fuzzy/nickname
  // matching) missed him: draftguru.com.au's source page lists him as "Nathan Fyfe", while
  // `players_master.csv`'s `realFullName` for this player is "Nat Fyfe" (confirmed by direct CSV
  // lookup below). This is a genuine name-variant mismatch, not a data error — flagged here as a
  // known class of future join failure (full legal first name vs. common name, "Nathan" vs. "Nat",
  // etc.) worth a fuzzy/alias-table pass in a future round; not built now, just documented.
  { realFullName: "Nat Fyfe", type: "Retired", year: 2025, club: "Fremantle", source: "draftguru.com.au 2025 retirements (listed as 'Nathan Fyfe')" },
  // 7 more confirmed via a full fetch (not the flat merged list) of draftguru.com.au's 2024
  // `/years/2024/retirements-delistings` page, cross-referenced by exact `realFullName` against the
  // real2026SeasonStats.ts 157-player gap set — genuine exact-name matches, not fuzzy.
  { realFullName: "Brad Crouch", type: "Retired", year: 2024, club: "St Kilda", source: "draftguru.com.au 2024 retirements, Nov 26 2024 (also listed Oct 31 2024 across two site edits)" },
  { realFullName: "Andrew Gaff", type: "Retired", year: 2024, club: "West Coast", source: "draftguru.com.au 2024 retirements, Aug 7 2024" },
  { realFullName: "Dyson Heppell", type: "Retired", year: 2024, club: "Essendon", source: "draftguru.com.au 2024 retirements, Aug 13 2024" },
  { realFullName: "Zach Tuohy", type: "Retired", year: 2024, club: "Geelong", source: "draftguru.com.au 2024 retirements, Aug 21 2024" },
  { realFullName: "Curtis Taylor", type: "Delisted", year: 2024, club: "North Melbourne", source: "draftguru.com.au 2024 delistings, Sep 20 2024" },
  { realFullName: "Zane Trew", type: "Delisted", year: 2024, club: "West Coast", source: "draftguru.com.au 2024 delistings, Sep 18 2024" },
  { realFullName: "Alex Witherden", type: "Delisted", year: 2024, club: "West Coast", source: "draftguru.com.au 2024 delistings, Oct 18 2024" },

  // --- Round C143c: 23 additional confirmed entries (see file-level Round C143c addendum above) ---
  // Same draftguru.com.au 2024 `/years/2024/retirements-delistings` page Round C143b already used,
  // a fuller pass over the SAME page rather than new research: cross-referenced all 38 players
  // Round C143b left genuinely unresolved and found these 23 as exact realFullName matches, with
  // table membership (Retired vs. Delisted) determined by line position on the page — Retirements
  // table = every row before the "Delistings" heading, Delistings table = every row after it.
  { realFullName: "Alex Keath", type: "Retired", year: 2024, club: "Western Bulldogs", source: "draftguru.com.au 2024 retirements, Oct 21 2024" },
  { realFullName: "Brandon Ellis", type: "Retired", year: 2024, club: "Gold Coast", source: "draftguru.com.au 2024 retirements, Jul 31 2024" },
  { realFullName: "Charlie Dixon", type: "Retired", year: 2024, club: "Port Adelaide", source: "draftguru.com.au 2024 retirements, Sep 25 2024" },
  { realFullName: "Dustin Martin", type: "Retired", year: 2024, club: "Richmond", source: "draftguru.com.au 2024 retirements, Aug 6 2024" },
  { realFullName: "Dylan Grimes", type: "Retired", year: 2024, club: "Richmond", source: "draftguru.com.au 2024 retirements, Aug 20 2024" },
  { realFullName: "Jaidyn Stephenson", type: "Retired", year: 2024, club: "North Melbourne", source: "draftguru.com.au 2024 retirements, Oct 29 2024" },
  { realFullName: "Jarryd Lyons", type: "Retired", year: 2024, club: "Brisbane", source: "draftguru.com.au 2024 retirements, Sep 13 2024" },
  { realFullName: "Joe Daniher", type: "Retired", year: 2024, club: "Brisbane", source: "draftguru.com.au 2024 retirements, Oct 3 2024" },
  { realFullName: "Marlion Pickett", type: "Retired", year: 2024, club: "Richmond", source: "draftguru.com.au 2024 retirements, Aug 22 2024" },
  { realFullName: "Tom Hawkins", type: "Retired", year: 2024, club: "Geelong", source: "draftguru.com.au 2024 retirements, Aug 6 2024" },
  { realFullName: "Brandan Parfitt", type: "Delisted", year: 2024, club: "Geelong", source: "draftguru.com.au 2024 delistings, Sep 24 2024" },
  { realFullName: "Ethan Hughes", type: "Delisted", year: 2024, club: "Fremantle", source: "draftguru.com.au 2024 delistings, Sep 11 2024" },
  { realFullName: "Gary Rohan", type: "Delisted", year: 2024, club: "Geelong", source: "draftguru.com.au 2024 delistings, Sep 24 2024" },
  { realFullName: "Jamaine Jones", type: "Delisted", year: 2024, club: "West Coast", source: "draftguru.com.au 2024 delistings, Sep 18 2024" },
  { realFullName: "Josh Rotham", type: "Delisted", year: 2024, club: "West Coast", source: "draftguru.com.au 2024 delistings, Oct 21 2024" },
  { realFullName: "Lachlan Gollant", type: "Delisted", year: 2024, club: "Adelaide", source: "draftguru.com.au 2024 delistings, Oct 4 2024" },
  { realFullName: "Luke Edwards", type: "Delisted", year: 2024, club: "West Coast", source: "draftguru.com.au 2024 delistings, Oct 31 2024" },
  { realFullName: "Matthew Taberner", type: "Delisted", year: 2024, club: "Fremantle", source: "draftguru.com.au 2024 delistings, Sep 11 2024" },
  { realFullName: "Ned McHenry", type: "Delisted", year: 2024, club: "Adelaide", source: "draftguru.com.au 2024 delistings, Oct 4 2024" },
  { realFullName: "Patrick Parnell", type: "Delisted", year: 2024, club: "Adelaide", source: "draftguru.com.au 2024 delistings, Oct 4 2024" },
  { realFullName: "Sebastian Ross", type: "Delisted", year: 2024, club: "St Kilda", source: "draftguru.com.au 2024 delistings, Aug 29 2024" },
  { realFullName: "Tom Emmett", type: "Delisted", year: 2024, club: "Fremantle", source: "draftguru.com.au 2024 delistings, Oct 25 2024" },
  { realFullName: "Will Hamill", type: "Delisted", year: 2024, club: "Adelaide", source: "draftguru.com.au 2024 delistings, Oct 4 2024" },


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

  // --- Round C143d: 4 additional confirmed entries from footywire.com research on the final 15
  // names Round C143c left unresolved (see file-level Round C143d addendum above for full detail,
  // including why "Bailey Williams"/"Bailey J. Williams" and Lance Collard deliberately get NO
  // entry here). ---
  { realFullName: "Lachlan Sholl", type: "Delisted", year: 2026, club: "Adelaide", source: "footywire.com player biography, Thu 17 Sep 2026: 'Adelaide delists Chayce Jones, Lachie Sholl and Tyler Welsh'" },
  { realFullName: "Chayce Jones", type: "Delisted", year: 2026, club: "Adelaide", source: "footywire.com player biography, Thu 17 Sep 2026: 'Adelaide delists Chayce Jones, Lachie Sholl and Tyler Welsh' (he also has a real 2026 real2026SeasonStats.ts row — 3 games — played part of the season before being delisted at its end, not a contradiction)" },
  { realFullName: "Sam Sturt", type: "Injured", year: 2026, club: "Fremantle", detail: "hamstring (footywire Status field: 'Expected return: TBC', treated as season-ending — 0 games played in 2026)", source: "footywire.com player profile, live Status field + 2026 season stats page (0 games)" },
  { realFullName: "Sid Draper", type: "Injured", year: 2026, club: "Adelaide", detail: "groin (season-ending)", source: "footywire.com player biography, Thu 15 Jan 2026: Crows coaching director Murray Davis — 'Sid Draper remains on light training duties as he continues to rehab a groin issue'" },
  { realFullName: "Tom Doedee", type: "Injured", year: 2024, club: "Brisbane Lions", detail: "knee/ACL — third ACL reconstruction, suffered March 2024; a March 2025 bio update said he was 'on the verge of returning' but he still shows 0 games played in 2026, so he remains out as of this round", source: "footywire.com player biography (March 2024 and March 2025 entries)" },

  // --- Round C143e: 1 additional entry, via a DIFFERENT sourcing method than every row above.
  // Every other 'Delisted'/'Retired' row in this file is sourced either from a draftguru.com.au
  // retirements/delistings table (which names a specific player as retired/delisted, sometimes with
  // a precise date) or from a footywire.com bio page that explicitly states a delisting/injury in
  // prose. Darcy Macpherson is different: he was accidentally omitted from Round C143d's 15-name
  // footywire research brief (a disclosed miss in that round's own addendum), so this round checked
  // him directly against footywire.com's current 2026 players list
  // (https://www.footywire.com/afl/footy/ft_players) and confirmed — via a JS search across every
  // `pp-` player-profile link on the page, with the page load itself corroborated by other names
  // ("Davies, Hugh", "Draper, Josh") resolving correctly in the same fetch — that he is NOT present
  // anywhere on that current-players list. Per Tyler's own stated rule for this round ("if they're
  // not on this page then they're no longer active and were delisted"), his absence itself is the
  // evidence, not a bio page or a retirements/delistings table naming him. `year: 2026` here is a
  // disclosed best estimate (the year this absence was detected), not a precise delisting date —
  // unlike the draftguru-sourced or bio-dated entries above, no more specific date is available for
  // this one, because the method is "absence from a live current-roster snapshot," which carries no
  // date information the way a dated bio quote or a per-year retirements table does.
  { realFullName: "Darcy Macpherson", type: "Delisted", year: 2024, club: "Gold Coast", detail: "delisted in 2024", source: "confirmed by Tyler directly (2026-09-27 correction) — delisted in 2024, not 2026 as originally inferred from footywire absence." },
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
