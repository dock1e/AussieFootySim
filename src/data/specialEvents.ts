/**
 * Big Game Splash — the special fixtures that get a full-time splash and a medal (brief §1).
 *
 * Only events whose award names are confirmed are here: the Grand Final (Norm Smith Medal), Anzac Day
 * (Anzac Medal, Essendon v Collingwood) and King's Birthday (Neale Daniher Trophy, Melbourne v
 * Collingwood, the "Big Freeze"). The optional rivalry rounds in the brief (Anzac Eve, Dreamtime,
 * Showdown, Western Derby, QClash) are left out until their award names are in the data.
 */

export type SpecialEventId = "grandFinal" | "anzac" | "kingsBirthday";

export interface SpecialEvent {
  id: SpecialEventId;
  label: string;
  /** Template with {year} and {round}. */
  eyebrow: string;
  medal: string;
  voteMethod: "judges321";
  tribute?: string;
  /** Grand Final only: the premiership / Grand Final 22. */
  showSquad: boolean;
  /** A Grand Final win uses the giant "Premiers." size. */
  headlineScale: "hero" | "large";
  /** Stadium id the event is always played at (clubGrounds' `STADIUM_CONFIGS`). */
  venueId: string;
  /** Home-and-away events: the two clubs (abbreviations) and the round the fixture generator aims for. */
  clubs?: [string, string];
  targetRound?: number;
}

export const SPECIAL_EVENTS: Record<SpecialEventId, SpecialEvent> = {
  grandFinal: {
    id: "grandFinal",
    label: "Grand Final",
    eyebrow: "{year} AFL GRAND FINAL",
    medal: "NORM SMITH MEDAL",
    voteMethod: "judges321",
    showSquad: true,
    headlineScale: "hero",
    venueId: "mcg",
  },
  anzac: {
    id: "anzac",
    label: "Anzac Day",
    eyebrow: "ANZAC DAY · ROUND {round}",
    medal: "ANZAC MEDAL",
    voteMethod: "judges321",
    tribute: "LEST WE FORGET",
    showSquad: false,
    headlineScale: "large",
    venueId: "mcg",
    clubs: ["ESS", "COLL"],
    targetRound: 7,
  },
  kingsBirthday: {
    id: "kingsBirthday",
    label: "King's Birthday",
    eyebrow: "KING'S BIRTHDAY · ROUND {round} · BIG FREEZE",
    medal: "NEALE DANIHER TROPHY",
    voteMethod: "judges321",
    showSquad: false,
    headlineScale: "large",
    venueId: "mcg",
    clubs: ["MELB", "COLL"],
    targetRound: 13,
  },
};

export function eventEyebrow(ev: SpecialEvent, year: number, round: number | string): string {
  return ev.eyebrow.replace("{year}", String(year)).replace("{round}", String(round));
}
