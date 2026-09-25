import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CLUBS, clubById } from "../../types/club";
import { CURRENT_SEASON_YEAR } from "../../config";
import { generatedPlayers } from "../../data/loadPlayers";
import { clubTokensFor } from "../../theme/clubTokens";
import { clubThemeStyle } from "../../theme/useClubTheme";
import { mulberry32 } from "../../engine/rng";
import { STATUS_LABEL, getAllClubContexts, withCoach, type ClubContext, type Status } from "../../narrative/clubContext";
import { hashString, pickMany, pickPhrase, rngFor, textFor, type NarrativeHistory } from "../../narrative/phraseEngine";
import type { Slot } from "../../narrative/phrases/types";
import { DEFAULT_COACH_NAME, newSaveId, useCareerStore } from "../../store/useCareerStore";
import { useSaveStore } from "../../store/useSaveStore";
import { BARLOW, COND, MONO } from "../matchday/shared";

/**
 * New Game Onboarding (`New Game Onboarding.dc.html`, steps 1–3): Welcome → The offers → Unveiling.
 * Step 4, Day one, is the real Dashboard (see `DayOne.tsx`): "Walk into the club" writes the save
 * and hands over to it. "Skip · random club" writes the save for a random club straight away.
 *
 * Every quote, pitch and headline comes from the phrase bank (`narrative/`), picked on an RNG seeded
 * by this new game's save id, so each new game reads differently. The pick history starts from the
 * previous save's and goes into the new one, so lines used last game are held back.
 *
 * Nothing is written until the coach commits: backing out (when a save already exists) leaves it untouched.
 */

type Step = 0 | 1 | 2;
type Filter = "All" | "Contender" | "Middle" | "Rebuild";
const FILTERS: Filter[] = ["All", "Contender", "Middle", "Rebuild"];
const STEP_LABELS = ["Welcome", "The offers", "Unveiling", "Day one"];

/** How much a club's board needs a new coach — rebuilds and sleeping giants call first (brief §4, missed-calls feed). */
const INTEREST: Record<Status, number> = { rebuild: 3, sleepingGiant: 3, reset: 2.2, middle: 1.6, rising: 1.3, contender: 1 };

function matchesFilter(status: Status, f: Filter): boolean {
  if (f === "All") return true;
  if (f === "Contender") return status === "contender";
  if (f === "Middle") return status === "middle" || status === "sleepingGiant";
  return status === "rebuild" || status === "reset" || status === "rising";
}

function varsFor(id: string): CSSProperties {
  return clubThemeStyle(clubTokensFor(id));
}

function patLabel(p: number): string {
  return p >= 4 ? "HIGH" : p >= 3 ? "MEDIUM" : "LOW";
}

const label: CSSProperties = { font: `500 11px ${MONO}`, letterSpacing: "1.5px", color: "#9aa4b5" };

function ClubTile({ id, size, font }: { id: string; size: number; font: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: Math.round(size / 4.5),
        background: "var(--deep)",
        border: "1px solid color-mix(in oklch, var(--acc) 55%, transparent)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        font: `700 ${font}px ${COND}`,
        color: "var(--accT)",
      }}
    >
      {id}
    </div>
  );
}

function PatienceBar({ patience }: { patience: number }) {
  return (
    <>
      <span style={{ flex: 1, height: 6, borderRadius: 3, background: "rgba(255,255,255,.08)", overflow: "hidden" }}>
        <span style={{ display: "block", height: "100%", width: `${(patience / 5) * 100}%`, background: "var(--acc)", borderRadius: 3 }} />
      </span>
      <span style={{ font: `600 12px ${MONO}`, color: "#dfe5ee" }}>{patLabel(patience)}</span>
    </>
  );
}

function Row({ k, children, center }: { k: string; children: ReactNode; center?: boolean }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: center ? "center" : undefined }}>
      <span style={{ flex: "none", width: 92, font: `600 10px ${MONO}`, letterSpacing: "1px", color: "#9aa4b5", paddingTop: center ? 0 : 2 }}>{k}</span>
      {children}
    </div>
  );
}

/** Wraps the club's nickname (or name) in the accent colour, as the reference's headline does. */
function Highlight({ text, ctx }: { text: string; ctx: ClubContext }) {
  const needle = [`${ctx.club} ${ctx.nick}`, ctx.nick, ctx.club].find((n) => text.includes(n));
  if (!needle) return <>{text}</>;
  const i = text.indexOf(needle);
  return (
    <>
      {text.slice(0, i)}
      <span style={{ color: "var(--accT)" }}>{needle}</span>
      {text.slice(i + needle.length)}
    </>
  );
}

export function Onboarding({ onDone, onCancel }: { onDone: () => void; onCancel?: () => void }) {
  const newGame = useSaveStore((s) => s.newGame);
  const [saveId] = useState(newSaveId);
  const seed = useMemo(() => hashString(saveId), [saveId]);
  /** Working copy of the pick history, carried from the last save into this one. */
  const history = useRef<NarrativeHistory>(structuredClone(useCareerStore.getState().narrative.history) as NarrativeHistory);

  const [step, setStep] = useState<Step>(0);
  const [coach, setCoach] = useState(DEFAULT_COACH_NAME);
  const [filter, setFilter] = useState<Filter>("All");
  const [committing, setCommitting] = useState(false);

  // Clubs as a brand-new save finds them (the generated pool, last season from the real ladder).
  const contexts = useMemo(
    () => getAllClubContexts({ year: CURRENT_SEASON_YEAR, seasonArchives: [], coachName: DEFAULT_COACH_NAME, players: generatedPlayers(), seed }),
    [seed],
  );
  const ctxFor = (clubId: number) => withCoach(contexts.get(clubId)!, coach);

  // Missed calls: the five clubs that need a coach most, with jitter so the order changes each new game.
  const calls = useMemo(() => {
    const rng = mulberry32(seed ^ 0x5bd1e995);
    const ranked = [...contexts.values()]
      .map((c) => ({ c, score: INTEREST[c.status] + rng() * 2.2 }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map((x) => x.c);
    const lines = pickMany("missedCall", ranked, 5, rngFor(saveId, "missedCall", "welcome"), history.current);
    const today = 2 + Math.floor(rng() * 3);
    let minutes = 8 * 60 + 14;
    return ranked.map((c, i) => {
      if (i > 0) minutes -= 5 + Math.floor(rng() * 21);
      const h = Math.floor(minutes / 60);
      const time = i < today ? `${((h + 11) % 12) + 1}:${String(minutes % 60).padStart(2, "0")} AM` : "Yesterday";
      return { clubId: c.clubId, id: c.id, time, phraseId: lines[i]?.id ?? null };
    });
  }, [contexts, seed, saveId]);

  const clipping = useMemo(() => {
    const top = contexts.get(calls[0].clubId)!;
    return pickPhrase("pressClipping", top, rngFor(saveId, "pressClipping", "welcome"), history.current)?.id ?? null;
  }, [contexts, calls, saveId]);

  // Per-club picks, cached for the session: going back to a club shows the same pitch. ↻ re-rolls.
  const pickNow = (slot: Slot, id: number, turn: string): string | null =>
    pickPhrase(slot, contexts.get(id)!, rngFor(saveId, slot, `${id}:${turn}`), history.current)?.id ?? null;
  const offerPicks = (id: number, have: Record<string, string>): Record<string, string> => {
    const add: Record<string, string> = {};
    for (const slot of ["offerPitch", "boardBrief"] as Slot[]) {
      if (have[`${slot}:${id}`]) continue;
      const pid = pickNow(slot, id, "0");
      if (pid) add[`${slot}:${id}`] = pid;
    }
    return add;
  };
  const [clubId, setClubId] = useState<number>(() => calls[0].clubId);
  const [picks, setPicks] = useState<Record<string, string>>(() => offerPicks(calls[0].clubId, {}));
  const [rolls, setRolls] = useState<Record<number, number>>({});
  const sel = ctxFor(clubId);

  const asideRef = useRef<HTMLElement>(null);
  const selectClub = (id: number, reveal = false) => {
    setClubId(id);
    // Phones stack the offer panel under the 18 tiles; bring it into view.
    if (reveal && window.innerWidth < 900) requestAnimationFrame(() => asideRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    const add = offerPicks(id, picks);
    if (Object.keys(add).length) setPicks((p) => ({ ...p, ...add }));
  };
  const text = (slot: Slot, id: number) => {
    const pid = picks[`${slot}:${id}`];
    return pid ? textFor(slot, pid, ctxFor(id)) ?? "" : "";
  };
  const reroll = () => {
    const n = (rolls[clubId] ?? 0) + 1;
    setRolls((r) => ({ ...r, [clubId]: n }));
    const pid = pickNow("offerPitch", clubId, String(n));
    if (pid) setPicks((p) => ({ ...p, [`offerPitch:${clubId}`]: pid }));
  };
  const goUnveil = () => {
    const add: Record<string, string> = {};
    for (const slot of ["unveilHeadline", "unveilBody"] as Slot[]) {
      if (picks[`${slot}:${clubId}`]) continue;
      const pid = pickNow(slot, clubId, "unveil");
      if (pid) add[`${slot}:${clubId}`] = pid;
    }
    if (Object.keys(add).length) setPicks((p) => ({ ...p, ...add }));
    setStep(2);
  };

  async function commit(id: number) {
    if (committing) return;
    setCommitting(true);
    const ctx = ctxFor(id);
    const brief = picks[`boardBrief:${id}`] ?? pickNow("boardBrief", id, "0");
    await newGame(clubById(id)!.name, {
      saveId,
      coach: { name: ctx.coach, clubId: id, contractYears: ctx.contractYears },
      board: { expectation: ctx.expectation, patience: ctx.patience },
      narrative: { history: history.current as Record<string, string[]> },
      dayOne: { year: CURRENT_SEASON_YEAR, done: {}, picks: brief ? { boardBrief: brief } : {} },
      startSeason: true,
    });
    onDone();
  }
  const goRandom = () => {
    const pool = CLUBS.filter((c) => c.ClubID !== clubId);
    void commit(pool[Math.floor(Math.random() * pool.length)].ClubID);
  };

  const name = coach.trim() || "The new coach";
  const facts = (c: ClubContext) => [
    { k: "LAST SEASON", v: c.finish ?? "—" },
    { k: "LIST AVG OVR", v: c.listAvg.toFixed(1) },
    { k: "EXPECTATION", v: c.expectation },
  ];
  const term = (c: ClubContext) => `${c.contractYears} ${c.contractYears === 1 ? "YEAR" : "YEARS"}`;
  const tiles = [...contexts.values()].filter((c) => matchesFilter(c.status, filter));

  const primaryBtn: CSSProperties = { background: "var(--acc)", color: "var(--on)", border: 0, borderRadius: 10, padding: "14px 22px", font: `700 16px ${BARLOW}`, cursor: "pointer" };
  const ghostBtn: CSSProperties = { background: "transparent", color: "#dfe5ee", border: "1px solid rgba(255,255,255,.18)", borderRadius: 10, padding: "14px 18px", font: `600 15px ${BARLOW}`, cursor: "pointer" };

  return (
    <div className="onb-root" style={{ ...varsFor(sel.id), minHeight: "100vh", background: "color-mix(in oklch, var(--deep) 22%, #080b12)", transition: "background .4s" }}>
      <style>{`
        @keyframes afs-ring{0%,100%{transform:rotate(0)}10%{transform:rotate(-12deg)}20%{transform:rotate(12deg)}30%{transform:rotate(-8deg)}40%{transform:rotate(0)}}
        @keyframes afs-up{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
        .onb-root input::placeholder{color:#6f7a8e}
        .onb-ghost:hover{border-color:rgba(255,255,255,.4)!important}
        .onb-light:hover{background:#fff!important}
        @media (max-width: 560px){ .onb-shell{padding:12px 16px 40px!important} .onb-unveil{padding:28px 22px!important} .onb-tiles{grid-template-columns:repeat(2,minmax(0,1fr))!important} .onb-fact{font-size:20px!important;white-space:normal!important} }
      `}</style>
      <div style={{ background: "linear-gradient(180deg, color-mix(in oklch, var(--deep) 55%, transparent) 0, transparent 420px)", minHeight: "100vh", transition: "background .4s" }}>
        <div style={{ display: "flex", height: 4 }}>
          <div style={{ flex: 6, background: "var(--acc)" }} />
          <div style={{ flex: 2, background: "var(--acc2)" }} />
          <div style={{ flex: 6, background: "var(--acc)" }} />
        </div>
        <div className="onb-shell" style={{ maxWidth: 1400, margin: "0 auto", padding: "14px 24px 48px", display: "flex", flexDirection: "column", gap: 18 }}>
          <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 34, height: 34, borderRadius: 9, background: "#eef2f8", display: "flex", alignItems: "center", justifyContent: "center", font: `700 13px ${COND}`, color: "#0a0e17" }}>AFS</div>
              <div style={{ font: `italic 700 22px/1 ${BARLOW}`, color: "#eef2f8", letterSpacing: "-.4px" }}>
                AussieFooty<span style={{ color: "var(--accT)" }}>Sim</span>
              </div>
              {onCancel && (
                <button onClick={onCancel} style={{ marginLeft: 8, background: "transparent", border: 0, color: "#8f9ab0", font: `500 12px ${MONO}`, cursor: "pointer" }} title="Leave without starting a new game">
                  ← Back to your save
                </button>
              )}
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {STEP_LABELS.map((l, i) => {
                const on = i === step;
                const past = i < step;
                const reachable = i <= 2;
                return (
                  <button
                    key={l}
                    onClick={reachable ? () => (i === 2 ? goUnveil() : setStep(i as Step)) : undefined}
                    disabled={!reachable}
                    title={reachable ? undefined : "Sign with a club to walk in on day one"}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "7px 12px 7px 8px",
                      borderRadius: 9,
                      border: `1px solid ${on ? "color-mix(in oklch, var(--acc) 60%, transparent)" : "rgba(255,255,255,.08)"}`,
                      background: on ? "rgba(0,0,0,.3)" : "transparent",
                      color: on ? "#fff" : "#9aa4b5",
                      font: `600 13px ${BARLOW}`,
                      cursor: reachable ? "pointer" : "default",
                    }}
                  >
                    <span
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 5,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: on ? "var(--acc)" : "rgba(255,255,255,.08)",
                        color: on ? "var(--on)" : "#c3cbd8",
                        font: `600 11px ${MONO}`,
                      }}
                    >
                      {past ? "✓" : i + 1}
                    </span>
                    {l}
                  </button>
                );
              })}
            </div>
          </header>

          {step === 0 && (
            <div data-screen-label="1 Welcome" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,460px),1fr))", gap: 28, alignItems: "center", padding: "40px 0 20px", minHeight: "calc(100vh - 140px)" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 22, animation: "afs-up .5s both" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ font: `600 10px ${MONO}`, letterSpacing: "1.5px", color: "#0a0e17", background: "#eef2f8", padding: "4px 8px", borderRadius: 4 }}>PRE-SEASON {CURRENT_SEASON_YEAR}</span>
                  <span style={{ ...label, fontSize: 11 }}>{CLUBS.length} CLUBS · 1 COACH</span>
                </div>
                <h1 style={{ margin: 0, font: `700 clamp(56px,7.4vw,108px)/.88 ${COND}`, color: "#fff", letterSpacing: "-1px", textWrap: "balance" }}>Every club in the league wants you.</h1>
                <p style={{ margin: 0, font: `400 19px/1.5 ${BARLOW}`, color: "#c9d1dd", maxWidth: 560, textWrap: "pretty" }}>
                  You came from nowhere. Two flags in the state league, a game plan nobody could crack, and a way of reading the ground the old heads still can't explain. Now the phone won't stop ringing, and every president is ready to clear the coach's box for you.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 460 }}>
                  <label htmlFor="onb-coach" style={{ font: `600 10px ${MONO}`, letterSpacing: "1.5px", color: "#9aa4b5" }}>
                    WHAT DO THEY CALL YOU, COACH?
                  </label>
                  <input
                    id="onb-coach"
                    value={coach}
                    onChange={(e) => setCoach(e.target.value)}
                    placeholder="Your name"
                    maxLength={40}
                    style={{ background: "rgba(0,0,0,.35)", border: "1px solid rgba(255,255,255,.16)", borderRadius: 10, padding: "14px 16px", color: "#fff", font: `700 24px ${COND}`, letterSpacing: ".3px", outline: "none" }}
                  />
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button className="onb-light" onClick={() => setStep(1)} style={{ background: "#eef2f8", color: "#0a0e17", border: 0, borderRadius: 10, padding: "14px 22px", font: `700 16px ${BARLOW}`, cursor: "pointer" }}>
                    Take the calls →
                  </button>
                  <button className="onb-ghost" onClick={goRandom} disabled={committing} style={ghostBtn}>
                    Skip · random club
                  </button>
                  <div style={{ font: `500 12px ${MONO}`, color: "#8f9ab0", alignSelf: "center" }}>{CLUBS.length} offers waiting</div>
                </div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, font: `600 10px ${MONO}`, letterSpacing: "1.5px", color: "#9aa4b5" }}>
                  <span style={{ display: "inline-block", animation: "afs-ring 1.6s infinite", fontSize: 14 }}>☎</span>MISSED CALLS · LAST 48 HOURS
                </div>
                {calls.map((k, i) => {
                  const c = ctxFor(k.clubId);
                  return (
                    <div key={k.id} style={varsFor(k.id)}>
                      <button
                        onClick={() => {
                          selectClub(k.clubId);
                          setStep(1);
                        }}
                        style={{
                          width: "100%",
                          textAlign: "left",
                          cursor: "pointer",
                          display: "flex",
                          gap: 12,
                          alignItems: "flex-start",
                          padding: "12px 14px",
                          background: "color-mix(in oklch, var(--deep) 40%, #10151f)",
                          border: "1px solid color-mix(in oklch, var(--acc) 25%, transparent)",
                          borderRadius: 12,
                          animation: `afs-up .45s ${0.15 + i * 0.12}s both`,
                        }}
                      >
                        <ClubTile id={k.id} size={44} font={15} />
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                            <span style={{ font: `700 16px ${COND}`, color: "#fff", letterSpacing: ".3px" }}>
                              {c.club} {c.nick}
                            </span>
                            <span style={{ font: `500 11px ${MONO}`, color: "#8f9ab0", whiteSpace: "nowrap" }}>{k.time}</span>
                          </div>
                          <div style={{ font: `400 14px/1.4 ${BARLOW}`, color: "#c3cbd8", textWrap: "pretty" }}>“{k.phraseId ? textFor("missedCall", k.phraseId, c) : ""}”</div>
                        </div>
                      </button>
                    </div>
                  );
                })}
                <div style={{ font: `500 12px ${MONO}`, color: "#8f9ab0", paddingLeft: 4 }}>+ {CLUBS.length - calls.length} more from club presidents</div>
                {clipping && (
                  <div style={{ marginTop: 6, padding: "10px 14px", borderLeft: "2px solid var(--acc)", background: "rgba(0,0,0,.22)", font: `500 13px/1.4 ${BARLOW}`, color: "#b8c1cf" }}>
                    <span style={{ font: `600 10px ${MONO}`, letterSpacing: "1.2px", color: "#8f9ab0", marginRight: 8 }}>IN THE PAPERS</span>
                    {textFor("pressClipping", clipping, ctxFor(calls[0].clubId))}
                  </div>
                )}
              </div>
            </div>
          )}

          {step === 1 && (
            <div data-screen-label="2 Choose club" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, flexWrap: "wrap" }}>
                <div>
                  <div style={label}>THE OFFERS · {name.toUpperCase()}</div>
                  <h2 style={{ margin: "4px 0 0", font: `700 44px/1 ${COND}`, color: "#fff" }}>Pick your club.</h2>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {FILTERS.map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      style={{
                        padding: "7px 12px",
                        borderRadius: 8,
                        border: `1px solid ${f === filter ? "color-mix(in oklch, var(--acc) 60%, transparent)" : "rgba(255,255,255,.1)"}`,
                        background: f === filter ? "rgba(0,0,0,.3)" : "transparent",
                        color: f === filter ? "#fff" : "#9aa4b5",
                        font: `600 13px ${BARLOW}`,
                        cursor: "pointer",
                      }}
                    >
                      {f}
                    </button>
                  ))}
                  <button onClick={goRandom} disabled={committing} style={{ padding: "7px 12px", borderRadius: 8, border: "1px dashed rgba(255,255,255,.25)", background: "transparent", color: "#dfe5ee", font: `600 13px ${BARLOW}`, cursor: "pointer" }}>
                    Random club → Day one
                  </button>
                </div>
              </div>
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
                <div style={{ flex: "1.5 1 520px", minWidth: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,200px),1fr))", gap: 10 }} className="onb-tiles">
                  {tiles.map((k) => {
                    const on = k.clubId === clubId;
                    return (
                      <div key={k.id} style={varsFor(k.id)}>
                        <button
                          onClick={() => selectClub(k.clubId, true)}
                          aria-pressed={on}
                          style={{
                            width: "100%",
                            display: "flex",
                            flexDirection: "column",
                            gap: 12,
                            padding: 14,
                            borderRadius: 12,
                            cursor: "pointer",
                            textAlign: "left",
                            background: on ? "color-mix(in oklch, var(--deep) 75%, #10151f)" : "color-mix(in oklch, var(--deep) 30%, #10151f)",
                            border: `1px solid ${on ? "var(--acc)" : "rgba(255,255,255,.07)"}`,
                            boxShadow: on ? "0 0 0 1px var(--acc)" : "none",
                            transition: "background .2s, border-color .2s",
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                            <ClubTile id={k.id} size={40} font={14} />
                            <span style={{ font: `600 9px ${MONO}`, letterSpacing: "1px", color: "#c3cbd8", border: "1px solid rgba(255,255,255,.16)", padding: "3px 6px", borderRadius: 4 }}>{STATUS_LABEL[k.status].toUpperCase()}</span>
                          </div>
                          <div>
                            <div style={{ font: `700 20px/1 ${COND}`, color: "#fff" }}>{k.club}</div>
                            <div style={{ font: `600 13px ${BARLOW}`, color: "var(--accT)" }}>{k.nick}</div>
                          </div>
                          <div style={{ display: "flex", justifyContent: "space-between", font: `500 11px ${MONO}`, color: "#9aa4b5" }}>
                            <span>LAST {k.finish ?? "—"}</span>
                            <span>OVR {k.listAvg.toFixed(1)}</span>
                          </div>
                        </button>
                      </div>
                    );
                  })}
                </div>
                <aside
                  ref={asideRef}
                  style={{
                    flex: "1 1 380px",
                    minWidth: 0,
                    position: "sticky",
                    top: 16,
                    background: "color-mix(in oklch, var(--deep) 45%, #10151f)",
                    border: "1px solid color-mix(in oklch, var(--acc) 35%, transparent)",
                    borderRadius: 16,
                    padding: 22,
                    display: "flex",
                    flexDirection: "column",
                    gap: 18,
                    overflow: "hidden",
                  }}
                >
                  <div style={{ position: "absolute", right: -10, top: -40, font: `700 200px/1 ${COND}`, color: "color-mix(in oklch, var(--acc) 12%, transparent)", pointerEvents: "none", letterSpacing: "-6px" }}>{sel.id}</div>
                  <div style={{ position: "relative", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <span style={{ font: `600 10px ${MONO}`, letterSpacing: "1.5px", color: "var(--on)", background: "var(--acc)", padding: "3px 7px", borderRadius: 4 }}>OFFER</span>
                    <span style={{ font: `500 11px ${MONO}`, letterSpacing: "1.5px", color: "#b3bccb" }}>{term(sel)}</span>
                  </div>
                  <div style={{ position: "relative" }}>
                    <h3 style={{ margin: 0, font: `700 46px/1 ${COND}`, color: "#fff" }}>
                      {sel.club} <span style={{ color: "var(--accT)" }}>{sel.nick}</span>
                    </h3>
                    <div style={{ font: `500 13px ${BARLOW}`, color: "#aab3c3", marginTop: 4 }}>
                      {sel.ground} · {STATUS_LABEL[sel.status]}
                    </div>
                  </div>
                  <blockquote style={{ position: "relative", margin: 0, padding: "14px 16px", background: "rgba(0,0,0,.28)", borderRadius: 12, font: `500 17px/1.45 ${BARLOW}`, color: "#eef2f8", textWrap: "pretty" }}>
                    “{text("offerPitch", clubId)}”
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                      <span style={{ font: `500 11px ${MONO}`, letterSpacing: "1px", color: "#9aa4b5" }}>— CLUB PRESIDENT</span>
                      <button onClick={reroll} title="Another line from the president" aria-label="Another line from the president" style={{ background: "transparent", border: "1px solid rgba(255,255,255,.14)", borderRadius: 6, color: "#c3cbd8", font: `600 13px ${MONO}`, padding: "2px 8px", cursor: "pointer" }}>
                        ↻
                      </button>
                    </div>
                  </blockquote>
                  <div style={{ position: "relative", display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8 }}>
                    {facts(sel).map((x) => (
                      <div key={x.k} style={{ background: "rgba(0,0,0,.25)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 10, padding: "10px 12px", minWidth: 0 }}>
                        <div className="onb-fact" style={{ font: `700 26px/1 ${COND}`, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{x.v}</div>
                        <div style={{ font: `500 9px ${MONO}`, letterSpacing: "1px", color: "#aab3c3", marginTop: 4 }}>{x.k}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 10 }}>
                    <Row k="THE BRIEF">
                      <span style={{ font: `500 14px/1.4 ${BARLOW}`, color: "#dfe5ee" }}>{text("boardBrief", clubId)}</span>
                    </Row>
                    <Row k="BEST PLAYER">
                      <span style={{ font: `500 14px/1.4 ${BARLOW}`, color: "#dfe5ee" }}>
                        {sel.star ? `${sel.star.name} · ${sel.star.pos} · ${sel.star.age}` : "—"}
                      </span>
                    </Row>
                    <Row k="PATIENCE" center>
                      <PatienceBar patience={sel.patience} />
                    </Row>
                  </div>
                  <button onClick={goUnveil} style={{ ...primaryBtn, position: "relative", padding: "14px 18px" }}>
                    Sign with {sel.club}
                  </button>
                </aside>
              </div>
            </div>
          )}

          {step === 2 && (
            <div data-screen-label="3 Unveiling" style={{ display: "flex", justifyContent: "center", padding: "36px 0" }}>
              <div
                className="onb-unveil"
                style={{
                  width: "100%",
                  maxWidth: 860,
                  position: "relative",
                  overflow: "hidden",
                  background: "color-mix(in oklch, var(--deep) 60%, #10151f)",
                  border: "1px solid color-mix(in oklch, var(--acc) 40%, transparent)",
                  borderRadius: 20,
                  padding: "40px 44px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 22,
                  animation: "afs-up .5s both",
                }}
              >
                <div style={{ position: "absolute", right: -20, bottom: -70, font: `700 300px/1 ${COND}`, color: "color-mix(in oklch, var(--acc) 12%, transparent)", pointerEvents: "none", letterSpacing: "-10px" }}>{sel.id}</div>
                <div style={{ position: "relative", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ font: `600 10px ${MONO}`, letterSpacing: "1.5px", color: "var(--on)", background: "var(--acc)", padding: "3px 7px", borderRadius: 4 }}>BREAKING</span>
                  <span style={{ font: `500 11px ${MONO}`, letterSpacing: "1.5px", color: "#b3bccb" }}>{sel.ground.toUpperCase()} · PRESS CONFERENCE</span>
                </div>
                <h2 style={{ position: "relative", margin: 0, font: `700 clamp(40px,6vw,76px)/.92 ${COND}`, color: "#fff", textWrap: "balance" }}>
                  <Highlight text={text("unveilHeadline", clubId)} ctx={sel} />
                </h2>
                <p style={{ position: "relative", margin: 0, font: `400 18px/1.5 ${BARLOW}`, color: "#dfe5ee", maxWidth: 640, textWrap: "pretty" }}>{text("unveilBody", clubId)}</p>
                <div style={{ position: "relative", display: "flex", gap: 28, flexWrap: "wrap" }}>
                  {[
                    { k: "CONTRACT", v: term(sel) },
                    { k: "THE BRIEF", v: sel.expectation },
                    { k: "ROUND 1", v: sel.r1 ? `vs ${sel.r1.club}` : "—" },
                  ].map((x) => (
                    <div key={x.k}>
                      <div style={{ font: `500 10px ${MONO}`, letterSpacing: "1.2px", color: "#9aa4b5" }}>{x.k}</div>
                      <div style={{ font: `700 28px ${COND}`, color: "#fff" }}>{x.v}</div>
                    </div>
                  ))}
                </div>
                <div style={{ position: "relative", display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <button onClick={() => void commit(clubId)} disabled={committing} style={primaryBtn}>
                    {committing ? "Signing…" : "Walk into the club →"}
                  </button>
                  <button className="onb-ghost" onClick={() => setStep(1)} style={ghostBtn}>
                    Back to the offers
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
