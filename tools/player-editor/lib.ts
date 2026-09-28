/**
 * Round C155 — Player Editor admin tool, core logic.
 *
 * A standalone tool (per Tyler's own AskUserQuestion choice: separate from the game, manual
 * sliders + a live preview, not an auto-solver). Deliberately NOT part of the React game bundle —
 * this module is only ever imported by `server.ts` (run directly via
 * `node --experimental-strip-types tools/player-editor/server.ts`), never by `src/`.
 *
 * Every number this file produces for OVR/POT is computed by calling the SAME, unmodified engine
 * functions every real round's own database refresh uses (`applyFairnessPass`,
 * `archetypeAttributeMeans`, `populationOvrStats`, `archetypeOvrRawStats` — all imported straight
 * from `src/engine/ratingGeneration.ts`/`src/engine/progression.ts`, never re-implemented here) —
 * see Schema.md's Round C155 section for why this matters (byte-for-byte reuse, not an
 * approximation that could silently drift from what a real refresh produces).
 *
 * A real, deliberate consequence of that reuse, disclosed up front rather than discovered by
 * surprise: `applyFairnessPass` doesn't just compute OVR/POT from a player's attributes, it also
 * SHRINKS the attributes themselves toward the archetype population mean (weighted by real career
 * games, `shrinkAttributesForSmallSample`) before computing OVR off the shrunk values — unless the
 * player carries `ovrOverride`. A manual slider edit for a lower-career-games player (Nick Watson,
 * Sam Darcy) is therefore genuinely partially pulled back toward the archetype mean by the same
 * mechanism that protects every other player's fairness, not a bug in this tool. The preview is
 * WYSIWYG with save: whatever the preview shows is exactly what gets written.
 */
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCsv, parseCsvToObjects } from "../../scripts/csv.ts";
import { coerceRow } from "../../scripts/buildData.ts";
import { RATED_ATTRIBUTES, type Player, type RatedAttribute } from "../../src/types/player.ts";
import { populationOvrStats, isActiveRealStatus } from "../../src/engine/progression.ts";
import {
  archetypeAttributeMeans,
  archetypeOvrRawStats,
  applyFairnessPass,
  careerGamesFor,
} from "../../src/engine/ratingGeneration.ts";
import { prestigeBonusFor } from "../../src/engine/prestige.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const CSV_PATH = join(__dirname, "..", "..", "data", "players_master.csv");
const BACKUP_PATH = join(__dirname, "..", "..", "data", "players_master.pre-roundC155.csv");

/** New Round C155 CSV column — see this tool's own doc comment / Schema.md's Round C155 section for the full design. Written as "1"/"0" like `ovrOverride`/`potOverride` already are. */
export const ATTRIBUTE_OVERRIDE_COLUMN = "attributeOverride";

function csvField(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "boolean") return value ? "1" : "0";
  const s = String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export interface Population {
  header: string[];
  players: Player[];
  archetypeMeans: ReturnType<typeof archetypeAttributeMeans>;
  populationStats: { mean: number; stdDev: number };
  archetypeStats: ReturnType<typeof archetypeOvrRawStats>;
}

/** Loads `players_master.csv` and computes the three population-reference stats ONCE — the exact
 * same reference every real round's own `recomputeOVRWithShrinkage` uses — so every preview/save
 * this server serves for its whole lifetime is measured against one consistent snapshot, not
 * recomputed (and potentially drifting) per request. A fresh save still recomputes these from the
 * just-written CSV on the NEXT server start, same as a real round would after a genuine data
 * refresh. */
export function loadPopulation(): Population {
  const csvText = readFileSync(CSV_PATH, "utf-8");
  const [header] = parseCsv(csvText);
  const rawRows = parseCsvToObjects(csvText);
  // `coerceRow`'s own BOOLEAN_FIELDS list (buildData.ts) already knows about `attributeOverride`
  // (Round C155) and coerces it to a real boolean, same as `ovrOverride`/`potOverride`.
  const players: Player[] = rawRows.map(coerceRow);
  if (!header.includes(ATTRIBUTE_OVERRIDE_COLUMN)) header.push(ATTRIBUTE_OVERRIDE_COLUMN);
  return {
    header,
    players,
    archetypeMeans: archetypeAttributeMeans(players),
    populationStats: populationOvrStats(players),
    archetypeStats: archetypeOvrRawStats(players),
  };
}

export interface PlayerSummary {
  id: number;
  name: string;
  club: string;
  archetype: string;
  OVR: number;
  POT: number;
  age: number;
  attributeOverride: boolean;
}

export function summarize(p: Player & { attributeOverride?: boolean }): PlayerSummary {
  return {
    id: p.PlayerID,
    name: `${p.fname} ${p.lname}`,
    club: p.Team,
    archetype: p.archetype,
    OVR: p.OVR,
    POT: p.POT,
    age: p.Age,
    attributeOverride: !!p.attributeOverride,
  };
}

export interface GridRow {
  id: number;
  name: string;
  club: string;
  archetype: string;
  age: number;
  OVR: number;
  POT: number;
  realStatus: string;
  active: boolean;
  attributeOverride: boolean;
  attributes: Record<RatedAttribute, number>;
}

/** Round C156 — Player Grid view. Returns ALL players (no pagination; 825 rows is small enough to
 * ship to the client in one shot per the round brief) with everything the client-side sortable/
 * filterable/heatmapped grid needs: identity fields, OVR/POT, real status (`realStatus` is
 * undefined for an ordinary active player, so it's normalized to the string `"Active"` here for
 * display), `isActiveRealStatus` (Retired/Delisted excluded, Injured still counts as active —
 * same semantics every other Top-N table in this series already uses), and all 20
 * `RATED_ATTRIBUTES` raw values. Sorting/filtering/ranking is deliberately done CLIENT-SIDE in
 * `app.js` once this loads, not per-request here, so the grid feels like a spreadsheet rather than
 * round-tripping the server on every click. */
export function gridRows(pop: Population): GridRow[] {
  return pop.players.map((p) => {
    const attributes = {} as Record<RatedAttribute, number>;
    for (const a of RATED_ATTRIBUTES) attributes[a] = p[a];
    return {
      id: p.PlayerID,
      name: `${p.fname} ${p.lname}`,
      club: p.Team,
      archetype: p.archetype as string,
      age: p.Age,
      OVR: p.OVR,
      POT: p.POT,
      realStatus: p.realStatus || "Active",
      active: isActiveRealStatus(p),
      attributeOverride: !!(p as Player & { attributeOverride?: boolean }).attributeOverride,
      attributes,
    };
  });
}

export function searchPlayers(pop: Population, query: string): PlayerSummary[] {
  const q = query.trim().toLowerCase();
  const matches = !q
    ? pop.players
    : pop.players.filter((p) => {
        const name = `${p.fname} ${p.lname}`.toLowerCase();
        return name.includes(q) || p.Team.toLowerCase().includes(q) || (p.archetype as string).toLowerCase().includes(q);
      });
  return matches
    .slice(0, 200)
    .map(summarize)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface PlayerDetail extends PlayerSummary {
  attributes: Record<RatedAttribute, number>;
  potentialTall: number;
  potentialMid: number;
  careerGames: number;
  prestigeBonus: number;
  isActiveRealStatus: boolean;
}

export function findPlayer(pop: Population, id: number): Player | undefined {
  return pop.players.find((p) => p.PlayerID === id);
}

export function playerDetail(pop: Population, p: Player): PlayerDetail {
  const attributes = {} as Record<RatedAttribute, number>;
  for (const a of RATED_ATTRIBUTES) attributes[a] = p[a];
  return {
    ...summarize(p),
    attributes,
    potentialTall: p.potentialTall,
    potentialMid: p.potentialMid,
    careerGames: careerGamesFor(p),
    prestigeBonus: prestigeBonusFor(p),
    isActiveRealStatus: isActiveRealStatus(p),
  };
}

export interface PreviewResult {
  before: { OVR: number; POT: number; attributes: Record<RatedAttribute, number> };
  after: { OVR: number; POT: number; attributes: Record<RatedAttribute, number> };
  shrinkageApplied: boolean;
}

/** Applies `changes` (a partial map of RatedAttribute -> new raw value) to a copy of `p`, then runs
 * the result through `applyFairnessPass` — the exact same function `recomputeOVRWithShrinkage`
 * calls for every player in a real round — against this server's frozen population-reference
 * stats. Returns both the pre-change and post-change {OVR, POT, attributes} so a caller (the
 * preview endpoint, or this round's own tuning script) can see exactly what moved and by how much,
 * including any shrinkage pull the fairness pass itself introduces. */
export function previewChange(pop: Population, p: Player, changes: Partial<Record<RatedAttribute, number>>): PreviewResult {
  const candidate: Player = { ...p };
  for (const [attr, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    candidate[attr as RatedAttribute] = Math.max(40, Math.min(110, Math.round(value)));
  }
  const before = applyFairnessPass(p, pop.archetypeMeans, pop.populationStats, 110, pop.archetypeStats);
  const after = applyFairnessPass(candidate, pop.archetypeMeans, pop.populationStats, 110, pop.archetypeStats);
  const beforeAttrs = {} as Record<RatedAttribute, number>;
  const afterAttrs = {} as Record<RatedAttribute, number>;
  let shrinkageApplied = false;
  for (const a of RATED_ATTRIBUTES) {
    beforeAttrs[a] = before[a];
    afterAttrs[a] = after[a];
    if (changes[a] !== undefined && after[a] !== Math.max(40, Math.min(110, Math.round(changes[a]!)))) shrinkageApplied = true;
  }
  return {
    before: { OVR: before.OVR, POT: before.POT, attributes: beforeAttrs },
    after: { OVR: after.OVR, POT: after.POT, attributes: afterAttrs },
    shrinkageApplied,
  };
}

/** Persists `changes` for player `id`: runs the exact same `previewChange` pipeline, writes the
 * resulting (possibly fairness-shrunk) attributes + OVR/POT back into `players_master.csv`, and
 * sets `attributeOverride=1` for this player — see this file's own top doc comment and Schema.md's
 * Round C155 section for why the persisted values are the POST-fairness-pass ones (WYSIWYG with
 * the preview), and why `attributeOverride` protects a future `refreshPlayerStats2026.ts` run from
 * silently overwriting these attributes again, without touching the OVR/POT formula itself. */
export function saveChange(pop: Population, id: number, changes: Partial<Record<RatedAttribute, number>>): { result: PreviewResult; player: Player } {
  const p = findPlayer(pop, id);
  if (!p) throw new Error(`No player with id ${id}`);
  const result = previewChange(pop, p, changes);

  const updated: Player & { attributeOverride?: boolean } = { ...p };
  for (const a of RATED_ATTRIBUTES) updated[a] = result.after.attributes[a];
  updated.OVR = result.after.OVR;
  updated.POT = result.after.POT;
  updated.attributeOverride = true;

  // Update in-memory population so subsequent requests against this same server process see the
  // new value immediately (list/detail calls right after a save).
  const idx = pop.players.findIndex((pl) => pl.PlayerID === id);
  pop.players[idx] = updated;

  if (!existsSync(BACKUP_PATH)) copyFileSync(CSV_PATH, BACKUP_PATH);

  const lines = [pop.header.join(",")];
  for (const player of pop.players) {
    lines.push(pop.header.map((col) => csvField((player as unknown as Record<string, unknown>)[col])).join(","));
  }
  writeFileSync(CSV_PATH, lines.join("\n") + "\n");

  return { result, player: updated };
}
