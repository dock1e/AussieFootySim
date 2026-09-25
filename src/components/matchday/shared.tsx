import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { MatchEvent } from "../../engine/match";
import { clubByName } from "../../types/club";
import { clubTokensFor } from "../../theme/clubTokens";
import { clubThemeStyle } from "../../theme/useClubTheme";
import { MINUTES_PER_QUARTER } from "../../engine/fantasyEngine";

/**
 * Match Day v2 — shared building blocks (`match-day-v2/02-implementation-spec.md` §0, visual source of
 * truth `Match Day v2.dc.html`). Every value here is copied from that file's inline styles. Used by the
 * live, break and full-time screens so the three states share one scoreboard, one stat strip and one
 * set of team chips — and so nothing on Match Day uses the old fixed violet `primary` token.
 */

export const RISE = "#4fd69a";
export const FALL = "#ffa37a";
export const WARN = "#f0c04a";

export const MONO = "'IBM Plex Mono', ui-monospace, monospace";
export const COND = "'Barlow Condensed', sans-serif";
export const BARLOW = "Barlow, system-ui, sans-serif";

export const CARD_BG = "color-mix(in oklch, var(--deep) var(--tc), #10151f)";
export const CARD_BORDER = "1px solid rgba(255,255,255,.07)";
export const HERO_BG = "color-mix(in oklch, var(--deep) calc(var(--tc) * 2.4), #10151f)";
export const PANEL_BG = "color-mix(in oklch, var(--deep) calc(var(--tc) * 1.6), #0f141e)";

export const cardStyle: CSSProperties = { background: CARD_BG, border: CARD_BORDER, borderRadius: 14 };

/** Critique A6: one section-label style everywhere (IBM Plex Mono 600 10px, 1.2px tracking). `--accT` only when the section is "yours". */
export function sectionLabelStyle(yours = false): CSSProperties {
  return { font: `600 10px ${MONO}`, letterSpacing: "1.2px", color: yours ? "var(--accT)" : "#8f9ab0", textTransform: "uppercase" };
}

export function SectionLabel({ children, yours, style }: { children: ReactNode; yours?: boolean; style?: CSSProperties }) {
  return <div style={{ ...sectionLabelStyle(yours), ...style }}>{children}</div>;
}

/** Fitness threshold colours — critique C8: ≥70 green, ≥45 amber, otherwise coral. */
export function fitColor(f: number): string {
  return f >= 70 ? RISE : f >= 45 ? WARN : FALL;
}

/** `FitnessValue` (spec §0): always the number, never colour alone. */
export function FitnessValue({ value, boxed = false }: { value: number; boxed?: boolean }) {
  const col = fitColor(value);
  return (
    <span
      style={{
        flex: "none",
        font: `600 ${boxed ? 10 : 11}px ${MONO}`,
        color: col,
        ...(boxed ? { padding: "1px 5px", borderRadius: 4, border: `1px solid ${col}` } : {}),
      }}
    >
      {Math.round(value)}%
    </span>
  );
}

/** A club's five theme vars, scoped to a wrapper — how another club's colours appear (brief rule 6). */
export function clubVarsByName(name: string | undefined): CSSProperties {
  return clubThemeStyle(clubTokensFor(name ? clubByName(name)?.abbreviation : undefined));
}

export function clubAbbr(name: string): string {
  return clubByName(name)?.abbreviation ?? name.slice(0, 4).toUpperCase();
}

/**
 * `TeamBadge` (spec §0, critique A7): the same recipe for both teams — `--deep` fill, 1px `--acc` 55%
 * border, `--accT` text — each club's vars scoped on the wrapper. No white-filled opponent badge.
 */
export function TeamBadge({ name, size = 52 }: { name: string; size?: number }) {
  return (
    <span style={{ ...clubVarsByName(name), display: "inline-flex", flex: "none" }} title={name}>
      <span
        style={{
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.21),
          background: "var(--deep)",
          border: "1px solid color-mix(in oklch, var(--acc) 55%, transparent)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          font: `700 ${Math.round(size * 0.33)}px ${COND}`,
          color: "var(--accT)",
        }}
      >
        {clubAbbr(name)}
      </span>
    </span>
  );
}

/** `TeamChip` — the small inline monogram (play by play, votes, top performers). */
export function TeamChip({ name, size = 11 }: { name: string; size?: number }) {
  return (
    <span style={{ ...clubVarsByName(name), display: "inline-flex", flex: "none" }} title={name}>
      <span
        style={{
          display: "inline-flex",
          padding: size <= 10 ? "1px 5px" : "2px 6px",
          borderRadius: size <= 10 ? 4 : 5,
          background: "var(--deep)",
          border: "1px solid color-mix(in oklch, var(--acc) 50%, transparent)",
          font: `700 ${size}px ${COND}`,
          color: "var(--accT)",
        }}
      >
        {clubAbbr(name)}
      </span>
    </span>
  );
}

// --- Clock + quarter maths -------------------------------------------------------------------------

/** Critique C1 / spec §0: Q1 break → QUARTER TIME, Q2 → HALF TIME, Q3 → THREE-QUARTER TIME. */
export function breakLabel(quarterJustFinished: number): string {
  return quarterJustFinished === 1 ? "QUARTER TIME" : quarterJustFinished === 2 ? "HALF TIME" : "THREE-QUARTER TIME";
}

/** "Sim to {next break}" wording for the transport bar. */
export function nextBreakName(quarter: number): string {
  return quarter <= 1 ? "quarter time" : quarter === 2 ? "half time" : quarter === 3 ? "three-quarter time" : "full time";
}

function mmss(minutes: number): string {
  const total = Math.max(0, Math.round(minutes * 60));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * The game clock (critique A2): time elapsed in the quarter plus time left, never ticks. Maps engine
 * ticks onto the same 30-minute quarter `engine/fantasyEngine.ts` already uses for FP/min and Δ5
 * (`MINUTES_PER_QUARTER`), so every minute figure on this screen agrees.
 */
export function gameClock(tick: number, quarter: number, ticksPerQuarter: number): { elapsed: string; left: string; fraction: number } {
  const into = Math.max(0, Math.min(ticksPerQuarter, tick - (quarter - 1) * ticksPerQuarter));
  const elapsedMin = (into / ticksPerQuarter) * MINUTES_PER_QUARTER;
  return { elapsed: mmss(elapsedMin), left: mmss(MINUTES_PER_QUARTER - elapsedMin), fraction: into / ticksPerQuarter };
}

/** Clock label for any event, e.g. `Q2 16:10`. */
export function eventClock(ev: MatchEvent, ticksPerQuarter: number): string {
  return `Q${ev.quarter} ${gameClock(ev.tick, ev.quarter, ticksPerQuarter).elapsed}`;
}

export interface QuarterGB {
  hg: number;
  hb: number;
  ag: number;
  ab: number;
}

/** Cumulative goals/behinds at the end of each quarter reached so far (critique A5). Index 0 = Q1. */
export function quarterGoalsBehinds(events: MatchEvent[], homeIds: Set<number>, awayIds: Set<number>): QuarterGB[] {
  const out: QuarterGB[] = [];
  const cur: QuarterGB = { hg: 0, hb: 0, ag: 0, ab: 0 };
  let q = 1;
  for (const ev of events) {
    while (ev.quarter > q) {
      out.push({ ...cur });
      q++;
    }
    for (const d of ev.statDeltas) {
      if (d.stat !== "goals" && d.stat !== "behinds") continue;
      const home = homeIds.has(d.playerId);
      if (!home && !awayIds.has(d.playerId)) continue;
      if (d.stat === "goals") home ? (cur.hg += d.delta) : (cur.ag += d.delta);
      else home ? (cur.hb += d.delta) : (cur.ab += d.delta);
    }
  }
  if (events.length > 0) out.push({ ...cur });
  return out;
}

// --- Scoreboard ------------------------------------------------------------------------------------

export interface ScoreSide {
  name: string;
  goals: number;
  behinds: number;
  points: number;
}

/**
 * `Scoreboard` (spec §0). Home block · centre · away block, flex-wrap; no buttons. The centre carries
 * the status line, a 4-segment quarter bar and the two-row quarter table of cumulative G.B (future
 * quarters `–`, current quarter in `--accT`).
 */
export function Scoreboard({
  home,
  away,
  status,
  statusSub,
  live,
  segments,
  quarters,
  currentQuarter,
}: {
  home: ScoreSide;
  away: ScoreSide;
  status: string;
  statusSub: string;
  live: boolean;
  /** 0-100 fill per quarter. */
  segments: [number, number, number, number];
  /** Cumulative G.B per quarter reached; missing entries render `–`. */
  quarters: QuarterGB[];
  /** 0-based index of the in-progress quarter, or -1 at a break. */
  currentQuarter: number;
}) {
  const cellStyle = (i: number, empty: boolean): CSSProperties => ({
    font: `${i === currentQuarter ? 600 : 500} 12px ${MONO}`,
    color: empty ? "#5d6880" : i === currentQuarter ? "var(--accT)" : "#c3ccdd",
  });
  const qCell = (i: number, side: "h" | "a") => {
    const q = quarters[i];
    if (!q) return { text: "–", empty: true };
    return { text: side === "h" ? `${q.hg}.${q.hb}` : `${q.ag}.${q.ab}`, empty: false };
  };
  return (
    <section
      className="md-scoreboard"
      style={{
        background: "color-mix(in oklch, var(--deep) calc(var(--tc) * 2.2), #10151f)",
        border: "1px solid color-mix(in oklch, var(--acc) 22%, rgba(255,255,255,.07))",
        borderRadius: 14,
        padding: "12px 18px",
        display: "flex",
        gap: 18,
        alignItems: "center",
        flexWrap: "wrap",
      }}
    >
      <div className="md-sb-side" style={{ flex: "1 1 220px", display: "flex", alignItems: "center", gap: 14, minWidth: 0 }}>
        <TeamBadge name={home.name} />
        <div style={{ minWidth: 0 }}>
          <div style={{ font: `600 13px ${BARLOW}`, color: "#aab3c3" }}>{home.name}</div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ font: `700 44px/1 ${COND}`, color: "#fff" }}>{home.points}</span>
            <span style={{ font: `500 13px ${MONO}`, color: "#aab3c3" }}>
              {home.goals}.{home.behinds}
            </span>
          </div>
        </div>
      </div>
      <div className="md-sb-centre" style={{ flex: "2 1 360px", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
          {live && <span style={{ width: 8, height: 8, borderRadius: "50%", background: FALL, display: "block" }} />}
          <span style={{ font: `600 13px ${MONO}`, letterSpacing: "1.2px", color: live ? "#fff" : "var(--accT)" }}>{status}</span>
          <span style={{ font: `500 12px ${MONO}`, color: "#aab3c3" }}>{statusSub}</span>
        </div>
        <div style={{ display: "flex", gap: 3, width: "min(100%,300px)" }}>
          {segments.map((v, i) => (
            <div key={i} style={{ flex: 1, height: 4, borderRadius: 2, background: "rgba(255,255,255,.1)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${v}%`, background: "var(--acc)" }} />
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "48px repeat(4,46px)", gap: "2px 6px", font: `500 12px ${MONO}`, color: "#aab3c3", textAlign: "center" }}>
          <span />
          {[0, 1, 2, 3].map((i) => (
            <span key={i} style={{ font: `600 10px ${MONO}`, color: i === currentQuarter ? "var(--accT)" : "#8f9ab0" }}>
              Q{i + 1}
            </span>
          ))}
          <span style={{ ...clubVarsByName(home.name), textAlign: "left", font: `700 11px ${COND}`, color: "var(--accT)" }}>{clubAbbr(home.name)}</span>
          {[0, 1, 2, 3].map((i) => {
            const c = qCell(i, "h");
            return (
              <span key={i} style={cellStyle(i, c.empty)}>
                {c.text}
              </span>
            );
          })}
          <span style={{ textAlign: "left", font: `700 11px ${COND}`, color: "#dfe3ea" }}>{clubAbbr(away.name)}</span>
          {[0, 1, 2, 3].map((i) => {
            const c = qCell(i, "a");
            return (
              <span key={i} style={cellStyle(i, c.empty)}>
                {c.text}
              </span>
            );
          })}
        </div>
      </div>
      <div className="md-sb-side" style={{ flex: "1 1 220px", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 14, minWidth: 0 }}>
        <div style={{ textAlign: "right", minWidth: 0 }}>
          <div style={{ font: `600 13px ${BARLOW}`, color: "#aab3c3" }}>{away.name}</div>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "flex-end", gap: 8 }}>
            <span style={{ font: `500 13px ${MONO}`, color: "#aab3c3" }}>
              {away.goals}.{away.behinds}
            </span>
            <span style={{ font: `700 44px/1 ${COND}`, color: "#fff" }}>{away.points}</span>
          </div>
        </div>
        <TeamBadge name={away.name} />
      </div>
    </section>
  );
}

// --- Stat strip ------------------------------------------------------------------------------------

export interface StatStripItem {
  label: string;
  home: number;
  away: number;
}

/** `StatStrip` (spec §0): 5–6 stats, home value `--accT`, away `#dfe3ea`, home share bar in `--acc`. */
export function StatStrip({ title, homeName, awayName, items }: { title: string; homeName: string; awayName: string; items: StatStripItem[] }) {
  return (
    <section style={{ ...cardStyle, flex: "1 1 460px", padding: "10px 14px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", ...sectionLabelStyle(), marginBottom: 6 }}>
        <span>{title}</span>
        <span>
          <span style={{ color: "var(--accT)" }}>{clubAbbr(homeName)}</span> · {clubAbbr(awayName)}
        </span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(78px,1fr))", gap: 12 }}>
        {items.map((d) => {
          const total = d.home + d.away;
          const share = total === 0 ? 50 : (d.home / total) * 100;
          return (
            <div key={d.label} style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <div style={{ font: `500 10px ${MONO}`, color: "#aab3c3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.label}</div>
              <div style={{ display: "flex", justifyContent: "space-between", font: `600 14px ${MONO}` }}>
                <span style={{ color: "var(--accT)" }}>{d.home}</span>
                <span style={{ color: "#dfe3ea" }}>{d.away}</span>
              </div>
              <div style={{ display: "flex", height: 4, borderRadius: 2, overflow: "hidden", gap: 2 }}>
                <div style={{ width: `${share}%`, background: "var(--acc)" }} />
                <div style={{ flex: 1, background: "#dfe3ea", opacity: 0.55 }} />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// --- Transport bar ---------------------------------------------------------------------------------

export function segStyle(on: boolean, pad = "6px 12px"): CSSProperties {
  return {
    border: 0,
    borderRadius: 6,
    padding: pad,
    cursor: "pointer",
    background: on ? "var(--acc)" : "transparent",
    color: on ? "var(--on)" : "#aab3c3",
    font: `${on ? 700 : 600} 12px ${BARLOW}`,
    whiteSpace: "nowrap",
  };
}

export const outlineButton: CSSProperties = {
  background: "transparent",
  color: "#dfe5ee",
  border: "1px solid rgba(255,255,255,.16)",
  borderRadius: 8,
  padding: "8px 12px",
  font: `600 13px ${BARLOW}`,
  cursor: "pointer",
};

export const primaryButton: CSSProperties = {
  background: "var(--acc)",
  color: "var(--on)",
  border: 0,
  borderRadius: 9,
  padding: "11px 18px",
  font: `700 14px ${BARLOW}`,
  cursor: "pointer",
};

const IS_DEV = import.meta.env.DEV;

/**
 * `TransportBar` (spec §0, critique A4): every playback control in one bar under the scoreboard.
 * Restart and New match-up live behind `⋯` and both ask to confirm; the seed shows there in dev only.
 */
export function TransportBar({
  playing,
  onTogglePlay,
  speeds,
  speed,
  onSpeed,
  nextBreak,
  onSimToBreak,
  onSimToFullTime,
  onRestart,
  onNewMatchup,
  seed,
  disabled,
}: {
  playing: boolean;
  onTogglePlay: () => void;
  speeds: readonly number[];
  speed: number;
  onSpeed: (s: number) => void;
  nextBreak: string;
  onSimToBreak: () => void;
  onSimToFullTime: () => void;
  onRestart: () => void;
  onNewMatchup: () => void;
  seed: number | null;
  disabled?: boolean;
}) {
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menu]);
  const menuItem: CSSProperties = { textAlign: "left", background: "none", border: 0, borderRadius: 6, padding: "9px 10px", color: "#eef2f8", font: `600 13px ${BARLOW}`, cursor: "pointer" };
  return (
    <section
      style={{ ...cardStyle, flex: "1 1 460px", position: "relative", padding: "10px 12px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}
    >
      <button onClick={onTogglePlay} disabled={disabled} style={{ ...primaryButton, borderRadius: 8, padding: "9px 18px", minWidth: 84, opacity: disabled ? 0.5 : 1 }}>
        {playing ? "Pause" : "Play"}
      </button>
      <div style={{ display: "flex", gap: 2, padding: 2, borderRadius: 8, background: "rgba(0,0,0,.25)" }}>
        {speeds.map((v) => (
          <button key={v} onClick={() => onSpeed(v)} style={segStyle(speed === v, "6px 9px")}>
            {v}x
          </button>
        ))}
      </div>
      <div style={{ flex: 1 }} />
      <button onClick={onSimToBreak} disabled={disabled} style={{ ...outlineButton, opacity: disabled ? 0.5 : 1 }}>
        Sim to {nextBreak}
      </button>
      <button onClick={onSimToFullTime} disabled={disabled} style={{ ...outlineButton, opacity: disabled ? 0.5 : 1 }}>
        Sim to full time
      </button>
      <div ref={menuRef}>
        <button onClick={() => setMenu((m) => !m)} aria-label="More" style={{ ...outlineButton, width: 36, height: 36, padding: 0, font: `700 16px ${BARLOW}` }}>
          ⋯
        </button>
        {menu && (
          <div
            style={{
              position: "absolute",
              right: 12,
              top: 54,
              zIndex: 5,
              minWidth: 220,
              background: "#121826",
              border: "1px solid rgba(255,255,255,.12)",
              borderRadius: 10,
              padding: 6,
              boxShadow: "0 16px 40px rgba(0,0,0,.5)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <button
              className="hover:bg-white/5"
              style={menuItem}
              onClick={() => {
                setMenu(false);
                if (window.confirm("Restart this match from the first bounce? Playback returns to Q1.")) onRestart();
              }}
            >
              Restart match…
            </button>
            <button
              className="hover:bg-white/5"
              style={menuItem}
              onClick={() => {
                setMenu(false);
                if (window.confirm("Leave this match and pick a new match-up? This match will be discarded.")) onNewMatchup();
              }}
            >
              New match-up…
            </button>
            {IS_DEV && seed !== null && <div style={{ padding: "6px 10px 4px", font: `500 10px ${MONO}`, color: "#5d6880" }}>SEED {seed} · DEV ONLY</div>}
          </div>
        )}
      </div>
    </section>
  );
}

/** `BreakBar` (spec §0, critique C2): replaces the transport bar at a break; the only resume control. */
export function BreakBar({
  label,
  summary,
  resumeLabel,
  onReset,
  onResume,
}: {
  label: string;
  summary: string;
  resumeLabel: string;
  onReset: () => void;
  onResume: () => void;
}) {
  return (
    <section
      className="md-breakbar"
      style={{
        flex: "1 1 460px",
        background: HERO_BG,
        border: "1px solid color-mix(in oklch, var(--acc) 35%, transparent)",
        borderRadius: 14,
        padding: "10px 12px",
        display: "flex",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <div style={{ flex: "1 1 180px", minWidth: 0 }}>
        <div style={sectionLabelStyle(true)}>{label}</div>
        <div style={{ font: `500 13px ${BARLOW}`, color: "#c3ccdd", marginTop: 3 }}>{summary}</div>
      </div>
      <button onClick={onReset} style={{ background: "none", border: 0, color: "#aab3c3", font: `600 13px ${BARLOW}`, cursor: "pointer", padding: "8px 6px" }}>
        Reset
      </button>
      <button onClick={onResume} style={primaryButton}>
        {resumeLabel}
      </button>
    </section>
  );
}

/** Club stripe (acc / acc2 / acc at 6/2/6). */
export function Stripe({ height = 3 }: { height?: number }) {
  return (
    <div style={{ display: "flex", height, flex: "none" }}>
      <div style={{ flex: 6, background: "var(--acc)" }} />
      <div style={{ flex: 2, background: "var(--acc2)" }} />
      <div style={{ flex: 6, background: "var(--acc)" }} />
    </div>
  );
}

// --- Copy helpers ----------------------------------------------------------------------------------

/** "1 goal", "2 goals" — critique D4. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** First letter capitalised — critique C3 ("Level · turner's legs are gone"). */
export function capitalise(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
