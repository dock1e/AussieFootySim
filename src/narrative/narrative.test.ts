import { describe, expect, it } from "vitest";
import { CLUBS } from "../types/club";
import { STATUSES, boardFor, getAllClubContexts, type ClubContext, type Status } from "./clubContext";
import { PHRASE_BANK, SLOTS } from "./phrases";
import type { Slot } from "./phrases/types";
import { eligible, fill, pickMany, pickPhrase, rngFor, tokenValues, type NarrativeHistory } from "./phraseEngine";

const contexts = getAllClubContexts({ year: 2026, seasonArchives: [], coachName: "Graeme Labrooy", seed: 1 });
const all = [...contexts.values()];

function asStatus(ctx: ClubContext, status: Status): ClubContext {
  return { ...ctx, status, ...boardFor(status, { finishNum: ctx.finishNum, madeFinals: ctx.madeFinals, wonFinal: ctx.wonFinal, premier: false }) };
}

const TOKEN_NAMES = new Set(Object.keys(tokenValues(all[0])));
const HEADLINE_SLOTS: Slot[] = ["unveilHeadline", "pressClipping"];
const MAIN_SLOTS: Slot[] = ["missedCall", "offerPitch", "inbox.president", "unveilBody"];

describe("club context", () => {
  it("builds all 18 clubs with a status, a board and a Round 1 opponent", () => {
    expect(all).toHaveLength(18);
    for (const c of all) {
      expect(STATUSES).toContain(c.status);
      expect(c.patience).toBeGreaterThanOrEqual(1);
      expect(c.patience).toBeLessThanOrEqual(5);
      expect(c.contractYears).toBeGreaterThanOrEqual(2);
      expect(c.contractYears).toBeLessThanOrEqual(5);
      expect(c.r1).not.toBeNull();
      expect(c.rival).not.toBeNull();
      expect(c.finish).not.toBeNull();
      expect(c.star).not.toBeNull();
    }
  });

  it("follows the status rules in order", () => {
    // Contender: top 4 and a top-6 list. Rebuild: 15th or worse with a bottom-5 list.
    for (const c of all) {
      if (c.status === "contender") expect(c.finishNum! <= 4 && c.listRankInLeague <= 6).toBe(true);
      if (c.status === "rebuild") expect(c.finishNum! >= 15 && c.listRankInLeague >= 14).toBe(true);
    }
    // Essendon v Richmond in Round 1 is a rivalry game.
    const ess = all.find((c) => c.id === "ESS")!;
    expect(ess.r1?.id).toBe("RICH");
    expect(ess.r1IsRival).toBe(true);
    // Essendon's rivals are Carlton and Richmond; the one it opens against is the rival its lines name.
    expect(ess.rival?.id).toBe("RICH");
  });
});

describe("phrase bank", () => {
  it("has no duplicate ids and no repeated text within a slot", () => {
    const ids = new Set<string>();
    for (const slot of SLOTS) {
      const texts = new Set<string>();
      for (const ph of PHRASE_BANK[slot]) {
        expect(ids.has(ph.id), ph.id).toBe(false);
        ids.add(ph.id);
        expect(texts.has(ph.text), ph.text).toBe(false);
        texts.add(ph.text);
      }
    }
    expect(ids.size).toBeGreaterThan(300);
  });

  it("only uses known tokens, and every phrase resolves or is marked ineligible for all 18 clubs", () => {
    const withResult = all.map((c) => ({ ...c, r1LastResult: "L by 12" }));
    for (const slot of SLOTS) {
      for (const ph of PHRASE_BANK[slot]) {
        for (const m of ph.text.matchAll(/\{([a-zA-Z0-9]+)/g)) expect(TOKEN_NAMES.has(m[1]), `${ph.id}: {${m[1]}}`).toBe(true);
        for (const c of [...all, ...withResult]) {
          const out = fill(ph.text, c);
          if (out !== null) expect(out, ph.id).not.toMatch(/[{}]/);
        }
      }
    }
  });

  it("gives every slot at least 3 eligible lines for every club × status", () => {
    for (const c of all) {
      for (const status of STATUSES) {
        const ctx = asStatus(c, status);
        for (const slot of SLOTS) expect(eligible(slot, ctx).length, `${c.id} ${status} ${slot}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("meets the minimum content: 8 status lines for the main slots, 5 eligible elsewhere", () => {
    for (const status of STATUSES) {
      for (const slot of MAIN_SLOTS) {
        const n = PHRASE_BANK[slot].filter((ph) => ph.when?.status?.length === 1 && ph.when.status[0] === status).length;
        expect(n, `${slot} ${status}`).toBeGreaterThanOrEqual(8);
      }
      for (const slot of SLOTS.filter((s) => !MAIN_SLOTS.includes(s))) {
        const n = PHRASE_BANK[slot].filter((ph) => !ph.when || (Object.keys(ph.when).length === 1 && ph.when.status?.includes(status))).length;
        expect(n, `${slot} ${status}`).toBeGreaterThanOrEqual(5);
      }
    }
  });

  it("has club-specific lines for every club and the context lines", () => {
    for (const club of CLUBS) {
      const count = (slot: Slot) => PHRASE_BANK[slot].filter((ph) => ph.when?.club?.includes(club.abbreviation) && Object.keys(ph.when).length === 1).length;
      expect(count("offerPitch"), club.abbreviation).toBeGreaterThanOrEqual(3);
      expect(count("missedCall"), club.abbreviation).toBeGreaterThanOrEqual(2);
      expect(count("unveilHeadline"), club.abbreviation).toBeGreaterThanOrEqual(1);
    }
    const flagged = (key: string, value?: unknown) => SLOTS.flatMap((s) => PHRASE_BANK[s]).filter((ph) => ph.when && key in ph.when && (value === undefined || (ph.when as Record<string, unknown>)[key] === value)).length;
    expect(flagged("r1IsRival", true)).toBeGreaterThanOrEqual(4);
    expect(flagged("r1LastResult", "L")).toBeGreaterThanOrEqual(4);
    expect(PHRASE_BANK.offerPitch.filter((ph) => ph.when?.isInterstate).length).toBeGreaterThanOrEqual(4);
    expect(flagged("starAgeMin", 30)).toBeGreaterThanOrEqual(4);
    expect(flagged("starAgeMax", 22)).toBeGreaterThanOrEqual(4);
  });

  it("passes the lint rules", () => {
    for (const slot of SLOTS) {
      const openings = new Map<string, string>();
      for (const ph of PHRASE_BANK[slot]) {
        const max = HEADLINE_SLOTS.includes(slot) ? 140 : 180;
        expect(ph.text.length, ph.id).toBeLessThan(max);
        expect(ph.text, ph.id).not.toMatch(/ {2}/);
        expect(ph.text, ph.id).not.toMatch(/\p{Extended_Pictographic}/u);
        if (slot === "unveilHeadline") expect(ph.text.split(/\s+/).length, ph.id).toBeLessThan(14);
        const open = ph.text.toLowerCase().replace(/[^a-z0-9{}' ]/g, " ").split(/\s+/).filter(Boolean).slice(0, 3).join(" ");
        expect(openings.get(open), `${ph.id} opens like ${openings.get(open)}: "${open}"`).toBeUndefined();
        openings.set(open, ph.id);
      }
    }
    // Filled text stays under the limits too.
    for (const c of all) {
      for (const slot of SLOTS) {
        for (const { phrase, text } of eligible(slot, c)) expect(text.length, phrase.id).toBeLessThan(HEADLINE_SLOTS.includes(slot) ? 140 : 200);
      }
    }
  });
});

describe("selection engine", () => {
  it("is deterministic for the same seed", () => {
    const ctx = all[4];
    const a = pickPhrase("offerPitch", ctx, rngFor("save-1", "offerPitch", "t1"), {});
    const b = pickPhrase("offerPitch", ctx, rngFor("save-1", "offerPitch", "t1"), {});
    expect(a).toEqual(b);
    const picks = new Set<string>();
    for (let i = 0; i < 20; i++) picks.add(pickPhrase("offerPitch", ctx, rngFor(`save-${i}`, "offerPitch", "t1"), {})!.id);
    expect(picks.size).toBeGreaterThan(3);
  });

  it("never repeats an id inside the recency window over 100 sequential picks", () => {
    for (const slot of SLOTS) {
      const ctx = all[0];
      const n = eligible(slot, ctx).length;
      const window = Math.min(10, Math.floor(n / 2));
      const history: NarrativeHistory = {};
      const seq: string[] = [];
      for (let i = 0; i < 100; i++) seq.push(pickPhrase(slot, ctx, rngFor("save-r", slot, String(i)), history)!.id);
      for (let i = 0; i < seq.length; i++) {
        const recent = seq.slice(Math.max(0, i - window), i);
        expect(recent.includes(seq[i]), `${slot} pick ${i}`).toBe(false);
      }
      expect(history[slot]!.length).toBe(50);
    }
  });

  it("pickMany returns distinct lines, one per context", () => {
    const five = all.slice(0, 5);
    const out = pickMany("missedCall", five, 5, rngFor("s", "missedCall", "w"), {});
    expect(out).toHaveLength(5);
    expect(new Set(out.map((x) => x.id)).size).toBe(5);
    expect(new Set(out.map((x) => x.text)).size).toBe(5);
  });

  it("prefers club-specific lines", () => {
    let clubHits = 0;
    const ess = all.find((c) => c.id === "ESS")!;
    for (let i = 0; i < 200; i++) {
      const pick = pickPhrase("offerPitch", ess, rngFor(`x${i}`, "offerPitch", "t"), {})!;
      if (pick.id.startsWith("offerPitch.ESS.")) clubHits++;
    }
    // 3 club lines at weight 2 × 3 against ~11 generic/status lines at ≤1.5: well over a third of picks.
    expect(clubHits).toBeGreaterThan(60);
  });
});
