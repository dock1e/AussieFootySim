/**
 * Club identity — see `../../Club Database.md`. `ClubID` matches
 * `Player.ClubID` and the id table in `../../Player Database/Schema.md`.
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
   * — one recognisable primary hex per club, used as a small accent (a dot,
   * a card border) wherever that club's identity is shown, the same way
   * real broadcast products use team colour as a quick visual anchor next
   * to a crest. Picked for recognisability, not lifted from an official
   * brand kit — several real clubs share a family of reds/navies, which is
   * an honest reflection of the competition's actual colour distribution,
   * not a bug in this list. Verify against a real source before using this
   * for anything higher-stakes than a UI accent (e.g. merchandise, print).
   */
  primaryColor: string;
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
  },
  {
    ClubID: 2,
    name: "Brisbane Lions",
    nickname: "Lions",
    founded: "1996",
    colours: "Maroon, blue, gold",
    homeState: "QLD",
    primaryColor: "#A30046",
  },
  {
    ClubID: 3,
    name: "Carlton",
    nickname: "Blues",
    founded: "1864",
    colours: "Navy blue",
    homeState: "VIC",
    primaryColor: "#041E42",
  },
  {
    ClubID: 4,
    name: "Collingwood",
    nickname: "Magpies",
    founded: "1892",
    colours: "Black, white",
    homeState: "VIC",
    primaryColor: "#1A1A1A",
  },
  {
    ClubID: 5,
    name: "Essendon",
    nickname: "Bombers",
    founded: "1872",
    colours: "Red, black",
    homeState: "VIC",
    primaryColor: "#CC2031",
  },
  {
    ClubID: 6,
    name: "Fremantle",
    nickname: "Dockers",
    founded: "1994",
    colours: "Purple",
    homeState: "WA",
    primaryColor: "#582C83",
  },
  {
    ClubID: 7,
    name: "Geelong",
    nickname: "Cats",
    founded: "1859",
    colours: "Navy, white, hoops",
    homeState: "VIC",
    primaryColor: "#14213D",
  },
  {
    ClubID: 8,
    name: "Gold Coast",
    nickname: "Suns",
    founded: "2009",
    colours: "Red, gold, blue",
    homeState: "QLD",
    primaryColor: "#E2231A",
  },
  {
    ClubID: 9,
    name: "Greater Western Sydney",
    nickname: "Giants",
    founded: "2010",
    colours: "Orange, charcoal",
    homeState: "NSW",
    primaryColor: "#F57920",
  },
  {
    ClubID: 10,
    name: "Hawthorn",
    nickname: "Hawks",
    founded: "1902",
    colours: "Brown, gold",
    homeState: "VIC",
    primaryColor: "#4D2004",
  },
  {
    ClubID: 11,
    name: "Melbourne",
    nickname: "Demons",
    founded: "1858",
    colours: "Navy, red",
    homeState: "VIC",
    primaryColor: "#0F1131",
  },
  {
    ClubID: 12,
    name: "North Melbourne",
    nickname: "Kangaroos",
    founded: "1869",
    colours: "Royal blue, white",
    homeState: "VIC",
    primaryColor: "#0033A0",
  },
  {
    ClubID: 13,
    name: "Port Adelaide",
    nickname: "Power",
    founded: "1870",
    colours: "Teal, black, white",
    homeState: "SA",
    primaryColor: "#008AAB",
  },
  {
    ClubID: 14,
    name: "Richmond",
    nickname: "Tigers",
    founded: "1885",
    colours: "Yellow, black",
    homeState: "VIC",
    primaryColor: "#FFD200",
  },
  {
    ClubID: 15,
    name: "St Kilda",
    nickname: "Saints",
    founded: "1873",
    colours: "Red, white, black",
    homeState: "VIC",
    primaryColor: "#ED0F05",
  },
  {
    ClubID: 16,
    name: "Sydney",
    nickname: "Swans",
    founded: "1874",
    colours: "Red, white",
    homeState: "NSW",
    primaryColor: "#ED171F",
  },
  {
    ClubID: 17,
    name: "West Coast",
    nickname: "Eagles",
    founded: "1986",
    colours: "Blue, gold",
    homeState: "WA",
    primaryColor: "#003087",
  },
  {
    ClubID: 18,
    name: "Western Bulldogs",
    nickname: "Bulldogs",
    founded: "1877",
    colours: "Red, white, blue",
    homeState: "VIC",
    primaryColor: "#E21937",
  },
];

export function clubById(id: number): Club | undefined {
  return CLUBS.find((c) => c.ClubID === id);
}

export function clubByName(name: string): Club | undefined {
  return CLUBS.find((c) => c.name === name);
}
