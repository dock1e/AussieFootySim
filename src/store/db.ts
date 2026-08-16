import { openDB, type IDBPDatabase } from "idb";
import type { SerializedSaveGame } from "../engine/saveGame";

/**
 * IndexedDB storage — Engine.md's tech stack table: "IndexedDB (via a thin
 * wrapper, e.g. idb) as the save store". This is that thin wrapper, and
 * nothing more — no query logic, no migrations (see saveGame.ts's own doc
 * comment on SAVE_SCHEMA_VERSION), just get/put/delete against one fixed
 * key.
 *
 * **Single-slot, deliberately** — see saveGame.ts's doc comment for why.
 * Always stores the already-JSON-safe `SerializedSaveGame` shape (never the
 * raw Map-bearing `SaveGameData`), the same form the JSON export/import
 * path uses — one representation, see saveGame.ts's "Serialization" section
 * for why that's not just tidiness but avoids a real silent-data-loss trap.
 *
 * **`DB_NAME` renamed Aug 2026** (SimAFL -> AussieFootySim rebrand, round
 * 15) — Tyler explicitly signed off on orphaning any existing browser save
 * under the old `simafl-save` name rather than migrating it ("it's ok to
 * orphan (delete) any current save files that exist"), so this is a genuine
 * one-way break, not an oversight: anyone with an old save gets a fresh
 * empty DB under the new name, the old IndexedDB database simply stops being
 * opened (still physically present in the browser, just unreachable through
 * this app — a real, if inert, "delete" would need `indexedDB.deleteDatabase`
 * called against the *old* name specifically, not attempted here since
 * nothing asked for that extra step).
 */

const DB_NAME = "aussiefootysim-save";
const DB_VERSION = 1;
const STORE_NAME = "saves";
const SAVE_KEY = "current";

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    },
  });
  return dbPromise;
}

/** Returns undefined if no save has ever been written. */
export async function readSaveFromDB(): Promise<SerializedSaveGame | undefined> {
  const db = await getDB();
  return db.get(STORE_NAME, SAVE_KEY);
}

export async function writeSaveToDB(save: SerializedSaveGame): Promise<void> {
  const db = await getDB();
  await db.put(STORE_NAME, save, SAVE_KEY);
}

export async function clearSaveInDB(): Promise<void> {
  const db = await getDB();
  await db.delete(STORE_NAME, SAVE_KEY);
}
