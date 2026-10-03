import { describe, it, expect } from "vitest";
import { getPlayersByClub } from "../data/loadPlayers";
import { mulberry32 } from "./rng";
import { simulateMatch, type MatchResult, type FreeKickKind } from "./match";
import { autoFillLineup, lineupToMatchTeam } from "./selection";
import { computeAussieFootySimRatings } from "./ratings";
import type { MatchTeam } from "./team";

/** ROADMAP #11 / gap #76 — every free kick paid is tagged on its event, and the tag agrees with the stats. */

const PAIRS: [string, string][] = [
  ["Collingwood", "Carlton"],
  ["Brisbane Lions", "Geelong"],
  ["Sydney", "Hawthorn"],
  ["Fremantle", "Adelaide"],
  ["Melbourne", "Richmond"],
  ["Gold Coast", "St Kilda"],
];

function play(homeName: string, awayName: string, seed: number): { result: MatchResult; home: MatchTeam; away: MatchTeam } {
  const hp = getPlayersByClub(homeName);
  const ap = getPlayersByClub(awayName);
  const home = lineupToMatchTeam(homeName, autoFillLineup(hp), hp);
  const away = lineupToMatchTeam(awayName, autoFillLineup(ap), ap);
  // simulateMatch plays on its own copies, so these stay as selected.
  return { result: simulateMatch(home, away, mulberry32(seed), seed, {}), home, away };
}

const games = PAIRS.map(([h, a], i) => play(h, a, 7100 + i));
const results = games.map((g) => g.result);

describe("free kicks (ROADMAP #11 / gap #76)", () => {
  it("tags every free-kick event with who it went to and who gave it away, matching its stat deltas", () => {
    for (const r of results) {
      for (const ev of r.events) {
        const forDelta = ev.statDeltas.find((d) => d.stat === "freeKicksFor");
        const againstDelta = ev.statDeltas.find((d) => d.stat === "freeKicksAgainst");
        if (!ev.freeKick) {
          expect(forDelta).toBeUndefined();
          continue;
        }
        expect(forDelta?.playerId).toBe(ev.freeKick.forId);
        expect(againstDelta?.playerId).toBe(ev.freeKick.againstId);
        expect(ev.freeKick.forId).not.toBe(ev.freeKick.againstId);
      }
    }
  });

  it("pays all four free-kick rules", () => {
    const kinds = new Set<FreeKickKind>();
    for (const r of results) for (const ev of r.events) if (ev.freeKick) kinds.add(ev.freeKick.kind);
    expect([...kinds].sort()).toEqual(["highContact", "holdingTheBall", "inTheBack", "outOnTheFull"]);
  });

  it("lands near the real ~17-18 free kicks per team per match", () => {
    let frees = 0;
    for (const r of results) for (const ev of r.events) if (ev.freeKick) frees++;
    const perTeam = frees / (results.length * 2);
    expect(perTeam).toBeGreaterThan(13);
    expect(perTeam).toBeLessThan(23);
  });

  it("credits every free-kick taker in the AussieFootySim Rating, Out on the Full included", () => {
    let checked = 0;
    for (const { result: r, home, away } of games) {
      for (const ev of r.events) {
        if (!ev.freeKick) continue;
        // Score this one event alone: the whole rating pool should go to the taker.
        const lines = computeAussieFootySimRatings({ ...r, events: [ev] }, home, away);
        expect(lines[ev.freeKick.forId].rating).toBeGreaterThan(0);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("gives a Holding the Ball free to the tackler, who keeps the ball", () => {
    let seen = 0;
    for (const r of results) {
      r.events.forEach((ev, i) => {
        if (ev.freeKick?.kind !== "holdingTheBall") return;
        seen++;
        expect(ev.statDeltas.find((d) => d.stat === "tackles")?.playerId).toBe(ev.freeKick.forId);
        // The next play is the taker's own (his disposal is sometimes folded into the receiver's
        // reception event, so he's either named or credited there).
        const next = r.events[i + 1];
        if (next && next.quarter === ev.quarter && !next.interchange && !next.injury) {
          const id = ev.freeKick.forId;
          expect(next.playerIds.includes(id) || next.statDeltas.some((d) => d.playerId === id)).toBe(true);
        }
      });
    }
    expect(seen).toBeGreaterThan(0);
  });
});
