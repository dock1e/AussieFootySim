import { useMemo, useRef, useState, type CSSProperties, type DragEvent } from "react";
import type { Player } from "../../../types/player";
import { POSITIONS, type Position } from "../../../types/archetype";
import type { Lineup } from "../../../engine/selection";
import { BARLOW, FALL, MONO } from "../shared";
import { FORWARD_UP_SLOTS, INT_SLOTS, POSITION_FULL, SEL_LINES, fitTier, isOutOfPosition } from "./flowData";
import { flowCard, monoLabel, pitchPanel } from "./FlowChrome";

/**
 * Step 2 · Selection (`Match Day Flow v2.dc.html` "2 Selection"): the squad table beside the team
 * sheet in six labelled lines plus the interchange.
 *   - Drag a squad row onto a tile to place him (swapping with the tile's player if he was already
 *     on the sheet); drag a tile onto another tile to swap them, bench ↔ field included; drag a tile
 *     onto the squad list to take him off. The drop target shows an accent border and tint.
 *   - Tap a tile then another tile to swap; tap a tile then a row (or a row then a tile) to place.
 *   - Double-click a tile or a row, or press ×, to take a player off the sheet.
 * Every change writes the club's saved line-up straight away; the plan carries forward each week.
 */

type Arm = { t: "slot"; v: number } | { t: "player"; v: number } | null;
type DragSrc = { t: "slot"; v: number } | { t: "player"; v: number } | null;

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

const sheetButton: CSSProperties = {
  background: "transparent",
  color: "#dfe5ee",
  border: "1px solid rgba(255,255,255,.16)",
  borderRadius: 8,
  padding: "8px 10px",
  font: `600 12px ${BARLOW}`,
  cursor: "pointer",
};

export function SelectionStep({
  players,
  lineup,
  onChange,
  onAutoPick,
  onLastWeek,
}: {
  players: Player[];
  lineup: Lineup;
  onChange: (lineup: Lineup) => void;
  onAutoPick: () => void;
  /** Null when no match has been played yet. */
  onLastWeek: (() => void) | null;
}) {
  const [arm, setArm] = useState<Arm>(null);
  const [over, setOver] = useState<number | null>(null);
  const dragSrc = useRef<DragSrc>(null);
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

  function commit(next: Lineup) {
    onChange(next);
    setArm(null);
    setOver(null);
  }
  /** Places a player; if he was already on the sheet, he swaps with the slot's player. */
  function place(slot: number, playerId: number) {
    const next = [...lineup];
    const from = slotOf.get(playerId);
    const occupant = next[slot];
    next[slot] = playerId;
    if (from !== undefined && from !== slot) next[from] = occupant;
    commit(next);
  }
  function swap(a: number, b: number) {
    const next = [...lineup];
    [next[a], next[b]] = [next[b], next[a]];
    commit(next);
  }
  function removeSlot(slot: number) {
    const next = [...lineup];
    next[slot] = null;
    commit(next);
  }

  const hint = !arm
    ? "Drag onto the sheet, or tap a player then a position"
    : arm.t === "slot"
      ? lineup[arm.v] !== null
        ? `Tap a player for ${POSITIONS[arm.v]} — or another position to swap`
        : POSITIONS[arm.v] === "INT"
          ? "Choose who sits on the interchange"
          : `Choose who plays ${POSITION_FULL[POSITIONS[arm.v]]} — sorted by fit`
      : `Now tap a position for ${byId.get(arm.v)?.lname ?? "him"}`;

  const tileHandlers = (slot: number) => ({
    draggable: lineup[slot] !== null,
    onDragStart: (e: DragEvent) => {
      dragSrc.current = { t: "slot", v: slot };
      e.dataTransfer.setData("text/plain", String(slot));
      e.dataTransfer.effectAllowed = "move";
    },
    onDragEnd: () => {
      dragSrc.current = null;
      setOver(null);
    },
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      if (over !== slot) setOver(slot);
    },
    onDragLeave: () => {
      if (over === slot) setOver(null);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const d = dragSrc.current;
      dragSrc.current = null;
      if (!d) return setOver(null);
      if (d.t === "slot") {
        if (d.v !== slot) swap(d.v, slot);
        else setOver(null);
      } else place(slot, d.v);
    },
    onClick: () => {
      if (arm?.t === "player") place(slot, arm.v);
      else if (arm?.t === "slot" && arm.v !== slot) swap(arm.v, slot);
      else setArm(arm?.t === "slot" && arm.v === slot ? null : { t: "slot", v: slot });
    },
    onDoubleClick: () => {
      if (lineup[slot] !== null) removeSlot(slot);
    },
  });

  const tileBox = (slot: number, border: string): CSSProperties => {
    const isArm = arm?.t === "slot" && arm.v === slot;
    const isOver = over === slot;
    const filled = lineup[slot] !== null;
    return {
      display: "flex",
      flexDirection: "column",
      alignItems: "flex-start",
      gap: 4,
      padding: "6px 8px 7px",
      borderRadius: 9,
      cursor: filled ? "grab" : "pointer",
      minHeight: 62,
      textAlign: "left",
      minWidth: 0,
      userSelect: "none",
      border: isArm || isOver ? "2px solid var(--acc)" : `1px ${filled ? "solid" : "dashed"} ${border}`,
      background: isOver ? "color-mix(in oklch, var(--acc) 26%, rgba(0,0,0,.25))" : isArm ? "color-mix(in oklch, var(--acc) 16%, rgba(0,0,0,.25))" : "rgba(0,0,0,.25)",
    };
  };
  const RemoveX = ({ slot }: { slot: number }) => (
    <button
      onClick={(e) => {
        e.stopPropagation();
        removeSlot(slot);
      }}
      title="Remove from sheet"
      aria-label="Remove from sheet"
      style={{ background: "none", border: 0, color: "#8f9ab0", font: `500 15px/1 ${BARLOW}`, cursor: "pointer", padding: "0 2px", margin: "-2px -3px 0 0" }}
    >
      ×
    </button>
  );

  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
      <section
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const d = dragSrc.current;
          dragSrc.current = null;
          if (d?.t === "slot") removeSlot(d.v);
        }}
        style={{ ...flowCard, flex: "1.35 1 480px", minWidth: 0, padding: "12px 6px 8px" }}
      >
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
          <span className="mdf-hide-sm" style={{ textAlign: "right" }}>
            AGE
          </span>
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
              cursor: "grab",
              userSelect: "none",
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
                draggable
                onDragStart={(e) => {
                  dragSrc.current = { t: "player", v: p.PlayerID };
                  e.dataTransfer.setData("text/plain", String(p.PlayerID));
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragEnd={() => {
                  dragSrc.current = null;
                  setOver(null);
                }}
                onDoubleClick={() => {
                  if (si !== undefined) removeSlot(si);
                }}
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

      <section style={{ ...flowCard, flex: "1 1 420px", minWidth: 0, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={monoLabel}>TEAM SHEET · FORWARD ↑</span>
            <span style={{ font: `500 12px ${BARLOW}`, color: "#aab3c3" }}>{lineupStat(lineup, byId)}</span>
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button
              onClick={() => {
                onLastWeek?.();
                setArm(null);
              }}
              disabled={!onLastWeek}
              title={onLastWeek ? undefined : "No match played yet"}
              style={{ ...sheetButton, opacity: onLastWeek ? 1 : 0.45, cursor: onLastWeek ? "pointer" : "not-allowed" }}
            >
              Last week's team
            </button>
            <button
              onClick={() => {
                onAutoPick();
                setArm(null);
              }}
              style={sheetButton}
            >
              Auto-pick
            </button>
            <button
              onClick={() => commit(lineup.map(() => null))}
              style={{ ...sheetButton, color: FALL, border: `1px solid color-mix(in oklch, ${FALL} 45%, transparent)` }}
            >
              Clear sheet
            </button>
          </div>
        </div>
        <div style={{ ...pitchPanel, display: "flex", flexDirection: "column", gap: 6 }}>
          {SEL_LINES.map((line) => (
            <div key={line.name} style={{ display: "grid", gridTemplateColumns: "22px repeat(3,minmax(0,1fr))", gap: 6, alignItems: "stretch" }}>
              <span style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", font: `600 9px ${MONO}`, letterSpacing: ".8px", color: "#8f9ab0", textAlign: "center" }}>
                {line.name}
              </span>
              {line.slots.map((slot) => {
                const pos = POSITIONS[slot];
                const id = lineup[slot];
                const p = id !== null ? byId.get(id) : undefined;
                const tier = p ? fitTier(p, pos) : null;
                const armedPlayer = arm?.t === "player" ? byId.get(arm.v) : undefined;
                const preview = armedPlayer ? fitTier(armedPlayer, pos) : null;
                return (
                  <div
                    key={slot}
                    {...tileHandlers(slot)}
                    style={tileBox(slot, tier ? `color-mix(in oklch, ${tier.color} 40%, transparent)` : "rgba(255,255,255,.18)")}
                  >
                    <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", font: `600 9px ${MONO}`, letterSpacing: ".7px", color: "#8f9ab0", minHeight: 14 }}>
                      <span>{pos}</span>
                      <span style={{ color: preview ? preview.color : "transparent", flex: 1, textAlign: "right", paddingRight: 4 }}>{preview ? `→ ${preview.word}` : ""}</span>
                      {p && <RemoveX slot={slot} />}
                    </span>
                    <span style={{ font: `600 13px ${BARLOW}`, color: p ? "#eef2f8" : "#8f9ab0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
                      {p ? `#${p.jumperNumber} ${p.lname}` : "Empty"}
                    </span>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, width: "100%" }}>
                      <span style={{ flex: 1, height: 3, borderRadius: 2, background: "rgba(255,255,255,.08)", overflow: "hidden" }}>
                        <span style={{ display: "block", height: "100%", width: `${tier?.bar ?? 0}%`, background: tier?.color }} />
                      </span>
                      <span style={{ flex: "none", font: `600 10px ${MONO}`, color: tier?.color ?? "transparent" }}>{tier?.word ?? ""}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          ))}
          <div style={{ font: `600 9px ${MONO}`, letterSpacing: ".8px", color: "#8f9ab0", textAlign: "center", paddingTop: 4, borderTop: "1px solid rgba(255,255,255,.08)" }}>INTERCHANGE</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 6 }}>
            {INT_SLOTS.map((slot) => {
              const id = lineup[slot];
              const p = id !== null ? byId.get(id) : undefined;
              return (
                <div key={slot} {...tileHandlers(slot)} style={tileBox(slot, p ? "rgba(255,255,255,.14)" : "rgba(255,255,255,.18)")}>
                  <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%", font: `600 9px ${MONO}`, letterSpacing: ".7px", color: "#8f9ab0", minHeight: 14 }}>
                    <span>INT</span>
                    {p && <RemoveX slot={slot} />}
                  </span>
                  <span style={{ font: `600 12px ${BARLOW}`, color: p ? "#eef2f8" : "#8f9ab0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
                    {p ? `#${p.jumperNumber} ${p.lname}` : "Empty"}
                  </span>
                  <span style={{ font: `500 10px ${MONO}`, color: "#8f9ab0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>{p?.archetype ?? ""}</span>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ font: `500 12px/1.45 ${BARLOW}`, color: "#8f9ab0", textWrap: "pretty" }}>
          Drag a player onto a position — drop onto an occupied one to swap. Tap two positions to swap them. Double-click or × to take a player off the sheet; drag a
          tile back onto the squad list to do the same.
        </div>
      </section>
    </div>
  );
}
