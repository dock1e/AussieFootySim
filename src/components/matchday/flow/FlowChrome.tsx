import type { CSSProperties, ReactNode } from "react";
import { BARLOW, CARD_BG, COND, MONO, outlineButton, primaryButton } from "../shared";

/**
 * Match Day flow chrome (`Match Day Flow.dc.html`): the six-step stepper, split into the standing plan
 * (set once, used every week) and this week, plus the sticky Back / hint / Next footer.
 */

export const STEP_LABELS = ["Selection", "Rotations", "Roles", "Fixture", "Opposition", "Match"] as const;
export type FlowStep = 0 | 1 | 2 | 3 | 4 | 5;

export interface StepInfo {
  sub: string;
  /** Locked while a match is in progress. */
  disabled?: boolean;
}

function StepButton({ n, label, info, on, onGo }: { n: number; label: string; info: StepInfo; on: boolean; onGo: () => void }) {
  return (
    <button
      className="mdf-step"
      onClick={onGo}
      disabled={info.disabled}
      title={info.disabled ? "Locked until full time" : undefined}
      style={{
        flex: "1 1 0",
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 12px",
        borderRadius: 10,
        overflow: "hidden",
        cursor: info.disabled ? "not-allowed" : "pointer",
        opacity: info.disabled ? 0.5 : 1,
        border: `1px solid ${on ? "var(--acc)" : "rgba(255,255,255,.08)"}`,
        background: on ? "color-mix(in oklch, var(--acc) 16%, #10151f)" : CARD_BG,
      }}
    >
      <span
        style={{
          width: 24,
          height: 24,
          flex: "none",
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          font: `700 12px ${MONO}`,
          background: on ? "var(--acc)" : "rgba(255,255,255,.08)",
          color: on ? "var(--on)" : "#c3ccdd",
        }}
      >
        {n}
      </span>
      <span style={{ display: "flex", flexDirection: "column", minWidth: 0, textAlign: "left" }}>
        <span style={{ font: `700 15px ${COND}`, color: "#fff", letterSpacing: ".3px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
        <span style={{ font: `500 11px ${MONO}`, color: "#aab3c3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{info.sub}</span>
      </span>
    </button>
  );
}

export function FlowStepper({ step, steps, weekLabel, onGo }: { step: FlowStep; steps: StepInfo[]; weekLabel: string; onGo: (s: FlowStep) => void }) {
  const group = (title: string, yours: boolean, idx: FlowStep[]) => (
    <div style={{ flex: "3 1 480px", minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ font: `600 10px ${MONO}`, letterSpacing: "1.2px", color: yours ? "var(--accT)" : "#8f9ab0" }}>{title}</div>
      <div style={{ display: "flex", gap: 6 }}>
        {idx.map((i) => (
          <StepButton key={i} n={i + 1} label={STEP_LABELS[i]} info={steps[i]} on={step === i} onGo={() => onGo(i)} />
        ))}
      </div>
    </div>
  );
  return (
    <nav className="mdf-stepper" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      {group("STANDING PLAN · SET ONCE, USED EVERY WEEK", false, [0, 1, 2])}
      {group(`THIS WEEK · ${weekLabel}`, true, [3, 4, 5])}
    </nav>
  );
}

export function FlowFooter({
  showBack,
  onBack,
  hint,
  nextLabel,
  onNext,
  nextDisabled,
}: {
  showBack: boolean;
  onBack: () => void;
  hint: ReactNode;
  nextLabel: string;
  onNext: () => void;
  nextDisabled?: boolean;
}) {
  return (
    <div
      style={{
        position: "sticky",
        bottom: 0,
        zIndex: 10,
        marginTop: 4,
        padding: "18px 0 14px",
        background: "linear-gradient(180deg, transparent, rgba(8,11,18,.92) 30%)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          padding: "10px 12px",
          borderRadius: 12,
          background: "#10151f",
          border: "1px solid rgba(255,255,255,.1)",
        }}
      >
        <button onClick={onBack} style={{ ...outlineButton, borderRadius: 9, padding: "10px 14px", visibility: showBack ? "visible" : "hidden" }}>
          Back
        </button>
        <span style={{ flex: "1 1 200px", minWidth: 0, font: `500 13px ${BARLOW}`, color: "#aab3c3" }}>{hint}</span>
        <button onClick={onNext} disabled={nextDisabled} style={{ ...primaryButton, opacity: nextDisabled ? 0.45 : 1, cursor: nextDisabled ? "not-allowed" : "pointer" }}>
          {nextLabel}
        </button>
      </div>
    </div>
  );
}

/** The pitch-tinted panel the line-up and coverage grids sit on. */
export const pitchPanel: CSSProperties = {
  borderRadius: 12,
  padding: 8,
  background: "color-mix(in oklch, #2b6a35 22%, #10151f)",
  border: "1px solid rgba(255,255,255,.06)",
};

export const flowCard: CSSProperties = { background: CARD_BG, border: "1px solid rgba(255,255,255,.07)", borderRadius: 14 };

export const monoLabel: CSSProperties = { font: `600 10px ${MONO}`, letterSpacing: "1.2px", color: "#8f9ab0" };

export const selectStyle: CSSProperties = {
  width: "100%",
  background: "rgba(0,0,0,.3)",
  border: "1px solid rgba(255,255,255,.14)",
  borderRadius: 7,
  color: "#eef2f8",
  font: `600 13px ${BARLOW}`,
  padding: "7px 8px",
  outline: "none",
  cursor: "pointer",
};
