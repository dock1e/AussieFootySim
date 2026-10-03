import { describe, it, expect } from "vitest";
import { makePlayer } from "../testUtils/makePlayer";
import type { Player } from "../types/player";
import type { Archetype, Position } from "../types/archetype";
import { GROUND_SLOTS, bestShape, planReset, uncoveredGroups, type RestPolicy, type ResetInput } from "./rotation";
import { autoFillLineup } from "./selection";
import { POSITIONS } from "../types/archetype";
import { specialistGroups } from "./rotation";

let nextId = 1;
const mk = (lname: string, archetype: Archetype, OVR = 70): Player => makePlayer({ PlayerID: nextId++, lname, archetype, OVR });

/** A sensible 18: three talls down back (May in a back pocket), a small in the other pocket. */
function team() {
  const slots: [Position, Player][] = [
    ["FB", mk("Tall1", "Key Defender")],
    ["BP", mk("May", "Key Defender")],
    ["BP", mk("Small1", "Back Pocket")],
    ["HBF", mk("Hbf1", "Half Back Flanker")],
    ["HBF", mk("Hbf2", "Half Back Flanker")],
    ["CHB", mk("Tall2", "Key Defender")],
    ["W", mk("Wing1", "Outside Mid")],
    ["C", mk("Centre", "Inside Mid")],
    ["W", mk("Wing2", "Outside Mid")],
    ["R", mk("Ruck1", "Ruck")],
    ["RR", mk("Mid1", "Inside Mid")],
    ["ROV", mk("Mid2", "Inside Mid")],
    ["HFF", mk("Hff1", "Medium Forward")],
    ["HFF", mk("Hff2", "Medium Forward")],
    ["CHF", mk("Kf1", "Key Forward")],
    ["FF", mk("Kf2", "Key Forward")],
    ["FP", mk("Fp1", "Small Forward")],
    ["FP", mk("Fp2", "Small Forward")],
  ];
  const current = new Map(slots.map(([pos, p]) => [p.PlayerID, pos]));
  const byName = new Map(slots.map(([, p]) => [p.lname, p]));
  return { onGround: slots.map(([, p]) => p), current, byName };
}

function input(t: ReturnType<typeof team>, bench: Player[], fitness: Record<string, number>, extra: Partial<ResetInput> = {}): ResetInput {
  const all = [...t.onGround, ...bench];
  const fit = new Map(all.map((p) => [p.PlayerID, fitness[p.lname] ?? 95]));
  return {
    onGround: t.onGround,
    bench,
    current: t.current,
    home: t.current,
    fitness: (id) => fit.get(id) ?? 95,
    rested: () => true,
    policy: () => undefined,
    pin: () => undefined,
    ...extra,
  };
}

describe("rotation — bestShape", () => {
  it("keeps a sensible line-up exactly where it is", () => {
    const t = team();
    const s = bestShape({ players: t.onGround, current: t.current, home: t.current });
    expect(s.poorFits).toBe(0);
    for (const p of t.onGround) expect(s.positions.get(p.PlayerID)).toBe(t.current.get(p.PlayerID));
  });

  it("covers every one of the 18 slots", () => {
    const t = team();
    const s = bestShape({ players: t.onGround, current: t.current, home: t.current });
    expect([...s.positions.values()].sort()).toEqual([...GROUND_SLOTS].sort());
  });
});

describe("rotation — planReset (Tyler's Steven May example)", () => {
  it("a tired May comes off for the small defender, who takes the back pocket", () => {
    const t = team();
    const smallDef = mk("Small2", "Back Pocket");
    const plan = planReset(input(t, [smallDef], { May: 60, Small2: 100 }));
    expect(plan.swaps.map((s) => [s.outgoing.lname, s.incoming.lname])).toEqual([["May", "Small2"]]);
    expect(plan.positions!.get(smallDef.PlayerID)).toBe("BP");
  });

  it("a fresh May comes back on for the tired full back, not the small defender in his old pocket", () => {
    const t = team();
    const may = t.byName.get("May")!;
    const smallDef = mk("Small2", "Back Pocket");
    // State after the first swap: Small2 at BP where May was, May resting.
    const onGround = t.onGround.map((p) => (p.PlayerID === may.PlayerID ? smallDef : p));
    const current = new Map(t.current);
    current.delete(may.PlayerID);
    current.set(smallDef.PlayerID, "BP");
    const plan = planReset({ ...input(t, [may], { Tall1: 60, May: 100, Small2: 90 }), onGround, current });
    expect(plan.swaps.map((s) => [s.outgoing.lname, s.incoming.lname])).toEqual([["Tall1", "May"]]);
    expect(plan.positions!.get(may.PlayerID)).toBe("FB");
    expect(plan.positions!.get(smallDef.PlayerID)).toBe("BP");
  });

  it("never strands a player out of position — a tired full back plays on if only a ruck is fresh", () => {
    const t = team();
    const plan = planReset(input(t, [mk("Ruck2", "Ruck")], { Tall1: 50, Ruck2: 100 }));
    expect(plan.swaps).toEqual([]);
  });

  it("a ruck coming off lets a key forward move across — the chain falls out of the re-sort", () => {
    const t = team();
    const kf3 = mk("Kf3", "Key Forward");
    const hybrid = t.byName.get("Kf2")!;
    // Make the full forward a ruck-forward who can go into the ruck.
    const ruckForward = { ...hybrid, archetype: "Hybrid Key Forward Ruck" } as Player;
    const onGround = t.onGround.map((p) => (p.PlayerID === hybrid.PlayerID ? ruckForward : p));
    const plan = planReset({ ...input(t, [kf3], { Ruck1: 55, Kf3: 100 }), onGround });
    expect(plan.swaps.map((s) => s.outgoing.lname)).toEqual(["Ruck1"]);
    expect(plan.positions!.get(ruckForward.PlayerID)).toBe("R");
    expect(plan.positions!.get(kf3.PlayerID)).toBe("FF");
  });

  it("respects Never rests and prefers a pinned reliever", () => {
    const t = team();
    const may = t.byName.get("May")!;
    const a = mk("BenchA", "Back Pocket");
    const b = mk("BenchB", "Medium Defender");
    const never = planReset(input(t, [a, b], { May: 50, BenchA: 100, BenchB: 100 }, { policy: (id): RestPolicy | undefined => (id === may.PlayerID ? "never" : undefined) }));
    expect(never.swaps).toEqual([]);
    const pinned = planReset(input(t, [a, b], { May: 50, BenchA: 100, BenchB: 100 }, { pin: (id) => (id === may.PlayerID ? b.PlayerID : undefined) }));
    expect(pinned.swaps.map((s) => s.incoming.lname)).toEqual(["BenchB"]);
  });

  it("swaps at most four at a reset, tiredest first, and only with someone genuinely fresher", () => {
    const t = team();
    const bench = [mk("B1", "Inside Mid"), mk("B2", "Inside Mid"), mk("B3", "Outside Mid"), mk("B4", "Outside Mid"), mk("B5", "Inside Mid")];
    const tired = { Wing1: 50, Centre: 55, Wing2: 60, Mid1: 65, Mid2: 70 };
    const plan = planReset(input(t, bench, { ...tired, B1: 100, B2: 100, B3: 100, B4: 100, B5: 100 }));
    expect(plan.swaps.map((s) => s.outgoing.lname)).toEqual(["Wing1", "Centre", "Wing2", "Mid1"]);
    const stale = planReset(input(t, bench, { Wing1: 75, B1: 82, B2: 82, B3: 82, B4: 82, B5: 82 }));
    expect(stale.swaps).toEqual([]); // nobody on the bench is ready (< BENCH_READY_FITNESS)
  });
});

describe("rotation — bench balance", () => {
  it("auto-fill picks a bench that spreads across rotation groups", () => {
    const pool: Player[] = [];
    const archetypes: Archetype[] = ["Key Defender", "Key Defender", "Key Defender", "Back Pocket", "Medium Defender", "Half Back Flanker", "Half Back Flanker", "Outside Mid", "Outside Mid", "Inside Mid", "Inside Mid", "Inside Mid", "Ruck", "Ruck", "Medium Forward", "Medium Forward", "Key Forward", "Key Forward", "Small Forward", "Small Forward"];
    for (const a of archetypes) pool.push(mk(`P${pool.length}`, a, 70));
    // Five extra small forwards rated a touch higher than anyone else spare.
    for (let i = 0; i < 5; i++) pool.push(mk(`SF${i}`, "Small Forward", 74));
    pool.push(mk("SpareMid", "Inside Mid", 71), mk("SpareDef", "Medium Defender", 71));
    const lineup = autoFillLineup(pool);
    const bench = lineup.flatMap((id, i) => (POSITIONS[i] === "INT" ? [pool.find((p) => p.PlayerID === id)!] : []));
    const groups = new Set(bench.flatMap(specialistGroups));
    expect(groups.has("Midfield")).toBe(true);
    expect(groups.has("Defence")).toBe(true);
    expect(bench.filter((p) => p.archetype === "Small Forward").length).toBeLessThan(5);
  });

  it("flags groups no bench player covers", () => {
    const bench = [mk("A", "Small Forward"), mk("B", "Small Forward")];
    expect(uncoveredGroups(bench)).toContain("Ruck");
    expect(uncoveredGroups(bench)).not.toContain("Forward");
  });
});
