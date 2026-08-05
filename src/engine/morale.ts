import { mulberry32 } from "./rng.ts";
import type { Player } from "../types/player.ts";

/**
 * `Morale` isn't in players_master.csv yet (see Schema.md: "Not yet
 * populated as a static seed value in the 668 player records — still a pure
 * in-engine runtime concept at this point"). Schema.md's own stated seed
 * range is "60-75 (mildly content)". Deterministically derived from
 * PlayerID (not Math.random()) so the same player shows the same seed
 * Morale every time the app reloads, until the real Event system (Engine.md
 * "Event and choice system") starts reading/writing this for real.
 */
export function seedMorale(player: Pick<Player, "PlayerID">): number {
  const rng = mulberry32(player.PlayerID);
  return 60 + Math.floor(rng() * 16); // 60-75 inclusive
}
