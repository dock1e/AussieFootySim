import { mulberry32, type Rng } from "../engine/rng";
import { ordinal, type ClubContext } from "./clubContext";
import { clubFullName } from "../types/club";
import { splashTokens, type SplashContext } from "./splashContext";
import { PHRASE_BANK } from "./phrases";
import type { Phrase, PhraseWhen, Slot } from "./phrases/types";

/**
 * New Game Onboarding — the phrase bank's selection engine (brief §4). Every quote, message and headline
 * in onboarding and the Day one dashboard comes through `pickPhrase`/`pickMany`:
 *   1. filter the slot to entries whose `when` passes and whose tokens all resolve;
 *   2. boost specificity (club ×3, context flags ×2, status ×1.5);
 *   3. drop anything picked in the last N for this slot, and quarter the weight of anything in the last 30;
 *   4. weighted pick on a seeded RNG (`rngFor(saveId, slot, turnKey)`): same save + turn = same text;
 *   5. record the id in the save's per-slot history (capped at 50).
 */

export type NarrativeHistory = Partial<Record<Slot, string[]>>;

export const HISTORY_CAP = 50;
const SOFT_WINDOW = 30;

export interface Picked {
  id: string;
  text: string;
}

const STATUS_PHRASE: Record<ClubContext["status"], string> = {
  contender: "contender",
  rising: "side on the rise",
  middle: "side stuck in the middle",
  sleepingGiant: "sleeping giant",
  reset: "club in reset",
  rebuild: "rebuild",
};

/** A club context (onboarding, Day one) or a Big Game Splash context. */
export type PhraseContext = ClubContext | SplashContext;

const isSplash = (ctx: PhraseContext): ctx is SplashContext => (ctx as SplashContext).kind === "splash";

/** Token values for a context. `null` means the token can't be filled here, and any phrase using it is ineligible. */
export function tokenValues(ctx: PhraseContext): Record<string, string | number | null> {
  if (isSplash(ctx)) return splashTokens(ctx);
  return {
    coach: ctx.coach,
    coachFirst: ctx.coachFirst,
    coachLast: ctx.coachLast,
    club: ctx.club,
    clubFull: clubFullName({ name: ctx.club, nickname: ctx.nick }),
    nick: ctx.nick,
    ground: ctx.ground,
    finish: ctx.finish,
    status: STATUS_PHRASE[ctx.status],
    expectation: ctx.expectation,
    years: ctx.contractYears,
    star: ctx.star?.name ?? null,
    starPos: ctx.star ? ctx.star.pos.toLowerCase() : null,
    captain: ctx.captain?.name ?? null,
    topYoungster: ctx.topYoungster?.name ?? null,
    listAvg: ctx.listAvg.toFixed(1),
    listRank: ordinal(ctx.listRankInLeague),
    rival: ctx.rival?.club ?? null,
    rivalNick: ctx.rival?.nick ?? null,
    r1: ctx.r1?.club ?? null,
    r1Nick: ctx.r1?.nick ?? null,
    r1Result: ctx.r1LastResult,
    daysToR1: ctx.daysToR1,
    state: ctx.state,
  };
}

const TOKEN_RE = /\{([a-zA-Z0-9]+)(?:\|([^|}]*)\|([^|}]*))?\}/g;

/** Fills `{token}`s (and `{token|singular|plural}`) from `ctx`. Returns null if any token doesn't resolve. */
export function fill(text: string, ctx: PhraseContext): string | null {
  const values = tokenValues(ctx);
  let ok = true;
  const out = text.replace(TOKEN_RE, (_m, name: string, one?: string, many?: string) => {
    const v = values[name];
    if (v === null || v === undefined || v === "") {
      ok = false;
      return "";
    }
    if (one !== undefined && many !== undefined) return Number(v) === 1 ? one : many;
    return String(v);
  });
  return ok ? out : null;
}

const SPLASH_KEYS = ["event", "comeback", "wireToWire", "thriller", "thrashing", "isFirstFlag", "flagDroughtMin", "oppMedallist", "rivalry", "repeatWinner", "stat"] as const;

function splashWhenPasses(when: PhraseWhen, c: SplashContext): boolean {
  // Club-context conditions never pass on a splash.
  if (Object.keys(when).some((k) => !(SPLASH_KEYS as readonly string[]).includes(k))) return false;
  if (when.event && !when.event.includes(c.event)) return false;
  const flags = ["comeback", "wireToWire", "thriller", "thrashing", "isFirstFlag", "oppMedallist", "rivalry", "repeatWinner"] as const;
  for (const f of flags) if (when[f] !== undefined && when[f] !== c[f]) return false;
  if (when.flagDroughtMin !== undefined && (c.flagDrought === null || c.flagDrought < when.flagDroughtMin)) return false;
  if (when.stat && (!c.statKey || !when.stat.includes(c.statKey))) return false;
  return true;
}

export function whenPasses(when: PhraseWhen | undefined, ctx: PhraseContext): boolean {
  if (!when) return true;
  if (isSplash(ctx)) return splashWhenPasses(when, ctx);
  if (SPLASH_KEYS.some((k) => when[k] !== undefined)) return false;
  if (when.status && !when.status.includes(ctx.status)) return false;
  if (when.club && !when.club.includes(ctx.id)) return false;
  if (when.madeFinals !== undefined && when.madeFinals !== ctx.madeFinals) return false;
  if (when.wonFinal !== undefined && when.wonFinal !== ctx.wonFinal) return false;
  if (when.isInterstate !== undefined && when.isInterstate !== ctx.isInterstate) return false;
  if (when.patienceMin !== undefined && ctx.patience < when.patienceMin) return false;
  if (when.patienceMax !== undefined && ctx.patience > when.patienceMax) return false;
  if (when.r1IsRival !== undefined && when.r1IsRival !== ctx.r1IsRival) return false;
  if (when.r1LastResult !== undefined && ctx.r1LastResult?.[0] !== when.r1LastResult) return false;
  if (when.starAgeMin !== undefined && (!ctx.star || ctx.star.age < when.starAgeMin)) return false;
  if (when.starAgeMax !== undefined && (!ctx.star || ctx.star.age > when.starAgeMax)) return false;
  if (when.listRankMax !== undefined && ctx.listRankInLeague > when.listRankMax) return false;
  if (when.listRankMin !== undefined && ctx.listRankInLeague < when.listRankMin) return false;
  return true;
}

/** The slot's entries that can be shown for `ctx`, each with its filled text. */
export function eligible(slot: Slot, ctx: PhraseContext): { phrase: Phrase; text: string }[] {
  const out: { phrase: Phrase; text: string }[] = [];
  for (const phrase of PHRASE_BANK[slot]) {
    if (!whenPasses(phrase.when, ctx)) continue;
    const text = fill(phrase.text, ctx);
    if (text !== null) out.push({ phrase, text });
  }
  return out;
}

function baseWeight(phrase: Phrase): number {
  return phrase.weight ?? (phrase.when?.club ? 2 : 1);
}

function specificity(when: PhraseWhen | undefined): number {
  if (!when) return 1;
  let m = 1;
  if (when.club) m *= 3;
  if (
    when.r1IsRival !== undefined ||
    when.r1LastResult !== undefined ||
    when.isInterstate !== undefined ||
    when.starAgeMin !== undefined ||
    when.starAgeMax !== undefined ||
    when.comeback !== undefined ||
    when.wireToWire !== undefined ||
    when.thriller !== undefined ||
    when.thrashing !== undefined ||
    when.isFirstFlag !== undefined ||
    when.flagDroughtMin !== undefined ||
    when.oppMedallist !== undefined ||
    when.rivalry !== undefined ||
    when.repeatWinner !== undefined ||
    when.stat !== undefined
  )
    m *= 2;
  if (when.status || when.event) m *= 1.5;
  return m;
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The seeded RNG for one pick: same save, slot and turn → same sequence. */
export function rngFor(saveId: string, slot: string, turnKey: string): Rng {
  return mulberry32(hashString(`${saveId}|${slot}|${turnKey}`));
}

export function recordPick(history: NarrativeHistory, slot: Slot, id: string): void {
  const list = [...(history[slot] ?? []), id];
  history[slot] = list.slice(-HISTORY_CAP);
}

/**
 * Picks one phrase for `slot`. `history` is updated in place (the caller owns persisting it).
 * `exclude` skips ids or texts already used on screen (pickMany's "distinct").
 */
export function pickPhrase(slot: Slot, ctx: PhraseContext, rng: Rng, history: NarrativeHistory, exclude?: { ids?: Set<string>; texts?: Set<string> }): Picked | null {
  let pool = eligible(slot, ctx).filter(({ phrase, text }) => !exclude?.ids?.has(phrase.id) && !exclude?.texts?.has(text));
  if (pool.length === 0) return null;
  const past = history[slot] ?? [];
  const hardN = Math.min(10, Math.floor(pool.length / 2));
  const hard = new Set(hardN > 0 ? past.slice(-hardN) : []);
  const soft = new Set(past.slice(-SOFT_WINDOW));
  const fresh = pool.filter(({ phrase }) => !hard.has(phrase.id));
  if (fresh.length > 0) pool = fresh;
  const weights = pool.map(({ phrase }) => baseWeight(phrase) * specificity(phrase.when) * (soft.has(phrase.id) ? 0.25 : 1));
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rng() * total;
  let idx = pool.length - 1;
  for (let i = 0; i < pool.length; i++) {
    r -= weights[i];
    if (r < 0) {
      idx = i;
      break;
    }
  }
  const chosen = pool[idx];
  recordPick(history, slot, chosen.phrase.id);
  return { id: chosen.phrase.id, text: chosen.text };
}

/**
 * `n` distinct phrases from one slot. `ctx` may be one context for all picks, or one per pick (the
 * missed-calls feed: a different club per line, each filled with its own club's context).
 */
export function pickMany(slot: Slot, ctx: PhraseContext | PhraseContext[], n: number, rng: Rng, history: NarrativeHistory): Picked[] {
  const ids = new Set<string>();
  const texts = new Set<string>();
  const out: Picked[] = [];
  for (let i = 0; i < n; i++) {
    const c = Array.isArray(ctx) ? ctx[i] : ctx;
    if (!c) break;
    const picked = pickPhrase(slot, c, rng, history, { ids, texts });
    if (!picked) continue;
    ids.add(picked.id);
    texts.add(picked.text);
    out.push(picked);
  }
  return out;
}

/** Re-fills a phrase already picked (by id) against a fresh context, e.g. after the coach's name changes. Null if the id is gone or no longer fills. */
export function textFor(slot: Slot, id: string, ctx: PhraseContext): string | null {
  const phrase = PHRASE_BANK[slot].find((x) => x.id === id);
  return phrase ? fill(phrase.text, ctx) : null;
}
