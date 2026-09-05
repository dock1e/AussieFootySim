/**
 * Real, dated external recruiter power-ranking data — a corroboration signal
 * for the write-up-prose scouting tier mechanism in `realProspects.ts`
 * (`scoutingProseSignalFor`/`potentialFloorFromProse`, round 77, retightened
 * round 78). Added round 79, prompted directly by Tyler flagging that Gabe
 * (Gabriel) Patterson reads "Superstar" in-game despite real recruiters
 * ranking him dead last of a 45-player published list — see
 * `realProspects.ts`'s own doc comment on `applyExternalConsensusFloor` for
 * the full diagnosis and fix this data enables.
 *
 * **Source**: zerohanger.com, "AFL Draft: September Power Rankings" by Jonty
 * Ralphsmith, published 3 September 2026.
 * https://www.zerohanger.com/afl-draft-september-power-rankings-181994/
 * (paginated ~5 players per page, counting down from rank 45 to rank 1
 * across 9 pages — `.../181994/`, `.../181994/2/`, ... `.../181994/9/`). All
 * 45 ranks fetched and transcribed directly from the live article this
 * round; the article's own words: "The September list has expanded to 45
 * players."
 *
 * **Coverage, fully disclosed**: only 34 of these 45 real names resolve to
 * an existing `RealProspectRecord` in our DB. `matchedRecordName` is `null`
 * for the other 11 — never guessed at. Two kinds of non-match: genuinely
 * absent from our DB entirely (Dougie Cochrane, Heath Mellody, Leo Steed,
 * Harvey Spawton-Guy, Koby LeCras, Jack Slattery, Memphis Webb — 7 names,
 * consistent with this project's established "disclosed as pending, not
 * invented" posture whenever a real name has no underlying record to attach
 * to), and an unresolvable surname collision with a DIFFERENT, already-
 * existing same-surname player (Mitch Harris, Kodah Edwards, George Gale,
 * Harry Chapman — 4 more Harrises/Edwardses/Gales/Chapmans already exist in
 * the DB under different first names; rather than guess which one, if any,
 * is a first-name variant of the zerohanger name, these stay unmatched).
 * Two matches ARE a confirmed first-name/nickname variant, not a guess:
 * "Gabe Patterson" -> "Gabriel Patterson" (exact write-up cross-match, see
 * realProspects.ts), "Khaled El Souki" -> "Khaled El souki" (same name, a
 * lowercase typo in the DB's own stored casing).
 */
export interface DraftPowerRanking {
  rank: number;
  /** Name exactly as printed in the zerohanger article. */
  name: string;
  /** The `RealProspectRecord.name` this resolves to, or null if genuinely/safely unresolved — see this file's own doc comment. */
  matchedRecordName: string | null;
}

export const ZEROHANGER_SEPT_2026_RANKINGS: readonly DraftPowerRanking[] = [
  { rank: 1, name: "Dougie Cochrane", matchedRecordName: null },
  { rank: 2, name: "Arki Butler", matchedRecordName: "Arki Butler" },
  { rank: 3, name: "Cody Walker", matchedRecordName: "Cody Walker" },
  { rank: 4, name: "Gus Teixeira", matchedRecordName: "Gus Teixeira" },
  { rank: 5, name: "Harry Van Hattum", matchedRecordName: "Harry Van Hattum" },
  { rank: 6, name: "Heath Mellody", matchedRecordName: null },
  { rank: 7, name: "Ethan Drever", matchedRecordName: "Ethan Drever" },
  { rank: 8, name: "Ethan Matthews", matchedRecordName: "Ethan Matthews" },
  { rank: 9, name: "Leo Steed", matchedRecordName: null },
  { rank: 10, name: "Mitch Harris", matchedRecordName: null },
  { rank: 11, name: "Caylen Murray", matchedRecordName: "Caylen Murray" },
  { rank: 12, name: "Clancy Snell", matchedRecordName: "Clancy Snell" },
  { rank: 13, name: "Wil Malady", matchedRecordName: "Wil Malady" },
  { rank: 14, name: "Kodah Edwards", matchedRecordName: null },
  { rank: 15, name: "Sam Gayfer", matchedRecordName: "Sam Gayfer" },
  { rank: 16, name: "Jake Eime", matchedRecordName: "Jake Eime" },
  { rank: 17, name: "George Gale", matchedRecordName: null },
  { rank: 18, name: "Ethan Herbert", matchedRecordName: "Ethan Herbert" },
  { rank: 19, name: "Tyson Bradley", matchedRecordName: "Tyson Bradley" },
  { rank: 20, name: "George Dimer", matchedRecordName: "George Dimer" },
  { rank: 21, name: "Toby Krasna", matchedRecordName: "Toby Krasna" },
  { rank: 22, name: "Marlon Neocleous", matchedRecordName: "Marlon Neocleous" },
  { rank: 23, name: "Noah Williams", matchedRecordName: "Noah Williams" },
  { rank: 24, name: "Jack Pickett", matchedRecordName: "Jack Pickett" },
  { rank: 25, name: "Khaled El Souki", matchedRecordName: "Khaled El souki" },
  { rank: 26, name: "Lochie Burrows", matchedRecordName: "Lochie Burrows" },
  { rank: 27, name: "Harvey Spawton-Guy", matchedRecordName: null },
  { rank: 28, name: "Harry Chapman", matchedRecordName: null },
  { rank: 29, name: "Darcy Szerszyn", matchedRecordName: "Darcy Szerszyn" },
  { rank: 30, name: "Jackson Phillips", matchedRecordName: "Jackson Phillips" },
  { rank: 31, name: "Koby LeCras", matchedRecordName: null },
  { rank: 32, name: "Keenan Boi", matchedRecordName: "Keenan Boi" },
  { rank: 33, name: "Jack Slattery", matchedRecordName: null },
  { rank: 34, name: "Jordan Knapp", matchedRecordName: "Jordan Knapp" },
  { rank: 35, name: "Albert MacGowan", matchedRecordName: "Albert MacGowan" },
  { rank: 36, name: "Gus Kennedy", matchedRecordName: "Gus Kennedy" },
  { rank: 37, name: "Memphis Webb", matchedRecordName: null },
  { rank: 38, name: "Cody Templeton", matchedRecordName: "Cody Templeton" },
  { rank: 39, name: "Hugh McCallum", matchedRecordName: "Hugh McCallum" },
  { rank: 40, name: "Xavier Ladbrook", matchedRecordName: "Xavier Ladbrook" },
  { rank: 41, name: "Wil Antrobus", matchedRecordName: "Wil Antrobus" },
  { rank: 42, name: "Billy Wigmore", matchedRecordName: "Billy Wigmore" },
  { rank: 43, name: "Blake Justice", matchedRecordName: "Blake Justice" },
  { rank: 44, name: "Archie Elliott", matchedRecordName: "Archie Elliott" },
  { rank: 45, name: "Gabe Patterson", matchedRecordName: "Gabriel Patterson" },
];

/**
 * Cal Twomey's mid-2026 Top 25 (ingested piecemeal across rounds 70-73 as
 * real write-up screenshots Tyler sent by hand — see ROADMAP.md's own round
 * 70/71/73 sections) turns out, on inspection, to be a confirmed SUBSET of
 * the 45 names above: every one of its 25 names also appears in the
 * zerohanger list, so it adds no independently-ranked names — only a
 * second, independent real source corroborating that those ~25 belong near
 * the top of this draft class. Recorded here as a plain membership set
 * (its own internal #8-25 order was never captured, only #1-7 — see
 * ROADMAP.md round 73 — so it isn't reconstructed as a second ranked list).
 * Gabriel Patterson's absence from this list too — exactly as Tyler
 * reported ("not mentioned at all in Cal Twomeys top 25") — is a second,
 * independent corroboration of his zerohanger rank of 45/45.
 */
export const CAL_TWOMEY_MID_2026_TOP_25: ReadonlySet<string> = new Set([
  "Clancy Snell", "Wil Malady", "Jackson Phillips", "Noah Williams", "Tyson Bradley",
  "Lochie Burrows", "Toby Krasna", "George Dimer", "Marlon Neocleous", "Ethan Matthews",
  "Sam Gayfer", "Caylen Murray", "Jack Pickett", "Khaled El souki", "Jake Eime",
  "Cody Walker", "Arki Butler", "Gus Teixeira", "Harry Van Hattum", "Ethan Drever",
]);
