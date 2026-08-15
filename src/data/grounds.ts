/**
 * Per-ground shape config — Aug 2026, Phase 10 round 12. Full research and
 * the numeric sweep this table's values come from: the vault's
 * "Ground Shapes - Multi-Stadium Design" note.
 *
 * Tyler's ask: give real venues (MCG, SCG, Adelaide Oval, Optus Stadium, the
 * Gabba, Marvel Stadium, Kardinia Park) subtly different long/narrow-vs-
 * short/wide ground shapes, with the app's existing default ground standing
 * in for the MCG. The round 11 research answered the natural follow-up
 * question first (does supporting 7 shapes change the corner-smoothing
 * approach?) before any of this was built: a bulge sweep across all seven
 * ratios below, using today's exact tuned `capFraction`/`roundFraction`/
 * `arcRadiusPullback`, stayed inside a 1.9-2.3px band the whole way — no
 * algorithm change needed, only this data-shape one. That's why every ground
 * below shares identical `capFraction`/`roundFraction`/`arcRadiusPullback`
 * values rather than each getting its own hand-tuned number; only
 * `groundHeight` (and therefore each ground's own length:width ratio)
 * actually varies.
 *
 * `groundHeight` derivation: each venue's real length:width ratio
 * (tomgorey.com's satellite-traced measurements, cross-verified line-for-line
 * against Tyler's own pasted dimension table) is compressed by one shared
 * factor — today's existing default ratio (`rx:ry` = 498:337 = 1.478) divided
 * by a real MCG's ratio (161.6:138.5 = 1.167) ≈ 1.267 — so the MCG entry
 * reproduces `GROUND_HEIGHT`'s existing shipped value (702) exactly, with
 * zero visible change to a ground shape Tyler has already approved through
 * eleven rounds of iteration, while every other venue gets a proportionally
 * faithful synthetic ratio relative to it. This is a deliberate screen-fit
 * simplification, not literal real-world scale — the design note discloses
 * that honestly, same as `ground.ts`'s own `GROUND_HEIGHT` comment has since
 * Phase 10 round 2.
 *
 * Deliberately NOT part of this config: goal-square/post sizing
 * (`GOAL_SQUARE_HALF_WIDTH`/`GOAL_SQUARE_DEPTH`/`POST_SPACING`/post widths,
 * all in MatchCanvas.tsx). Those dimensions are fixed by the real AFL Laws of
 * the Game identically on every ground — unlike overall ground length/width,
 * which the Laws deliberately leave a wide 135-185m x 110-155m range for
 * (see the design note's "AFL's own official size rule is extremely loose"
 * finding) — so making them vary per ground here would move *away* from
 * realism, not toward it.
 */
export interface GroundConfig {
  /** Stable key. Also the intended lookup key once a ground/stadium selector is built (not yet — see the design note's "recommended path"). */
  id: string;
  /** Display name — matches the corresponding Stadium Database vault page where one exists, so a future selector can cross-link cleanly. */
  name: string;
  /** Real length x width, metres (tomgorey.com, Aug 2026 research). Reference/display only — never read by any on-screen pixel math below. */
  realDimensions: { lengthM: number; widthM: number };
  /** Canvas pixel height. Paired with the shared, ground-independent GROUND_WIDTH (ground.ts) to set this ground's own aspect ratio — everything else (turf inset, corner smoothing, 50m arc, centre square, goal posts) derives from this exactly the way it always has for the single default ground, since those formulas were already expressed as fractions of rx/ry rather than hardcoded pixels. */
  groundHeight: number;
  /** Flat-cap half-angle fraction — see MatchCanvas.tsx's `flatCapEllipsePath`. Shared across every ground per the round 11 finding above. */
  capFraction: number;
  /** How far back into the curve each corner's smoothing reaches — see MatchCanvas.tsx's `GROUND_CAP_ROUND_FRACTION` history (rounds 8-9). Shared across every ground per the round 11 finding above. */
  roundFraction: number;
  /** Multiplier pulling the 50m arc back toward the goal line — see MatchCanvas.tsx's round 9 note. Shared across every ground per the round 11 finding above. */
  arcRadiusPullback: number;
}

const SHARED_CAP_FRACTION = 0.0523; // ground.ts's GROUND_END_CAP_FRACTION, unchanged
const SHARED_ROUND_FRACTION = 0.08; // MatchCanvas.tsx's GROUND_CAP_ROUND_FRACTION, unchanged
const SHARED_ARC_RADIUS_PULLBACK = 0.93; // MatchCanvas.tsx's ARC_RADIUS_PULLBACK, unchanged

export const GROUND_CONFIGS: Record<string, GroundConfig> = {
  mcg: {
    id: "mcg",
    name: "Melbourne Cricket Ground",
    realDimensions: { lengthM: 161.6, widthM: 138.5 },
    groundHeight: 702, // today's existing default, byte-for-byte unchanged — anchors the compression factor for every other row
    capFraction: SHARED_CAP_FRACTION,
    roundFraction: SHARED_ROUND_FRACTION,
    arcRadiusPullback: SHARED_ARC_RADIUS_PULLBACK,
  },
  scg: {
    id: "scg",
    name: "Sydney Cricket Ground",
    realDimensions: { lengthM: 155.3, widthM: 135.2 },
    groundHeight: 713,
    capFraction: SHARED_CAP_FRACTION,
    roundFraction: SHARED_ROUND_FRACTION,
    arcRadiusPullback: SHARED_ARC_RADIUS_PULLBACK,
  },
  gabba: {
    id: "gabba",
    name: "The Gabba",
    realDimensions: { lengthM: 156.3, widthM: 135.8 },
    groundHeight: 711,
    capFraction: SHARED_CAP_FRACTION,
    roundFraction: SHARED_ROUND_FRACTION,
    arcRadiusPullback: SHARED_ARC_RADIUS_PULLBACK,
  },
  marvel: {
    id: "marvel",
    name: "Marvel Stadium",
    realDimensions: { lengthM: 155.4, widthM: 123.3 },
    groundHeight: 652,
    capFraction: SHARED_CAP_FRACTION,
    roundFraction: SHARED_ROUND_FRACTION,
    arcRadiusPullback: SHARED_ARC_RADIUS_PULLBACK,
  },
  optus: {
    id: "optus",
    name: "Optus Stadium",
    realDimensions: { lengthM: 165.1, widthM: 129.7 },
    groundHeight: 646,
    capFraction: SHARED_CAP_FRACTION,
    roundFraction: SHARED_ROUND_FRACTION,
    arcRadiusPullback: SHARED_ARC_RADIUS_PULLBACK,
  },
  adelaideOval: {
    id: "adelaideOval",
    name: "Adelaide Oval",
    realDimensions: { lengthM: 167.2, widthM: 123.4 },
    groundHeight: 608,
    capFraction: SHARED_CAP_FRACTION,
    roundFraction: SHARED_ROUND_FRACTION,
    arcRadiusPullback: SHARED_ARC_RADIUS_PULLBACK,
  },
  kardiniaPark: {
    id: "kardiniaPark",
    name: "Kardinia Park",
    realDimensions: { lengthM: 170.1, widthM: 113.1 },
    groundHeight: 551,
    capFraction: SHARED_CAP_FRACTION,
    roundFraction: SHARED_ROUND_FRACTION,
    arcRadiusPullback: SHARED_ARC_RADIUS_PULLBACK,
  },

  /**
   * Aug 2026, Phase 10 round 14 (Tyler: "Build just the smaller scope
   * fixture" - greenlighting the "Layer A" ground-*selection* build from the
   * vault's "Ground Selection - Fixture-Driven Home Grounds" note) - 5 more
   * venues, same tomgorey.com satellite-traced source and exact same
   * compression formula as the 7 above (re-derived and verified to reproduce
   * every one of those 7's exact shipped `groundHeight` before being applied
   * here - see `scripts/.compute_new_ground_heights.ts.throwaway`). These
   * fill two different real gaps the round 13 research found:
   *
   * `engie`/`peopleFirst` are the two clubs (GWS, Gold Coast) whose real
   * primary home ground had no shape at all - round 11's original 7-ground
   * list was scoped to "iconic" grounds for visual variety, not full
   * 18-club coverage.
   *
   * `tasmania`/`tio`/`manuka` are the away-designated-home-game *exception*
   * venues Tyler named (Tasmania, Darwin, Manuka) - confirmed for real
   * against the live 2026 AFL fixture in round 13's research. Consumed by
   * `src/data/clubGrounds.ts`'s `GROUND_EXCEPTIONS` table, not by any
   * club's primary-ground mapping.
   */
  engie: {
    id: "engie",
    name: "ENGIE Stadium",
    realDimensions: { lengthM: 161.1, widthM: 127.2 }, // tomgorey.com's "Sydney Showground" row - same physical venue, renamed several times (GIANTS/Spotless/Sydney Showground/ENGIE Stadium)
    groundHeight: 649,
    capFraction: SHARED_CAP_FRACTION,
    roundFraction: SHARED_ROUND_FRACTION,
    arcRadiusPullback: SHARED_ARC_RADIUS_PULLBACK,
  },
  peopleFirst: {
    id: "peopleFirst",
    name: "People First Stadium",
    realDimensions: { lengthM: 157.4, widthM: 131.5 }, // tomgorey.com's "Carrara Stadium" row - same venue (Carrara/Metricon/Heritage Bank/People First Stadium)
    groundHeight: 685,
    capFraction: SHARED_CAP_FRACTION,
    roundFraction: SHARED_ROUND_FRACTION,
    arcRadiusPullback: SHARED_ARC_RADIUS_PULLBACK,
  },
  tasmania: {
    id: "tasmania",
    name: "University of Tasmania Stadium",
    realDimensions: { lengthM: 160.8, widthM: 129.7 }, // tomgorey.com's "UTAS Stadium" row - Launceston, Hawthorn's confirmed Tasmania exception venue (distinct from Blundstone Arena/Hobart, which no club currently designates a home game at per round 13's research)
    groundHeight: 662,
    capFraction: SHARED_CAP_FRACTION,
    roundFraction: SHARED_ROUND_FRACTION,
    arcRadiusPullback: SHARED_ARC_RADIUS_PULLBACK,
  },
  tio: {
    id: "tio",
    name: "TIO Stadium",
    realDimensions: { lengthM: 164.1, widthM: 131.0 }, // tomgorey.com's "Marrara Oval" row - Darwin; TIO Stadium is Marrara Oval's naming-rights name, confirmed the same venue (not the smaller, separate "Darwin Football Stadium" in the same sporting precinct)
    groundHeight: 656,
    capFraction: SHARED_CAP_FRACTION,
    roundFraction: SHARED_ROUND_FRACTION,
    arcRadiusPullback: SHARED_ARC_RADIUS_PULLBACK,
  },
  manuka: {
    id: "manuka",
    name: "Manuka Oval",
    realDimensions: { lengthM: 159.7, widthM: 133.0 }, // tomgorey.com's "Manuka Oval" row - Canberra, GWS's confirmed Manuka exception venue
    groundHeight: 683,
    capFraction: SHARED_CAP_FRACTION,
    roundFraction: SHARED_ROUND_FRACTION,
    arcRadiusPullback: SHARED_ARC_RADIUS_PULLBACK,
  },
};

/**
 * Aug 2026, Phase 10 round 14 — a real ground selector exists now
 * (`src/data/clubGrounds.ts`'s `groundForMatch`), so this is no longer a
 * frozen constant: `let`, plus `setActiveGroundConfig` below, so switching
 * which ground is "active" mid-session is possible without a page reload.
 * ES module imports are *live bindings*, not one-time value copies — every
 * file that does `import { ACTIVE_GROUND } from "./grounds"` and reads the
 * bare identifier (not destructured into its own separately-cached local)
 * sees the current value automatically, including `MatchCanvas.tsx`'s own
 * `ACTIVE_GROUND.arcRadiusPullback` read inside `drawGround` (already
 * re-read fresh every animation frame, so it needed no further change).
 * `engine/ground.ts`'s `GROUND_HEIGHT`/`GROUND_END_CAP_FRACTION`/`CENTER_Y`
 * are the one place this alone isn't enough — those hoist a *derived* value
 * into their own separate frozen bindings rather than reading `.groundHeight`
 * fresh at each of their own many call sites, so they need their own
 * `setActiveGround` (that file's own, not this one) to stay in sync — see
 * that function's doc comment for why.
 */
export const DEFAULT_GROUND_ID = "mcg";
export let ACTIVE_GROUND: GroundConfig = GROUND_CONFIGS[DEFAULT_GROUND_ID];

/** The only place ACTIVE_GROUND is ever reassigned — everything else only ever reads it. Called by engine/ground.ts's own setActiveGround, which is the real public entry point (also re-syncs that file's derived constants) — nothing outside this file and that one should need to call this directly. */
export function setActiveGroundConfig(config: GroundConfig): void {
  ACTIVE_GROUND = config;
}
