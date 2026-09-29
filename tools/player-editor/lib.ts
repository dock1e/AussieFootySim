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
import { AttributeZScorer } from "../../src/engine/attributeGeneration.ts";
import { REAL_2026_SEASON_STATS } from "../../src/data/real2026SeasonStats.ts";
import { CLUBS } from "../../src/types/club.ts";
import type { Archetype } from "../../src/types/archetype.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const CSV_PATH = join(__dirname, "..", "..", "data", "players_master.csv");
const BACKUP_PATH = join(__dirname, "..", "..", "data", "players_master.pre-roundC155.csv");

/** New Round C155 CSV column — see this tool's own doc comment / Schema.md's Round C155 section for the full design. Written as "1"/"0" like `ovrOverride`/`potOverride` already are. */
export const ATTRIBUTE_OVERRIDE_COLUMN = "attributeOverride";

/** Round C159 — [[End-of-2026 Player Database Refresh]] / ROADMAP #115: the 20 new `raw_<attr>`
 * CSV columns `types/player.ts`'s `RawAttributes` adds. `setRawAttr` writes one, matching the same
 * dynamic-key convention this file already uses for `RatedAttribute`s. */
function rawColumn(a: RatedAttribute): string {
  return `raw_${a}`;
}
function setRawAttr(p: Record<string, unknown>, a: RatedAttribute, value: number): void {
  p[rawColumn(a)] = value;
}

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
  // Round C159 — defensive completeness, same convention as ATTRIBUTE_OVERRIDE_COLUMN just above:
  // a live CSV that's already been through this round's migration always has every raw_<attr>
  // column already, but this guards a hand-edited or pre-migration CSV from silently losing the
  // column set on save.
  for (const a of RATED_ATTRIBUTES) {
    const col = rawColumn(a);
    if (!header.includes(col)) header.push(col);
  }
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
  /** Round C158 Part C#4 — raw bio/metadata field values, keyed by `METADATA_FIELDS` (declared
   * further down this file — see that constant's own doc comment for what's included and why). */
  metadata: Record<string, string | number>;
  /** Round C158 Part C#1 — whether this player has a real 2026 season stat row at all, i.e.
   * whether "Revert to formula" is even possible for them (see `revertToFormula`'s own doc comment
   * for the 157-player carve-out this mirrors). */
  canRevertToFormula: boolean;
}

export function findPlayer(pop: Population, id: number): Player | undefined {
  return pop.players.find((p) => p.PlayerID === id);
}

export function playerDetail(pop: Population, p: Player): PlayerDetail {
  const attributes = {} as Record<RatedAttribute, number>;
  for (const a of RATED_ATTRIBUTES) attributes[a] = p[a];
  const metadata: Record<string, string | number> = {};
  for (const f of METADATA_FIELDS) metadata[f] = (p as unknown as Record<string, string | number>)[f];
  const name = p.realFullName ?? `${p.fname} ${p.lname}`;
  return {
    ...summarize(p),
    attributes,
    potentialTall: p.potentialTall,
    potentialMid: p.potentialMid,
    careerGames: careerGamesFor(p),
    prestigeBonus: prestigeBonusFor(p),
    isActiveRealStatus: isActiveRealStatus(p),
    metadata,
    canRevertToFormula: REAL_2026_SEASON_STATS.some((r) => r.realFullName === name),
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
/**
 * Round C158 built a `skipShrinkForOverride` opt-in on `applyFairnessPass` so a SECOND save of the
 * SAME player wouldn't keep re-shrinking their untouched attributes toward the archetype mean
 * (`shrinkAttributesForSmallSample` was never a fixed point of its own prior output — see
 * Schema.md's Round C158 section). Round C159 root-caused and fixed that at its actual source
 * (`ratingGeneration.ts`'s `shrinkAttributesForSmallSample`/`archetypeAttributeMeans` now always
 * blend from a persisted, never-overwritten-by-shrink `raw_<attr>` baseline, not from "whatever's
 * currently stored") and made `attributeOverride`'s shrink-skip UNCONDITIONAL inside
 * `applyFairnessPass` itself — so this function no longer needs to opt into it.
 *
 * **What this function now does instead, to keep a manual slider edit correct under the new
 * architecture**: a manual edit IS a genuine fresh, deliberate input for the attribute(s) actually
 * being touched — exactly the same class of event `refreshPlayerStats2026.ts`'s real-stat
 * regeneration is for the 20 attributes it touches. So before running the fairness pass, this
 * function updates `candidate`'s `raw_<attr>` for every touched attribute to Tyler's own new value
 * (untouched attributes keep whatever raw baseline they already had — no change for them). On a
 * player's FIRST save (`attributeOverride` still false), this makes the fairness pass's shrink step
 * blend from Tyler's ACTUAL new value for the edited attribute(s), not a stale prior raw snapshot —
 * matching the historically-observed, intentional behaviour that a low-career-games player's manual
 * edit is still genuinely partially pulled toward the archetype mean. `saveChange` (below) then
 * freezes the REST of the player's raw baseline to match on the actual save, so every subsequent
 * save (now an `attributeOverride` player, unconditionally shrink-skipped) reads back exactly what
 * was saved, forever — no drift, no re-shrink, on any future call from anywhere.
 */
export function previewChange(pop: Population, p: Player, changes: Partial<Record<RatedAttribute, number>>): PreviewResult {
  const candidate: Player = { ...p };
  for (const [attr, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    const v = Math.max(40, Math.min(110, Math.round(value)));
    candidate[attr as RatedAttribute] = v;
    setRawAttr(candidate as unknown as Record<string, unknown>, attr as RatedAttribute, v);
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

function csvLineFor(header: string[], row: Record<string, unknown>): string {
  return header.map((col) => csvField(row[col])).join(",");
}

/**
 * Round C158 — writes exactly ONE line of `players_master.csv`, the one belonging to `updated`
 * (matched by its leading `PlayerID` column), leaving every other byte of the file untouched. This
 * replaces the old approach of re-serializing the ENTIRE in-memory population array on every save —
 * that old approach turned out NOT to actually corrupt other players' data in practice (confirmed by
 * a live empirical diff test — see Schema.md's Round C158 section), but it was still one accidental
 * bug (a stale in-memory `pop.players` entry, a serialization/formatting drift) away from silently
 * doing exactly that. Reading the file fresh from disk (rather than trusting `pop.header`'s cached
 * copy) and only ever touching the one matching line makes single-row scoping a structural
 * guarantee, not an emergent property of today's code. Mandatory per Round C158's Part A brief for
 * every save path this tool exposes (attribute edits, metadata edits, revert-to-formula).
 *
 * **Round C159 fix, found while re-verifying this exact function for ROADMAP #115**: `loadPopulation`
 * dynamically `header.push()`es a column the in-memory `header` array needs but the ON-DISK header
 * line doesn't have yet (e.g. `ATTRIBUTE_OVERRIDE_COLUMN`/the new `raw_<attr>` columns, for any CSV
 * that predates them — real right now, since Round C158's revert to the pre-C155 base stripped
 * `attributeOverride` out of the CSV entirely and nothing since has put the column name back in the
 * header row itself). The OLD `writeSingleRow` only ever touched the ONE data line, never line 0 —
 * so a save using a dynamically-added column wrote that column's VALUE into the row (a trailing
 * field past the header's own column count) while the header row on disk still didn't list it,
 * making that value permanently unreachable on the next load (`parseCsvToObjects` keys every field
 * by its position in the header row it read, so a value past the last header entry is silently
 * dropped). Confirmed empirically, not just reasoned about: a live before/after/before save-3x test
 * against the un-fixed function showed `attributeOverride` reading back `false` after every save.
 * Fixed by also syncing line 0 to the caller's `header` whenever it's grown past what's on disk —
 * still only touches the ONE data row PLUS the header row (never any other player's row), so the
 * single-row-scope guarantee (Round C158's own mandate) still holds for every other player's data.
 */
function writeSingleRow(id: number, header: string[], updatedRow: Record<string, unknown>): void {
  if (!existsSync(BACKUP_PATH)) copyFileSync(CSV_PATH, BACKUP_PATH);
  const diskText = readFileSync(CSV_PATH, "utf-8");
  // split("\n") on a file ending in "\n" yields a trailing "" element; re-joining with "\n"
  // reproduces that exact trailing newline without any special-casing.
  const diskLines = diskText.split("\n");
  const diskHeader = diskLines[0].split(",");
  if (diskHeader.join(",") !== header.join(",")) {
    diskLines[0] = header.join(",");
  }
  const newLine = csvLineFor(header, updatedRow);
  let replaced = false;
  for (let i = 1; i < diskLines.length; i++) {
    if (!diskLines[i]) continue;
    const firstComma = diskLines[i].indexOf(",");
    const rowId = Number(diskLines[i].slice(0, firstComma === -1 ? undefined : firstComma));
    if (rowId === id) {
      diskLines[i] = newLine;
      replaced = true;
      break;
    }
  }
  if (!replaced) throw new Error(`writeSingleRow: could not find on-disk row for PlayerID ${id} — refusing to write (would have appended/corrupted the file)`);
  writeFileSync(CSV_PATH, diskLines.join("\n"));
}

/** Persists `changes` for player `id`: runs the exact same `previewChange` pipeline, writes the
 * resulting (possibly fairness-shrunk) attributes + OVR/POT back into `players_master.csv`, and
 * sets `attributeOverride=1` for this player — see this file's own top doc comment and Schema.md's
 * Round C155/C158 sections. Round C158: the CSV write is now scoped to exactly this player's own
 * line (`writeSingleRow`), never the rest of the file. */
export function saveChange(pop: Population, id: number, changes: Partial<Record<RatedAttribute, number>>): { result: PreviewResult; player: Player } {
  const p = findPlayer(pop, id);
  if (!p) throw new Error(`No player with id ${id}`);
  const result = previewChange(pop, p, changes);

  const updated: Player & { attributeOverride?: boolean } = { ...p };
  for (const a of RATED_ATTRIBUTES) {
    updated[a] = result.after.attributes[a];
    // Round C159 — freeze this player's raw baseline to equal their just-saved live value, for
    // EVERY attribute (not just the one(s) Tyler actually touched this save). From this point on
    // `attributeOverride` unconditionally skips shrinkage in `applyFairnessPass`, so raw's exact
    // value no longer drives any future computation for this player — but keeping it in lockstep
    // with live is the honest, disclosed meaning of "their raw baseline IS their override value,
    // frozen" (Schema.md's Round C159 section), and it's what a future "revert to formula" (which
    // regenerates real raw AND clears attributeOverride) correctly replaces wholesale.
    setRawAttr(updated as unknown as Record<string, unknown>, a, result.after.attributes[a]);
  }
  updated.OVR = result.after.OVR;
  updated.POT = result.after.POT;
  updated.attributeOverride = true;

  // Update in-memory population so subsequent requests against this same server process see the
  // new value immediately (list/detail calls right after a save).
  const idx = pop.players.findIndex((pl) => pl.PlayerID === id);
  pop.players[idx] = updated;

  writeSingleRow(id, pop.header, updated as unknown as Record<string, unknown>);

  return { result, player: updated };
}

/** Round C158 Part C#4 — bio/metadata fields Tyler can edit directly: cosmetic/real-world facts,
 * NOT formula inputs. Editing any of these never triggers an attribute/OVR/POT recompute — see this
 * function's own call site and Schema.md's Round C158 section for the one field investigated for a
 * real (but generation-time-only, not live) downstream dependency: `height` feeds
 * `attributeGeneration.ts`'s tall-archetype `kickMaxDistance` bonus and `archetype`
 * classification, but ONLY at original real-stat generation time (`AttributeZScorer`) — never
 * re-read on any ordinary refresh once a player's attributes exist, so editing it here cannot desync
 * anything on its own. Editing `archetype` itself is deliberately NOT exposed here (that would
 * silently desync a player's already-generated attributes from their archetype's own primary-stat
 * weighting — a real formula input, out of scope for a "bio fields" editor). */
export const METADATA_FIELDS = [
  "age_day",
  "age_month",
  "age_year",
  "Age",
  "height",
  "weight",
  "OriginClub",
  "Team",
  "homeState",
  "jumperNumber",
] as const;
export type MetadataField = (typeof METADATA_FIELDS)[number];

function clubIdForName(name: string): number | undefined {
  return CLUBS.find((c) => c.name === name)?.ClubID;
}

/** Saves bio/metadata-only edits for player `id`. Never calls `applyFairnessPass` — these fields
 * are cosmetic/real-world facts, not formula inputs (see `METADATA_FIELDS`'s own doc comment).
 * Setting `Team` also updates `ClubID` to match (the two must never desync — every other real round
 * in this series keeps them in lockstep, e.g. Round C157's own club-reassignment task). Row-scoped
 * via the same `writeSingleRow` every attribute save uses. */
export function saveMetadata(pop: Population, id: number, changes: Partial<Record<MetadataField, string | number>>): Player {
  const p = findPlayer(pop, id);
  if (!p) throw new Error(`No player with id ${id}`);
  const updated: Record<string, unknown> = { ...p };
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined || value === "") continue;
    if (key === "Team") {
      const clubId = clubIdForName(String(value));
      if (clubId === undefined) throw new Error(`Unknown club name: ${value}`);
      updated.Team = value;
      updated.ClubID = clubId;
    } else if (key === "OriginClub" || key === "homeState") {
      updated[key] = String(value);
    } else {
      const n = Number(value);
      if (Number.isNaN(n)) throw new Error(`Metadata field "${key}" must be numeric, got ${JSON.stringify(value)}`);
      updated[key] = n;
    }
  }
  const idx = pop.players.findIndex((pl) => pl.PlayerID === id);
  pop.players[idx] = updated as unknown as Player;
  writeSingleRow(id, pop.header, updated);
  return updated as unknown as Player;
}

/** Round C158 Part C#1 — "Revert to formula": clears `attributeOverride` and regenerates this
 * player's 20 `RATED_ATTRIBUTES` fresh from their real per-game stats via the exact same
 * `AttributeZScorer` every ordinary real-stat refresh uses (`refreshPlayerStats2026.ts`'s own call
 * pattern, reused verbatim here — never a re-implementation), then runs the normal (NOT
 * skip-shrink) fairness pass, since this output genuinely IS fresh real-stat data, not a repeat
 * application on already-shrunk output. Only available for a player with a real
 * `real2026SeasonStats.ts` row (594 of 825) — matching that script's own documented scope; a player
 * outside that set has no real-stat-driven formula to revert to, so this throws with a clear
 * message rather than silently leaving stale/guessed attributes in place. */
export function revertToFormula(pop: Population, id: number): { result: PreviewResult; player: Player } {
  const p = findPlayer(pop, id);
  if (!p) throw new Error(`No player with id ${id}`);
  const name = p.realFullName ?? `${p.fname} ${p.lname}`;
  const hasRealRow = REAL_2026_SEASON_STATS.some((r) => r.realFullName === name);
  if (!hasRealRow) {
    throw new Error(
      `${name} has no real 2026 season stat row — there is no real-stat-driven formula to revert to for this player (the same 157-player carve-out refreshPlayerStats2026.ts documents). Their attributes cannot be reverted here; a manual value is the only value that exists for them.`,
    );
  }
  const scorer = new AttributeZScorer(REAL_2026_SEASON_STATS);
  const freshAttrs = scorer.attributesFor(name, p.archetype as Archetype, p.Age);
  // Round C159 — this IS a genuine fresh-data event (`AttributeZScorer` regenerating straight from
  // real per-game stats), so `freshAttrs` becomes the new persisted `raw_<attr>` baseline here, same
  // as `refreshPlayerStats2026.ts`'s own real-stat-refresh path — never the post-shrink `after`
  // below. `attributeOverride: false` also means `applyFairnessPass`'s unconditional override-skip
  // does NOT fire for this call, so the normal per-round shrink applies exactly as it would for any
  // other real-stat-refreshed player.
  const freshBase: Player = { ...p, ...freshAttrs, attributeOverride: false } as Player;
  for (const a of RATED_ATTRIBUTES) setRawAttr(freshBase as unknown as Record<string, unknown>, a, freshAttrs[a]);
  const after = applyFairnessPass(freshBase, pop.archetypeMeans, pop.populationStats, 110, pop.archetypeStats);
  const before = applyFairnessPass(p, pop.archetypeMeans, pop.populationStats, 110, pop.archetypeStats);
  const beforeAttrs = {} as Record<RatedAttribute, number>;
  const afterAttrs = {} as Record<RatedAttribute, number>;
  for (const a of RATED_ATTRIBUTES) {
    beforeAttrs[a] = before[a];
    afterAttrs[a] = after[a];
  }
  const updated: Player & { attributeOverride?: boolean } = { ...p };
  for (const a of RATED_ATTRIBUTES) {
    updated[a] = after[a];
    // Raw baseline goes back to the FRESH (pre-shrink) real-stat output, not `after` — this player
    // is no longer `attributeOverride`, so future ordinary refreshes should keep shrinking them from
    // this real baseline exactly like every other non-overridden player, not treat their live value
    // as already-raw (that would just reintroduce ROADMAP #115's bug for this one player).
    setRawAttr(updated as unknown as Record<string, unknown>, a, freshAttrs[a]);
  }
  updated.OVR = after.OVR;
  updated.POT = after.POT;
  updated.attributeOverride = false;
  updated.clangerTend = scorer.clangerTendFor(name);

  const idx = pop.players.findIndex((pl) => pl.PlayerID === id);
  pop.players[idx] = updated;
  writeSingleRow(id, pop.header, updated as unknown as Record<string, unknown>);

  return {
    result: {
      before: { OVR: before.OVR, POT: before.POT, attributes: beforeAttrs },
      after: { OVR: after.OVR, POT: after.POT, attributes: afterAttrs },
      shrinkageApplied: true,
    },
    player: updated,
  };
}

/** Round C158 Part C#3 — CSV export: the raw, current on-disk `players_master.csv` bytes, so a
 * downloaded export is always byte-identical to what a fresh `loadPopulation()` would read (no
 * re-serialization step that could drift from the file's own on-disk formatting). */
export function exportCsv(): string {
  return readFileSync(CSV_PATH, "utf-8");
}

export interface ImportResult {
  rowCount: number;
  expectedRowCount: number;
  columnsMatch: boolean;
  changedPlayerIds: number[];
  applied: boolean;
  error?: string;
}

/** Round C158 Part C#3 — CSV import: validates BEFORE writing anything, and only ever replaces the
 * whole file (never a per-row splice — an import is inherently a bulk, whole-file operation, unlike
 * every single-player save path above) once explicitly confirmed by the caller (`confirm: true` —
 * the client always shows a preview/confirm dialog first; see `server.ts`'s `/api/import` doc
 * comment for the two-step, dry-run-then-confirm protocol). Validates: header matches the current
 * live CSV's columns exactly (same set, doesn't require the same order — order-independent so a
 * hand-edited export with columns reordered doesn't spuriously fail) and row count matches (825) —
 * both hard failures, not warnings, since either mismatch means this isn't a same-schema export of
 * this same database. Reports every PlayerID whose OVR, POT, or any RATED_ATTRIBUTE changed versus
 * the CURRENT live file, computed BEFORE the write, so a caller sees exactly what an import will
 * change before (dry run) or after (confirmed) it happens. */
export function importCsv(csvText: string, confirm: boolean): ImportResult {
  const currentText = readFileSync(CSV_PATH, "utf-8");
  const [currentHeader] = parseCsv(currentText);
  const currentPlayers = parseCsvToObjects(currentText).map(coerceRow);

  const [newHeader] = parseCsv(csvText);
  const newRawRows = parseCsvToObjects(csvText);

  const columnsMatch = currentHeader.length === newHeader.length && [...currentHeader].sort().join(",") === [...newHeader].sort().join(",");
  const expectedRowCount = currentPlayers.length;

  if (!columnsMatch) {
    return { rowCount: newRawRows.length, expectedRowCount, columnsMatch, changedPlayerIds: [], applied: false, error: `Column mismatch: import has ${newHeader.length} columns, expected ${currentHeader.length} matching the live schema exactly.` };
  }
  if (newRawRows.length !== expectedRowCount) {
    return { rowCount: newRawRows.length, expectedRowCount, columnsMatch, changedPlayerIds: [], applied: false, error: `Row count mismatch: import has ${newRawRows.length} rows, expected ${expectedRowCount}.` };
  }

  let newPlayers: Player[];
  try {
    newPlayers = newRawRows.map(coerceRow);
  } catch (err) {
    return { rowCount: newRawRows.length, expectedRowCount, columnsMatch, changedPlayerIds: [], applied: false, error: `Failed to parse import: ${err instanceof Error ? err.message : String(err)}` };
  }

  const byId = new Map(currentPlayers.map((p) => [p.PlayerID, p]));
  const changedPlayerIds: number[] = [];
  for (const np of newPlayers) {
    const old = byId.get(np.PlayerID);
    if (!old) { changedPlayerIds.push(np.PlayerID); continue; }
    let changed = old.OVR !== np.OVR || old.POT !== np.POT;
    if (!changed) for (const a of RATED_ATTRIBUTES) if (old[a] !== np[a]) { changed = true; break; }
    if (changed) changedPlayerIds.push(np.PlayerID);
  }

  if (!confirm) {
    return { rowCount: newRawRows.length, expectedRowCount, columnsMatch, changedPlayerIds, applied: false };
  }

  if (!existsSync(BACKUP_PATH)) copyFileSync(CSV_PATH, BACKUP_PATH);
  writeFileSync(CSV_PATH, csvText.endsWith("\n") ? csvText : csvText + "\n");
  return { rowCount: newRawRows.length, expectedRowCount, columnsMatch, changedPlayerIds, applied: true };
}
