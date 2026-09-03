/**
 * Club identity — see `../../Club Database.md`. `ClubID` matches
 * `Player.ClubID` and the id table in `../../Player Database/Schema.md`.
 *
 * Round 68 — a name-stability audit found ~30 call sites across the app
 * (`getPlayersByClub`, `clubByName`, `ClubBadgeByName`, and direct
 * `Player.Team === clubName` comparisons in Contracts/Trade/Draft/Season/
 * Dashboard/etc.) that key off `Club.name`/`Player.Team` as plain strings
 * rather than `ClubID`. Unlike the player-name case (`Player.realFullName`,
 * this round), this is NOT currently broken and does NOT need the same
 * frozen-field treatment: nothing here joins against a FROZEN, externally-
 * scraped file the way `realDraftHistory.ts`/`realSeasonHistory.ts` do for
 * players — every one of these ~30 sites compares two LIVE fields against
 * each other, so they stay consistent under a coordinated rename.
 *
 * The one real invariant a future club-fictionalization pass MUST honour:
 * rename by pivoting through `ClubID`, updating `CLUBS[i].name` and every
 * matching `Player.Team`/`OriginClub` string in the SAME atomic pass — never
 * a blind find-replace of the old name, and never renaming `CLUBS[i].name`
 * without updating `Player.Team` in lockstep. Do that, and every `.Team ===`
 * / `clubByName(...)` call site above keeps working unchanged, with zero
 * refactor needed. `DraftHistoryEntry.club` (`data/realDraftHistory.ts`) is
 * a different, already-safe case: it's real historical fact ("Adelaide"
 * drafted this player in 2011) frozen the same way `Player.realFullName` is,
 * and correctly stays un-renamed even after "Adelaide" the live club becomes
 * something fictional.
 */
export interface Club {
  ClubID: number;
  name: string;
  nickname: string;
  founded: string;
  colours: string;
  homeState: string;
  /**
   * Added Aug 2026 (AFL.com.au-inspired branding pass, ROADMAP.md item #13)
   * as a "recognisable, not verified" placeholder — replaced round 51
   * ([[Club Branding and Colours]]) with each club's real, documented brand
   * hex (sourced from teamcolorcodes.com, not invented by this project),
   * used as the `ClubBadge` background and anywhere else club identity
   * needs a quick visual anchor, the same way real broadcast products use
   * team colour next to a crest. Several real clubs genuinely share a
   * colour family (Adelaide/Geelong are both navy; Essendon/Gold
   * Coast/St Kilda/Sydney are all reds) — an honest reflection of the
   * competition's actual colour distribution, not a data bug.
   */
  primaryColor: string;
  /**
   * Added round 51 ([[Club Branding and Colours]]) — each club's second
   * verified brand colour, used as `ClubBadge`'s text colour against
   * `primaryColor`'s background. Chosen for contrast (checked by
   * `verify_round51_scratch.ts`'s WCAG relative-luminance pass), not just
   * picked by eye. For the two clubs with only one strongly documented
   * brand colour (Carlton, GWS), this is a sensible high-contrast pairing
   * (white / near-black) rather than an invented second "official" colour —
   * see the design note for the GWS/charcoal caveat specifically.
   */
  secondaryColor: string;
  /**
   * Added round 51 ([[Club Branding and Colours]]) — the standard 3-4 letter
   * AFL abbreviation code (matches Tyler's own reference screenshot exactly:
   * ADEL, BL, CARL, COLL, ESS, FRE, GEEL, GCFC, GWS, HAW, MELB, NMFC, PORT,
   * RICH, STK, SYD, WCE, WB), used as `ClubBadge`'s label text.
   */
  abbreviation: string;
}

export const CLUBS: Club[] = [
  {
    ClubID: 1,
    name: "Adelaide",
    nickname: "Crows",
    founded: "1990",
    colours: "Navy, red, gold",
    homeState: "SA",
    primaryColor: "#002B5C",
    secondaryColor: "#FFD200",
    abbreviation: "ADEL",
  },
  {
    ClubID: 2,
    name: "Brisbane Lions",
    nickname: "Lions",
    founded: "1996",
    colours: "Maroon, blue, gold",
    homeState: "QLD",
    primaryColor: "#A30046",
    secondaryColor: "#FDBE57",
    abbreviation: "BL",
  },
  {
    ClubID: 3,
    name: "Carlton",
    nickname: "Blues",
    founded: "1864",
    colours: "Navy blue",
    homeState: "VIC",
    primaryColor: "#031A29",
    secondaryColor: "#FFFFFF",
    abbreviation: "CARL",
  },
  {
    ClubID: 4,
    name: "Collingwood",
    nickname: "Magpies",
    founded: "1892",
    colours: "Black, white",
    homeState: "VIC",
    primaryColor: "#000000",
    secondaryColor: "#FFFFFF",
    abbreviation: "COLL",
  },
  {
    ClubID: 5,
    name: "Essendon",
    nickname: "Bombers",
    founded: "1872",
    colours: "Red, black",
    homeState: "VIC",
    primaryColor: "#CC2031",
    secondaryColor: "#FFFFFF",
    abbreviation: "ESS",
  },
  {
    ClubID: 6,
    name: "Fremantle",
    nickname: "Dockers",
    founded: "1994",
    colours: "Purple",
    homeState: "WA",
    primaryColor: "#2A0D54",
    secondaryColor: "#FFFFFF",
    abbreviation: "FRE",
  },
  {
    ClubID: 7,
    name: "Geelong",
    nickname: "Cats",
    founded: "1859",
    colours: "Navy, white, hoops",
    homeState: "VIC",
    primaryColor: "#002B5C",
    secondaryColor: "#FFFFFF",
    abbreviation: "GEEL",
  },
  {
    ClubID: 8,
    name: "Gold Coast",
    nickname: "Suns",
    founded: "2009",
    colours: "Red, gold, blue",
    homeState: "QLD",
    primaryColor: "#E02112",
    secondaryColor: "#FFDD00",
    abbreviation: "GCFC",
  },
  {
    ClubID: 9,
    name: "Greater Western Sydney",
    nickname: "Giants",
    founded: "2010",
    colours: "Orange, charcoal",
    homeState: "NSW",
    primaryColor: "#F47920",
    secondaryColor: "#000000",
    abbreviation: "GWS",
  },
  {
    ClubID: 10,
    name: "Hawthorn",
    nickname: "Hawks",
    founded: "1902",
    colours: "Brown, gold",
    homeState: "VIC",
    primaryColor: "#4D2004",
    secondaryColor: "#FBBF15",
    abbreviation: "HAW",
  },
  {
    ClubID: 11,
    name: "Melbourne",
    nickname: "Demons",
    founded: "1858",
    colours: "Navy, red",
    homeState: "VIC",
    primaryColor: "#0F1131",
    secondaryColor: "#CC2031",
    abbreviation: "MELB",
  },
  {
    ClubID: 12,
    name: "North Melbourne",
    nickname: "Kangaroos",
    founded: "1869",
    colours: "Royal blue, white",
    homeState: "VIC",
    primaryColor: "#1A3B8E",
    secondaryColor: "#FFFFFF",
    abbreviation: "NMFC",
  },
  {
    ClubID: 13,
    name: "Port Adelaide",
    nickname: "Power",
    founded: "1870",
    colours: "Teal, black, white",
    homeState: "SA",
    primaryColor: "#008AAB",
    secondaryColor: "#FFFFFF",
    abbreviation: "PORT",
  },
  {
    ClubID: 14,
    name: "Richmond",
    nickname: "Tigers",
    founded: "1885",
    colours: "Yellow, black",
    homeState: "VIC",
    primaryColor: "#FFD200",
    secondaryColor: "#000000",
    abbreviation: "RICH",
  },
  {
    ClubID: 15,
    name: "St Kilda",
    nickname: "Saints",
    founded: "1873",
    colours: "Red, white, black",
    homeState: "VIC",
    primaryColor: "#ED1B2F",
    secondaryColor: "#FFFFFF",
    abbreviation: "STK",
  },
  {
    ClubID: 16,
    name: "Sydney",
    nickname: "Swans",
    founded: "1874",
    colours: "Red, white",
    homeState: "NSW",
    primaryColor: "#E1251B",
    secondaryColor: "#FFFFFF",
    abbreviation: "SYD",
  },
  {
    ClubID: 17,
    name: "West Coast",
    nickname: "Eagles",
    founded: "1986",
    colours: "Blue, gold",
    homeState: "WA",
    primaryColor: "#003087",
    secondaryColor: "#F2A900",
    abbreviation: "WCE",
  },
  {
    ClubID: 18,
    name: "Western Bulldogs",
    nickname: "Bulldogs",
    founded: "1877",
    colours: "Red, white, blue",
    homeState: "VIC",
    primaryColor: "#213270",
    secondaryColor: "#FFFFFF",
    abbreviation: "WB",
  },
];

export function clubById(id: number): Club | undefined {
  return CLUBS.find((c) => c.ClubID === id);
}

export function clubByName(name: string): Club | undefined {
  return CLUBS.find((c) => c.name === name);
}
