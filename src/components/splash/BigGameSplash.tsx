import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { clubTokensFor } from "../../theme/clubTokens";
import { clubThemeStyle } from "../../theme/useClubTheme";
import type { SplashVM } from "../../narrative/splashData";
import { BARLOW, COND, MONO } from "../matchday/shared";

/**
 * Big Game Splash (`Big Game Splash.dc.html`) — the full-screen celebration or commiseration shown at
 * full time of a Grand Final, Anzac Day or King's Birthday match the coach played, before the normal
 * full-time report. A fixed overlay, so it can also be reopened from any match report's "Medal" chip.
 *
 * The page wears the coach's club colours (a glow on a win; desaturated on a loss). The medal card
 * always wears the medallist's club colours. Confetti on a win only, off for reduced motion or when
 * the coach turns it off. Space (or Continue) skips the staged reveal.
 */

const GOLD = "#e8c25a";
const CONFETTI_KEY = "afs.splash.confetti";

function confettiPref(): boolean {
  try {
    return localStorage.getItem(CONFETTI_KEY) !== "off";
  } catch {
    return true;
  }
}

function setConfettiPref(on: boolean) {
  try {
    localStorage.setItem(CONFETTI_KEY, on ? "on" : "off");
  } catch {
    /* storage unavailable: the toggle still works for this view */
  }
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

const vars = (abbr: string) => clubThemeStyle(clubTokensFor(abbr));

function Confetti({ colors }: { colors: string[] }) {
  const bits = useMemo(() => {
    let s = 7;
    const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
    return Array.from({ length: 90 }, (_, i) => ({
      left: rnd() * 100,
      w: 6 + rnd() * 6,
      h: 10 + rnd() * 10,
      color: colors[i % colors.length],
      dx: (rnd() - 0.5) * 160,
      rot: 360 + rnd() * 720,
      dur: 5 + rnd() * 5,
      delay: -rnd() * 8,
    }));
  }, [colors]);
  return (
    <div aria-hidden="true" style={{ position: "fixed", inset: 0, overflow: "hidden", pointerEvents: "none", zIndex: 5 }}>
      {bits.map((b, i) => (
        <span
          key={i}
          style={
            {
              position: "absolute",
              left: `${b.left}%`,
              top: 0,
              width: b.w,
              height: b.h,
              background: b.color,
              borderRadius: 2,
              opacity: 0.9,
              "--dx": `${b.dx}px`,
              "--rot": `${b.rot}deg`,
              animation: `afs-fall ${b.dur}s linear ${b.delay}s infinite`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

export function BigGameSplash({
  vm,
  myAbbr,
  onContinue,
  onReplay,
  onClose,
}: {
  vm: SplashVM;
  myAbbr: string;
  onContinue: () => void;
  /** Live match only: replay the match from Q1. */
  onReplay?: () => void;
  /** Reopened from a match report: close back to it. */
  onClose?: () => void;
}) {
  const [skip, setSkip] = useState(false);
  const [confettiOn, setConfettiOn] = useState(confettiPref);
  const reduced = useMemo(prefersReducedMotion, []);
  const win = vm.won;

  // The page behind stays put while the splash is up.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        setSkip(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const tokens = clubTokensFor(myAbbr);
  const confettiColors = useMemo(() => [tokens.acc, tokens.acc2, GOLD, "#ffffff"], [tokens.acc, tokens.acc2]);
  const showConfetti = win && confettiOn && !reduced;
  const up = (delay: number): CSSProperties => (skip || reduced ? {} : { animation: `afs-up .6s ${delay}s both` });
  const hero = win && vm.event.headlineScale === "hero";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${vm.event.label} — full time`}
      data-screen-label="Big game splash"
      style={{ position: "fixed", inset: 0, zIndex: 60, overflowY: "auto", ...vars(myAbbr), background: "color-mix(in oklch, var(--deep) 26%, #080b12)" }}
    >
      <style>{`
        @keyframes afs-up{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
        @keyframes afs-fall{0%{transform:translate3d(0,-10vh,0) rotate(0)}100%{transform:translate3d(var(--dx),110vh,0) rotate(var(--rot))}}
        @keyframes afs-shine{0%,100%{opacity:.35}50%{opacity:.8}}
        @media (prefers-reduced-motion: reduce){ .bgs-shine{animation:none!important} }
        @media (max-width: 640px){ .bgs-hero{padding:28px 20px 26px!important} .bgs-shell{padding:12px 16px 40px!important} .bgs-card{padding:22px 18px!important} }
      `}</style>
      {showConfetti && <Confetti colors={confettiColors} />}
      <div style={{ minHeight: "100%", filter: win ? "none" : "saturate(.55)" }}>
        <div
          style={{
            minHeight: "100vh",
            background: win
              ? "radial-gradient(120% 60% at 50% 0%, color-mix(in oklch, var(--acc) 30%, transparent) 0, transparent 60%)"
              : "linear-gradient(180deg, color-mix(in oklch, var(--deep) 45%, transparent) 0, transparent 420px)",
          }}
        >
          <div style={{ display: "flex", height: 4 }}>
            <div style={{ flex: 6, background: "var(--acc)" }} />
            <div style={{ flex: 2, background: "var(--acc2)" }} />
            <div style={{ flex: 6, background: "var(--acc)" }} />
          </div>
          <div className="bgs-shell" style={{ maxWidth: 1400, margin: "0 auto", padding: "14px 24px 56px", display: "flex", flexDirection: "column", gap: 22, position: "relative" }}>
            <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 34, height: 34, borderRadius: 9, background: "#eef2f8", display: "flex", alignItems: "center", justifyContent: "center", font: `700 13px ${COND}`, color: "#0a0e17" }}>AFS</div>
                <div style={{ font: `italic 700 22px/1 ${BARLOW}`, color: "#eef2f8", letterSpacing: "-.4px" }}>
                  AussieFooty<span style={{ color: "var(--accT)" }}>Sim</span>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {win && (
                  <button
                    onClick={() => {
                      setConfettiOn((v) => !v);
                      setConfettiPref(!confettiOn);
                    }}
                    aria-pressed={confettiOn}
                    style={{ background: "transparent", border: "1px solid rgba(255,255,255,.14)", borderRadius: 8, color: "#9aa4b5", font: `600 11px ${MONO}`, letterSpacing: "1px", padding: "6px 10px", cursor: "pointer" }}
                  >
                    CONFETTI {confettiOn ? "ON" : "OFF"}
                  </button>
                )}
                {onClose && (
                  <button onClick={onClose} style={{ background: "transparent", border: "1px solid rgba(255,255,255,.14)", borderRadius: 8, color: "#dfe5ee", font: `600 13px ${BARLOW}`, padding: "6px 12px", cursor: "pointer" }}>
                    Close
                  </button>
                )}
              </div>
            </header>

            <section
              className="bgs-hero"
              data-screen-label="Big game splash — hero"
              style={{ position: "relative", overflow: "hidden", borderRadius: 22, border: "1px solid color-mix(in oklch, var(--acc) 40%, transparent)", background: "color-mix(in oklch, var(--deep) 62%, #0d1119)", padding: "44px 48px 40px", display: "flex", flexDirection: "column", gap: 26 }}
            >
              <div aria-hidden="true" style={{ position: "absolute", right: -30, top: -60, font: `700 340px/1 ${COND}`, color: "color-mix(in oklch, var(--acc) 11%, transparent)", letterSpacing: "-12px", pointerEvents: "none" }}>
                {vm.bigMark}
              </div>
              <div style={{ position: "relative", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", ...up(0) }}>
                <span data-testid="result-chip" style={{ font: `600 11px ${MONO}`, letterSpacing: "1.5px", color: win ? "var(--on)" : "#eef2f8", background: win ? "var(--acc)" : "rgba(255,255,255,.1)", padding: "5px 9px", borderRadius: 5 }}>
                  {vm.resultChip}
                </span>
                <span style={{ font: `500 11px ${MONO}`, letterSpacing: "1.5px", color: "#c3cbd8" }}>
                  {vm.eyebrow} · {vm.venue.toUpperCase()} · FULL TIME
                </span>
                {vm.event.tribute && (
                  <span style={{ font: `600 11px ${MONO}`, letterSpacing: "1.5px", color: "#eef2f8", borderLeft: "1px solid rgba(255,255,255,.2)", paddingLeft: 10 }}>{vm.event.tribute}</span>
                )}
              </div>
              <div style={{ position: "relative", display: "flex", flexDirection: "column", gap: 14, ...up(0.1) }}>
                <h1 style={{ margin: 0, font: `700 ${hero ? "clamp(96px,14vw,200px)" : "clamp(52px,8.5vw,124px)"}/.86 ${COND}`, color: "#fff", letterSpacing: hero ? -3 : -1, textWrap: "balance" } as CSSProperties}>{vm.headline}</h1>
                <p style={{ margin: 0, font: `400 20px/1.5 ${BARLOW}`, color: "#dfe5ee", maxWidth: 720, textWrap: "pretty" } as CSSProperties}>{vm.sub}</p>
              </div>
              <div style={{ position: "relative", display: "flex", gap: 14, flexWrap: "wrap", alignItems: "stretch", ...up(0.25) }}>
                {vm.scoreRows.map((r, i) => (
                  <div key={r.abbr} style={{ ...vars(r.abbr), flex: "1 1 300px", minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 14,
                        padding: "14px 18px",
                        borderRadius: 14,
                        background: i === 0 ? "color-mix(in oklch, var(--deep) 70%, #0d1119)" : "rgba(0,0,0,.28)",
                        border: `1px solid ${i === 0 ? "color-mix(in oklch, var(--acc) 55%, transparent)" : "rgba(255,255,255,.08)"}`,
                      }}
                    >
                      <div style={{ width: 52, height: 52, flex: "none", borderRadius: 11, background: "var(--deep)", border: "1px solid color-mix(in oklch, var(--acc) 60%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", font: `700 17px ${COND}`, color: "var(--accT)" }}>{r.abbr}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ font: `700 22px/1 ${COND}`, color: i === 0 ? "#fff" : "#aab3c3" }}>{r.name}</div>
                        <div style={{ font: `500 13px ${MONO}`, color: "#aab3c3", marginTop: 4 }}>{r.gb}</div>
                      </div>
                      <div style={{ font: `700 ${i === 0 ? 56 : 44}px/1 ${COND}`, color: i === 0 ? "#fff" : "#9aa4b5" }}>{r.pts}</div>
                    </div>
                  </div>
                ))}
                <div style={{ display: "flex", gap: 24, alignItems: "center", padding: "0 8px", flexWrap: "wrap" }}>
                  {vm.facts.map((f) => (
                    <div key={f.k}>
                      <div style={{ font: `500 10px ${MONO}`, letterSpacing: "1.2px", color: "#9aa4b5" }}>{f.k}</div>
                      <div style={{ font: `700 26px ${COND}`, color: "#fff" }}>{f.v}</div>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "stretch" }}>
              <div data-testid="medal-card" data-club={vm.medal.clubAbbr} style={{ ...vars(vm.medal.clubAbbr), flex: "1.4 1 520px", minWidth: 0 }}>
                <section
                  className="bgs-card"
                  data-screen-label="Medal"
                  style={{
                    position: "relative",
                    overflow: "hidden",
                    height: "100%",
                    borderRadius: 20,
                    border: "1px solid color-mix(in oklch, var(--acc) 45%, transparent)",
                    background: "radial-gradient(120% 90% at 20% 0%, color-mix(in oklch, var(--deep) 85%, #1a1a10) 0, #0d1119 70%)",
                    padding: "28px 30px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 20,
                    ...up(0.4),
                  }}
                >
                  <div style={{ display: "flex", gap: 22, alignItems: "center", flexWrap: "wrap" }}>
                    <div
                      style={{
                        position: "relative",
                        width: 120,
                        height: 120,
                        flex: "none",
                        borderRadius: "50%",
                        background: "radial-gradient(circle at 35% 30%, #fff3c4 0, #e8c25a 30%, #a8801f 70%, #6e5210 100%)",
                        boxShadow: "0 0 0 6px rgba(232,194,90,.18), 0 12px 40px rgba(232,194,90,.25)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <div style={{ position: "absolute", inset: 10, borderRadius: "50%", border: "1.5px solid rgba(80,58,8,.5)" }} />
                      <div className="bgs-shine" style={{ position: "absolute", inset: 0, borderRadius: "50%", background: "linear-gradient(135deg, rgba(255,255,255,.55), transparent 45%)", animation: skip ? "none" : "afs-shine 3s infinite" }} />
                      <div style={{ position: "relative", textAlign: "center", color: "#3d2c05" }}>
                        <div style={{ font: `700 40px/1 ${COND}` }}>{vm.medal.num}</div>
                        <div style={{ font: `600 9px ${MONO}`, letterSpacing: "1px" }}>{vm.medal.clubAbbr}</div>
                      </div>
                    </div>
                    <div style={{ flex: 1, minWidth: 220 }}>
                      <div style={{ font: `600 11px ${MONO}`, letterSpacing: "1.8px", color: GOLD }}>{vm.event.medal}</div>
                      <div style={{ font: `700 52px/.95 ${COND}`, color: "#fff", margin: "6px 0", textWrap: "balance" } as CSSProperties}>{vm.medal.name}</div>
                      <div style={{ font: `500 14px ${BARLOW}`, color: "#c3cbd8" }}>
                        {vm.medal.pos} · {vm.medal.clubName} · <span style={{ color: "#fff", fontWeight: 600 }}>{vm.medal.stat}</span>
                      </div>
                    </div>
                  </div>
                  <p style={{ margin: 0, font: `500 17px/1.5 ${BARLOW}`, color: "#eef2f8", textWrap: "pretty" } as CSSProperties}>{vm.medal.citation}</p>
                  <div style={{ display: "flex", flexDirection: "column", borderTop: "1px solid rgba(255,255,255,.08)" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) repeat(5,30px) 44px", gap: 4, padding: "10px 0 6px", font: `500 10px ${MONO}`, letterSpacing: "1px", color: "#8f9ab0" }}>
                      <span>JUDGES · 3-2-1</span>
                      {["J1", "J2", "J3", "J4", "J5"].map((j) => (
                        <span key={j} style={{ textAlign: "center" }}>
                          {j}
                        </span>
                      ))}
                      <span style={{ textAlign: "right" }}>TOTAL</span>
                    </div>
                    {vm.votes.map((v, i) => {
                      const t = clubTokensFor(v.clubAbbr);
                      return (
                        <div key={v.playerId} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) repeat(5,30px) 44px", gap: 4, alignItems: "center", padding: "8px 0", borderTop: "1px solid rgba(255,255,255,.05)" }}>
                          <span style={{ display: "flex", gap: 8, alignItems: "center", minWidth: 0 }}>
                            <span style={{ flex: "none", font: `600 9px ${MONO}`, letterSpacing: ".5px", color: t.accT, background: t.deep, border: `1px solid ${t.acc}`, padding: "2px 5px", borderRadius: 4 }}>{v.clubAbbr}</span>
                            <span style={{ font: `${i === 0 ? 700 : 600} 15px ${BARLOW}`, color: i === 0 ? "#fff" : "#c3cbd8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.name}</span>
                          </span>
                          {v.votes.map((n, j) => (
                            <span key={j} style={{ textAlign: "center", font: `600 13px ${MONO}`, color: n === 3 ? GOLD : n ? "#dfe5ee" : "#5d6778" }}>
                              {n || "–"}
                            </span>
                          ))}
                          <span style={{ textAlign: "right", font: `700 20px ${COND}`, color: i === 0 ? GOLD : "#dfe5ee" }}>{v.total}</span>
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>

              <section
                className="bgs-card"
                style={{ flex: "1 1 380px", minWidth: 0, borderRadius: 20, border: "1px solid rgba(255,255,255,.08)", background: "color-mix(in oklch, var(--deep) 30%, #0e131c)", padding: "26px 28px", display: "flex", flexDirection: "column", gap: 18, ...up(0.55) }}
              >
                <div style={{ font: `500 11px ${MONO}`, letterSpacing: "1.5px", color: "#9aa4b5" }}>{vm.quoteLabel}</div>
                <blockquote style={{ margin: 0, font: `600 26px/1.3 ${COND}`, color: "#fff", letterSpacing: ".2px", textWrap: "pretty" } as CSSProperties}>“{vm.quote.text}”</blockquote>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <span style={{ width: 28, height: 2, background: "var(--acc)" }} />
                  <span style={{ font: `600 13px ${BARLOW}`, color: "#dfe5ee" }}>{vm.quote.by}</span>
                </div>
                <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 10, paddingTop: 16, borderTop: "1px solid rgba(255,255,255,.07)" }}>
                  {vm.milestones.map((m) => (
                    <div key={m.k} style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
                      <span style={{ flex: "none", width: 112, font: `600 10px ${MONO}`, letterSpacing: "1px", color: "#9aa4b5" }}>{m.k}</span>
                      <span style={{ font: `500 15px/1.4 ${BARLOW}`, color: "#eef2f8" }}>{m.v}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <section data-screen-label="Players who stood up" style={{ display: "flex", flexDirection: "column", gap: 14, ...up(0.7) }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <h2 style={{ margin: 0, font: `700 34px/1 ${COND}`, color: "#fff" }}>{vm.standLabel}</h2>
                <span style={{ font: `500 11px ${MONO}`, letterSpacing: "1.5px", color: "#9aa4b5" }}>{vm.myClubLabel} · RANKED BY COACHES' VOTES</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,260px),1fr))", gap: 12 }}>
                {vm.stood.map((p, i) => (
                  <div
                    key={p.playerId}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                      padding: "16px 18px",
                      borderRadius: 14,
                      background: i === 0 ? "color-mix(in oklch, var(--deep) 60%, #0e131c)" : "color-mix(in oklch, var(--deep) 25%, #0e131c)",
                      border: `1px solid ${i === 0 ? "color-mix(in oklch, var(--acc) 50%, transparent)" : "rgba(255,255,255,.07)"}`,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                      <div style={{ width: 42, height: 42, borderRadius: 10, background: "var(--deep)", border: "1px solid color-mix(in oklch, var(--acc) 55%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", font: `700 18px ${COND}`, color: "var(--accT)" }}>{p.num}</div>
                      <span style={{ font: `600 10px ${MONO}`, letterSpacing: "1px", color: p.rank === "MEDALLIST" ? GOLD : "#c3cbd8" }}>{p.rank}</span>
                    </div>
                    <div>
                      <div style={{ font: `700 24px/1 ${COND}`, color: "#fff" }}>{p.name}</div>
                      <div style={{ font: `500 12px ${MONO}`, color: "#9aa4b5", marginTop: 4 }}>{p.pos}</div>
                    </div>
                    <div style={{ font: `600 14px ${BARLOW}`, color: "var(--accT)" }}>{p.stat}</div>
                    <div style={{ font: `400 14px/1.45 ${BARLOW}`, color: "#c3cbd8", textWrap: "pretty" } as CSSProperties}>{p.cite}</div>
                  </div>
                ))}
              </div>
            </section>

            {vm.squad && (
              <section
                data-screen-label="Premiership team"
                data-testid="squad"
                style={{ borderRadius: 20, border: "1px solid color-mix(in oklch, var(--acc) 35%, transparent)", background: "color-mix(in oklch, var(--deep) 45%, #0e131c)", padding: "24px 28px", display: "flex", flexDirection: "column", gap: 16, ...up(0.85) }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <h2 style={{ margin: 0, font: `700 30px/1 ${COND}`, color: "#fff" }}>{vm.squad.title}</h2>
                  <span style={{ font: `500 11px ${MONO}`, letterSpacing: "1.5px", color: "#9aa4b5" }}>{vm.squad.sub}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,190px),1fr))", gap: 8 }}>
                  {vm.squad.players.map((s) => (
                    <div key={`${s.num}-${s.name}`} style={{ display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", borderRadius: 9, background: "rgba(0,0,0,.25)", border: "1px solid rgba(255,255,255,.06)" }}>
                      <span style={{ width: 26, font: `600 13px ${MONO}`, color: "var(--accT)", textAlign: "right" }}>{s.num}</span>
                      <span style={{ font: `600 15px ${BARLOW}`, color: "#eef2f8" }}>{s.name}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, flexWrap: "wrap", paddingTop: 4, ...up(1) }}>
              <span style={{ font: `400 14px ${BARLOW}`, color: "#9aa4b5" }}>{vm.footNote}</span>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {onReplay && (
                  <button onClick={onReplay} style={{ background: "transparent", color: "#dfe5ee", border: "1px solid rgba(255,255,255,.18)", borderRadius: 10, padding: "14px 18px", font: `600 15px ${BARLOW}`, cursor: "pointer" }}>
                    Replay from Q1
                  </button>
                )}
                <button
                  onClick={() => {
                    setSkip(true);
                    onContinue();
                  }}
                  style={{ background: "var(--acc)", color: "var(--on)", border: 0, borderRadius: 10, padding: "14px 22px", font: `700 16px ${BARLOW}`, cursor: "pointer" }}
                >
                  Continue to match report →
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
