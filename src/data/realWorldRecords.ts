/**
 * Real-world VFL/AFL all-time record data — Aug 2026, [[Records]]'s own AFL-wide tier (games,
 * career goals) widened here into full top-100 ranked lists specifically so `engine/records.ts`
 * can merge them against AussieFootySim's own simulated `allTimePlayerTotals` into one combined
 * leaderboard. This supersedes [[Records]]'s own prior design-note stance ("no modelled player
 * should ever 'hold' a real Tony Lockett-tier record — that would misrepresent modelled data as
 * real") — Tyler's own explicit ask this round is exactly that comparison, so this file is now the
 * source of truth for the real side of it. See [[Records]] for the full 22-category real-history
 * reference (Brownlow, Coleman, All-Australian, etc.) — this file only widens the two categories
 * Tyler named concretely (career goals, career games) from that note's own top-10 excerpts to a
 * full top 100, since a merged leaderboard needs the whole list, not just the headline names.
 *
 * Sourced directly from afltables.com's own all-time leaderboards (the same primary source
 * [[Records]] already used), scraped via a live browser session this round:
 *   - https://afltables.com/afl/stats/alltime/careergoals.html (career goals)
 *   - https://afltables.com/afl/stats/alltime/highs.html (career games)
 * Both lists are frozen at the moment they were fetched (Aug 2026) — they do NOT update as the
 * real 2026 AFL season continues, the same "real-world reference snapshot" convention [[Records]]
 * itself already uses. A real, load-bearing correction made this round: Records.md's own prior
 * note (researched earlier in Aug 2026) had Scott Pendlebury's games tally at 437 — re-verified
 * fresh this round directly against afltables.com and confirmed at 442, matching Tyler's own
 * figure exactly. Real AFL games record tallies move week to week for an active player; always
 * prefer a fresh check over an older cached figure.
 *
 * `bio` (career span, clubs, still-active status, full write-up ingredients) is populated ONLY for
 * the top 3 of each category — the scope Tyler asked for ("for the top 3, an option to see a brief
 * write up"). Verified individually against each player's own afltables.com career-summary page
 * (not just the leaderboard row) for the top 3, since a write-up needs exact start/end years and
 * every club they played for, not just a season-count. Ranks 4-100 intentionally carry no `bio` —
 * the merged leaderboard only shows their name and value, same as afl.com.au's own Stats Leaders
 * list does for anyone outside its own "brief write-up" spotlight.
 */

export interface RealWorldRecordEntry {
  name: string;
  /** Career total for whichever category this entry belongs to — goals for `REAL_WORLD_CAREER_GOALS`, games for `REAL_WORLD_GAMES_PLAYED`. */
  value: number;
  bio?: {
    /** Career games played — for the games-played list this always equals `value`; kept as its own field so `engine/records.ts`'s `formatLegendWriteup` has one consistent shape for both categories. */
    games: number;
    startYear: number;
    /** The last year they appeared, real or (for a still-active player) simply the year this data was frozen. Superseded by `stillActive` in the generated write-up when true. */
    endYear: number;
    stillActive: boolean;
    startClub: string;
    endClub: string;
  };
}

/** Real-world career goalkicking leaders, top 100, VFL/AFL history 1897-2026. */
export const REAL_WORLD_CAREER_GOALS: RealWorldRecordEntry[] = [
  { name: "Tony Lockett", value: 1360, bio: { games: 281, startYear: 1983, endYear: 2002, stillActive: false, startClub: "St Kilda", endClub: "Sydney" } },
  { name: "Gordon Coventry", value: 1299, bio: { games: 306, startYear: 1920, endYear: 1937, stillActive: false, startClub: "Collingwood", endClub: "Collingwood" } },
  { name: "Jason Dunstall", value: 1254, bio: { games: 269, startYear: 1985, endYear: 1998, stillActive: false, startClub: "Hawthorn", endClub: "Hawthorn" } },
  { name: "Lance Franklin", value: 1066 },
  { name: "Doug Wade", value: 1057 },
  { name: "Gary Ablett (Sr)", value: 1031 },
  { name: "Jack Titus", value: 970 },
  { name: "Matthew Lloyd", value: 926 },
  { name: "Leigh Matthews", value: 915 },
  { name: "Peter McKenna", value: 874 },
  { name: "Bernie Quinlan", value: 817 },
  { name: "Matthew Richardson", value: 800 },
  { name: "Tom Hawkins", value: 796 },
  { name: "Jack Riewoldt", value: 787 },
  { name: "Kevin Bartlett", value: 778 },
  { name: "Jeremy Cameron", value: 775 },
  { name: "Saverio Rocca", value: 748 },
  { name: "Barry Hall", value: 746 },
  { name: "Stephen Kernahan", value: 738 },
  { name: "Bill Mohr", value: 735 },
  { name: "Wayne Carey", value: 727 },
  { name: "Peter Hudson", value: 727 },
  { name: "Josh Kennedy", value: 723 },
  { name: "Harry Vallence", value: 722 },
  { name: "Nick Riewoldt", value: 718 },
  { name: "Taylor Walker", value: 712 },
  { name: "Dick Lee", value: 707 },
  { name: "Matthew Pavlich", value: 700 },
  { name: "Bob Pratt", value: 681 },
  { name: "Jack Moriarty", value: 662 },
  { name: "Eddie Betts", value: 640 },
  { name: "Alastair Lynch", value: 633 },
  { name: "David Neitz", value: 631 },
  { name: "Michael Moncrieff", value: 629 },
  { name: "Brendan Fevola", value: 623 },
  { name: "Jack Gunston", value: 613 },
  { name: "Michael Roach", value: 607 },
  { name: "Stewart Loewe", value: 594 },
  { name: "Jonathan Brown", value: 594 },
  { name: "Kelvin Templeton", value: 593 },
  { name: "Jack Darling", value: 592 },
  { name: "Tony Modra", value: 588 },
  { name: "Jarryd Roughead", value: 578 },
  { name: "Simon Madden", value: 575 },
  { name: "Simon Beasley", value: 575 },
  { name: "Richard Osborne", value: 574 },
  { name: "Stephen Milne", value: 574 },
  { name: "Norm Smith", value: 572 },
  { name: "Paul Salmon", value: 561 },
  { name: "Brad Johnson", value: 558 },
  { name: "Chris Grant", value: 554 },
  { name: "Luke Breust", value: 553 },
  { name: "Peter Daicos", value: 549 },
  { name: "Warren Tredrea", value: 549 },
  { name: "Fraser Gehrig", value: 549 },
  { name: "Dick Harris", value: 548 },
  { name: "Lindsay White", value: 540 },
  { name: "John Coleman", value: 537 },
  { name: "Brian Taylor", value: 527 },
  { name: "Daniel Bradshaw", value: 524 },
  { name: "Michael O'Loughlin", value: 521 },
  { name: "Brent Harvey", value: 518 },
  { name: "Steve Johnson", value: 516 },
  { name: "Peter Sumich", value: 514 },
  { name: "John Longmire", value: 511 },
  { name: "Tom Lynch", value: 508 },
  { name: "Bill Hutchison", value: 496 },
  { name: "Charlie Cameron", value: 486 },
  { name: "Jeff Farmer", value: 483 },
  { name: "Paul Hudson", value: 479 },
  { name: "John Peck", value: 475 },
  { name: "Jock Spencer", value: 475 },
  { name: "Keith Forbes", value: 475 },
  { name: "Scott Lucas", value: 471 },
  { name: "Terry Daniher", value: 469 },
  { name: "Dermott Brereton", value: 464 },
  { name: "Adam Goodes", value: 464 },
  { name: "Sel Murray", value: 461 },
  { name: "Albert Pannam", value: 459 },
  { name: "Garry Wilson", value: 452 },
  { name: "Travis Cloke", value: 452 },
  { name: "Toby Greene", value: 450 },
  { name: "Gary Ablett (Jr)", value: 445 },
  { name: "Robert Walls", value: 444 },
  { name: "Alex Jesaulenko", value: 444 },
  { name: "Malcolm Blight", value: 444 },
  { name: "Drew Petrie", value: 444 },
  { name: "Jack Dyer", value: 443 },
  { name: "Jimmy Freake", value: 442 },
  { name: "Dick Reynolds", value: 442 },
  { name: "Alan Ruthven", value: 442 },
  { name: "Bill Brownless", value: 441 },
  { name: "Mark LeCras", value: 441 },
  { name: "Jake Stringer", value: 440 },
  { name: "Alan Noonan", value: 434 },
  { name: "Roger Merrett", value: 433 },
  { name: "Russell Robertson", value: 428 },
  { name: "Garry Lyon", value: 426 },
  { name: "Lou Richards", value: 423 },
  { name: "Jason Akermanis", value: 421 },
];

/** Real-world career games-played leaders, top 100, VFL/AFL history 1897-2026. */
export const REAL_WORLD_GAMES_PLAYED: RealWorldRecordEntry[] = [
  { name: "Scott Pendlebury", value: 442, bio: { games: 442, startYear: 2006, endYear: 2026, stillActive: true, startClub: "Collingwood", endClub: "Collingwood" } },
  { name: "Brent Harvey", value: 432, bio: { games: 432, startYear: 1996, endYear: 2016, stillActive: false, startClub: "North Melbourne", endClub: "North Melbourne" } },
  { name: "Michael Tuck", value: 426, bio: { games: 426, startYear: 1972, endYear: 1991, stillActive: false, startClub: "Hawthorn", endClub: "Hawthorn" } },
  { name: "Shaun Burgoyne", value: 407 },
  { name: "Kevin Bartlett", value: 403 },
  { name: "Dustin Fletcher", value: 400 },
  { name: "Travis Boak", value: 387 },
  { name: "Robert Harvey", value: 383 },
  { name: "Simon Madden", value: 378 },
  { name: "Patrick Dangerfield", value: 377 },
  { name: "David Mundy", value: 376 },
  { name: "Craig Bradley", value: 375 },
  { name: "Steele Sidebottom", value: 374 },
  { name: "Adam Goodes", value: 372 },
  { name: "Bernie Quinlan", value: 366 },
  { name: "Brad Johnson", value: 364 },
  { name: "Tom Hawkins", value: 359 },
  { name: "John Blakey", value: 359 },
  { name: "Gary Ablett (Jr)", value: 357 },
  { name: "Bruce Doull", value: 356 },
  { name: "Paul Roos", value: 356 },
  { name: "Joel Selwood", value: 355 },
  { name: "Lance Franklin", value: 354 },
  { name: "Matthew Pavlich", value: 353 },
  { name: "Eddie Betts", value: 350 },
  { name: "Doug Hawkins", value: 350 },
  { name: "Jack Riewoldt", value: 347 },
  { name: "Luke Hodge", value: 346 },
  { name: "Todd Goldstein", value: 345 },
  { name: "Jack Darling", value: 342 },
  { name: "Kade Simpson", value: 342 },
  { name: "Chris Grant", value: 341 },
  { name: "Andrew McLeod", value: 340 },
  { name: "Luke Parker", value: 338 },
  { name: "John Rantall", value: 336 },
  { name: "Nick Riewoldt", value: 336 },
  { name: "Brendon Goddard", value: 334 },
  { name: "Shannon Hurn", value: 333 },
  { name: "Kevin Murray", value: 333 },
  { name: "David Cloke", value: 333 },
  { name: "Leigh Matthews", value: 332 },
  { name: "Drew Petrie", value: 332 },
  { name: "Corey Enright", value: 332 },
  { name: "Justin Madden", value: 332 },
  { name: "Gary Dempsey", value: 329 },
  { name: "Sam Mitchell", value: 329 },
  { name: "John Nicholls", value: 328 },
  { name: "Barry Round", value: 328 },
  { name: "Callan Ward", value: 327 },
  { name: "Heath Shaw", value: 325 },
  { name: "Jarrad McVeigh", value: 325 },
  { name: "Ian Nankervis", value: 325 },
  { name: "Jude Bolton", value: 325 },
  { name: "Jason Akermanis", value: 325 },
  { name: "Scott West", value: 324 },
  { name: "Paul Salmon", value: 324 },
  { name: "Nathan Burke", value: 323 },
  { name: "Nick Dal Santo", value: 322 },
  { name: "Simon Black", value: 322 },
  { name: "Ted Whitten", value: 321 },
  { name: "Stewart Loewe", value: 321 },
  { name: "Tyson Edwards", value: 321 },
  { name: "Dick Reynolds", value: 320 },
  { name: "Jordan Lewis", value: 319 },
  { name: "Marcus Ashcroft", value: 318 },
  { name: "Dayne Zorko", value: 317 },
  { name: "Lachie Neale", value: 317 },
  { name: "Taylor Walker", value: 317 },
  { name: "Mark Blicavs", value: 313 },
  { name: "Terry Daniher", value: 313 },
  { name: "Tony Shaw", value: 313 },
  { name: "James Kelly", value: 313 },
  { name: "Roger Merrett", value: 313 },
  { name: "Robert Murphy", value: 312 },
  { name: "Stephen Silvagni", value: 312 },
  { name: "Mark Ricciuto", value: 312 },
  { name: "Jack Dyer", value: 311 },
  { name: "Glenn Archer", value: 311 },
  { name: "Ben Hart", value: 311 },
  { name: "Luke Breust", value: 308 },
  { name: "Scott Thompson", value: 308 },
  { name: "Tim Watson", value: 307 },
  { name: "Trent Cotchin", value: 306 },
  { name: "Wayne Schimmelbusch", value: 306 },
  { name: "Gordon Coventry", value: 306 },
  { name: "Adam Simpson", value: 306 },
  { name: "David Neitz", value: 306 },
  { name: "Paul Williams", value: 306 },
  { name: "Alastair Lynch", value: 306 },
  { name: "Mitch Duncan", value: 305 },
  { name: "Jimmy Bartel", value: 305 },
  { name: "Shane Crawford", value: 305 },
  { name: "Russell Greene", value: 304 },
  { name: "Shane Edwards", value: 303 },
  { name: "Michael O'Loughlin", value: 303 },
  { name: "Chris Langford", value: 303 },
  { name: "Dustin Martin", value: 302 },
  { name: "Nathan Jones", value: 302 },
  { name: "Don Scott", value: 302 },
  { name: "Luke Power", value: 302 },
];
