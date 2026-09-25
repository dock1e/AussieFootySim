import type { Player } from "../../../types/player";
import type { Position } from "../../../types/archetype";
import type { GameStyle } from "../../../engine/tactics";
import { BARLOW, COND, MONO, RISE, WARN, clubAbbr, clubVarsByName, Stripe } from "../shared";
import { styleLabel, type DangerMan, type ScoutRow } from "./flowData";
import { flowCard, monoLabel } from "./FlowChrome";
import type { ScoutPick } from "./useScoutPick";

/**
 * Step 3 · Opposition (`Match Day Flow v2.dc.html` "3 Opposition"): scouting and tags only — the
 * game style moved to the Game plan step. Their danger men are their top four on-ground players by
 * average fantasy points; only mids, wings, half-forwards and half-backs can be tagged, and the tagger
 * list is your on-field starters, never the ruck, best man-markers first. The scout's style pick
 * comes from simulating this week's match in every style (`useScoutPick`); "Use it" sets it in your
 * game plan. Tags apply to this match only.
 */

export interface WeeklyChange {
  kind: "TEAM" | "TAG" | "STYLE";
  text: string;
}

function untaggableReason(pos: Position | undefined, matchup: DangerMan["matchup"]): string {
  if (pos === "R") return `Rucks can't be tagged. ${matchup ? matchup.player.lname : "Your ruck"} goes head to head.`;
  return "Key and deep positions can't be tagged. Handled by your match-up.";
}

export function OppositionStep({
  opponent,
  subtitle,
  howTheyPlay,
  danger,
  taggers,
  taggerSlot,
  tags,
  onTag,
  scout,
  scoutPick,
  scoutPending,
  planStyle,
  onUseStyle,
  changes,
  onClearTags,
}: {
  opponent: string;
  subtitle: string;
  howTheyPlay: string;
  danger: DangerMan[];
  taggers: Player[];
  taggerSlot: (p: Player) => string;
  tags: Map<number, number>;
  onTag: (targetId: number, taggerId: number | null) => void;
  scout: ScoutRow[];
  scoutPick: ScoutPick | null;
  scoutPending: boolean;
  planStyle: GameStyle;
  onUseStyle: (s: GameStyle) => void;
  changes: WeeklyChange[];
  onClearTags: () => void;
}) {
  const recOn = scoutPick !== null && scoutPick.style === planStyle;
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
            <div style={{ font: `700 22px/1.1 ${COND}`, color: "#fff" }}>Scouting {opponent}</div>
            <div style={{ font: `500 13px ${BARLOW}`, color: "#aab3c3" }}>{subtitle} · tags apply to this match only</div>
          </div>
          <div style={{ font: `500 13px ${BARLOW}`, color: "#c3ccdd", flex: "1 1 260px", minWidth: 0, textWrap: "pretty" }}>
            <span style={{ font: `600 10px ${MONO}`, letterSpacing: "1px", color: "var(--accT)" }}>HOW THEY PLAY · </span>
            {howTheyPlay}
          </div>
        </section>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
        <section style={{ flex: "1.4 1 480px", minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "0 2px" }}>
            <span style={monoLabel}>THEIR DANGER MEN</span>
            <span style={{ font: `500 12px ${BARLOW}`, color: "#8f9ab0" }}>Only mids, wings, half-forwards and half-backs can be tagged</span>
          </div>
          {danger.map((d) => {
            const taggerId = tags.get(d.player.PlayerID);
            const tagged = taggerId !== undefined && d.taggable;
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
                  {d.taggable ? (
                    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ font: `600 9px ${MONO}`, letterSpacing: ".8px", color: "#8f9ab0" }}>TAG HIM WITH</span>
                      <select
                        value={tagged ? taggerId : ""}
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
                            #{p.jumperNumber} {p.fname} {p.lname} · {taggerSlot(p)} · man-marking {p.manMarking}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      <span style={{ font: `600 9px ${MONO}`, letterSpacing: ".8px", color: "#8f9ab0" }}>NO TAG</span>
                      <span style={{ font: `500 13px/1.35 ${BARLOW}`, color: "#9aa4b5", textWrap: "pretty" }}>{untaggableReason(d.pos, d.matchup)}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </section>

        <div style={{ flex: "1 1 340px", minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
          <section style={{ ...flowCard, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={monoLabel}>SCOUTING · {opponent.toUpperCase()}</div>
            {scout.map((c) => (
              <div key={c.label} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: "2px 10px", padding: "6px 0", borderTop: "1px solid rgba(255,255,255,.06)" }}>
                <span style={{ font: `600 13px ${BARLOW}`, color: "#eef2f8" }}>{c.label}</span>
                <span style={{ font: `600 13px ${MONO}`, color: "var(--accT)" }}>{c.value}</span>
                <span style={{ gridColumn: "1 / -1", font: `500 12px ${BARLOW}`, color: "#9aa4b5" }}>{c.note}</span>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "10px 0 2px", borderTop: "1px solid rgba(255,255,255,.06)" }}>
              {scoutPick ? (
                <>
                  <span style={{ font: `500 13px ${BARLOW}`, color: "#c3ccdd" }}>
                    ★ Scout suggests <b style={{ color: "#fff" }}>{styleLabel(scoutPick.style)}</b>
                    <span style={{ display: "block", font: `500 11px ${MONO}`, color: "#8f9ab0", marginTop: 2 }}>
                      avg margin {scoutPick.margins[scoutPick.style] >= 0 ? "+" : ""}
                      {Math.round(scoutPick.margins[scoutPick.style])} over {scoutPick.games} simulated games
                    </span>
                  </span>
                  <button
                    onClick={() => onUseStyle(scoutPick.style)}
                    style={{
                      background: recOn ? "transparent" : "var(--acc)",
                      color: recOn ? RISE : "var(--on)",
                      border: recOn ? `1px solid ${RISE}` : 0,
                      borderRadius: 8,
                      padding: "7px 12px",
                      font: `700 12px ${BARLOW}`,
                      cursor: "pointer",
                    }}
                  >
                    {recOn ? "In your game plan" : "Use it"}
                  </button>
                </>
              ) : (
                <span style={{ font: `500 13px ${BARLOW}`, color: "#8f9ab0" }}>{scoutPending ? "★ The scout is playing it out in every style…" : "★ No scout pick yet"}</span>
              )}
            </div>
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
                <span style={{ ...monoLabel, color: "var(--accT)" }}>CHANGES VS LAST WEEK · {changes.length}</span>
                <button onClick={onClearTags} style={{ background: "none", border: 0, color: "#aab3c3", font: `600 12px ${BARLOW}`, cursor: "pointer", padding: 4 }}>
                  Clear tags
                </button>
              </div>
              {changes.length === 0 && <div style={{ font: `500 13px/1.45 ${BARLOW}`, color: "#aab3c3" }}>No changes. You'll play last week's plan.</div>}
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
