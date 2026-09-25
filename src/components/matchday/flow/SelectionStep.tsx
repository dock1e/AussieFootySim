import { useMemo, useState, type CSSProperties } from "react";
import type { Player } from "../../../types/player";
import { POSITIONS, type Position } from "../../../types/archetype";
import type { Lineup } from "../../../engine/selection";
import { BARLOW, MONO } from "../shared";
import { FORWARD_UP_SLOTS, INT_SLOTS, POSITION_FULL, fitTier, isOutOfPosition } from "./flowData";
import { flowCard, monoLabel, pitchPanel } from "./FlowChrome";

/**
 * Step 1 · Selection (`Match Day Flow.dc.html` "1 Selection"): the squad table beside the forward-up
 * line-up grid. Tap a position then a player, or a player then a position; placing a player who
 * already has a slot swaps him with whoever was there. Writes straight to the club's persistent
 * lineup (`useSelectionStore`) — this is the standing plan, used every week.
 */

type Arm = { t: "slot"; v: number } | { t: "player"; v: number } | null;

const GRID = "30px minmax(0,1fr) minmax(0,130px) 34px 38px 52px 48px";

export function lineupStat(lineup: Lineup, byId: Map<number, Player>): string {
  const filled = lineup.filter((id) => id !== null).length;
  let oop = 0;
  FORWARD_UP_SLOTS.forEach((i) => {
    const p = lineup[i] !== null ? byId.get(lineup[i]!) : undefined;
    if (p && isOutOfPosition(p, POSITIONS[i])) oop += 1;
  });
  const onGround = FORWARD_UP_SLOTS.filter((i) => lineup[i] !== null).length;
  return `${filled}/${POSITIONS.length} selected · ${onGround - oop}/${onGround} in a suitable position${oop ? ` · ${oop} out of position` : ""}`;
}

export function SelectionStep({
  players,
  lineup,
  onPlace,
  onAutoPick,
}: {
  players: Player[];
  lineup: Lineup;
  onPlace: (slotIndex: number, playerId: number) => void;
  onAutoPick: () => void;
}) {
  const [arm, setArm] = useState<Arm>(null);
  const byId = useMemo(() => new Map(players.map((p) => [p.PlayerID, p])), [players]);
  const slotOf = useMemo(() => {
    const m = new Map<number, number>();
    lineup.forEach((id, i) => {
      if (id !== null) m.set(id, i);
    });
    return m;
  }, [lineup]);

  const armedSlotPos: Position | null = arm?.t === "slot" && POSITIONS[arm.v] !== "INT" ? POSITIONS[arm.v] : null;
  const rows = useMemo(() => {
    const list = [...players];
    if (armedSlotPos) list.sort((a, b) => fitTier(b, armedSlotPos).rank - fitTier(a, armedSlotPos).rank || b.OVR - a.OVR);
    else list.sort((a, b) => b.OVR - a.OVR);
    return list;
  }, [players, armedSlotPos]);

  function place(slot: number, playerId: number) {
    onPlace(slot, playerId);
    setArm(null);
  }

  const hint = !arm
    ? "Tap a position, then a player — or a player, then a position."
    : arm.t === "slot"
      ? POSITIONS[arm.v] === "INT"
        ? "Choose who sits on the interchange"
        : `Choose who plays ${POSITION_FULL[POSITIONS[arm.v]]} — sorted by fit`
      : `Now tap a position for ${byId.get(arm.v)?.lname ?? "him"}`;

  const tileGo = (slot: number) => () => {
    if (arm?.t === "player") place(slot, arm.v);
    else setArm(arm?.t === "slot" && arm.v === slot ? null : { t: "slot", v: slot });
  };

  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
      <section style={{ ...flowCard, flex: "1.35 1 480px", minWidth: 0, padding: "12px 6px 8px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap", padding: "0 10px 8px" }}>
          <span style={monoLabel}>SQUAD · {players.length} PLAYERS</span>
          <span style={{ font: `500 12px ${BARLOW}`, color: arm ? "var(--accT)" : "#8f9ab0" }}>{hint}</span>
        </div>
        <div
          className="mdf-squad-grid"
          style={{
            display: "grid",
            gridTemplateColumns: GRID,
            gap: 8,
            padding: "0 10px",
            height: 26,
            alignItems: "center",
            font: `600 9px ${MONO}`,
            letterSpacing: ".7px",
            color: "#8f9ab0",
            borderBottom: "1px solid rgba(255,255,255,.08)",
          }}
        >
          <span>#</span>
          <span>PLAYER</span>
          <span className="mdf-hide-sm">TYPE</span>
          <span className="mdf-hide-sm" style={{ textAlign: "right" }}>AGE</span>
          <span style={{ textAlign: "right" }}>OVR</span>
          <span style={{ textAlign: "right", color: armedSlotPos ? "var(--accT)" : "#8f9ab0" }}>{armedSlotPos ? `FIT ${armedSlotPos}` : "FIT"}</span>
          <span style={{ textAlign: "center" }}>SLOT</span>
        </div>
        <div style={{ maxHeight: 620, overflowY: "auto" }}>
          {rows.map((p) => {
            const si = slotOf.get(p.PlayerID);
            const sPos = si !== undefined ? POSITIONS[si] : undefined;
            const fitPos = armedSlotPos ?? (sPos && sPos !== "INT" ? sPos : null);
            const tier = fitPos ? fitTier(p, fitPos) : null;
            const on = arm?.t === "player" && arm.v === p.PlayerID;
            const rowStyle: CSSProperties = {
              display: "grid",
              gridTemplateColumns: GRID,
              gap: 8,
              alignItems: "center",
              padding: "0 10px",
              height: 36,
              cursor: "pointer",
              borderRadius: 6,
              background: on ? "color-mix(in oklch, var(--acc) 20%, transparent)" : "transparent",
              boxShadow: on ? "inset 3px 0 0 var(--acc)" : "none",
              borderBottom: "1px solid rgba(255,255,255,.04)",
              opacity: sPos && !armedSlotPos ? 0.62 : 1,
            };
            return (
              <div
                key={p.PlayerID}
                className="mdf-squad-grid"
                style={rowStyle}
                onClick={() => {
                  if (arm?.t === "slot") place(arm.v, p.PlayerID);
                  else setArm(on ? null : { t: "player", v: p.PlayerID });
                }}
              >
                <span style={{ font: `500 12px ${MONO}`, color: "#8f9ab0" }}>{p.jumperNumber}</span>
                <span style={{ font: `600 14px ${BARLOW}`, color: "#eef2f8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {p.fname} {p.lname}
                </span>
                <span className="mdf-hide-sm" style={{ font: `500 12px ${BARLOW}`, color: "#aab3c3", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {p.archetype}
                </span>
                <span className="mdf-hide-sm" style={{ textAlign: "right", font: `400 12px ${MONO}`, color: "#c3ccdd" }}>
                  {p.Age}
                </span>
                <span style={{ textAlign: "right", font: `600 13px ${MONO}`, color: "#fff" }}>{p.OVR}</span>
                <span style={{ textAlign: "right", font: `600 11px ${MONO}`, color: tier ? tier.color : "#5d6880" }}>{tier ? tier.word : "—"}</span>
                <span
                  style={{
                    justifySelf: "center",
                    font: `600 10px ${MONO}`,
                    padding: "2px 6px",
                    borderRadius: 5,
                    color: sPos ? (sPos === "INT" ? "#c3ccdd" : "var(--accT)") : "#5d6880",
                    background: sPos ? "rgba(255,255,255,.06)" : "transparent",
                  }}
                >
                  {sPos ?? "—"}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section style={{ ...flowCard, flex: "1 1 400px", minWidth: 0, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={monoLabel}>LINE-UP · FORWARD ↑</span>
            <span style={{ font: `500 12px ${BARLOW}`, color: "#aab3c3" }}>{lineupStat(lineup, byId)}</span>
          </div>
          <button
            onClick={() => {
              onAutoPick();
              setArm(null);
            }}
            style={{ background: "transparent", color: "#dfe5ee", border: "1px solid rgba(255,255,255,.16)", borderRadius: 8, padding: "8px 12px", font: `600 13px ${BARLOW}`, cursor: "pointer" }}
          >
            Auto-pick best 23
          </button>
        </div>
        <div style={{ ...pitchPanel, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 6 }}>
            {FORWARD_UP_SLOTS.map((slot) => {
              const pos = POSITIONS[slot];
              const id = lineup[slot];
              const p = id !== null ? byId.get(id) : undefined;
              const tier = p ? fitTier(p, pos) : null;
              const isArm = arm?.t === "slot" && arm.v === slot;
              const armedPlayer = arm?.t === "player" ? byId.get(arm.v) : undefined;
              const preview = armedPlayer ? fitTier(armedPlayer, pos) : null;
              return (
                <button
                  key={slot}
                  onClick={tileGo(slot)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 4,
                    padding: "7px 8px",
                    borderRadius: 9,
                    cursor: "pointer",
                    minHeight: 62,
                    textAlign: "left",
                    minWidth: 0,
                    border: isArm ? "2px solid var(--acc)" : `1px solid ${tier ? `color-mix(in oklch, ${tier.color} 40%, transparent)` : "rgba(255,255,255,.12)"}`,
                    background: isArm ? "color-mix(in oklch, var(--acc) 16%, rgba(0,0,0,.25))" : "rgba(0,0,0,.25)",
                  }}
                >
                  <span style={{ display: "flex", justifyContent: "space-between", width: "100%", font: `600 9px ${MONO}`, letterSpacing: ".7px", color: "#8f9ab0" }}>
                    <span>{pos}</span>
                    <span style={{ color: preview ? preview.color : "transparent" }}>{preview ? `→ ${preview.word}` : ""}</span>
                  </span>
                  <span style={{ font: `600 13px ${BARLOW}`, color: "#eef2f8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
                    {p ? `#${p.jumperNumber} ${p.lname}` : "+ Empty"}
                  </span>
                  <span style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
                    <span style={{ flex: 1, height: 3, borderRadius: 2, background: "rgba(255,255,255,.08)", overflow: "hidden" }}>
                      <span style={{ display: "block", height: "100%", width: `${tier?.bar ?? 0}%`, background: tier?.color }} />
                    </span>
                    <span style={{ flex: "none", font: `600 10px ${MONO}`, color: tier?.color ?? "transparent" }}>{tier?.word ?? ""}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <div style={{ font: `600 9px ${MONO}`, letterSpacing: ".8px", color: "#8f9ab0", textAlign: "center", paddingTop: 4, borderTop: "1px solid rgba(255,255,255,.08)" }}>
            INTERCHANGE · ROTATIONS SET NEXT
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 6 }}>
            {INT_SLOTS.map((slot) => {
              const id = lineup[slot];
              const p = id !== null ? byId.get(id) : undefined;
              const isArm = arm?.t === "slot" && arm.v === slot;
              return (
                <button
                  key={slot}
                  onClick={tileGo(slot)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 3,
                    padding: "7px 8px",
                    borderRadius: 9,
                    cursor: "pointer",
                    minHeight: 62,
                    textAlign: "left",
                    minWidth: 0,
                    border: isArm ? "2px solid var(--acc)" : "1px solid rgba(255,255,255,.12)",
                    background: isArm ? "color-mix(in oklch, var(--acc) 16%, rgba(0,0,0,.25))" : "rgba(0,0,0,.25)",
                  }}
                >
                  <span style={{ font: `600 9px ${MONO}`, letterSpacing: ".7px", color: "#8f9ab0" }}>INT</span>
                  <span style={{ font: `600 12px ${BARLOW}`, color: "#eef2f8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
                    {p ? `#${p.jumperNumber} ${p.lname}` : "+ Empty"}
                  </span>
                  <span style={{ font: `500 10px ${MONO}`, color: "#8f9ab0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
                    {p?.archetype ?? ""}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
