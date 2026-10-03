/**
 * The season a NEW game starts in — see Configuration.md "Season structure". Everything that depends on
 * the start year (club lists, coaches, the last real season's ladder, the draft-pick inventory, the
 * finance history) keys off `CURRENT_SEASON_YEAR`.
 *
 * `RELEASE_START_SEASON` is what ships. Per Tyler's steer (Oct 2 2026) it stays 2026 until the real
 * 2026 off-season has finished and been entered in `data/realOffSeason2026.ts` — check with
 * `npm run readiness:2027`, then flip it to 2027.
 *
 * To preview a 2027 start locally before then, put `VITE_START_SEASON=2027` in `app/.env.local`
 * (gitignored) and restart `npm run dev`. Only the browser build reads that override; scripts and tests
 * run under Node, where `import.meta.env` doesn't exist, and always use `RELEASE_START_SEASON`.
 */
export const RELEASE_START_SEASON = 2026;
export const SUPPORTED_START_SEASONS = [2026, 2027] as const;
export type StartSeason = (typeof SUPPORTED_START_SEASONS)[number];

const envStart = Number((import.meta as { env?: Record<string, string | undefined> }).env?.VITE_START_SEASON);

export const GAME_START_SEASON: StartSeason = (SUPPORTED_START_SEASONS as readonly number[]).includes(envStart) ? (envStart as StartSeason) : RELEASE_START_SEASON;

/** The in-game "current" season a new save starts in. A save's own `year` advances from here. */
export const CURRENT_SEASON_YEAR: number = GAME_START_SEASON;
