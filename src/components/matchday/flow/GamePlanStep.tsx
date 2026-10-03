import { useState, type CSSProperties } from "react";
import type { Player } from "../../../types/player";
import { POSITIONS, type Archetype, type Position } from "../../../types/archetype";
import type { Lineup } from "../../../engine/selection";
import type { Cover } from "../../../engine/team";
import {
  REST_POLICIES,
  ROTATION_GROUPS,
  groupLabel,
  groupOfPosition,
  groupShort,
  rotationGroupsOf,
  uncoveredGroups,
  type RestPolicy,
  type RotationGroup,
} from "../../../engine/rotation";
import {
  defaultTacticForPosition,
  gameStyleModelledImpact,
  resolveTactic,
  tacticGroupForSlot,
  tacticsFor,
  type GameStyle,
  type Tactic,
  type TeamPlan,
} from "../../../engine/tactics";
import { BARLOW, COND, FALL, MONO, RISE, Stripe } from "../shared";
import { INT_SLOTS, PLAN_LINES, POSITION_FULL, STYLE_LINE_TEXT, STYLE_ORDER, TACTIC_BLURB, fitTier, lineKeyFor, styleBlurb, styleLabel } from "./flowData";
import { flowCard, monoLabel, pitchPanel, selectStyle } from "./FlowChrome";

/**
 * Step 4 · Game plan (`Match Day Flow v2.dc.html` "4 Game plan"): roles, rotations and game style on
 * one screen. The style band's effect bars are the engine's own modelled effects
 * (`gameStyleModelledImpact`), and Fatigue is real — it scales fitness drain, so it changes how often
 * covered players rest. The grid is a read-only summary; all editing happens in the player panel,
 * one player at a time. Rotations (ROADMAP #16) are the AI's job: at each goal reset the tiredest
 * players come off and fresh bench players from the same rotation group come on, with the ground
 * re-sorted so everyone stays in a position he suits. The coach only grooms it — rest policies,
 * which groups a bench player covers, and an optional pinned reliever. Roles are stored per player per
 * position. Time on ground is projected from real simulated matches.
 */

const PANEL_BG: CSSProperties = {
  background: "color-mix(in oklch, var(--deep) calc(var(--tc) * 1.6), #0f141e)",
  border: "1px solid color-mix(in oklch, var(--acc) 25%, rgba(255,255,255,.07))",
  borderRadius: 14,
};

function chip(on: boolean): CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "7px 10px",
    minHeight: 34,
    borderRadius: 999,
    cursor: "pointer",
    font: `600 12px ${BARLOW}`,
    color: on ? "var(--on)" : "#dfe5ee",
    background: on ? "var(--acc)" : "transparent",
    border: `1px ${on ? "solid var(--acc)" : "dashed rgba(255,255,255,.22)"}`,
  };
}

function FitWord({ p, pos, on }: { p: Player; pos: Position; on?: boolean }) {
  const t = fitTier(p, pos);
  return <span style={{ flex: "none", font: `600 10px ${MONO}`, color: on ? "var(--on)" : t.color }}>{t.word}</span>;
}

function RestPolicyChips({ playerId, policy, onRestPolicy }: { playerId: number; policy: RestPolicy; onRestPolicy: (id: number, p: RestPolicy) => void }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {REST_POLICIES.map((r) => (
          <button key={r.key} onClick={() => onRestPolicy(playerId, r.key)} style={chip(policy === r.key)}>
            {r.label}
          </button>
        ))}
      </div>
      <span style={{ font: `500 12px/1.4 ${BARLOW}`, color: "#9aa4b5" }}>{REST_POLICIES.find((r) => r.key === policy)?.blurb}</span>
    </div>
  );
}

function roleOptions(p: Player, pos: Position): { options: Tactic[]; suggested: Tactic } {
  const group = tacticGroupForSlot(pos, p.archetype as Archetype);
  return { options: tacticsFor(group).filter((t) => t !== "Tagging"), suggested: defaultTacticForPosition(pos, group) };
}

const METRICS: { key: "ourScoring" | "theirScoring" | "pressure" | "fitnessCost"; label: string; lowerIsGood: boolean }[] = [
  { key: "ourScoring", label: "Our scoring", lowerIsGood: false },
  { key: "theirScoring", label: "Their scoring", lowerIsGood: true },
  { key: "pressure", label: "Pressure", lowerIsGood: false },
  { key: "fitnessCost", label: "Fatigue", lowerIsGood: true },
];

export function GamePlanStep({
  lineup,
  byId,
  plan,
  covers,
  restPolicy,
  eligibility,
  onStyle,
  onCover,
  onRestPolicy,
  onBenchGroups,
  onRole,
  tog,
  projecting,
  scoutStyle,
  lastWeekStyle,
}: {
  lineup: Lineup;
  byId: Map<number, Player>;
  plan: TeamPlan;
  /** Pinned relievers for this line-up, keyed by rester (`{ by: benchId }`). */
  covers: Record<number, Cover>;
  restPolicy: Record<number, RestPolicy>;
  /** The coach's per-player eligibility overrides — for a bench player, the groups he covers. */
  eligibility: Record<number, Position[]> | undefined;
  onStyle: (s: GameStyle) => void;
  onCover: (resterId: number, cover: Cover | null) => void;
  onRestPolicy: (playerId: number, policy: RestPolicy) => void;
  /** `null` = back to his archetype's default groups. */
  onBenchGroups: (playerId: number, groups: RotationGroup[] | null) => void;
  onRole: (playerId: number, pos: Position, tactic: Tactic) => void;
  tog: Map<number, number> | null;
  projecting: boolean;
  scoutStyle: GameStyle | null;
  lastWeekStyle: GameStyle | null;
}) {
  const slotOf = new Map<number, number>();
  lineup.forEach((id, i) => {
    if (id !== null) slotOf.set(id, i);
  });
  const posOf = (id: number) => (slotOf.has(id) ? POSITIONS[slotOf.get(id)!] : undefined);
  const bench = INT_SLOTS.map((i) => (lineup[i] !== null ? byId.get(lineup[i]!) : undefined)).filter((p): p is Player => !!p);
  const ruckId = lineup[9];
  const [selRaw, setSel] = useState<number | null>(ruckId);
  const sel = selRaw !== null && slotOf.has(selRaw) ? selRaw : ruckId;

  const style = plan.gameStyle;
  const lineText = STYLE_LINE_TEXT[style];

  // Rotation groups: which groups each bench player covers, and who can relieve a given starter.
  const groupsOf = (p: Player) => rotationGroupsOf(p, eligibility?.[p.PlayerID]);
  const relieversFor = (pos: Position) => {
    const g = groupOfPosition(pos);
    return g ? bench.filter((b) => groupsOf(b).includes(g)) : [];
  };
  const policyOf = (id: number): RestPolicy => restPolicy[id] ?? "normal";
  const togOf = (id: number) => {
    const v = tog?.get(id);
    return v === undefined ? "…" : `${Math.round(v)}%`;
  };
  const starters = PLAN_LINES.flatMap((l) => l.slots).filter((i) => lineup[i] !== null);
  const starterIds = starters.map((i) => lineup[i]!);
  const restShare = tog && starterIds.length ? Math.round(starterIds.reduce((a, id) => a + (100 - (tog.get(id) ?? 100)), 0) / starterIds.length) : null;
  const uncovered = uncoveredGroups(bench, eligibility);
  const covStat = `${uncovered.length ? `No bench cover: ${uncovered.map(groupShort).join(", ")}` : "Bench covers every group"} · ${
    restShare === null ? (projecting ? "projecting rests…" : "") : `starters rest ~${restShare}% of the match`
  }`;

  const impact = gameStyleModelledImpact(style);

  // --- Player panel ---------------------------------------------------------------------------------
  const selP = sel !== null ? byId.get(sel) : undefined;
  const selPos = sel !== null ? posOf(sel) : undefined;
  const roleOf = (p: Player, pos: Position) => resolveTactic(plan, p, pos) ?? roleOptions(p, pos).suggested;

  const RoleSelect = ({ p, pos }: { p: Player; pos: Position }) => {
    const { options, suggested } = roleOptions(p, pos);
    const value = roleOf(p, pos);
    return (
      <>
        <select value={value} onChange={(e) => onRole(p.PlayerID, pos, e.target.value as Tactic)} style={selectStyle}>
          {options.map((t) => (
            <option key={t} value={t}>
              {t}
              {t === suggested ? "  (suggested)" : ""}
            </option>
          ))}
        </select>
        <span style={{ font: `500 12px/1.4 ${BARLOW}`, color: "#9aa4b5" }}>{TACTIC_BLURB[value]}</span>
      </>
    );
  };

  let panel: JSX.Element | null = null;
  if (selP && selPos && selPos !== "INT") {
    const { options, suggested } = roleOptions(selP, selPos);
    const current = roleOf(selP, selPos);
    const pin = covers[selP.PlayerID]?.by;
    const pinned = pin !== undefined ? byId.get(pin) : undefined;
    const group = groupOfPosition(selPos);
    const relievers = relieversFor(selPos);
    const policy = policyOf(selP.PlayerID);
    const benchSorted = [...bench].sort((a, b) => fitTier(b, selPos).rank - fitTier(a, selPos).rank || b.OVR - a.OVR);
    const names = (ps: Player[]) => ps.map((p) => p.lname).join(", ");
    const summary =
      policy === "never"
        ? "Plays the whole game unless you change it at a break."
        : pinned
          ? `${pinned.lname} comes on first when he needs a rest.`
          : relievers.length
            ? `Rests at goal resets when he tires. ${names(relievers)} cover${relievers.length === 1 ? "s" : ""} ${group ? groupLabel(group).toLowerCase() : "him"}.`
            : "No bench player covers his group — he only rests if a teammate can move across.";
    const lineKey = lineKeyFor(selPos);
    panel = (
      <>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={monoLabel}>ROLE AT {POSITION_FULL[selPos].toUpperCase()}</span>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 6 }}>
            {options.map((t) => {
              const on = t === current;
              return (
                <button
                  key={t}
                  onClick={() => onRole(selP.PlayerID, selPos, t)}
                  style={{
                    padding: "9px 10px",
                    minHeight: 40,
                    borderRadius: 8,
                    cursor: "pointer",
                    textAlign: "left",
                    font: `600 13px ${BARLOW}`,
                    color: on ? "var(--on)" : "#dfe5ee",
                    background: on ? "var(--acc)" : "rgba(0,0,0,.25)",
                    border: `1px solid ${on ? "var(--acc)" : "rgba(255,255,255,.1)"}`,
                  }}
                >
                  {t}
                  {t === suggested ? " ★" : ""}
                </button>
              );
            })}
          </div>
          <span style={{ font: `500 12px/1.4 ${BARLOW}`, color: "#9aa4b5", textWrap: "pretty" }}>
            {TACTIC_BLURB[current]}
            {style !== "Balanced" ? ` ${styleLabel(style)}: ${lineText[lineKey].toLowerCase()}.` : ""}
          </span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,.08)" }}>
          <span style={monoLabel}>ROTATION{group ? ` · ${groupLabel(group).toUpperCase()}` : ""}</span>
          <span style={{ font: `600 15px/1.35 ${BARLOW}`, color: !relievers.length && policy !== "never" && !pinned ? FALL : "#fff", textWrap: "pretty" }}>{summary}</span>
          <RestPolicyChips playerId={selP.PlayerID} policy={policy} onRestPolicy={onRestPolicy} />
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ font: `600 9px ${MONO}`, letterSpacing: ".8px", color: "#8f9ab0", width: "100%" }}>FIRST OFF THE BENCH FOR HIM · OPTIONAL</span>
            <button onClick={() => onCover(selP.PlayerID, null)} style={chip(!pinned)}>
              AI picks
            </button>
            {benchSorted.map((b) => {
              const on = pin === b.PlayerID;
              return (
                <button key={b.PlayerID} onClick={() => onCover(selP.PlayerID, { by: b.PlayerID })} style={chip(on)}>
                  #{b.jumperNumber} {b.lname} <FitWord p={b} pos={selPos} on={on} />
                </button>
              );
            })}
          </div>
        </div>
      </>
    );
  } else if (selP && selPos === "INT") {
    const override = eligibility?.[selP.PlayerID];
    const groups = groupsOf(selP);
    const toggle = (g: RotationGroup) => onBenchGroups(selP.PlayerID, groups.includes(g) ? groups.filter((x) => x !== g) : ROTATION_GROUPS.map((x) => x.key).filter((x) => x === g || groups.includes(x)));
    // Roles for the positions he'll actually play: his covered groups' positions he suits.
    const rolePositions = ROTATION_GROUPS.filter((g) => groups.includes(g.key))
      .flatMap((g) => g.positions)
      .filter((pos) => fitTier(selP, pos).rank >= 2);
    panel = (
      <>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={monoLabel}>COVERS</span>
          <span style={{ font: `600 15px/1.35 ${BARLOW}`, color: groups.length ? "#fff" : FALL, textWrap: "pretty" }}>
            {groups.length
              ? `Comes on for tired players in ${groups.map((g) => groupLabel(g).toLowerCase()).join(", ")}.`
              : "Covers nothing — he won't come on unless you make a change at a break."}
          </span>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <button onClick={() => onBenchGroups(selP.PlayerID, null)} style={chip(!override)} title="The groups his archetype suits">
              Auto
            </button>
            {ROTATION_GROUPS.map((g) => (
              <button key={g.key} onClick={() => toggle(g.key)} style={chip(groups.includes(g.key))}>
                {g.label}
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,.08)" }}>
          <span style={monoLabel}>ONCE HE'S ON</span>
          <RestPolicyChips playerId={selP.PlayerID} policy={policyOf(selP.PlayerID)} onRestPolicy={onRestPolicy} />
        </div>
        {rolePositions.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,.08)" }}>
            <span style={monoLabel}>ROLE WHEN HE PLAYS</span>
            {[...new Set(rolePositions)].map((pos) => (
              <div key={pos} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={{ font: `600 14px ${BARLOW}`, color: "#eef2f8" }}>{POSITION_FULL[pos]}</span>
                <RoleSelect p={selP} pos={pos} />
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  const tileBase = (on: boolean, accent: boolean): CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 3,
    padding: "7px 8px",
    borderRadius: 9,
    cursor: "pointer",
    textAlign: "left",
    minWidth: 0,
    border: on ? "2px solid var(--acc)" : `1px solid ${accent ? "color-mix(in oklch, var(--acc) 45%, transparent)" : "rgba(255,255,255,.1)"}`,
    background: on ? "color-mix(in oklch, var(--acc) 18%, rgba(0,0,0,.25))" : "rgba(0,0,0,.25)",
  });
  const ellipsis: CSSProperties = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section data-screen-label="Game style" style={{ ...PANEL_BG, padding: "12px 14px", display: "flex", gap: 16, flexWrap: "wrap", alignItems: "stretch" }}>
        <div style={{ flex: "2 1 560px", minWidth: 0, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <span style={{ ...monoLabel, color: "var(--accT)" }}>GAME STYLE</span>
            <span style={{ font: `500 12px ${BARLOW}`, color: "#8f9ab0" }}>Shapes every line below and the match engine</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 6 }}>
            {STYLE_ORDER.map((s) => {
              const on = s === style;
              return (
                <button
                  key={s}
                  onClick={() => onStyle(s)}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: 4,
                    padding: "9px 11px",
                    borderRadius: 10,
                    cursor: "pointer",
                    textAlign: "left",
                    minWidth: 0,
                    border: on ? "2px solid var(--acc)" : "1px solid rgba(255,255,255,.08)",
                    background: on ? "color-mix(in oklch, var(--acc) 16%, rgba(0,0,0,.2))" : "rgba(0,0,0,.2)",
                  }}
                >
                  <span style={{ display: "flex", justifyContent: "space-between", gap: 6, width: "100%", font: `600 9px ${MONO}`, letterSpacing: ".7px", minHeight: 12 }}>
                    <span style={{ color: "#8f9ab0" }}>{s === lastWeekStyle ? "LAST WEEK" : ""}</span>
                    <span style={{ color: "#f0c04a" }}>{s === scoutStyle ? "★ SCOUT PICK" : ""}</span>
                  </span>
                  <span style={{ font: `700 16px ${COND}`, color: "#fff", letterSpacing: ".3px" }}>{styleLabel(s)}</span>
                  <span style={{ font: `500 12px/1.35 ${BARLOW}`, color: "#9aa4b5", textWrap: "pretty" }}>{styleBlurb(s)}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div style={{ flex: "1 1 280px", minWidth: 0, display: "flex", flexDirection: "column", gap: 8, paddingLeft: 16, borderLeft: "1px solid rgba(255,255,255,.08)" }}>
          <span style={monoLabel}>EFFECT · VS TRUST THE PLAYERS</span>
          {METRICS.map((m) => {
            const v = Math.round(impact[m.key]);
            const good = m.lowerIsGood ? v < 0 : v > 0;
            const col = v === 0 ? "#8f9ab0" : good ? RISE : FALL;
            const w = Math.min(50, (Math.abs(v) / 30) * 50);
            return (
              <div key={m.key} style={{ display: "grid", gridTemplateColumns: "92px minmax(0,1fr) 44px", gap: 10, alignItems: "center", height: 24 }}>
                <span style={{ font: `600 12px ${BARLOW}`, color: "#c3ccdd" }}>{m.label}</span>
                <span style={{ position: "relative", height: 8, borderRadius: 4, background: "rgba(255,255,255,.07)" }}>
                  <span style={{ position: "absolute", left: "50%", top: -3, bottom: -3, width: 1, background: "rgba(255,255,255,.3)" }} />
                  <span style={{ position: "absolute", top: 0, bottom: 0, left: `${v >= 0 ? 50 : 50 - w}%`, width: `${w}%`, borderRadius: 4, background: col }} />
                </span>
                <span style={{ textAlign: "right", font: `600 12px ${MONO}`, color: col }}>
                  {v > 0 ? "+" : ""}
                  {v}%
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <section style={{ ...flowCard, flex: "1.5 1 560px", minWidth: 0, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={monoLabel}>ROLES &amp; ROTATIONS · FORWARD ↑</span>
            <span style={{ font: `500 12px ${BARLOW}`, color: "#aab3c3" }}>{covStat}</span>
          </div>
          <div style={{ ...pitchPanel, display: "flex", flexDirection: "column", gap: 8 }}>
            {PLAN_LINES.map((line) => (
              <div key={line.name} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "0 2px" }}>
                  <span style={{ font: `600 9px ${MONO}`, letterSpacing: ".8px", color: "#8f9ab0" }}>{line.name}</span>
                  {style !== "Balanced" && (
                    <span style={{ font: `600 11px ${BARLOW}`, color: "var(--accT)" }}>
                      {styleLabel(style)} · {lineText[line.key]}
                    </span>
                  )}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 6 }}>
                  {line.slots.map((slot) => {
                    const pos = POSITIONS[slot];
                    const id = lineup[slot];
                    const p = id !== null ? byId.get(id) : undefined;
                    if (!p)
                      return (
                        <div key={slot} style={{ display: "flex", flexDirection: "column", gap: 3, padding: "7px 8px", borderRadius: 9, border: "1px dashed rgba(255,255,255,.18)", background: "rgba(0,0,0,.2)", minHeight: 78 }}>
                          <span style={{ font: `600 9px ${MONO}`, color: "#8f9ab0" }}>{pos}</span>
                          <span style={{ font: `600 13px ${BARLOW}`, color: "#8f9ab0" }}>Empty</span>
                        </div>
                      );
                    const pin = covers[p.PlayerID]?.by;
                    const policy = policyOf(p.PlayerID);
                    const noCover = relieversFor(pos).length === 0 && pin === undefined;
                    const rest =
                      policy === "never"
                        ? "Never rests"
                        : pin !== undefined
                          ? `↻ ${byId.get(pin)?.lname} first`
                          : noCover
                            ? "No bench cover"
                            : policy === "normal"
                              ? "Rotates"
                              : REST_POLICIES.find((r) => r.key === policy)!.label;
                    const restColor = policy === "never" ? "#f0c04a" : noCover ? FALL : pin !== undefined || policy !== "normal" ? "var(--accT)" : "#8f9ab0";
                    const badge = tog ? togOf(p.PlayerID) : "";
                    return (
                      <button key={slot} onClick={() => setSel(p.PlayerID)} style={{ ...tileBase(sel === p.PlayerID, pin !== undefined || policy !== "normal"), minHeight: 78 }}>
                        <span style={{ display: "flex", justifyContent: "space-between", width: "100%", gap: 6, font: `600 9px ${MONO}`, letterSpacing: ".7px", color: "#8f9ab0" }}>
                          <span>{pos}</span>
                          <span style={{ color: "var(--accT)" }}>{badge}</span>
                        </span>
                        <span style={{ font: `600 13px ${BARLOW}`, color: "#eef2f8", ...ellipsis }}>
                          #{p.jumperNumber} {p.lname}
                        </span>
                        <span style={{ font: `600 11px ${BARLOW}`, color: "#dfe5ee", opacity: 0.85, ...ellipsis }}>{roleOf(p, pos)}</span>
                        <span style={{ font: `500 11px ${BARLOW}`, color: restColor, ...ellipsis }}>{rest}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <div style={{ font: `600 9px ${MONO}`, letterSpacing: ".8px", color: "#8f9ab0", padding: "4px 2px 0", borderTop: "1px solid rgba(255,255,255,.08)" }}>INTERCHANGE</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 6 }}>
              {INT_SLOTS.map((slot) => {
                const id = lineup[slot];
                const b = id !== null ? byId.get(id) : undefined;
                if (!b)
                  return (
                    <div key={slot} style={{ padding: "7px 8px", borderRadius: 9, border: "1px dashed rgba(255,255,255,.18)", background: "rgba(0,0,0,.2)", minHeight: 62, font: `600 12px ${BARLOW}`, color: "#8f9ab0" }}>
                      Empty
                    </div>
                  );
                const bg = groupsOf(b);
                return (
                  <button key={slot} onClick={() => setSel(b.PlayerID)} style={{ ...tileBase(sel === b.PlayerID, false), minHeight: 62 }}>
                    <span style={{ display: "flex", justifyContent: "space-between", width: "100%", font: `600 9px ${MONO}`, letterSpacing: ".7px", color: "#8f9ab0" }}>
                      <span>INT</span>
                      <span>{togOf(b.PlayerID)}</span>
                    </span>
                    <span style={{ font: `600 12px ${BARLOW}`, color: "#eef2f8", ...ellipsis }}>
                      #{b.jumperNumber} {b.lname}
                    </span>
                    <span style={{ font: `500 11px ${BARLOW}`, color: bg.length ? "var(--accT)" : FALL, ...ellipsis }} title={bg.map(groupLabel).join(", ")}>
                      {bg.length ? bg.map(groupShort).join(" · ") : "Covers nothing"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </section>

        <section data-screen-label="Player plan" style={{ ...PANEL_BG, flex: "1 1 360px", minWidth: 0, overflow: "hidden", position: "sticky", top: 12 }}>
          <Stripe />
          <div style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: 14 }}>
            {selP ? (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                      <span style={{ font: `600 12px ${MONO}`, color: "var(--accT)" }}>#{selP.jumperNumber}</span>
                      <span style={{ font: `700 24px/1.05 ${COND}`, color: "#fff" }}>
                        {selP.fname} {selP.lname}
                      </span>
                    </div>
                    <div style={{ font: `500 13px ${BARLOW}`, color: "#aab3c3", marginTop: 2 }}>
                      {selP.archetype} · {selPos === "INT" ? "interchange" : `starts ${POSITION_FULL[selPos!]} · ${fitTier(selP, selPos!).word} fit`}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", flex: "none" }} title="Average time on ground over two projected matches against this week's opponent">
                    <div style={{ font: `700 24px/1 ${COND}`, color: "#fff" }}>{togOf(selP.PlayerID)}</div>
                    <div style={{ font: `600 9px ${MONO}`, letterSpacing: ".8px", color: "#8f9ab0" }}>PROJ. TOG</div>
                  </div>
                </div>
                {panel}
              </>
            ) : (
              <span style={{ font: `500 13px ${BARLOW}`, color: "#8f9ab0" }}>Pick a player to set his role and who relieves him.</span>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

