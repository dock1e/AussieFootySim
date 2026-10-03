import { prepareStartingWorld } from "./engine/seasonStart";

/**
 * Imported FIRST by `main.tsx`: ES modules evaluate in import order, so this runs before `App` and every
 * store module it pulls in read the player pool. For a 2027 start it swaps in the real start-season club
 * lists (`engine/seasonStart.ts`); for a 2026 start it does nothing.
 */
prepareStartingWorld();
