import type { CSSProperties } from "react";
import { CLUBS } from "../../../types/club";
import { BARLOW, COND, FALL, MONO, RISE, WARN, clubAbbr, clubVarsByName, Stripe } from "../shared";
import type { FixtureChoice, FixtureRow } from "./flowData";
import { flowCard, monoLabel } from "./FlowChrome";

/**
 * Step 1 · Fixture (`Match Day Flow v2.dc.html` "1 Fixture"): your season fixture with results, the next
 * match flagged NEXT UP, and the selected match's card. Only the next unplayed round can be played live
 * (rounds stay in order), so later rounds can be looked at but not chosen. With no season running (or
 * once the home-and-away rounds are done) it becomes a friendly against any club.
 *
 * Kick-off times come from `timeslotFor` (engine/fixture.ts) — the generated fixture's own slot for
 * each match — and set the ball colour: yellow at night, red in the day.
 */

function Badge({ club, width = 48 }: { club: string; width?: number }) {
  return (
    <span style={clubVarsByName(club)}>
      <span
        style={{
          display: "inline-flex",
          justifyContent: "center",
          width,
          padding: "3px 0",
          borderRadius: 6,
          background: "var(--deep)",
          border: "1px solid color-mix(in oklch, var(--acc) 55%, transparent)",
          font: `700 12px ${COND}`,
          color: "var(--accT)",
        }}
      >
        {clubAbbr(club)}
      </span>
    </span>
  );
}

const ROW_GRID = "34px 52px minmax(0,1fr) 70px 86px";

/** The match ball's colour as a small swatch — yellow at night, red in the day (Match Day flow v2 §6). */
export function BallSwatch({ night }: { night: boolean }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 16,
        height: 10,
        borderRadius: "50%",
        background: night ? "#f6c624" : "#d0202e",
        boxShadow: "0 0 0 1px rgba(0,0,0,.5)",
        transform: "rotate(-20deg)",
        flex: "none",
      }}
    />
  );
}

function DayNight({ night }: { night: boolean }) {
  return (
    <span className="mdf-hide-sm" style={{ display: "flex", alignItems: "center", gap: 6, font: `600 10px ${MONO}`, letterSpacing: ".8px", color: "#aab3c3" }}>
      <BallSwatch night={night} />
      {night ? "NIGHT" : "DAY"}
    </span>
  );
}

function rowStyle(on: boolean, dim: boolean, clickable: boolean): CSSProperties {
  return {
    display: "grid",
    gridTemplateColumns: ROW_GRID,
    gap: 10,
    alignItems: "center",
    width: "100%",
    padding: "8px 10px",
    minHeight: 52,
    border: 0,
    borderRadius: 8,
    textAlign: "left",
    cursor: clickable ? "pointer" : "default",
    opacity: dim ? 0.55 : 1,
    background: on ? "color-mix(in oklch, var(--acc) 16%, transparent)" : "transparent",
    boxShadow: on ? "inset 3px 0 0 var(--acc)" : "none",
    borderBottom: "1px solid rgba(255,255,255,.04)",
  };
}

export interface SelectedFixtureCard {
  roundLabel: string;
  opponent: string;
  venue: string;
  homeAway: string;
  when: string;
  night: boolean;
  /** The round whose plan is carried over, or null for the first match. */
  carriedFrom: number | null;
  ladder: string;
  lastMet: string;
}

export function FixtureStep({
  myClub,
  year,
  rows,
  nextRound,
  friendlyOnly,
  choice,
  onChoose,
  card,
  homeVenue,
  friendlyWhen,
}: {
  myClub: string;
  year: number;
  rows: FixtureRow[];
  nextRound: number | null;
  friendlyOnly: boolean;
  choice: FixtureChoice;
  onChoose: (c: FixtureChoice) => void;
  card: SelectedFixtureCard;
  homeVenue: string;
  friendlyWhen: (club: string) => { label: string; night: boolean };
}) {
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-start" }}>
      <section style={{ ...flowCard, flex: "1.5 1 520px", minWidth: 0, padding: "12px 6px 8px" }}>
        {friendlyOnly ? (
          <>
            <div style={{ ...monoLabel, padding: "0 10px 4px" }}>FRIENDLY · {myClub.toUpperCase()}</div>
            <div style={{ font: `500 13px ${BARLOW}`, color: "#aab3c3", padding: "0 10px 8px" }}>
              {rows.length ? "The home-and-away season is finished. " : "No season in progress. "}
              Pick an opponent for a friendly at {homeVenue}. Friendlies don't count on the ladder.
            </div>
            <div style={{ maxHeight: 640, overflowY: "auto" }}>
              {CLUBS.filter((c) => c.name !== myClub).map((c) => {
                const on = choice.kind === "friendly" && choice.opponent === c.name;
                const when = friendlyWhen(c.name);
                return (
                  <button key={c.ClubID} onClick={() => onChoose({ kind: "friendly", opponent: c.name })} className="mdf-fix-grid" style={rowStyle(on, false, true)}>
                    <span style={{ font: `600 12px ${MONO}`, color: "#8f9ab0" }}>—</span>
                    <Badge club={c.name} />
                    <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                      <span style={{ font: `600 14px ${BARLOW}`, color: "#eef2f8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</span>
                      <span style={{ font: `500 11px ${BARLOW}`, color: "#8f9ab0" }}>
                        {homeVenue} · {when.label}
                      </span>
                    </span>
                    <DayNight night={when.night} />
                    <span style={{ textAlign: "right", font: `600 11px ${MONO}`, letterSpacing: ".6px", color: on ? "var(--accT)" : "#8f9ab0" }}>FRIENDLY</span>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <>
            <div style={{ ...monoLabel, padding: "0 10px 8px" }}>
              {year} FIXTURE · {myClub.toUpperCase()}
            </div>
            <div style={{ maxHeight: 640, overflowY: "auto" }}>
              {rows.map((f) => {
                const played = !!f.result;
                const isNext = f.round === nextRound;
                const on = choice.kind === "season" && choice.round === f.round;
                const resColor = played ? (f.result!.outcome === "W" ? RISE : f.result!.outcome === "L" ? FALL : WARN) : isNext ? "var(--accT)" : "#8f9ab0";
                return (
                  <button
                    key={f.round}
                    onClick={isNext ? () => onChoose({ kind: "season", round: f.round }) : undefined}
                    disabled={!isNext}
                    title={played ? undefined : isNext ? undefined : "Only the next round can be played"}
                    className="mdf-fix-grid" style={rowStyle(on, played, isNext)}
                  >
                    <span style={{ font: `600 12px ${MONO}`, color: "#8f9ab0" }}>R{f.round}</span>
                    <Badge club={f.opponent} />
                    <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                      <span style={{ font: `600 14px ${BARLOW}`, color: "#eef2f8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{f.opponent}</span>
                      <span style={{ font: `500 11px ${BARLOW}`, color: "#8f9ab0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {f.venue} · {f.when.label} · {f.isHome ? "home" : "away"}
                      </span>
                    </span>
                    <DayNight night={f.when.night} />
                    <span style={{ textAlign: "right", font: `600 11px ${MONO}`, letterSpacing: ".6px", color: resColor, whiteSpace: "nowrap" }}>
                      {played ? `${f.result!.outcome} ${f.result!.score}` : isNext ? "NEXT UP" : "UPCOMING"}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </section>

      <section
        style={{
          flex: "1 1 340px",
          minWidth: 0,
          position: "relative",
          overflow: "hidden",
          background: "color-mix(in oklch, var(--deep) calc(var(--tc) * 2.2), #10151f)",
          border: "1px solid color-mix(in oklch, var(--acc) 30%, transparent)",
          borderRadius: 14,
        }}
      >
        <Stripe />
        <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ ...monoLabel, color: "var(--accT)" }}>{card.roundLabel} · SELECTED</div>
          <div style={clubVarsByName(card.opponent)}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div
                style={{
                  width: 60,
                  height: 60,
                  borderRadius: 12,
                  background: "var(--deep)",
                  border: "1px solid color-mix(in oklch, var(--acc) 55%, transparent)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  font: `700 19px ${COND}`,
                  color: "var(--accT)",
                }}
              >
                {clubAbbr(card.opponent)}
              </div>
              <div>
                <div style={{ font: `700 30px/1 ${COND}`, color: "#fff" }}>vs {card.opponent}</div>
                <div style={{ font: `500 13px ${BARLOW}`, color: "#aab3c3", marginTop: 4 }}>
                  {card.venue} · {card.when} · {card.homeAway}
                </div>
              </div>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "8px 14px", font: `500 13px ${BARLOW}`, color: "#c3ccdd" }}>
            <span style={{ font: `600 10px ${MONO}`, letterSpacing: "1px", color: "#8f9ab0", paddingTop: 2 }}>LADDER</span>
            <span>{card.ladder}</span>
            <span style={{ font: `600 10px ${MONO}`, letterSpacing: "1px", color: "#8f9ab0", paddingTop: 2 }}>LAST MET</span>
            <span>{card.lastMet}</span>
            <span style={{ font: `600 10px ${MONO}`, letterSpacing: "1px", color: "#8f9ab0", paddingTop: 2 }}>BALL</span>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <BallSwatch night={card.night} />
              {card.night ? "NIGHT · YELLOW BALL" : "DAY · RED BALL"}
            </span>
          </div>
          <div style={{ borderTop: "1px solid rgba(255,255,255,.08)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={monoLabel}>{card.carriedFrom !== null ? `CARRIED OVER FROM ROUND ${card.carriedFrom}` : "YOUR PLAN"}</div>
            <div style={{ font: `500 13px/1.5 ${BARLOW}`, color: "#c3ccdd", textWrap: "pretty" }}>
              {card.carriedFrom !== null ? "Last week's team, rotations, roles and game style." : "Your saved team, rotations, roles and game style."} Tags reset every week.
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
