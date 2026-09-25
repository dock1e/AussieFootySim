import { useMemo } from "react";
import type { Player } from "../../../types/player";
import { POSITIONS, defaultEligiblePositions, type Archetype, type Position } from "../../../types/archetype";
import type { Lineup } from "../../../engine/selection";
import { BARLOW, COND, FALL, MONO } from "../shared";
import { FORWARD_UP_SLOTS, INT_SLOTS, fitTier } from "./flowData";
import { flowCard, monoLabel, pitchPanel } from "./FlowChrome";

/**
 * Step 2 · Rotations (`Match Day Flow.dc.html` "2 Rotations"): pair each interchange player with the
 * players he relieves. The engine rotates by position (`MatchTeam.interchangeEligibility` — a bench
 * player can come on for anyone in a position he's cleared for), so a pairing here is a position: both
 * players in a doubled slot (BP, HBF, W, HFF, FP) are covered together. Time on ground comes from
 * real projected matches (`useTogProjection`), not a formula.
 */

/** A bench player's effective list: his saved pairing, or his archetype default until one is saved. */
export function effectiveRotations(p: Player, overrides: Record<number, Position[]> | undefined): Position[] {
  return overrides?.[p.PlayerID] ?? defaultEligiblePositions(p.archetype as Archetype);
}

/** On-ground positions in forward-up order, each once. */
const GROUND_POSITIONS: Position[] = [...new Set(FORWARD_UP_SLOTS.map((i) => POSITIONS[i]))];

export function coverageCount(lineup: Lineup, byId: Map<number, Player>, overrides: Record<number, Position[]> | undefined): number {
  const covered = new Set<Position>();
  INT_SLOTS.forEach((i) => {
    const b = lineup[i] !== null ? byId.get(lineup[i]!) : undefined;
    if (b) effectiveRotations(b, overrides).forEach((pos) => covered.add(pos));
  });
  return FORWARD_UP_SLOTS.filter((i) => lineup[i] !== null && covered.has(POSITIONS[i])).length;
}

function togLabel(tog: Map<number, number> | null, id: number): string {
  const v = tog?.get(id);
  return v === undefined ? "…" : `${Math.round(v)}%`;
}

export function RotationsStep({
  lineup,
  byId,
  overrides,
  onSetRotations,
  tog,
  projecting,
}: {
  lineup: Lineup;
  byId: Map<number, Player>;
  overrides: Record<number, Position[]> | undefined;
  onSetRotations: (playerId: number, positions: Position[]) => void;
  tog: Map<number, number> | null;
  projecting: boolean;
}) {
  const bench = INT_SLOTS.map((i) => (lineup[i] !== null ? byId.get(lineup[i]!) : undefined)).filter((p): p is Player => !!p);
  const starters = useMemo(() => {
    const m = new Map<Position, Player[]>();
    FORWARD_UP_SLOTS.forEach((i) => {
      const p = lineup[i] !== null ? byId.get(lineup[i]!) : undefined;
      if (!p) return;
      const pos = POSITIONS[i];
      m.set(pos, [...(m.get(pos) ?? []), p]);
    });
    return m;
  }, [lineup, byId]);
  const relief = useMemo(() => {
    const m = new Map<Position, Player[]>();
    bench.forEach((b) => effectiveRotations(b, overrides).forEach((pos) => m.set(pos, [...(m.get(pos) ?? []), b])));
    return m;
  }, [bench, overrides]);
  const covered = coverageCount(lineup, byId, overrides);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ font: `500 14px/1.45 ${BARLOW}`, color: "#c3ccdd", maxWidth: 820, textWrap: "pretty" }}>
        Pair each interchange player with the <b style={{ color: "#fff" }}>positions</b> he relieves. He comes on for whoever tires first in a position he's paired with, and
        takes that position — so a second ruckman can spell the ruck and rest in a forward pocket.
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: "1.2 1 460px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {bench.length === 0 && <section style={{ ...flowCard, padding: "12px 14px", font: `500 13px ${BARLOW}`, color: "#aab3c3" }}>No interchange players picked yet. Fill the INT slots on Selection first.</section>}
          {bench.map((b) => {
            const mine = GROUND_POSITIONS.filter((pos) => effectiveRotations(b, overrides).includes(pos));
            const sugg = GROUND_POSITIONS.filter((pos) => !mine.includes(pos) && starters.has(pos))
              .map((pos) => ({ pos, tier: fitTier(b, pos) }))
              .filter((x) => x.tier.rank >= 2)
              .sort((a, c) => c.tier.rank - a.tier.rank)
              .slice(0, 4);
            return (
              <section key={b.PlayerID} style={{ ...flowCard, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
                    <span style={{ font: `600 12px ${MONO}`, color: "var(--accT)" }}>#{b.jumperNumber}</span>
                    <span style={{ font: `700 18px ${COND}`, color: "#fff" }}>
                      {b.fname} {b.lname}
                    </span>
                    <span style={{ font: `500 12px ${BARLOW}`, color: "#8f9ab0" }}>{b.archetype}</span>
                  </div>
                  <span style={{ font: `500 11px ${MONO}`, color: "#aab3c3" }} title="Average time on ground over two projected matches against this week's opponent">
                    PROJ. TOG <b style={{ color: "#fff" }}>{togLabel(tog, b.PlayerID)}</b>
                    {projecting && tog ? " ·" : ""}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {mine.map((pos) => {
                    const t = fitTier(b, pos);
                    const who = (starters.get(pos) ?? []).map((p) => p.lname).join(" · ") || "empty";
                    return (
                      <span
                        key={pos}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "6px 6px 6px 8px",
                          borderRadius: 9,
                          background: "color-mix(in oklch, var(--acc) 14%, rgba(0,0,0,.25))",
                          border: "1px solid color-mix(in oklch, var(--acc) 50%, transparent)",
                        }}
                      >
                        <span style={{ font: `600 10px ${MONO}`, color: "var(--accT)" }}>{pos}</span>
                        <span style={{ font: `600 13px ${BARLOW}`, color: "#eef2f8" }}>↔ {who}</span>
                        <span style={{ flex: "none", font: `600 10px ${MONO}`, color: t.color }}>{t.word}</span>
                        <button
                          onClick={() => onSetRotations(b.PlayerID, mine.filter((x) => x !== pos))}
                          title="Remove"
                          aria-label={`Stop ${b.lname} rotating into ${pos}`}
                          style={{ background: "none", border: 0, color: "#aab3c3", font: `500 16px/1 ${BARLOW}`, cursor: "pointer", padding: "0 4px" }}
                        >
                          ×
                        </button>
                      </span>
                    );
                  })}
                  {mine.length === 0 && <span style={{ font: `500 13px ${BARLOW}`, color: FALL, padding: "6px 0" }}>No rotations — he stays on the bench all game.</span>}
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <span style={{ font: `600 9px ${MONO}`, letterSpacing: ".8px", color: "#8f9ab0", marginRight: 2 }}>{sugg.length ? "ADD" : "NO OTHER GOOD FITS"}</span>
                  {sugg.map(({ pos, tier }) => (
                    <button
                      key={pos}
                      onClick={() => onSetRotations(b.PlayerID, [...mine, pos])}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "5px 9px",
                        borderRadius: 999,
                        background: "transparent",
                        border: "1px dashed rgba(255,255,255,.2)",
                        cursor: "pointer",
                        font: `600 12px ${BARLOW}`,
                        color: "#c3ccdd",
                      }}
                    >
                      + {pos} · {(starters.get(pos) ?? []).map((p) => p.lname).join(", ")} <span style={{ font: `600 10px ${MONO}`, color: tier.color }}>{tier.word}</span>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>

        <section style={{ ...flowCard, flex: "1 1 380px", minWidth: 0, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={monoLabel}>COVERAGE · FORWARD ↑</span>
            <span style={{ font: `500 12px ${BARLOW}`, color: "#aab3c3" }}>
              {covered}/18 positions have relief{projecting ? " · projecting…" : ""}
            </span>
          </div>
          <div style={{ ...pitchPanel, display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 6 }}>
            {FORWARD_UP_SLOTS.map((slot) => {
              const pos = POSITIONS[slot];
              const id = lineup[slot];
              const p = id !== null ? byId.get(id) : undefined;
              const r = relief.get(pos) ?? [];
              const t = p ? tog?.get(p.PlayerID) : undefined;
              const tv = t === undefined ? null : Math.round(t);
              return (
                <div
                  key={slot}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 3,
                    padding: "7px 8px",
                    borderRadius: 9,
                    minWidth: 0,
                    border: `1px solid ${r.length ? "color-mix(in oklch, var(--acc) 35%, transparent)" : "rgba(255,255,255,.08)"}`,
                    background: "rgba(0,0,0,.25)",
                  }}
                >
                  <span style={{ font: `600 9px ${MONO}`, letterSpacing: ".7px", color: "#8f9ab0" }}>{pos}</span>
                  <span style={{ font: `600 13px ${BARLOW}`, color: "#eef2f8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{p?.lname ?? "—"}</span>
                  <span
                    style={{
                      font: `600 11px ${BARLOW}`,
                      color: r.length ? "var(--accT)" : FALL,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      maxWidth: "100%",
                    }}
                  >
                    {r.length ? `↔ ${r.map((b) => b.lname).join(", ")}` : "No relief"}
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
                    <span style={{ flex: 1, height: 3, borderRadius: 2, background: "rgba(255,255,255,.08)", overflow: "hidden" }}>
                      <span style={{ display: "block", height: "100%", width: `${tv ?? 0}%`, background: tv !== null && tv > 90 ? FALL : "rgba(255,255,255,.45)" }} />
                    </span>
                    <span style={{ font: `500 10px ${MONO}`, color: "#aab3c3" }}>{tv === null ? "…" : `~${tv}% TOG`}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
