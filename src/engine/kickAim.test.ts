import { describe, it, expect } from "vitest";
import { zoneAt } from "./zones";
import { BACKWARD_KICK_FACTOR, directionWeight } from "./positioning";
import { weightedKickTarget } from "./involvement";
import { kickReason, simulateMatch } from "./match";
import { autoFillLineup, lineupToMatchTeam } from "./selection";
import { makePlayer } from "../testUtils/makePlayer";
import { mulberry32 } from "./rng";
import { STADIUM_CONFIGS } from "../data/stadiums";
import type { Player } from "../types/player";
import type { Archetype } from "../types/archetype";
import type { AbstractPosition } from "./positioning";

/** Oct 2026 — ROADMAP #18: kicks land where they're aimed. */
describe("kick aim point", () => {
  it("zoneAt maps a real position onto its zone by real ground geometry (50m arcs, middle thirds)", () => {
    // 160m ground: one zone-unit = 40m, so the 50m arc ends at 1.25 / 2.75 and each middle third is 0.5 wide.
    expect(zoneAt(0)).toBe(0);
    expect(zoneAt(1.2)).toBe(0); // 48m from own goal: still inside the defensive 50
    expect(zoneAt(1.3)).toBe(1);
    expect(zoneAt(2)).toBe(2);
    expect(zoneAt(2.3)).toBe(3);
    expect(zoneAt(2.8)).toBe(4); // 48m out: inside the forward 50
    expect(zoneAt(-0.3)).toBe(0);
    expect(zoneAt(4.4)).toBe(4);
    // Venue-length aware: the same spot is outside the 50 on a longer ground.
    expect(zoneAt(2.8, 180)).toBe(3);
  });

  it("forward progress is preferred, a sideways kick is fine, a backward one is heavily discounted", () => {
    expect(directionWeight(1)).toBeGreaterThan(directionWeight(0.3));
    expect(directionWeight(0.3)).toBeGreaterThan(directionWeight(0));
    expect(directionWeight(0)).toBe(1);
    expect(directionWeight(-0.5)).toBe(BACKWARD_KICK_FACTOR);
    expect(directionWeight(3)).toBe(directionWeight(1.5)); // capped
  });

  it("names why a receiver was chosen, in priority order, and stays quiet for a routine kick", () => {
    const base = { player: makePlayer({ PlayerID: 1 }), distance: 6, kickDistance: 28, progress: 0.4, aim: { zoneFrac: 2.4, lane: 0.1 }, from: { zoneFrac: 2, lane: 0 } };
    const reason = (p: Partial<typeof base>, from = 2 as const, to = 2 as const, missed = false) => kickReason({ ...base, ...p }, "home", from, to, 160, 0, missed);
    expect(reason({ progress: -0.5 })).toMatch(/back/);
    expect(reason({}, 3 as never, 4 as never)).toMatch(/inside 50/);
    expect(reason({ progress: 0.1, aim: { zoneFrac: 2.1, lane: 0.9 }, from: { zoneFrac: 2, lane: -0.2 } })).toMatch(/switch/);
    expect(reason({ progress: 1.2 })).toBe("gaining 50 metres");
    expect(reason({ progress: 1.2 }, 2, 2, true)).toBe("aiming for a 50-metre gain");
    expect(reason({ distance: 20 })).toMatch(/free man|loose player/);
    expect(reason({ kickDistance: 15 })).toMatch(/short/);
    expect(reason({})).toBeNull(); // routine: no clause
    // Backward wins over everything; the variant is picked by tick, not by a random draw.
    expect(kickReason({ ...base, progress: -1, distance: 30 }, "home", 2, 4, 160, 1)).toMatch(/back/);
  });

  it("a handball that carries the ball across the 50 arc earns the inside-50 / rebound-50, logged on the handball itself", () => {
    let id = 80_000;
    const a: Archetype[] = ["Key Defender", "Medium Defender", "Half Back Flanker", "Back Pocket", "Inside Mid", "Outside Mid", "Key Forward", "Medium Forward", "Small Forward", "Ruck"];
    const mk = (club: string): Player[] => Array.from({ length: 30 }, (_, i) => makePlayer({ PlayerID: id++, Team: club, archetype: a[i % a.length], OVR: 60 + (i % 15) }));
    const hp = mk("H");
    const ap = mk("A");
    const home = lineupToMatchTeam("H", autoFillLineup(hp), hp);
    const away = lineupToMatchTeam("A", autoFillLineup(ap), ap);
    let credited = 0;
    for (let s = 1; s <= 4; s++) {
      const r = simulateMatch(home, away, mulberry32(s), s, { recordEvents: true });
      for (const e of r.events) {
        if (!e.statDeltas.some((d) => d.stat === "handballs")) continue;
        const zoneCredit = e.statDeltas.find((d) => d.stat === "inside50s" || d.stat === "rebound50s");
        if (!zoneCredit) continue;
        credited++;
        // Credited to the player who handballed it, the same rule a kick follows.
        expect(e.statDeltas.find((d) => d.stat === "handballs")!.playerId).toBe(zoneCredit.playerId);
      }
    }
    expect(credited).toBeGreaterThan(0);
  });

  it("a kick's aim is the chosen receiver's real tracked position, with its progress from the kicker", () => {
    let id = 70_000;
    const a: Archetype[] = ["Key Defender", "Medium Defender", "Half Back Flanker", "Inside Mid", "Outside Mid", "Key Forward", "Medium Forward", "Small Forward", "Ruck"];
    const mk = (club: string): Player[] => Array.from({ length: 30 }, (_, i) => makePlayer({ PlayerID: id++, Team: club, archetype: a[i % a.length], OVR: 65 }));
    const hp = mk("H");
    const ap = mk("A");
    const home = lineupToMatchTeam("H", autoFillLineup(hp), hp);
    const away = lineupToMatchTeam("A", autoFillLineup(ap), ap);
    const tracked = new Map<number, AbstractPosition>();
    home.players.forEach((p, i) => tracked.set(p.PlayerID, { zoneFrac: (i % 5) * 0.9, lane: ((i % 3) - 1) * 0.5 }));
    away.players.forEach((p, i) => tracked.set(p.PlayerID, { zoneFrac: (i % 5) * 0.9 + 0.2, lane: ((i % 3) - 1) * 0.4 }));
    const kicker = home.players.find((p) => home.positions!.get(p.PlayerID) === "C")!;
    tracked.set(kicker.PlayerID, { zoneFrac: 2, lane: 0 });
    for (let s = 0; s < 30; s++) {
      const pick = weightedKickTarget(mulberry32(s), "home", home, 3, "home", kicker, "away", away, { zoneFrac: 2, lane: 0 }, tracked, STADIUM_CONFIGS["mcg"]);
      expect(pick.aim).toEqual(tracked.get(pick.player.PlayerID));
      expect(pick.progress).toBeCloseTo(pick.aim.zoneFrac - 2);
    }
  });
});
