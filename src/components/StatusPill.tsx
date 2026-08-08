/**
 * The single most important UI idiom to copy from aflclubmanager.com per
 * User Interface.md: "a numeric value paired with a short, plain-English
 * status pill right next to it — `72 SETTLED`, `100 FRESH`, `0.0 FLAT`... The
 * number carries the precision, the pill carries the feeling at a glance."
 *
 * This one component is meant to be reused everywhere a number like that
 * shows up — fitness, morale, form, club health, team rating.
 */
export type PillTone = "good" | "warn" | "bad" | "info";

const TONE_CLASS: Record<PillTone, string> = {
  good: "stat-pill-good",
  warn: "stat-pill-warn",
  bad: "stat-pill-bad",
  info: "stat-pill-info",
};

/** Aug 2026 branding pass (ROADMAP.md item #13) — see index.css's doc comment on the `-solid` classes. */
const TONE_CLASS_SOLID: Record<PillTone, string> = {
  good: "stat-pill-good-solid",
  warn: "stat-pill-warn-solid",
  bad: "stat-pill-bad-solid",
  info: "stat-pill-info-solid",
};

/**
 * `variant` defaults to `"soft"` — every existing call site keeps its
 * current translucent-background look unchanged. Pass `"solid"` for the
 * bolder, fully-filled look real AFL.com.au uses for its W/L form circles.
 */
export function StatusPill({ label, tone, variant = "soft" }: { label: string; tone: PillTone; variant?: "soft" | "solid" }) {
  const toneClass = variant === "solid" ? TONE_CLASS_SOLID[tone] : TONE_CLASS[tone];
  return <span className={`stat-pill ${toneClass}`}>{label}</span>;
}

export function NumberWithPill({
  value,
  label,
  tone,
}: {
  value: number | string;
  label: string;
  tone: PillTone;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-semibold tabular-nums">{value}</span>
      <StatusPill label={label} tone={tone} />
    </span>
  );
}

/** condition (0-99, see Schema.md) -> a FIT status word, banded the same way aflclubmanager bands fitness. */
export function fitnessBand(condition: number): { label: string; tone: PillTone } {
  if (condition >= 90) return { label: "FRESH", tone: "good" };
  if (condition >= 75) return { label: "SETTLED", tone: "good" };
  if (condition >= 55) return { label: "FLAT", tone: "warn" };
  return { label: "HEAVY LEGS", tone: "bad" };
}

/** Morale (1-99, seeded 60-75 per Schema.md until the Engine event system is live) -> a status word. */
export function moraleBand(morale: number): { label: string; tone: PillTone } {
  if (morale >= 80) return { label: "HAPPY", tone: "good" };
  if (morale >= 60) return { label: "SETTLED", tone: "good" };
  if (morale >= 40) return { label: "FLAT", tone: "warn" };
  return { label: "UNHAPPY", tone: "bad" };
}

/** Line-rating gap-to-league band — see Engine.md "List Needs report" (green/amber/red). */
export function gapBand(gap: number): { label: string; tone: PillTone } {
  if (gap > 1.5) return { label: `+${gap.toFixed(1)}`, tone: "good" };
  if (gap < -1.5) return { label: gap.toFixed(1), tone: "bad" };
  return { label: `${gap >= 0 ? "+" : ""}${gap.toFixed(1)}`, tone: "warn" };
}
