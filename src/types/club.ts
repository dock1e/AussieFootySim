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
}

export const CLUBS: Club[] = [
  { ClubID: 1, name: "Adelaide", nickname: "Crows", founded: "1990", colours: "Navy, red, gold", homeState: "SA" },
  {
    ClubID: 2,
    name: "Brisbane Lions",
    nickname: "Lions",
    founded: "1996",
    colours: "Maroon, blue, gold",
    homeState: "QLD",
  },
  { ClubID: 3, name: "Carlton", nickname: "Blues", founded: "1864", colours: "Navy blue", homeState: "VIC" },
  { ClubID: 4, name: "Collingwood", nickname: "Magpies", founded: "1892", colours: "Black, white", homeState: "VIC" },
  { ClubID: 5, name: "Essendon", nickname: "Bombers", founded: "1872", colours: "Red, black", homeState: "VIC" },
  { ClubID: 6, name: "Fremantle", nickname: "Dockers", founded: "1994", colours: "Purple", homeState: "WA" },
  {
    ClubID: 7,
    name: "Geelong",
    nickname: "Cats",
    founded: "1859",
    colours: "Navy, white, hoops",
    homeState: "VIC",
  },
  {
    ClubID: 8,
    name: "Gold Coast",
    nickname: "Suns",
    founded: "2009",
    colours: "Red, gold, blue",
    homeState: "QLD",
  },
  {
    ClubID: 9,
    name: "Greater Western Sydney",
    nickname: "Giants",
    founded: "2010",
    colours: "Orange, charcoal",
    homeState: "NSW",
  },
  { ClubID: 10, name: "Hawthorn", nickname: "Hawks", founded: "1902", colours: "Brown, gold", homeState: "VIC" },
  { ClubID: 11, name: "Melbourne", nickname: "Demons", founded: "1858", colours: "Navy, red", homeState: "VIC" },
  {
    ClubID: 12,
    name: "North Melbourne",
    nickname: "Kangaroos",
    founded: "1869",
    colours: "Royal blue, white",
    homeState: "VIC",
  },
  {
    ClubID: 13,
    name: "Port Adelaide",
    nickname: "Power",
    founded: "1870",
    colours: "Teal, black, white",
    homeState: "SA",
  },
  { ClubID: 14, name: "Richmond", nickname: "Tigers", founded: "1885", colours: "Yellow, black", homeState: "VIC" },
  {
    ClubID: 15,
    name: "St Kilda",
    nickname: "Saints",
    founded: "1873",
    colours: "Red, white, black",
    homeState: "VIC",
  },
  { ClubID: 16, name: "Sydney", nickname: "Swans", founded: "1874", colours: "Red, white", homeState: "NSW" },
  { ClubID: 17, name: "West Coast", nickname: "Eagles", founded: "1986", colours: "Blue, gold", homeState: "WA" },
  {
    ClubID: 18,
    name: "Western Bulldogs",
    nickname: "Bulldogs",
    founded: "1877",
    colours: "Red, white, blue",
    homeState: "VIC",
  },
];

export function clubById(id: number): Club | undefined {
  return CLUBS.find((c) => c.ClubID === id);
}

export function clubByName(name: string): Club | undefined {
  return CLUBS.find((c) => c.name === name);
}
