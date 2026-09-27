/**
 * Round C151 scratch diagnostic — investigation only, not part of the committed refresh pipeline.
 * Dumps current (pre-round) blendedPotentialFor internals for Nick Watson / Sam Darcy, and
 * reconstructs their historical OVR via historicalOvrReconstruction.ts against Tyler's supplied
 * year-by-year targets, to root-cause exactly how short the current formula lands before any fix.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsvToObjects } from "./csv.ts";
import { coerceRow } from "./buildData.ts";
import type { Player } from "../src/types/player.ts";
import { potentialCeilingFor, populationOvrStats, ovrRawComposite } from "../src/engine/progression.ts";
import { blendedPotentialFor, shrinkageWeight, careerGamesFor, archetypeOvrRawStats, recomputeOVRWithShrinkage } from "../src/engine/ratingGeneration.ts";
import { draftCapitalScore } from "../src/engine/draftCapital.ts";
import { qualifiesForProvenTrajectory, PROVEN_TRAJECTORY_GAMES_BONUS } from "../src/engine/provenTrajectory.ts";
import { reconstructHistoricalOvr } from "../src/engine/historicalOvrReconstruction.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "..", "data", "players_master.csv");
const players: Player[] = parseCsvToObjects(readFileSync(CSV_PATH, "utf-8")).map(coerceRow);

const populationStats = populationOvrStats(players);
const archetypeStats = archetypeOvrRawStats(players);
const refreshed = recomputeOVRWithShrinkage(players);

for (const name of ["Nick Watson", "Sam Darcy"]) {
  const p = players.find((x) => (x.realFullName ?? `${x.fname} ${x.lname}`) === name)!;
  console.log(`\n=== ${name} ===`);
  console.log(`Age ${p.Age}, archetype ${p.archetype}, OVR ${p.OVR}, POT ${p.POT}, potentialTall ${p.potentialTall}, potentialMid ${p.potentialMid}`);
  const ceiling = potentialCeilingFor(p);
  const cGames = careerGamesFor(p);
  const proven = qualifiesForProvenTrajectory(p, populationStats, archetypeStats[p.archetype]);
  const effGames = cGames + (proven ? PROVEN_TRAJECTORY_GAMES_BONUS : 0);
  const weight = shrinkageWeight(effGames);
  const capScore = draftCapitalScore(p);
  console.log(`potCeiling(frame) ${ceiling}, careerGames ${cGames}, provenTrajectory(post-C151 fix) ${proven}, effGames ${effGames}, shrinkageWeight ${weight.toFixed(3)}, capScore ${capScore?.toFixed(2)}`);
  const potBefore = blendedPotentialFor(p, p.OVR, effGames, 110, false); // pre-C151 shape (proven=false forces old cap/blend)
  const potAfter = refreshed.find((x) => (x.realFullName ?? `${x.fname} ${x.lname}`) === name)!;
  console.log(`POT (pre-Round-C151 shape) = ${potBefore}`);
  console.log(`POT/OVR after full Round C151 recomputeOVRWithShrinkage pass = OVR ${potAfter.OVR}, POT ${potAfter.POT} (gap ${potAfter.POT - potAfter.OVR})`);

  // Historical reconstruction
  const baseline = populationStats; // reuse today's population as the fixed reference, per that file's own doc comment
  const years = reconstructHistoricalOvr(p, baseline, archetypeStats[p.archetype]);
  console.log("Reconstructed real years (year, games, ovr, pot, gap):");
  for (const y of years) console.log(`  ${y.year}: games=${y.games} ovr=${y.ovr} pot=${y.pot} gap=${y.pot - y.ovr}`);
}
