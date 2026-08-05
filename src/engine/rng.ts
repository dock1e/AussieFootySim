/**
 * Seeded PRNG — see ../../Engine.md "Tech stack": "Every match/season run
 * takes an explicit seed. Same seed + same inputs = same result — required
 * for reproducible balance runs and very useful for debugging a specific
 * weird match."
 *
 * mulberry32 — public-domain, fast, good-enough statistical quality for a
 * game simulation (not cryptographic). https://gist.github.com/tommyettinger/46a874533244883189143505d203312c
 */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed | 0;
  return function rng() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Convenience: an integer in [min, max], inclusive. */
export function rngInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

/** Convenience: pick one element of a non-empty array. */
export function rngChoice<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error("rngChoice: items must be non-empty");
  return items[Math.floor(rng() * items.length)];
}
