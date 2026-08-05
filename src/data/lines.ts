import type { Archetype } from "../types/archetype";
import type { Player } from "../types/player";
import { averageOvr } from "./loadPlayers";

/**
 * Groups the 14 archetypes into the four position lines used throughout
 * User Interface.md / Engine.md (List Needs report, Dashboard positional
 * rating bars, etc: "per position line (Midfield/Forwards/Defence/Ruck)").
 *
 * NOTE: the vault specs the *line* concept extensively but never pins down
 * archetype->line membership as a table the way it does for
 * archetype->position suitability — this mapping is a first-pass inference
 * (hybrids assigned to their more prominent side), not sourced from a vault
 * doc. Worth confirming with Tyler if the League Line-rating numbers this
 * feeds ever look off — see ROADMAP.md.
 */
export const LINES = ["Midfield", "Forwards", "Defence", "Ruck"] as const;
export type Line = (typeof LINES)[number];

export const ARCHETYPE_LINE: Record<Archetype, Line> = {
  "Inside Mid": "Midfield",
  "Outside Mid": "Midfield",
  "Key Forward": "Forwards",
  "Medium Forward": "Forwards",
  "Small Forward": "Forwards",
  "Pressure Forward": "Forwards",
  "Hybrid Mid Forward": "Forwards",
  "Key Defender": "Defence",
  "Medium Defender": "Defence",
  "Intercept Defender": "Defence",
  "Half Back Flanker": "Defence",
  "Back Pocket": "Defence",
  Ruck: "Ruck",
  "Hybrid Key Forward Ruck": "Ruck",
};

export interface LineSummary {
  line: Line;
  players: Player[];
  avgOvr: number;
  gapToLeague: number;
  elite: Player[]; // OVR >= 84, per Engine.md "List Needs report" elite threshold
  avgAge: number;
  young: Player[]; // <= 22
  veteran: Player[]; // >= 30
}

/** Per Engine.md "List Needs report": green above league / amber around / red below. */
export type LineBand = "green" | "amber" | "red";

export function bandForGap(gap: number): LineBand {
  if (gap > 1.5) return "green";
  if (gap < -1.5) return "red";
  return "amber";
}

export function summariseLines(clubPlayers: Player[], leagueAvgOvr: number): LineSummary[] {
  return LINES.map((line) => {
    const players = clubPlayers.filter((p) => ARCHETYPE_LINE[p.archetype as Archetype] === line);
    const avgOvr = averageOvr(players);
    const avgAge = players.length ? players.reduce((s, p) => s + p.Age, 0) / players.length : 0;
    return {
      line,
      players,
      avgOvr,
      gapToLeague: avgOvr - leagueAvgOvr,
      elite: players.filter((p) => p.OVR >= 84),
      avgAge,
      young: players.filter((p) => p.Age <= 22),
      veteran: players.filter((p) => p.Age >= 30),
    };
  });
}
