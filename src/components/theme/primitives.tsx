import type { CSSProperties, ReactNode } from "react";
import { MEANING_TOKENS } from "../../theme/clubTokens";

/**
 * Round 114 — Club Theme System component library (brief section 6:
 * "Build these first, then assemble the screens from them"). Every value
 * here is copied from the brief's section 2.3/2.6 tables and the reference
 * file's actual inline styles (`Club Theme System.dc.html`), not eyeballed.
 * All colour comes from `var(--…)` tokens set by `clubThemeStyle`/`ScopedClub`
 * — nothing in this file hardcodes a club colour, per rule 1 ("never write
 * per-club CSS or per-club components").
 */

const FONT_MONO = "'IBM Plex Mono',monospace";
const FONT_BARLOW = "Barlow,sans-serif";
const FONT_COND = "'Barlow Condensed',sans-serif";

/** Section label: 10-11px mono, uppercase, 1.2-1.5px tracking, muted. */
export function SectionLabel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ font: `500 11px ${FONT_MONO}`, letterSpacing: "1.5px", color: "#9aa4b5", textTransform: "uppercase", ...style }}>
      {children}
    </div>
  );
}

/** Standard card surface — brief 2.3. */
export function Card({ children, style, padding = "18px 20px" }: { children: ReactNode; style?: CSSProperties; padding?: string }) {
  return (
    <section
      style={{
        background: "color-mix(in oklch, var(--deep) var(--tc), #10151f)",
        border: "1px solid rgba(255,255,255,.07)",
        borderRadius: 16,
        padding,
        ...style,
      }}
    >
      {children}
    </section>
  );
}

/** Hero / "yours" card — 2.4x the tint, accent-tinted border. Watermark number is the caller's job (absolute-positioned child). */
export function HeroCard({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <section
      style={{
        position: "relative",
        overflow: "hidden",
        background: "color-mix(in oklch, var(--deep) calc(var(--tc) * 2.4), #10151f)",
        border: "1px solid color-mix(in oklch, var(--acc) 30%, transparent)",
        borderRadius: 16,
        padding: "22px 24px",
        ...style,
      }}
    >
      {children}
    </section>
  );
}

/** Watermark number bleeding off the top-right of a HeroCard — brief 2.6. */
export function Watermark({ children, size = 240 }: { children: ReactNode; size?: number }) {
  return (
    <div
      style={{
        position: "absolute",
        right: -6,
        top: -50,
        font: `700 ${size}px/1 ${FONT_COND}`,
        color: "color-mix(in oklch, var(--acc) 14%, transparent)",
        pointerEvents: "none",
        letterSpacing: "-8px",
      }}
    >
      {children}
    </div>
  );
}

/** Detail panel — 1.6x tint, accent-tinted border, club stripe goes at its top (brief 2.3, 2.6). */
export function DetailPanel({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <aside
      style={{
        background: "color-mix(in oklch, var(--deep) calc(var(--tc) * 1.6), #0f141e)",
        border: "1px solid color-mix(in oklch, var(--acc) 25%, rgba(255,255,255,.07))",
        borderRadius: 16,
        overflow: "hidden",
        ...style,
      }}
    >
      <ClubStripe />
      <div style={{ padding: "18px 20px" }}>{children}</div>
    </aside>
  );
}

/** The 3-4px acc/acc2/acc band at the top of the app and every detail panel — brief 2.6. */
export function ClubStripe({ height = 4 }: { height?: number }) {
  return (
    <div style={{ display: "flex", height }}>
      <div style={{ flex: 6, background: "var(--acc)" }} />
      <div style={{ flex: 2, background: "var(--acc2)" }} />
      <div style={{ flex: 6, background: "var(--acc)" }} />
    </div>
  );
}

/** Monogram chip — brief 2.6. Wrap in <ScopedClub> for an opponent's colours. */
export function ClubChip({ children, size = "md" }: { children: ReactNode; size?: "sm" | "md" }) {
  const fontSize = size === "sm" ? 10 : 11;
  return (
    <span
      style={{
        display: "inline-flex",
        padding: "2px 6px",
        borderRadius: 5,
        background: "var(--deep)",
        border: "1px solid color-mix(in oklch, var(--acc) 50%, transparent)",
        font: `700 ${fontSize}px ${FONT_COND}`,
        color: "var(--accT)",
      }}
    >
      {children}
    </span>
  );
}

export type StatusTone = "neutral" | "good" | "warn" | "bad" | "accent";

const STATUS_COLOR: Record<StatusTone, string> = {
  neutral: "#9aa4b5",
  good: MEANING_TOKENS.rise,
  warn: MEANING_TOKENS.warn,
  bad: MEANING_TOKENS.fall,
  accent: "var(--accT)",
};

/** Status chip — mono 9px, 1px border in the status colour, transparent fill — brief 2.6. */
export function StatusChip({ children, tone = "neutral", color: colorOverride, style }: { children: ReactNode; tone?: StatusTone; color?: string; style?: CSSProperties }) {
  const color = colorOverride ?? STATUS_COLOR[tone];
  return (
    <span
      style={{
        display: "inline-flex",
        padding: "3px 7px",
        borderRadius: 999,
        border: `1px solid ${color}`,
        background: "transparent",
        color,
        font: `600 9px ${FONT_MONO}`,
        letterSpacing: ".75px",
        textTransform: "uppercase",
        ...style,
      }}
    >
      {children}
    </span>
  );
}

/** A labelled stat tile, e.g. inside a hero card's chip row — brief matches Dashboard hero. */
export function KpiTile({ value, label, tone = "neutral", color }: { value: ReactNode; label: string; tone?: "neutral" | "accent"; color?: string }) {
  return (
    <div style={{ background: "rgba(0,0,0,.28)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 10, padding: "10px 12px" }}>
      <div style={{ font: `700 30px/1 ${FONT_COND}`, color: color ?? (tone === "accent" ? "var(--accT)" : "#fff") }}>{value}</div>
      <div style={{ font: `500 9px ${FONT_MONO}`, letterSpacing: "1px", color: "#aab3c3", marginTop: 4, textTransform: "uppercase" }}>
        {label}
      </div>
    </div>
  );
}

/** 30x17 toggle track, 13px knob — brief 2.6. */
export function Toggle({ on, onChange, label }: { on: boolean; onChange: () => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onChange}
      style={{
        width: 30,
        height: 17,
        borderRadius: 999,
        border: 0,
        padding: 2,
        cursor: "pointer",
        background: on ? "var(--acc)" : "rgba(255,255,255,.16)",
        display: "inline-flex",
        justifyContent: on ? "flex-end" : "flex-start",
        transition: "background .15s ease",
      }}
    >
      <span
        style={{
          width: 13,
          height: 13,
          borderRadius: "50%",
          background: on ? "var(--on)" : "#c3ccdd",
          transition: "transform .15s ease",
        }}
      />
    </button>
  );
}

/** Segmented control — pill buttons, active one filled with `--acc`. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div style={{ display: "flex", padding: 2, borderRadius: 7, background: "rgba(0,0,0,.25)" }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            style={{
              border: 0,
              borderRadius: 5,
              padding: "4px 9px",
              background: active ? "var(--acc)" : "transparent",
              color: active ? "var(--on)" : "#aab3c3",
              font: `600 10px ${FONT_MONO}`,
              letterSpacing: ".7px",
              cursor: "pointer",
              textTransform: "uppercase",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Diverging bar vs a projection: green grows right, coral grows left, centre tick — brief 2.6. `value` in [-max, max]. */
export function DivergingBar({ value, max = 4 }: { value: number; max?: number }) {
  const clamped = Math.max(-max, Math.min(max, value));
  const pct = (Math.abs(clamped) / max) * 50; // half-track width per side
  const isRise = clamped >= 0;
  return (
    <span style={{ position: "relative", flex: 1, height: 6, borderRadius: 3, background: "rgba(255,255,255,.06)", display: "inline-block" }}>
      <span style={{ position: "absolute", left: "50%", top: -2, bottom: -2, width: 1, background: "rgba(255,255,255,.25)" }} />
      {isRise ? (
        <span
          style={{
            position: "absolute",
            left: "50%",
            top: 0,
            bottom: 0,
            width: `${pct}%`,
            background: MEANING_TOKENS.rise,
            borderRadius: "0 3px 3px 0",
          }}
        />
      ) : (
        <span
          style={{
            position: "absolute",
            right: "50%",
            top: 0,
            bottom: 0,
            width: `${pct}%`,
            background: MEANING_TOKENS.fall,
            borderRadius: "3px 0 0 3px",
          }}
        />
      )}
    </span>
  );
}

/** Ghost (acc2, 40-45%) bar behind a solid acc bar in the same track — brief 2.6. Both fractions in [0,1]. */
export function BarSolidGhost({ solid, ghost }: { solid: number; ghost: number }) {
  return (
    <span style={{ position: "relative", height: 6, borderRadius: 3, background: "rgba(255,255,255,.07)", overflow: "hidden", display: "block" }}>
      <span style={{ position: "absolute", inset: 0, width: `${Math.min(100, ghost * 100)}%`, background: "color-mix(in oklch, var(--acc2) 42%, transparent)" }} />
      <span style={{ position: "absolute", inset: 0, width: `${Math.min(100, solid * 100)}%`, background: "var(--acc)" }} />
    </span>
  );
}

/** 5-pip facility/upgrade level indicator — brief section 4.6 (Facilities). `underConstruction` hatches that pip with acc2. */
export function Pips({ level, total = 5, underConstruction }: { level: number; total?: number; underConstruction?: number }) {
  return (
    <span style={{ display: "inline-flex", gap: 3 }}>
      {Array.from({ length: total }, (_, i) => {
        const filled = i < level;
        const building = underConstruction === i;
        return (
          <span
            key={i}
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              background: building
                ? "repeating-linear-gradient(45deg, var(--acc2), var(--acc2) 2px, transparent 2px, transparent 4px)"
                : filled
                  ? "var(--acc)"
                  : "rgba(255,255,255,.12)",
            }}
          />
        );
      })}
    </span>
  );
}

/** ☆ / ★ pin-to-watchlist star — brief 2.6. */
export function PinStar({ pinned, onToggle, title }: { pinned: boolean; onToggle: () => void; title?: string }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      title={title ?? (pinned ? "Unpin" : "Pin to watchlist")}
      style={{
        background: "none",
        border: 0,
        padding: 0,
        font: `600 16px ${FONT_BARLOW}`,
        color: pinned ? "var(--accT)" : "#5d6880",
        cursor: "pointer",
        lineHeight: 1,
      }}
    >
      {pinned ? "★" : "☆"}
    </button>
  );
}

/** Rise/fall value with sign + arrow — always green/coral regardless of club (brief rule 5), never club-coloured. */
export function TrendValue({ value, decimals = 1 }: { value: number; decimals?: number }) {
  const rising = value >= 0;
  const arrow = rising ? "▲" : "▼";
  const sign = rising ? "+" : "";
  return (
    <span style={{ color: rising ? MEANING_TOKENS.rise : MEANING_TOKENS.fall, font: `600 13px ${FONT_BARLOW}` }}>
      {arrow} {sign}
      {value.toFixed(decimals)}
    </span>
  );
}

/** Medal marker for #1/#2/#3 all-time-list ranks — brief rule 5, never club-coloured. */
export function Medal({ rank }: { rank: 1 | 2 | 3 }) {
  const color = rank === 1 ? MEANING_TOKENS.gold : rank === 2 ? MEANING_TOKENS.silver : MEANING_TOKENS.bronze;
  return <span style={{ color, font: `700 13px ${FONT_COND}` }}>{rank === 1 ? "1st" : rank === 2 ? "2nd" : "3rd"}</span>;
}
