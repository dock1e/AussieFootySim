import type { Player } from "../types/player";
import { autoFillLineup, lineupToMatchTeam, type Lineup } from "../engine/selection";
import type { MatchTeam } from "../engine/team";

/**
 * Round 128, Tyler: "use the actual team lists and selection for today's grand final as the default
 * teams to be selected." The real, confirmed 22-man teams for the 2026 AFL Grand Final (Fremantle v
 * Brisbane Lions, MCG, Saturday 26 September 2026), captured live from AFL.com.au's Team Line-ups page
 * (List View) the day before the match — both clubs named unchanged sides from their preliminary
 * finals bar one injury out each (Fremantle's Brennan Cox, Brisbane's Noah Answerth, both emergencies,
 * so not included here).
 *
 * Each array is already in `POSITIONS`' own 23-slot order (`types/archetype.ts`) — FB, BP, BP, HBF,
 * HBF, CHB, W, C, W, R, RR, ROV, HFF, HFF, CHF, FF, FP, FP, then 5 INT — derived from the standard AFL
 * team-sheet convention of listing each 3-player line as [left flank/pocket, key position, right
 * flank/pocket] (e.g. the FB line's middle name is the actual full-back, the two outer names are the
 * back pockets), applied identically to both clubs. Names are "first-initial surname" exactly as the
 * real team sheet lists them (no guernsey numbers — this game doesn't model those) and are matched
 * against this game's own real-player roster by `matchRealName` below, not hand-mapped to PlayerIDs,
 * so this file stays correct even if a future refresh changes anyone's in-game PlayerID.
 */
export const GRAND_FINAL_2026_CLUBS = ["Fremantle", "Brisbane Lions"] as const;
export type GrandFinal2026Club = (typeof GRAND_FINAL_2026_CLUBS)[number];

export const GRAND_FINAL_2026: Record<GrandFinal2026Club, string[]> = {
  Fremantle: [
    "A. Pearce", // FB
    "J. Clark", // BP
    "J. McVee", // BP
    "K. Worner", // HBF
    "H. Chapman", // HBF
    "O. McDonald", // CHB
    "M. Johnson", // W
    "A. Brayshaw", // C
    "N. Erasmus", // W
    "L. Jackson", // R
    "C. Serong", // RR
    "S. Bolton", // ROV
    "M. Frederick", // HFF
    "S. Switkowski", // HFF
    "M. Reid", // CHF
    "J. Treacy", // FF
    "J. Amiss", // FP
    "P. Voss", // FP
    "I. Dudley", // INT
    "M. Cox", // INT
    "H. Young", // INT
    "C. Wagner", // INT
    "L. Ryan", // INT
  ],
  "Brisbane Lions": [
    "H. Andrews", // FB
    "T. Gallop", // BP
    "R. Lester", // BP
    "D. Wilmot", // HBF
    "D. Zorko", // HBF
    "D. Gardiner", // CHB
    "J. Berry", // W
    "W. Ashcroft", // C
    "Z. Bailey", // W
    "D. Fort", // R
    "J. Dunkley", // RR
    "L. Neale", // ROV
    "C. Cameron", // HFF
    "O. Allen", // HFF
    "L. Morris", // CHF
    "C. Rayner", // FF
    "E. Hipwood", // FP
    "K. Lohmann", // FP
    "S. Draper", // INT
    "J. Fletcher", // INT
    "H. McCluggage", // INT
    "L. Ashcroft", // INT
    "C. McKenna", // INT
  ],
};

/**
 * Matches a "J. Surname" guernsey-sheet name against this game's own roster by last name + first
 * initial (there are two Ashcrofts in the real Brisbane 22 — W. Ashcroft and L. Ashcroft — so surname
 * alone isn't always enough). Falls back to a surname-only match when the initial doesn't line up
 * (e.g. a nickname-vs-legal-first-name mismatch) rather than leaving a real, findable player out over
 * a formatting quirk; returns `undefined` only when no roster player shares the surname at all.
 */
function matchRealName(guernseyName: string, players: readonly Player[], used: ReadonlySet<number>): Player | undefined {
  const spaceIdx = guernseyName.indexOf(" ");
  if (spaceIdx === -1) return undefined;
  const initial = guernseyName.slice(0, spaceIdx).replace(/\./g, "").trim().toLowerCase();
  const surname = guernseyName.slice(spaceIdx + 1).trim().toLowerCase();
  const candidates = players.filter((p) => !used.has(p.PlayerID) && p.lname.trim().toLowerCase() === surname);
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return candidates[0];
  return candidates.find((p) => p.fname.trim()[0]?.toLowerCase() === initial) ?? candidates[0];
}

/**
 * Builds the real 2026 Grand Final `MatchTeam` for one club from this save's own current roster.
 * A name from `GRAND_FINAL_2026` that can't be matched (a fringe player this game's data doesn't carry
 * under that exact name) is reported in `unmatched` rather than silently dropped — `lineupToMatchTeam`
 * still fields a full 23 by topping up from the rest of the club's roster by OVR, same fallback every
 * other under-filled lineup in this game already gets, so the match can always kick off.
 */
export function buildGrandFinalTeam(club: GrandFinal2026Club, allClubPlayers: readonly Player[]): { team: MatchTeam; unmatched: string[] } {
  const used = new Set<number>();
  const unmatched: string[] = [];
  const lineup: Lineup = GRAND_FINAL_2026[club].map((name) => {
    const p = matchRealName(name, allClubPlayers, used);
    if (!p) {
      unmatched.push(name);
      return null;
    }
    used.add(p.PlayerID);
    return p.PlayerID;
  });
  const team = lineupToMatchTeam(club, lineup, allClubPlayers);
  return { team, unmatched };
}

/** Exported for parity with the rest of this game's "no evidence, no guess, no crash" fallbacks — not currently used by the GF exhibition flow, but keeps a fully auto-filled option available if a future caller wants a non-real lineup for either GF club. */
export function autoFallbackTeam(club: GrandFinal2026Club, allClubPlayers: readonly Player[]): MatchTeam {
  return lineupToMatchTeam(club, autoFillLineup(allClubPlayers), allClubPlayers);
}
