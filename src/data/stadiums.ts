/**
 * Venue-accurate stadium database — Sep 2026, Phase 10 round 104. Tyler's own
 * brief ("Ground Visualisation Spec.pdf" + attached report "Algorithmic
 * Simulation of AFL Stadiums: Geometric Modeling, Regulation Markings, and
 * Visual Identity Systems"): "typed per the report's AFLStadiumModels.ts
 * schema, seeded with all 20 venues from the report's venue table — verbatim
 * length, width, aspect ratio, superellipse exponent n, capacity, mowing
 * pattern and seat palette... the single source of truth for every number."
 * Every value below is copied from that report's own `AFLStadiumDatabase.json`
 * — none estimated or guessed. Full design record:
 * [[Venue-Accurate Ground Renderer]].
 *
 * Supersedes `data/grounds.ts` (the old 12-venue, pixel-based, synthetic-
 * ellipse `GROUND_CONFIGS` table) — deleted this round. See the design note
 * for the 12-of-20 id migration `clubGrounds.ts` now uses, and for why the
 * other 8 venues here are fully populated but not yet attached to any club.
 */

export type BoundaryShapeType = "superellipse" | "ellipse" | "elongated_flat_flank" | "asymmetrical_oval";

export type MowingPatternType = "concentric_ovals" | "transverse_stripes" | "checkerboard" | "radial";

export interface FieldMarkingsConfig {
  centreSquareWidth: number; // Regulatory 50.0m
  centreSquareLength: number; // Regulatory 50.0m
  centreCircleInnerDia: number; // Regulatory 3.0m
  centreCircleOuterDia: number; // Regulatory 10.0m
  goalSquareLength: number; // Regulatory 9.0m
  goalSquareWidth: number; // Regulatory 6.4m
  goalPostSpacing: number; // Regulatory 6.4m
  behindPostSpacing: number; // Regulatory 6.4m
  arcRadius: number; // Regulatory 50.0m
  interchangeGateWidth: number; // Regulatory 15.0m
}

export interface ArchitecturalFeatures {
  interchangeSide: "north" | "south" | "east" | "west";
  interchangeBenchOffsetMeters: number;
  homeBenchPosition: { x: number; y: number };
  awayBenchPosition: { x: number; y: number };
  coachesBoxPosition: { x: number; y: number; elevationLevel: number };
  playerRacePosition: { x: number; y: number; label: string };
  hasRetractableRoof: boolean;
  hasHeritageScoreboardHill: boolean;
}

export interface StadiumVisualTheme {
  primarySeatColor: string;
  secondarySeatColor: string;
  concourseColor: string;
  turfBaseColor: string;
  turfStripeColor: string;
  mowingPattern: MowingPatternType;
  mowingBandWidthMeters: number;
  lineMarkingColor: string;
  /** Normalized perimeter vertices [-1.0 to 1.0] — a rough seating-bowl outline, scaled relative to the boundary's own (a, b) by the renderer. */
  grandstandOutline: Array<{ x: number; y: number }>;
}

export interface AFLStadium {
  id: string;
  officialName: string;
  commonName: string;
  state: string;
  twentyYearGameCount: number;
  capacity: number;
  lengthMeters: number;
  widthMeters: number;
  aspectRatio: number;
  surfaceAreaSqMeters: number;
  shapeType: BoundaryShapeType;
  /** Parameter 'n' in |x/a|^n + |y/b|^n = 1. */
  superellipseExponent: number;
  /** a - 75.0m, precomputed by the report; `engine/groundGeometry.ts`'s own `corridorBuffer(a)` recomputes this live rather than trusting this field, but it's kept here verbatim as the report gave it (cross-checked equal for all 20 venues). */
  centerCorridorBufferMeters: number;
  markings: FieldMarkingsConfig;
  architecture: ArchitecturalFeatures;
  theme: StadiumVisualTheme;
}

/**
 * Every field here is identical across all 20 venues in the report — these
 * are Law 3's own regulation numbers, not venue geometry, so they're a single
 * shared constant rather than 20 copies of the same object.
 */
const STANDARD_MARKINGS: FieldMarkingsConfig = {
  centreSquareWidth: 50.0,
  centreSquareLength: 50.0,
  centreCircleInnerDia: 3.0,
  centreCircleOuterDia: 10.0,
  goalSquareLength: 9.0,
  goalSquareWidth: 6.4,
  goalPostSpacing: 6.4,
  behindPostSpacing: 6.4,
  arcRadius: 50.0,
  interchangeGateWidth: 15.0,
};

export const STADIUMS: AFLStadium[] = [
  {
    id: "mcg",
    officialName: "Melbourne Cricket Ground",
    commonName: "MCG",
    state: "VIC",
    twentyYearGameCount: 1020,
    capacity: 100024,
    lengthMeters: 161.4,
    widthMeters: 138.0,
    aspectRatio: 1.17,
    surfaceAreaSqMeters: 17656,
    shapeType: "superellipse",
    superellipseExponent: 2.08,
    centerCorridorBufferMeters: 5.7,
    markings: STANDARD_MARKINGS,
    architecture: {
      interchangeSide: "south",
      interchangeBenchOffsetMeters: 0.0,
      homeBenchPosition: { x: -16.0, y: 71.0 },
      awayBenchPosition: { x: 16.0, y: 71.0 },
      coachesBoxPosition: { x: 0.0, y: 82.0, elevationLevel: 2 },
      playerRacePosition: { x: -45.0, y: 62.0, label: "Ponsford Stand Race" },
      hasRetractableRoof: false,
      hasHeritageScoreboardHill: false,
    },
    theme: {
      primarySeatColor: "#1b4d3e",
      secondarySeatColor: "#3b444b",
      concourseColor: "#4a5043",
      turfBaseColor: "#2d682a",
      turfStripeColor: "#357732",
      mowingPattern: "concentric_ovals",
      mowingBandWidthMeters: 6.0,
      lineMarkingColor: "#ffffff",
      grandstandOutline: [
        { x: -1.25, y: 0.0 }, { x: -1.15, y: 0.6 }, { x: -0.85, y: 1.05 }, { x: 0.0, y: 1.25 },
        { x: 0.85, y: 1.05 }, { x: 1.15, y: 0.6 }, { x: 1.25, y: 0.0 }, { x: 1.15, y: -0.6 },
        { x: 0.85, y: -1.05 }, { x: 0.0, y: -1.25 }, { x: -0.85, y: -1.05 }, { x: -1.15, y: -0.6 },
      ],
    },
  },
  {
    id: "marvel",
    officialName: "Docklands Stadium",
    commonName: "Marvel Stadium",
    state: "VIC",
    twentyYearGameCount: 950,
    capacity: 56347,
    lengthMeters: 159.5,
    widthMeters: 128.8,
    aspectRatio: 1.24,
    surfaceAreaSqMeters: 16749,
    shapeType: "superellipse",
    superellipseExponent: 2.22,
    centerCorridorBufferMeters: 4.75,
    markings: STANDARD_MARKINGS,
    architecture: {
      interchangeSide: "west",
      interchangeBenchOffsetMeters: 0.0,
      homeBenchPosition: { x: -15.0, y: 66.0 },
      awayBenchPosition: { x: 15.0, y: 66.0 },
      coachesBoxPosition: { x: 0.0, y: 74.0, elevationLevel: 2 },
      playerRacePosition: { x: 0.0, y: 68.0, label: "Lockett Stand Tunnel" },
      hasRetractableRoof: true,
      hasHeritageScoreboardHill: false,
    },
    theme: {
      primarySeatColor: "#0b2265",
      secondarySeatColor: "#1e3d59",
      concourseColor: "#525252",
      turfBaseColor: "#296628",
      turfStripeColor: "#327730",
      mowingPattern: "transverse_stripes",
      mowingBandWidthMeters: 7.0,
      lineMarkingColor: "#ffffff",
      grandstandOutline: [
        { x: -1.35, y: -0.85 }, { x: 1.35, y: -0.85 }, { x: 1.35, y: 0.85 }, { x: -1.35, y: 0.85 },
      ],
    },
  },
  {
    id: "adelaide_oval",
    officialName: "Adelaide Oval",
    commonName: "Adelaide Oval",
    state: "SA",
    twentyYearGameCount: 260,
    capacity: 53583,
    lengthMeters: 167.2,
    widthMeters: 123.4,
    aspectRatio: 1.35,
    surfaceAreaSqMeters: 16205,
    shapeType: "ellipse",
    superellipseExponent: 2.0,
    centerCorridorBufferMeters: 8.6,
    markings: STANDARD_MARKINGS,
    architecture: {
      interchangeSide: "west",
      interchangeBenchOffsetMeters: 0.0,
      homeBenchPosition: { x: -16.0, y: 63.5 },
      awayBenchPosition: { x: 16.0, y: 63.5 },
      coachesBoxPosition: { x: 0.0, y: 75.0, elevationLevel: 3 },
      playerRacePosition: { x: -25.0, y: 64.0, label: "Western Stand Race" },
      hasRetractableRoof: false,
      hasHeritageScoreboardHill: true,
    },
    theme: {
      primarySeatColor: "#8b0000",
      secondarySeatColor: "#0c2340",
      concourseColor: "#c2b280",
      turfBaseColor: "#2f6b2c",
      turfStripeColor: "#397c36",
      mowingPattern: "concentric_ovals",
      mowingBandWidthMeters: 5.5,
      lineMarkingColor: "#ffffff",
      grandstandOutline: [
        { x: -1.25, y: 0.0 }, { x: -1.15, y: 0.8 }, { x: 0.0, y: 1.25 }, { x: 1.15, y: 0.8 },
        { x: 1.25, y: 0.0 }, { x: 1.05, y: -0.8 }, { x: 0.0, y: -1.05 }, { x: -1.05, y: -0.8 },
      ],
    },
  },
  {
    id: "kardinia_park",
    officialName: "Kardinia Park",
    commonName: "GMHBA Stadium",
    state: "VIC",
    twentyYearGameCount: 175,
    capacity: 40000,
    lengthMeters: 170.0,
    widthMeters: 115.0,
    aspectRatio: 1.48,
    surfaceAreaSqMeters: 16230,
    shapeType: "elongated_flat_flank",
    superellipseExponent: 2.35,
    centerCorridorBufferMeters: 10.0,
    markings: STANDARD_MARKINGS,
    architecture: {
      interchangeSide: "west",
      interchangeBenchOffsetMeters: 0.0,
      homeBenchPosition: { x: -16.0, y: 59.0 },
      awayBenchPosition: { x: 16.0, y: 59.0 },
      coachesBoxPosition: { x: 0.0, y: 68.0, elevationLevel: 2 },
      playerRacePosition: { x: 30.0, y: 58.0, label: "Selwood Stand Tunnel" },
      hasRetractableRoof: false,
      hasHeritageScoreboardHill: false,
    },
    theme: {
      primarySeatColor: "#001f3f",
      secondarySeatColor: "#ffffff",
      concourseColor: "#4b4f56",
      turfBaseColor: "#2b6a28",
      turfStripeColor: "#337930",
      mowingPattern: "transverse_stripes",
      mowingBandWidthMeters: 6.0,
      lineMarkingColor: "#ffffff",
      grandstandOutline: [
        { x: -1.4, y: -0.65 }, { x: -1.1, y: -0.75 }, { x: 1.1, y: -0.75 }, { x: 1.4, y: -0.65 },
        { x: 1.4, y: 0.65 }, { x: 1.1, y: 0.75 }, { x: -1.1, y: 0.75 }, { x: -1.4, y: 0.65 },
      ],
    },
  },
  {
    id: "scg",
    officialName: "Sydney Cricket Ground",
    commonName: "SCG",
    state: "NSW",
    twentyYearGameCount: 240,
    capacity: 48000,
    lengthMeters: 155.5,
    widthMeters: 136.0,
    aspectRatio: 1.14,
    surfaceAreaSqMeters: 16735,
    shapeType: "superellipse",
    superellipseExponent: 2.04,
    centerCorridorBufferMeters: 2.75,
    markings: STANDARD_MARKINGS,
    architecture: {
      interchangeSide: "south",
      interchangeBenchOffsetMeters: 0.0,
      homeBenchPosition: { x: -15.0, y: 69.5 },
      awayBenchPosition: { x: 15.0, y: 69.5 },
      coachesBoxPosition: { x: 0.0, y: 78.0, elevationLevel: 2 },
      playerRacePosition: { x: 0.0, y: 70.0, label: "Members Pavilion Race" },
      hasRetractableRoof: false,
      hasHeritageScoreboardHill: false,
    },
    theme: {
      primarySeatColor: "#154734",
      secondarySeatColor: "#003366",
      concourseColor: "#d4af37",
      turfBaseColor: "#2d6c29",
      turfStripeColor: "#367d32",
      mowingPattern: "concentric_ovals",
      mowingBandWidthMeters: 5.0,
      lineMarkingColor: "#ffffff",
      grandstandOutline: [
        { x: -1.2, y: 0.0 }, { x: -1.1, y: 0.75 }, { x: 0.0, y: 1.2 }, { x: 1.1, y: 0.75 },
        { x: 1.2, y: 0.0 }, { x: 1.1, y: -0.75 }, { x: 0.0, y: -1.2 }, { x: -1.1, y: -0.75 },
      ],
    },
  },
  {
    id: "gabba",
    officialName: "Brisbane Cricket Ground",
    commonName: "The Gabba",
    state: "QLD",
    twentyYearGameCount: 240,
    capacity: 42000,
    lengthMeters: 156.0,
    widthMeters: 138.0,
    aspectRatio: 1.13,
    surfaceAreaSqMeters: 17098,
    shapeType: "superellipse",
    superellipseExponent: 2.06,
    centerCorridorBufferMeters: 3.0,
    markings: STANDARD_MARKINGS,
    architecture: {
      interchangeSide: "south",
      interchangeBenchOffsetMeters: 0.0,
      homeBenchPosition: { x: -15.0, y: 70.5 },
      awayBenchPosition: { x: 15.0, y: 70.5 },
      coachesBoxPosition: { x: 0.0, y: 79.0, elevationLevel: 2 },
      playerRacePosition: { x: -30.0, y: 68.0, label: "Lions Dressing Room Tunnel" },
      hasRetractableRoof: false,
      hasHeritageScoreboardHill: false,
    },
    theme: {
      primarySeatColor: "#6f1632",
      secondarySeatColor: "#002b49",
      concourseColor: "#ffb81c",
      turfBaseColor: "#296926",
      turfStripeColor: "#327b2f",
      mowingPattern: "transverse_stripes",
      mowingBandWidthMeters: 6.5,
      lineMarkingColor: "#ffffff",
      grandstandOutline: [
        { x: -1.2, y: -0.85 }, { x: 1.2, y: -0.85 }, { x: 1.25, y: 0.0 }, { x: 1.2, y: 0.85 },
        { x: -1.2, y: 0.85 }, { x: -1.25, y: 0.0 },
      ],
    },
  },
  {
    id: "optus_stadium",
    officialName: "Perth Stadium",
    commonName: "Optus Stadium",
    state: "WA",
    twentyYearGameCount: 170,
    capacity: 61266,
    lengthMeters: 165.0,
    widthMeters: 130.0,
    aspectRatio: 1.27,
    surfaceAreaSqMeters: 17156,
    shapeType: "superellipse",
    superellipseExponent: 2.1,
    centerCorridorBufferMeters: 7.5,
    markings: STANDARD_MARKINGS,
    architecture: {
      interchangeSide: "south",
      interchangeBenchOffsetMeters: 0.0,
      homeBenchPosition: { x: -16.0, y: 66.5 },
      awayBenchPosition: { x: 16.0, y: 66.5 },
      coachesBoxPosition: { x: 0.0, y: 76.0, elevationLevel: 2 },
      playerRacePosition: { x: 0.0, y: 67.0, label: "Main Stadium Tunnel" },
      hasRetractableRoof: false,
      hasHeritageScoreboardHill: false,
    },
    theme: {
      primarySeatColor: "#9e472a",
      secondarySeatColor: "#007a87",
      concourseColor: "#4b382a",
      turfBaseColor: "#2a6c27",
      turfStripeColor: "#347e31",
      mowingPattern: "checkerboard",
      mowingBandWidthMeters: 7.0,
      lineMarkingColor: "#ffffff",
      grandstandOutline: [
        { x: -1.25, y: 0.0 }, { x: -1.15, y: 0.7 }, { x: 0.0, y: 1.25 }, { x: 1.15, y: 0.7 },
        { x: 1.25, y: 0.0 }, { x: 1.15, y: -0.7 }, { x: 0.0, y: -1.25 }, { x: -1.15, y: -0.7 },
      ],
    },
  },
  {
    id: "norwood_oval",
    officialName: "Norwood Oval",
    commonName: "Coopers Stadium",
    state: "SA",
    twentyYearGameCount: 8,
    capacity: 10000,
    lengthMeters: 164.8,
    widthMeters: 109.9,
    aspectRatio: 1.5,
    surfaceAreaSqMeters: 15168,
    shapeType: "elongated_flat_flank",
    superellipseExponent: 2.42,
    centerCorridorBufferMeters: 7.4,
    markings: STANDARD_MARKINGS,
    architecture: {
      interchangeSide: "south",
      interchangeBenchOffsetMeters: 0.0,
      homeBenchPosition: { x: -15.0, y: 56.5 },
      awayBenchPosition: { x: 15.0, y: 56.5 },
      coachesBoxPosition: { x: 0.0, y: 64.0, elevationLevel: 1 },
      playerRacePosition: { x: -25.0, y: 56.0, label: "Heritage Pavilion Race" },
      hasRetractableRoof: false,
      hasHeritageScoreboardHill: false,
    },
    theme: {
      primarySeatColor: "#8b0000",
      secondarySeatColor: "#1c2833",
      concourseColor: "#7f8c8d",
      turfBaseColor: "#276824",
      turfStripeColor: "#317b2e",
      mowingPattern: "transverse_stripes",
      mowingBandWidthMeters: 5.0,
      lineMarkingColor: "#ffffff",
      grandstandOutline: [
        { x: -1.35, y: -0.6 }, { x: 1.35, y: -0.6 }, { x: 1.35, y: 0.6 }, { x: -1.35, y: 0.6 },
      ],
    },
  },
  {
    id: "carrara",
    officialName: "Carrara Stadium",
    commonName: "People First Stadium",
    state: "QLD",
    twentyYearGameCount: 180,
    capacity: 25000,
    lengthMeters: 158.0,
    widthMeters: 134.0,
    aspectRatio: 1.18,
    surfaceAreaSqMeters: 16785,
    shapeType: "superellipse",
    superellipseExponent: 2.05,
    centerCorridorBufferMeters: 4.0,
    markings: STANDARD_MARKINGS,
    architecture: {
      interchangeSide: "west",
      interchangeBenchOffsetMeters: 0.0,
      homeBenchPosition: { x: -15.0, y: 68.5 },
      awayBenchPosition: { x: 15.0, y: 68.5 },
      coachesBoxPosition: { x: 0.0, y: 76.0, elevationLevel: 2 },
      playerRacePosition: { x: -20.0, y: 68.0, label: "Suns Tunnel" },
      hasRetractableRoof: false,
      hasHeritageScoreboardHill: false,
    },
    theme: {
      primarySeatColor: "#d32f2f",
      secondarySeatColor: "#fbc02d",
      concourseColor: "#546e7a",
      turfBaseColor: "#2e6d2a",
      turfStripeColor: "#377f33",
      mowingPattern: "transverse_stripes",
      mowingBandWidthMeters: 6.0,
      lineMarkingColor: "#ffffff",
      grandstandOutline: [
        { x: -1.2, y: -0.8 }, { x: 1.2, y: -0.8 }, { x: 1.2, y: 0.8 }, { x: -1.2, y: 0.8 },
      ],
    },
  },
  {
    id: "engie_stadium",
    officialName: "Sydney Showground Stadium",
    commonName: "ENGIE Stadium",
    state: "NSW",
    twentyYearGameCount: 119,
    capacity: 23500,
    lengthMeters: 164.0,
    widthMeters: 127.5,
    aspectRatio: 1.29,
    surfaceAreaSqMeters: 16944,
    shapeType: "superellipse",
    superellipseExponent: 2.18,
    centerCorridorBufferMeters: 7.0,
    markings: STANDARD_MARKINGS,
    architecture: {
      interchangeSide: "south",
      interchangeBenchOffsetMeters: 0.0,
      homeBenchPosition: { x: -15.0, y: 65.5 },
      awayBenchPosition: { x: 15.0, y: 65.5 },
      coachesBoxPosition: { x: 0.0, y: 74.0, elevationLevel: 2 },
      playerRacePosition: { x: 15.0, y: 65.0, label: "Giants Race" },
      hasRetractableRoof: false,
      hasHeritageScoreboardHill: false,
    },
    theme: {
      primarySeatColor: "#f47920",
      secondarySeatColor: "#4b4f54",
      concourseColor: "#616161",
      turfBaseColor: "#2b6a28",
      turfStripeColor: "#347c30",
      mowingPattern: "transverse_stripes",
      mowingBandWidthMeters: 6.0,
      lineMarkingColor: "#ffffff",
      grandstandOutline: [
        { x: -1.25, y: -0.8 }, { x: 1.25, y: -0.8 }, { x: 1.25, y: 0.8 }, { x: -1.25, y: 0.8 },
      ],
    },
  },
  {
    id: "york_park",
    officialName: "York Park",
    commonName: "University of Tasmania Stadium",
    state: "TAS",
    twentyYearGameCount: 100,
    capacity: 15615,
    lengthMeters: 170.0,
    widthMeters: 140.0,
    aspectRatio: 1.21,
    surfaceAreaSqMeters: 18970,
    shapeType: "superellipse",
    superellipseExponent: 2.08,
    centerCorridorBufferMeters: 10.0,
    markings: STANDARD_MARKINGS,
    architecture: {
      interchangeSide: "west",
      interchangeBenchOffsetMeters: 0.0,
      homeBenchPosition: { x: -15.0, y: 71.5 },
      awayBenchPosition: { x: 15.0, y: 71.5 },
      coachesBoxPosition: { x: 0.0, y: 80.0, elevationLevel: 2 },
      playerRacePosition: { x: -10.0, y: 71.0, label: "Carlton & United Stand Race" },
      hasRetractableRoof: false,
      hasHeritageScoreboardHill: false,
    },
    theme: {
      primarySeatColor: "#003a70",
      secondarySeatColor: "#ffffff",
      concourseColor: "#5c6f84",
      turfBaseColor: "#296825",
      turfStripeColor: "#32772e",
      mowingPattern: "concentric_ovals",
      mowingBandWidthMeters: 6.0,
      lineMarkingColor: "#ffffff",
      grandstandOutline: [
        { x: -1.2, y: -0.85 }, { x: 1.2, y: -0.85 }, { x: 1.2, y: 0.85 }, { x: -1.2, y: 0.85 },
      ],
    },
  },
  {
    id: "manuka_oval",
    officialName: "Manuka Oval",
    commonName: "Manuka Oval",
    state: "ACT",
    twentyYearGameCount: 65,
    capacity: 15000,
    lengthMeters: 168.0,
    widthMeters: 135.0,
    aspectRatio: 1.24,
    surfaceAreaSqMeters: 18013,
    shapeType: "superellipse",
    superellipseExponent: 2.06,
    centerCorridorBufferMeters: 9.0,
    markings: STANDARD_MARKINGS,
    architecture: {
      interchangeSide: "west",
      interchangeBenchOffsetMeters: 0.0,
      homeBenchPosition: { x: -15.0, y: 69.0 },
      awayBenchPosition: { x: 15.0, y: 69.0 },
      coachesBoxPosition: { x: 0.0, y: 77.0, elevationLevel: 2 },
      playerRacePosition: { x: 0.0, y: 70.0, label: "Bradman Stand Race" },
      hasRetractableRoof: false,
      hasHeritageScoreboardHill: false,
    },
    theme: {
      primarySeatColor: "#702082",
      secondarySeatColor: "#007a87",
      concourseColor: "#78866b",
      turfBaseColor: "#2c6c29",
      turfStripeColor: "#367d33",
      mowingPattern: "concentric_ovals",
      mowingBandWidthMeters: 6.0,
      lineMarkingColor: "#ffffff",
      grandstandOutline: [
        { x: -1.2, y: 0.0 }, { x: -1.0, y: 0.8 }, { x: 0.0, y: 1.15 }, { x: 1.0, y: 0.8 },
        { x: 1.2, y: 0.0 }, { x: 1.0, y: -0.8 }, { x: 0.0, y: -1.15 }, { x: -1.0, y: -0.8 },
      ],
    },
  },
  {
    id: "stadium_australia",
    officialName: "Stadium Australia",
    commonName: "Accor Stadium",
    state: "NSW",
    twentyYearGameCount: 56,
    capacity: 82500,
    lengthMeters: 160.0,
    widthMeters: 119.0,
    aspectRatio: 1.34,
    surfaceAreaSqMeters: 15592,
    shapeType: "superellipse",
    superellipseExponent: 2.25,
    centerCorridorBufferMeters: 5.0,
    markings: STANDARD_MARKINGS,
    architecture: {
      interchangeSide: "west",
      interchangeBenchOffsetMeters: 0.0,
      homeBenchPosition: { x: -15.0, y: 61.0 },
      awayBenchPosition: { x: 15.0, y: 61.0 },
      coachesBoxPosition: { x: 0.0, y: 70.0, elevationLevel: 3 },
      playerRacePosition: { x: -35.0, y: 60.0, label: "South-West Tunnel" },
      hasRetractableRoof: false,
      hasHeritageScoreboardHill: false,
    },
    theme: {
      primarySeatColor: "#1e3a8a",
      secondarySeatColor: "#e5e7eb",
      concourseColor: "#374151",
      turfBaseColor: "#296726",
      turfStripeColor: "#32772f",
      mowingPattern: "transverse_stripes",
      mowingBandWidthMeters: 6.0,
      lineMarkingColor: "#ffffff",
      grandstandOutline: [
        { x: -1.3, y: -0.8 }, { x: 1.3, y: -0.8 }, { x: 1.3, y: 0.8 }, { x: -1.3, y: 0.8 },
      ],
    },
  },
  {
    id: "bellerive_oval",
    officialName: "Bellerive Oval",
    commonName: "Ninja Stadium",
    state: "TAS",
    twentyYearGameCount: 43,
    capacity: 19500,
    lengthMeters: 160.0,
    widthMeters: 124.0,
    aspectRatio: 1.29,
    surfaceAreaSqMeters: 15757,
    shapeType: "asymmetrical_oval",
    superellipseExponent: 2.06,
    centerCorridorBufferMeters: 5.0,
    markings: STANDARD_MARKINGS,
    architecture: {
      interchangeSide: "south",
      interchangeBenchOffsetMeters: 0.0,
      homeBenchPosition: { x: -15.0, y: 63.5 },
      awayBenchPosition: { x: 15.0, y: 63.5 },
      coachesBoxPosition: { x: 0.0, y: 72.0, elevationLevel: 2 },
      playerRacePosition: { x: 20.0, y: 63.0, label: "Southern Stand Race" },
      hasRetractableRoof: false,
      hasHeritageScoreboardHill: true,
    },
    theme: {
      primarySeatColor: "#134e5e",
      secondarySeatColor: "#71b280",
      concourseColor: "#606c38",
      turfBaseColor: "#2d6b2b",
      turfStripeColor: "#367d34",
      mowingPattern: "concentric_ovals",
      mowingBandWidthMeters: 5.5,
      lineMarkingColor: "#ffffff",
      grandstandOutline: [
        { x: -1.2, y: -0.8 }, { x: 1.2, y: -0.8 }, { x: 1.2, y: 0.8 }, { x: -1.2, y: 0.8 },
      ],
    },
  },
  {
    id: "subiaco_oval",
    officialName: "Subiaco Oval",
    commonName: "Domain Stadium",
    state: "WA",
    twentyYearGameCount: 280,
    capacity: 43500,
    lengthMeters: 175.0,
    widthMeters: 122.0,
    aspectRatio: 1.43,
    surfaceAreaSqMeters: 16926,
    shapeType: "superellipse",
    superellipseExponent: 2.05,
    centerCorridorBufferMeters: 12.5,
    markings: STANDARD_MARKINGS,
    architecture: {
      interchangeSide: "north",
      interchangeBenchOffsetMeters: 0.0,
      homeBenchPosition: { x: -16.0, y: -62.5 },
      awayBenchPosition: { x: 16.0, y: -62.5 },
      coachesBoxPosition: { x: 0.0, y: -72.0, elevationLevel: 2 },
      playerRacePosition: { x: -30.0, y: -62.0, label: "Subiaco Tunnel" },
      hasRetractableRoof: false,
      hasHeritageScoreboardHill: false,
    },
    theme: {
      primarySeatColor: "#003b46",
      secondarySeatColor: "#07575b",
      concourseColor: "#66a5ad",
      turfBaseColor: "#296628",
      turfStripeColor: "#327730",
      mowingPattern: "concentric_ovals",
      mowingBandWidthMeters: 6.0,
      lineMarkingColor: "#ffffff",
      grandstandOutline: [
        { x: -1.3, y: 0.0 }, { x: -1.15, y: 0.7 }, { x: 0.0, y: 1.2 }, { x: 1.15, y: 0.7 },
        { x: 1.3, y: 0.0 }, { x: 1.15, y: -0.7 }, { x: 0.0, y: -1.2 }, { x: -1.15, y: -0.7 },
      ],
    },
  },
  {
    id: "football_park",
    officialName: "Football Park",
    commonName: "AAMI Stadium",
    state: "SA",
    twentyYearGameCount: 195,
    capacity: 51240,
    lengthMeters: 165.0,
    widthMeters: 133.0,
    aspectRatio: 1.24,
    surfaceAreaSqMeters: 17398,
    shapeType: "superellipse",
    superellipseExponent: 2.05,
    centerCorridorBufferMeters: 7.5,
    markings: STANDARD_MARKINGS,
    architecture: {
      interchangeSide: "west",
      interchangeBenchOffsetMeters: 0.0,
      homeBenchPosition: { x: -15.0, y: 68.0 },
      awayBenchPosition: { x: 15.0, y: 68.0 },
      coachesBoxPosition: { x: 0.0, y: 76.0, elevationLevel: 2 },
      playerRacePosition: { x: 0.0, y: 68.0, label: "Main Tunnel" },
      hasRetractableRoof: false,
      hasHeritageScoreboardHill: false,
    },
    theme: {
      primarySeatColor: "#cc0000",
      secondarySeatColor: "#002b49",
      concourseColor: "#4a525a",
      turfBaseColor: "#2b6a28",
      turfStripeColor: "#347d31",
      mowingPattern: "transverse_stripes",
      mowingBandWidthMeters: 6.0,
      lineMarkingColor: "#ffffff",
      grandstandOutline: [
        { x: -1.25, y: -0.85 }, { x: 1.25, y: -0.85 }, { x: 1.25, y: 0.85 }, { x: -1.25, y: 0.85 },
      ],
    },
  },
  {
    id: "marrara_oval",
    officialName: "Marrara Oval",
    commonName: "TIO Stadium",
    state: "NT",
    twentyYearGameCount: 32,
    capacity: 12000,
    lengthMeters: 175.0,
    widthMeters: 135.0,
    aspectRatio: 1.3,
    surfaceAreaSqMeters: 18730,
    shapeType: "superellipse",
    superellipseExponent: 2.05,
    centerCorridorBufferMeters: 12.5,
    markings: STANDARD_MARKINGS,
    architecture: {
      interchangeSide: "west",
      interchangeBenchOffsetMeters: 0.0,
      homeBenchPosition: { x: -15.0, y: 69.0 },
      awayBenchPosition: { x: 15.0, y: 69.0 },
      coachesBoxPosition: { x: 0.0, y: 76.0, elevationLevel: 2 },
      playerRacePosition: { x: 0.0, y: 69.0, label: "Bonson Stand Race" },
      hasRetractableRoof: false,
      hasHeritageScoreboardHill: true,
    },
    theme: {
      primarySeatColor: "#b83a24",
      secondarySeatColor: "#e08137",
      concourseColor: "#8d7055",
      turfBaseColor: "#296627",
      turfStripeColor: "#327730",
      mowingPattern: "transverse_stripes",
      mowingBandWidthMeters: 6.5,
      lineMarkingColor: "#ffffff",
      grandstandOutline: [
        { x: -1.2, y: -0.8 }, { x: 1.2, y: -0.8 }, { x: 1.2, y: 0.8 }, { x: -1.2, y: 0.8 },
      ],
    },
  },
  {
    id: "eureka_stadium",
    officialName: "Eureka Stadium",
    commonName: "Mars Stadium",
    state: "VIC",
    twentyYearGameCount: 15,
    capacity: 11000,
    lengthMeters: 168.0,
    widthMeters: 134.0,
    aspectRatio: 1.25,
    surfaceAreaSqMeters: 17943,
    shapeType: "superellipse",
    superellipseExponent: 2.08,
    centerCorridorBufferMeters: 9.0,
    markings: STANDARD_MARKINGS,
    architecture: {
      interchangeSide: "west",
      interchangeBenchOffsetMeters: 0.0,
      homeBenchPosition: { x: -15.0, y: 68.5 },
      awayBenchPosition: { x: 15.0, y: 68.5 },
      coachesBoxPosition: { x: 0.0, y: 76.0, elevationLevel: 2 },
      playerRacePosition: { x: -15.0, y: 68.0, label: "Western Stand Race" },
      hasRetractableRoof: false,
      hasHeritageScoreboardHill: true,
    },
    theme: {
      primarySeatColor: "#1c3f60",
      secondarySeatColor: "#ffffff",
      concourseColor: "#4b5320",
      turfBaseColor: "#2a6727",
      turfStripeColor: "#32772f",
      mowingPattern: "transverse_stripes",
      mowingBandWidthMeters: 6.0,
      lineMarkingColor: "#ffffff",
      grandstandOutline: [
        { x: -1.2, y: -0.8 }, { x: 1.2, y: -0.8 }, { x: 1.2, y: 0.8 }, { x: -1.2, y: 0.8 },
      ],
    },
  },
  {
    id: "cazalys_stadium",
    officialName: "Cazaly's Stadium",
    commonName: "Cazaly's Stadium",
    state: "QLD",
    twentyYearGameCount: 14,
    capacity: 13000,
    lengthMeters: 163.7,
    widthMeters: 139.8,
    aspectRatio: 1.17,
    surfaceAreaSqMeters: 18110,
    shapeType: "superellipse",
    superellipseExponent: 2.04,
    centerCorridorBufferMeters: 6.85,
    markings: STANDARD_MARKINGS,
    architecture: {
      interchangeSide: "south",
      interchangeBenchOffsetMeters: 0.0,
      homeBenchPosition: { x: -15.0, y: 71.0 },
      awayBenchPosition: { x: 15.0, y: 71.0 },
      coachesBoxPosition: { x: 0.0, y: 78.0, elevationLevel: 2 },
      playerRacePosition: { x: 0.0, y: 71.0, label: "Main Grandstand Race" },
      hasRetractableRoof: false,
      hasHeritageScoreboardHill: false,
    },
    theme: {
      primarySeatColor: "#005a36",
      secondarySeatColor: "#e6a100",
      concourseColor: "#4a5d4e",
      turfBaseColor: "#2b6d28",
      turfStripeColor: "#357f31",
      mowingPattern: "concentric_ovals",
      mowingBandWidthMeters: 6.0,
      lineMarkingColor: "#ffffff",
      grandstandOutline: [
        { x: -1.2, y: -0.85 }, { x: 1.2, y: -0.85 }, { x: 1.2, y: 0.85 }, { x: -1.2, y: 0.85 },
      ],
    },
  },
  {
    id: "traeger_park",
    officialName: "Traeger Park",
    commonName: "TIO Traeger Park",
    state: "NT",
    twentyYearGameCount: 12,
    capacity: 10000,
    lengthMeters: 172.0,
    widthMeters: 132.0,
    aspectRatio: 1.3,
    surfaceAreaSqMeters: 18000,
    shapeType: "superellipse",
    superellipseExponent: 2.05,
    centerCorridorBufferMeters: 11.0,
    markings: STANDARD_MARKINGS,
    architecture: {
      interchangeSide: "west",
      interchangeBenchOffsetMeters: 0.0,
      homeBenchPosition: { x: -15.0, y: 67.5 },
      awayBenchPosition: { x: 15.0, y: 67.5 },
      coachesBoxPosition: { x: 0.0, y: 74.0, elevationLevel: 2 },
      playerRacePosition: { x: 0.0, y: 67.0, label: "Main Pavilion Tunnel" },
      hasRetractableRoof: false,
      hasHeritageScoreboardHill: false,
    },
    theme: {
      primarySeatColor: "#a04000",
      secondarySeatColor: "#2e4053",
      concourseColor: "#d35400",
      turfBaseColor: "#296627",
      turfStripeColor: "#337930",
      mowingPattern: "transverse_stripes",
      mowingBandWidthMeters: 6.5,
      lineMarkingColor: "#ffffff",
      grandstandOutline: [
        { x: -1.2, y: -0.8 }, { x: 1.2, y: -0.8 }, { x: 1.2, y: 0.8 }, { x: -1.2, y: 0.8 },
      ],
    },
  },
];

/** O(1) lookup by id — direct analog of `grounds.ts`'s old `GROUND_CONFIGS[id]` indexing convention. */
export const STADIUM_CONFIGS: Record<string, AFLStadium> = Object.fromEntries(STADIUMS.map((s) => [s.id, s]));

export const DEFAULT_STADIUM_ID = "mcg";

/** Safe lookup — never throws on an unrecognised id, matching this codebase's established "no evidence, no guess, no crash" convention (falls back to the MCG, same default `clubGrounds.ts`'s own `groundForMatch` already used). */
export function getStadium(id: string): AFLStadium {
  return STADIUM_CONFIGS[id] ?? STADIUM_CONFIGS[DEFAULT_STADIUM_ID];
}
