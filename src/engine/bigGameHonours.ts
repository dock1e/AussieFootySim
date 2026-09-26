import type { Player } from "../types/player.ts";
import { SPECIAL_EVENTS } from "../data/specialEvents.ts";
import type { Season } from "./season.ts";

/**
 * Big Game Splash — writes a special match's medal to the medallist's career record and, for a Grand
 * Final, marks the 22 on each side as premiership players or Grand Finalists (brief §3). Each match is
 * applied once: it carries `honoursApplied` afterwards, so replaying the match or reloading the save
 * never writes it twice.
 */

interface Applied {
  season: Season;
  players: Player[];
  /** Grand Finals the coach's club won in this pass (for the coach's own premiership count). */
  flagsWon: number[];
}

export function applyBigGameHonours(season: Season, players: readonly Player[], year: number): Applied {
  const byId = new Map(players.map((p, i) => [p.PlayerID, i]));
  const next = [...players];
  const flagsWon: number[] = [];
  let flagged = false;
  const edit = (id: number, f: (p: Player) => Player) => {
    const i = byId.get(id);
    if (i === undefined) return;
    next[i] = f(next[i]);
  };

  const played = season.played.map((m) => {
    if (!m.awards || m.honoursApplied) return m;
    const a = m.awards;
    edit(a.medallistId, (p) => ({ ...p, honours: [...(p.honours ?? []), { type: a.event, medal: SPECIAL_EVENTS[a.event].medal, season: year, round: m.round }] }));
    flagged = true;
    return { ...m, honoursApplied: true };
  });

  const applyFinals = <T extends { key: string; awards?: typeof season.played[number]["awards"]; honoursApplied?: boolean; winnerClubId: number; homeClubId: number }>(ms: T[]): T[] =>
    ms.map((m) => {
      if (!m.awards || m.honoursApplied) return m;
      const a = m.awards;
      edit(a.medallistId, (p) => ({ ...p, honours: [...(p.honours ?? []), { type: a.event, medal: SPECIAL_EVENTS[a.event].medal, season: year, round: "GF" }] }));
      if (m.key === "GF") {
        const winners = m.winnerClubId === m.homeClubId ? a.homeSquad : a.awaySquad;
        const losers = m.winnerClubId === m.homeClubId ? a.awaySquad : a.homeSquad;
        for (const id of winners) edit(id, (p) => ({ ...p, premiershipPlayer: [...(p.premiershipPlayer ?? []), year] }));
        for (const id of losers) edit(id, (p) => ({ ...p, grandFinalist: [...(p.grandFinalist ?? []), year] }));
        flagsWon.push(m.winnerClubId);
      }
      flagged = true;
      return { ...m, honoursApplied: true };
    });

  const finalsInProgress = season.finalsInProgress ? applyFinals(season.finalsInProgress) : undefined;
  const finals = season.finals ? { ...season.finals, matches: applyFinals(season.finals.matches) } : season.finals;
  if (!flagged) return { season, players: [...players], flagsWon };
  return { season: { ...season, played, finals, finalsInProgress }, players: next, flagsWon };
}
