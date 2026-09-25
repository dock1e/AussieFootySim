import type { Player } from "../../../types/player";
import { POSITIONS, type Archetype, type Position } from "../../../types/archetype";
import type { Lineup } from "../../../engine/selection";
import {
  GAME_STYLES,
  defaultTacticForPosition,
  tacticGroupFor,
  tacticGroupForSlot,
  tacticsFor,
  type GameStyle,
  type PlayerTactic,
  type Tactic,
  type TeamPlan,
} from "../../../engine/tactics";
import { BARLOW, COND, MONO, segStyle } from "../shared";
import { INT_SLOTS, POSITION_FULL, ROLE_LINES, TACTIC_BLURB, fitTier, styleLabel } from "./flowData";
import { flowCard, monoLabel, selectStyle } from "./FlowChrome";
import { effectiveRotations } from "./RotationsStep";

/**
 * Step 3 · Roles (`Match Day Flow.dc.html` "3 Roles"): the standing game style and each player's role.
 * The engine keeps one role per player (`TeamPlan.tactics`, keyed by PlayerID), chosen from his
 * position's menu — so a starter's role is set on his position's card, and a bench player's (from his
 * own archetype's menu, the same check `sanitizePlan` makes) on the Interchange cards. The bench
 * players who rotate into a position are listed on its card, read-only. Tagging is picked weekly on the
 * Opposition step, so it isn't offered here.
 */

function roleOptions(options: readonly Tactic[], current: Tactic): Tactic[] {
  return options.filter((t) => t !== "Tagging" || current === "Tagging");
}

function RoleSelect({ value, suggested, options, onChange }: { value: Tactic; suggested: Tactic; options: readonly Tactic[]; onChange: (t: Tactic) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as Tactic)} style={selectStyle}>
      {roleOptions(options, value).map((t) => (
        <option key={t} value={t}>
          {t}
          {t === suggested ? "  (suggested)" : ""}
        </option>
      ))}
    </select>
  );
}

export function RolesStep({
  lineup,
  byId,
  plan,
  overrides,
  onStyle,
  onTactic,
}: {
  lineup: Lineup;
  byId: Map<number, Player>;
  plan: TeamPlan;
  overrides: Record<number, Position[]> | undefined;
  onStyle: (s: GameStyle) => void;
  onTactic: (playerId: number, pt: PlayerTactic) => void;
}) {
  const bench = INT_SLOTS.map((i) => (lineup[i] !== null ? byId.get(lineup[i]!) : undefined)).filter((p): p is Player => !!p);
  const tacticOf = (p: Player, pos: Position | undefined): { value: Tactic; suggested: Tactic; options: readonly Tactic[] } => {
    const group = pos ? tacticGroupForSlot(pos, p.archetype as Archetype) : tacticGroupFor(p.archetype as Archetype);
    const suggested = defaultTacticForPosition(pos, group);
    const options = tacticsFor(group);
    const saved = plan.tactics.get(p.PlayerID)?.tactic;
    return { value: saved && options.includes(saved) ? saved : suggested, suggested, options };
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section style={{ ...flowCard, padding: "12px 14px", display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 320px", minWidth: 0 }}>
          <div style={monoLabel}>STANDING GAME STYLE</div>
          <div style={{ font: `500 13px/1.4 ${BARLOW}`, color: "#c3ccdd", marginTop: 4, textWrap: "pretty" }}>
            Roles belong to the player, not the position. Change the style for one match on the Opposition step.
          </div>
        </div>
        <div style={{ display: "flex", gap: 2, padding: 3, borderRadius: 9, background: "rgba(0,0,0,.25)", flexWrap: "wrap" }}>
          {GAME_STYLES.map((s) => (
            <button key={s} onClick={() => onStyle(s)} style={segStyle(plan.gameStyle === s)}>
              {styleLabel(s)}
            </button>
          ))}
        </div>
      </section>

      {ROLE_LINES.map((line) => (
        <div key={line.name} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ ...monoLabel, color: "var(--accT)", padding: "4px 2px 0" }}>{line.name}</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,380px),1fr))", gap: 10, alignItems: "start" }}>
            {line.slots.map((slot) => {
              const pos = POSITIONS[slot];
              const id = lineup[slot];
              const p = id !== null ? byId.get(id) : undefined;
              const rotators = bench.filter((b) => effectiveRotations(b, overrides).includes(pos));
              const t = p ? tacticOf(p, pos) : null;
              return (
                <div key={slot} style={{ ...flowCard, borderRadius: 12, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ font: `700 15px ${COND}`, color: "#fff", letterSpacing: ".4px" }}>{pos}</span>
                    <span style={{ font: `500 11px ${BARLOW}`, color: "#8f9ab0" }}>{POSITION_FULL[pos]}</span>
                  </div>
                  {p && t ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                        <span style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
                          <span style={{ font: `600 9px ${MONO}`, letterSpacing: ".8px", color: "#8f9ab0", flex: "none" }}>START</span>
                          <span style={{ font: `600 14px ${BARLOW}`, color: "#eef2f8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            #{p.jumperNumber} {p.lname}
                          </span>
                        </span>
                        <span style={{ font: `500 11px ${BARLOW}`, color: "#8f9ab0", whiteSpace: "nowrap" }}>
                          {p.archetype} · <span style={{ color: fitTier(p, pos).color }}>{fitTier(p, pos).word}</span>
                        </span>
                      </div>
                      <RoleSelect value={t.value} suggested={t.suggested} options={t.options} onChange={(tactic) => onTactic(p.PlayerID, { tactic })} />
                      <span style={{ font: `500 12px/1.35 ${BARLOW}`, color: "#9aa4b5", textWrap: "pretty" }}>{TACTIC_BLURB[t.value]}</span>
                    </div>
                  ) : (
                    <span style={{ font: `500 13px ${BARLOW}`, color: "#8f9ab0" }}>Empty — pick someone on Selection.</span>
                  )}
                  {rotators.map((b) => {
                    const bt = tacticOf(b, undefined);
                    return (
                      <div key={b.PlayerID} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, paddingTop: 10, borderTop: "1px dashed rgba(255,255,255,.1)" }}>
                        <span style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
                          <span style={{ font: `600 9px ${MONO}`, letterSpacing: ".8px", color: "var(--accT)", flex: "none" }}>ROTATES IN</span>
                          <span style={{ font: `600 14px ${BARLOW}`, color: "#eef2f8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            #{b.jumperNumber} {b.lname}
                          </span>
                        </span>
                        <span style={{ font: `500 11px ${BARLOW}`, color: "#8f9ab0", whiteSpace: "nowrap" }}>{bt.value}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {bench.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ ...monoLabel, color: "var(--accT)", padding: "4px 2px 0" }}>INTERCHANGE · ONE ROLE WHEREVER HE ROTATES IN</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(100%,380px),1fr))", gap: 10, alignItems: "start" }}>
            {bench.map((b) => {
              const t = tacticOf(b, undefined);
              return (
                <div key={b.PlayerID} style={{ ...flowCard, borderRadius: 12, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                    <span style={{ display: "flex", alignItems: "baseline", gap: 6, minWidth: 0 }}>
                      <span style={{ font: `600 9px ${MONO}`, letterSpacing: ".8px", color: "#8f9ab0", flex: "none" }}>INT</span>
                      <span style={{ font: `600 14px ${BARLOW}`, color: "#eef2f8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        #{b.jumperNumber} {b.lname}
                      </span>
                    </span>
                    <span style={{ font: `500 11px ${BARLOW}`, color: "#8f9ab0", whiteSpace: "nowrap" }}>{b.archetype}</span>
                  </div>
                  <RoleSelect value={t.value} suggested={t.suggested} options={t.options} onChange={(tactic) => onTactic(b.PlayerID, { tactic })} />
                  <span style={{ font: `500 12px/1.35 ${BARLOW}`, color: "#9aa4b5", textWrap: "pretty" }}>{TACTIC_BLURB[t.value]}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
