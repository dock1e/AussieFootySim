/**
 * Round C151 scratch calibration — NOT part of the committed pipeline. Numerically fits the
 * proven-trajectory upside-cap shape (BASE_CAP + YOUTH_BONUS_PER_YEAR * max(0, MAX_QUALIFYING_AGE-age))
 * against Tyler's own year-by-year Watson/Darcy targets, using the existing shrinkage-weighted blend
 * structure (not a max()) so the change stays a parameter widening, not a mechanism redesign.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import type { Player } from "../src/types/player.ts";
import { potentialCeilingFor } from "../src/engine/progression.ts";
import { draftCapitalScore } from "../src/engine/draftCapital.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "..", "data", "players_master.csv");
const players: Player[] = parseCsvToObjects(readFileSync(CSV_PATH, "utf-8")).map(coerceRow);

function potAgeFactor(age: number) { return Math.max(0.1, Math.min(1, (30 - age) / 12)); }
function shrinkageWeight(games: number) { return games <= 0 ? 0 : games / (games + 30); }

const CURRENT_AGE_2026 = { "Nick Watson": 21, "Sam Darcy": 23 };

// year, ovr(target), pot(target), careerGamesAsOfYear (approx real cumulative games)
const cases: { name: string; year: number; ovrTarget: number; potTarget: number; careerGames: number }[] = [
  { name: "Nick Watson", year: 2024, ovrTarget: 64, potTarget: 94, careerGames: 18 },
  { name: "Nick Watson", year: 2025, ovrTarget: 72, potTarget: 94, careerGames: 43 },
  { name: "Nick Watson", year: 2026, ovrTarget: 85, potTarget: 100, careerGames: 64 },
  { name: "Sam Darcy", year: 2022, ovrTarget: 66, potTarget: 99, careerGames: 4 },
  { name: "Sam Darcy", year: 2023, ovrTarget: 71, potTarget: 99, careerGames: 7 },
  { name: "Sam Darcy", year: 2024, ovrTarget: 82, potTarget: 101, careerGames: 28 },
  { name: "Sam Darcy", year: 2025, ovrTarget: 88, potTarget: 104, careerGames: 45 },
];

function paramsFor(name: string) {
  const p = players.find((x) => (x.realFullName ?? `${x.fname} ${x.lname}`) === name)!;
  const ceiling = potentialCeilingFor(p);
  const capScore = draftCapitalScore(p)!;
  return { ceiling, capScore, currentAge: (CURRENT_AGE_2026 as any)[name] as number };
}

function gapFor(name: string, year: number, careerGames: number, baseCap: number, youthBonusPerYear: number, blendMode: "shrinkage" | "max" | "fixed50", maxQualifyingAge = 23) {
  const { ceiling, capScore, currentAge } = paramsFor(name);
  const age = currentAge - (2026 - year);
  const effGames = careerGames + 60; // PROVEN_TRAJECTORY_GAMES_BONUS, both qualify at every historical year in this exercise
  const weight = shrinkageWeight(effGames);
  const cap = baseCap + youthBonusPerYear * Math.max(0, maxQualifyingAge - age);
  const upsideAttr = Math.max(0, (ceiling - 70) / 40) * cap;
  const upsideDraft = Math.max(0, (capScore - 50) / 50) * cap;
  let blended: number;
  if (blendMode === "max") blended = Math.max(upsideAttr, upsideDraft);
  else if (blendMode === "fixed50") blended = 0.5 * upsideAttr + 0.5 * upsideDraft;
  else blended = weight * upsideAttr + (1 - weight) * upsideDraft;
  const af = potAgeFactor(age);
  return blended * af;
}

function sse(baseCap: number, youthBonusPerYear: number, blendMode: "shrinkage" | "max" | "fixed50") {
  let s = 0;
  for (const c of cases) {
    const gap = gapFor(c.name, c.year, c.careerGames, baseCap, youthBonusPerYear, blendMode);
    const targetGap = c.potTarget - c.ovrTarget;
    s += (gap - targetGap) ** 2;
  }
  return s;
}

for (const blendMode of ["shrinkage", "max", "fixed50"] as const) {
  let best = { baseCap: 20, youthBonusPerYear: 0, sse: Infinity };
  for (let baseCap = 10; baseCap <= 70; baseCap += 1) {
    for (let youthBonusPerYear = 0; youthBonusPerYear <= 15; youthBonusPerYear += 0.5) {
      const s = sse(baseCap, youthBonusPerYear, blendMode);
      if (s < best.sse) best = { baseCap, youthBonusPerYear, sse: s };
    }
  }
  console.log(`\n=== blendMode=${blendMode} Best fit:`, best, "===");
  for (const c of cases) {
    const gap = gapFor(c.name, c.year, c.careerGames, best.baseCap, best.youthBonusPerYear, blendMode);
    const targetGap = c.potTarget - c.ovrTarget;
    console.log(`${c.name} ${c.year}: fitted gap ${gap.toFixed(1)} vs target gap ${targetGap} (OVR target ${c.ovrTarget} -> POT ${(c.ovrTarget + gap).toFixed(1)} vs target POT ${c.potTarget})`);
  }
}
