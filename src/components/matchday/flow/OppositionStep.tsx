import type { Player } from "../../../types/player";
import { GAME_STYLES, gameStyleModelledImpact, type GameStyle } from "../../../engine/tactics";
import { BARLOW, COND, FALL, MONO, RISE, WARN, clubAbbr, clubVarsByName, Stripe } from "../shared";
import { styleBlurb, styleLabel, type DangerMan, type ScoutRow } from "./flowData";
import { flowCard, monoLabel } from "./FlowChrome";

/**
 * Step 5 · Opposition (`Match Day Flow.dc.html` "5 Opposition"): this week's changes to the standing
 * plan — tag one of their danger men, pick a different game style — for this match only. Their danger
 * men are their top four on-ground players by average fantasy points (this season's, falling back to
 * real 2025 numbers), "How they play" is the game style the AI actually picks for them
 * (`aiTeamPlan`), and scouting ranks come from each list's real 2025 stats.
 *
 * The reference marks one style as the "scout pick"; the engine has no model of which style beats
 * which, so each option shows its modelled effect instead (the same numbers as the break screen).
 */

export interface WeeklyChange {
  kind: "TAG" | "STYLE";
  text: string;
}

function signed(n: number): string {
  const r = Math.round(n);
  return r > 0 ? `+${r}` : `${r}`;
}

export function OppositionStep({
  opponent,
  subtitle,
  howTheyPlay,
  danger,
  taggers,
  tags,
  onTag,
  standingStyle,
  weekStyle,
  onWeekStyle,
  scout,
  changes,
  onReset,
}: {
  opponent: string;
  subtitle: string;
  howTheyPlay: string;
  danger: DangerMan[];
  taggers: Player[];
  tags: Map<number, number>;
  onTag: (targetId: number, taggerId: number | null) => void;
  standingStyle: GameStyle;
  weekStyle: GameStyle | null;
  onWeekStyle: (s: GameStyle | null) => void;
  scout: ScoutRow[];
  changes: WeeklyChange[];
  onReset: () => void;
}) {
  const active = weekStyle ?? standingStyle;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={clubVarsByName(opponent)}>
        <section
          style={{
            background: "color-mix(in oklch, var(--deep) 30%, #10151f)",
            border: "1px solid color-mix(in oklch, var(--acc) 30%, transparent)",
            borderRadius: 14,
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: "var(--deep)",
              border: "1px solid color-mix(in oklch, var(--acc) 55%, transparent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              font: `700 15px ${COND}`,
              color: "var(--accT)",
            }}
          >
            {clubAbbr(opponent)}
          </div>
          <div style={{ flex: "1 1 260px", minWidth: 0 }}>
            <div style={{ font: `700 22px/1.1 ${COND}`, color: "#fff" }}>Game plan vs {opponent}</div>
            <div style={{ font: `500 13px ${BARLOW}`, color: "#aab3c3" }}>{subtitle} · changes apply to this match only</div>
          </div>
          <div style={{ font: `500 13px ${BARLOW}`, color: "#c3ccdd", flex: "1 1 260px", minWidth: 0, textWrap: "pretty" }}>
            <span style={{ font: `600 10px ${MONO}`, letterSpacing: "1px", color: "var(--accT)" }}>HOW THEY PLAY · </span>
            {howTheyPlay}
          </div>
        </section>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <section style={{ flex: "1.4 1 480px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ ...monoLabel, padding: "0 2px" }}>THEIR DANGER MEN</div>
          {danger.map((d) => {
            const taggerId = tags.get(d.player.PlayerID);
            const tagged = taggerId !== undefined;
            return (
              <div
                key={d.player.PlayerID}
                style={{
                  ...flowCard,
                  border: `1px solid ${tagged ? "color-mix(in oklch, var(--acc) 45%, transparent)" : "rgba(255,255,255,.07)"}`,
                  padding: "12px 14px",
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ font: `600 10px ${MONO}`, color: "#8f9ab0" }}>{d.pos ?? "—"}</span>
                      <span style={{ font: `700 19px ${COND}`, color: "#fff" }}>
                        {d.player.fname} {d.player.lname}
                      </span>
                      {d.adviseTag && !tagged && (
                        <span style={{ font: `600 9px ${MONO}`, letterSpacing: ".8px", color: WARN, padding: "2px 6px", border: `1px solid ${WARN}`, borderRadius: 4 }}>TAG ADVISED</span>
                      )}
                    </div>
                    <div style={{ font: `500 13px/1.4 ${BARLOW}`, color: "#aab3c3", marginTop: 2 }}>{d.note}</div>
                  </div>
                  <div style={{ textAlign: "right", flex: "none" }}>
                    <div style={{ font: `700 24px/1 ${COND}`, color: "#fff" }}>{Math.round(d.avgFp)}</div>
                    <div style={{ font: `600 9px ${MONO}`, letterSpacing: ".8px", color: "#8f9ab0" }}>AVG FP</div>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10, alignItems: "end" }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ font: `600 9px ${MONO}`, letterSpacing: ".8px", color: "#8f9ab0" }}>DEFAULT MATCH-UP</span>
                    <span style={{ font: `600 14px ${BARLOW}`, color: "#eef2f8" }}>
                      {d.matchup ? `#${d.matchup.player.jumperNumber} ${d.matchup.player.fname} ${d.matchup.player.lname} (${d.matchup.pos})` : "—"}
                    </span>
                  </div>
                  <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <span style={{ font: `600 9px ${MONO}`, letterSpacing: ".8px", color: "#8f9ab0" }}>TAG HIM WITH</span>
                    <select
                      value={taggerId ?? ""}
                      onChange={(e) => onTag(d.player.PlayerID, e.target.value ? Number(e.target.value) : null)}
                      style={{
                        width: "100%",
                        background: tagged ? "color-mix(in oklch, var(--acc) 22%, rgba(0,0,0,.3))" : "rgba(0,0,0,.3)",
                        border: `1px solid ${tagged ? "var(--acc)" : "rgba(255,255,255,.14)"}`,
                        borderRadius: 7,
                        color: "#eef2f8",
                        font: `600 13px ${BARLOW}`,
                        padding: 8,
                        outline: "none",
                        cursor: "pointer",
                      }}
                    >
                      <option value="">No tag — default match-up</option>
                      {taggers.map((p) => (
                        <option key={p.PlayerID} value={p.PlayerID}>
                          #{p.jumperNumber} {p.fname} {p.lname} · man-marking {p.manMarking}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            );
          })}
          {taggers.length === 0 && (
            <div style={{ font: `500 12px ${BARLOW}`, color: "#8f9ab0", padding: "0 2px" }}>Nobody in a midfield position can run a tag this week.</div>
          )}
        </section>

        <div style={{ flex: "1 1 340px", minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          <section style={{ ...flowCard, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={monoLabel}>GAME STYLE THIS WEEK</div>
            {GAME_STYLES.map((s) => {
              const on = active === s;
              const impact = gameStyleModelledImpact(s);
              return (
                <button
                  key={s}
                  onClick={() => onWeekStyle(s === standingStyle ? null : s)}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                    padding: "9px 10px",
                    borderRadius: 9,
                    cursor: "pointer",
                    textAlign: "left",
                    border: `1px solid ${on ? "var(--acc)" : "rgba(255,255,255,.06)"}`,
                    background: on ? "color-mix(in oklch, var(--acc) 12%, transparent)" : "rgba(0,0,0,.15)",
                    minHeight: 44,
                  }}
                >
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: "50%",
                      flex: "none",
                      marginTop: 3,
                      border: `2px solid ${on ? "var(--acc)" : "#5d6880"}`,
                      background: on ? "radial-gradient(circle, var(--acc) 0 3px, transparent 3.5px)" : "transparent",
                    }}
                  />
                  <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 }}>
                    <span style={{ font: `600 14px ${BARLOW}`, color: "#eef2f8" }}>
                      {styleLabel(s)}
                      {s === standingStyle && <span style={{ color: "#8f9ab0", fontWeight: 500 }}> · standing</span>}
                    </span>
                    <span style={{ font: `500 12px ${BARLOW}`, color: "#9aa4b5" }}>{styleBlurb(s)}</span>
                    {(impact.ourScoring !== 0 || impact.theirScoring !== 0) && (
                      <span style={{ font: `500 11px ${MONO}`, color: "#aab3c3", display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <span>
                          our scoring <b style={{ color: impact.ourScoring >= 0 ? RISE : FALL }}>{signed(impact.ourScoring)}%</b>
                        </span>
                        <span>
                          theirs <b style={{ color: impact.theirScoring <= 0 ? RISE : FALL }}>{signed(impact.theirScoring)}%</b>
                        </span>
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </section>

          <section style={{ ...flowCard, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={monoLabel}>SCOUTING · {opponent.toUpperCase()}</div>
            {scout.map((c) => (
              <div key={c.label} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: "2px 10px", padding: "6px 0", borderTop: "1px solid rgba(255,255,255,.06)" }}>
                <span style={{ font: `600 13px ${BARLOW}`, color: "#eef2f8" }}>{c.label}</span>
                <span style={{ font: `600 13px ${MONO}`, color: "var(--accT)" }}>{c.value}</span>
                <span style={{ gridColumn: "1 / -1", font: `500 12px ${BARLOW}`, color: "#9aa4b5" }}>{c.note}</span>
              </div>
            ))}
          </section>

          <section
            style={{
              background: "color-mix(in oklch, var(--deep) calc(var(--tc) * 1.6), #0f141e)",
              border: "1px solid color-mix(in oklch, var(--acc) 25%, rgba(255,255,255,.07))",
              borderRadius: 14,
              overflow: "hidden",
            }}
          >
            <Stripe />
            <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ ...monoLabel, color: "var(--accT)" }}>CHANGES VS STANDING PLAN · {changes.length}</span>
                <button onClick={onReset} style={{ background: "none", border: 0, color: "#aab3c3", font: `600 12px ${BARLOW}`, cursor: "pointer", padding: 4 }}>
                  Reset
                </button>
              </div>
              {changes.length === 0 && <div style={{ font: `500 13px/1.45 ${BARLOW}`, color: "#aab3c3" }}>No changes. You'll play the standing plan.</div>}
              {changes.map((c, i) => (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "52px minmax(0,1fr)", gap: 8, padding: "8px 0", borderTop: "1px solid rgba(255,255,255,.06)" }}>
                  <span style={{ font: `600 9px ${MONO}`, letterSpacing: ".8px", color: "#8f9ab0", paddingTop: 3 }}>{c.kind}</span>
                  <span style={{ font: `600 13px/1.35 ${BARLOW}`, color: "#eef2f8" }}>{c.text}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
