import { useEffect, useMemo, type CSSProperties } from "react";
import { CLUBS, clubById, clubNameParts } from "../../types/club";
import { generateFixture, matchesInRound, timeslotFor } from "../../engine/fixture";
import { groundForMatch } from "../../data/clubGrounds";
import { getPlayersByClub, leagueAverageOvr } from "../../data/loadPlayers";
import { summariseLines } from "../../data/lines";
import { careerContext, fillDayOne } from "../../narrative/career";
import { textFor, type NarrativeHistory } from "../../narrative/phraseEngine";
import type { Slot } from "../../narrative/phrases/types";
import { useCareerStore } from "../../store/useCareerStore";
import { useSaveStore } from "../../store/useSaveStore";
import { useSeasonStore } from "../../store/useSeasonStore";
import { BARLOW, COND, FALL, MONO, RISE, WARN, clubVarsByName } from "../matchday/shared";

/**
 * New Game Onboarding, step 4 — the Day one dashboard (`New Game Onboarding.dc.html` "4 Day one
 * dashboard"). It replaces the old "No season in progress" empty state: from signing until Round 1
 * is played, the Dashboard shows this instead of the in-season view.
 *
 * Its text (sub-line, inbox, checklist blurbs, board brief) comes from the phrase bank, picked once
 * per pre-season and stored in the save (`dayOne.picks`), so a reload shows the same words. Checklist
 * ticks persist too. Each item links to the tab where the work happens.
 */

export type DayOneTarget = "plan" | "list" | "dept" | "scout" | "start";

const TASKS: { key: "plan" | "list" | "dept" | "scout"; title: string; tab: string }[] = [
  { key: "plan", title: "Set your standing plan", tab: "MATCH DAY" },
  { key: "list", title: "Meet the list", tab: "LIST" },
  { key: "dept", title: "Appoint your assistants", tab: "FOOTBALL DEPT" },
  { key: "scout", title: `Scout Round 1`, tab: "MATCH DAY" },
];

const card: CSSProperties = {
  background: "color-mix(in oklch, var(--deep) 30%, #10151f)",
  border: "1px solid rgba(255,255,255,.07)",
  borderRadius: 16,
};
const label: CSSProperties = { font: `500 11px ${MONO}`, letterSpacing: "1.5px", color: "#9aa4b5" };

function Tile({ id, size, font }: { id: string; size: number; font: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        flex: "none",
        borderRadius: Math.round(size / 4.8),
        background: "var(--deep)",
        border: "1px solid color-mix(in oklch, var(--acc) 55%, transparent)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        font: `700 ${font}px ${COND}`,
        color: "var(--accT)",
      }}
    >
      {id}
    </div>
  );
}

export function DayOne({ myClub, onGo }: { myClub: string; onGo: (target: DayOneTarget) => void }) {
  const year = useSaveStore((s) => s.year);
  const seasonArchives = useSaveStore((s) => s.seasonArchives);
  const season = useSeasonStore((s) => s.season);
  const coach = useCareerStore((s) => s.coach);
  const board = useCareerStore((s) => s.board);
  const saveId = useCareerStore((s) => s.saveId);
  const dayOne = useCareerStore((s) => s.dayOne);
  const toggleTask = useCareerStore((s) => s.toggleTask);

  const club = CLUBS.find((c) => c.name === myClub) ?? CLUBS[0];
  const fixture = useMemo(() => season?.fixture ?? generateFixture(CLUBS.map((c) => c.ClubID)), [season]);
  const ctx = useMemo(
    () => careerContext({ clubId: club.ClubID, year, seasonArchives, coach, board, saveId, fixture }),
    [club.ClubID, year, seasonArchives, coach, board, saveId, fixture],
  );

  // Pick this pre-season's text once (and again only when the year rolls over).
  useEffect(() => {
    if (dayOne && dayOne.year === year && Object.keys(dayOne.picks).length >= 11) return;
    const store = useCareerStore.getState();
    const history = structuredClone(store.narrative.history) as NarrativeHistory;
    const next = fillDayOne(store.dayOne, year, ctx, saveId ?? "legacy", history);
    if (store.dayOne && JSON.stringify(next) === JSON.stringify(store.dayOne)) return;
    store.setNarrative({ history: history as Record<string, string[]> });
    store.setDayOne(next);
  }, [dayOne, year, ctx, saveId]);

  const say = (slot: Slot): string => {
    const id = dayOne?.year === year ? dayOne.picks[slot] : undefined;
    return (id && textFor(slot, id, ctx)) || "";
  };

  const players = useMemo(() => getPlayersByClub(myClub), [myClub]);
  const lines = useMemo(() => summariseLines(players, leagueAverageOvr()), [players]);

  const r1 = matchesInRound(fixture, 1);
  const r1Index = r1.findIndex((m) => m.homeClubId === club.ClubID || m.awayClubId === club.ClubID);
  const r1Match = r1[r1Index];
  const opp = r1Match ? clubById(r1Match.homeClubId === club.ClubID ? r1Match.awayClubId : r1Match.homeClubId) : undefined;
  const isHome = r1Match?.homeClubId === club.ClubID;
  const venue = r1Match ? groundForMatch(r1Match.homeClubId, 1, fixture).commonName : ctx.ground;
  const slot = season && r1Index >= 0 ? timeslotFor(season.seed, 1, r1Index).label.toUpperCase() : "TIME TBC";
  const lastMet = ctx.r1LastResult ? `Last met: ${ctx.r1LastResult}` : ctx.r1?.finish ? `${ctx.r1.nick} finished ${ctx.r1.finish} last year` : "";

  const done = dayOne?.year === year ? dayOne.done : {};
  const doneCount = TASKS.filter((t) => done[t.key]).length;
  const coachName = (coach?.name ?? ctx.coach).toUpperCase();
  const facts = [
    { k: "LAST SEASON", v: ctx.finish ?? "—" },
    { k: "LIST AVG OVR", v: ctx.listAvg.toFixed(1) },
    { k: "EXPECTATION", v: ctx.expectation },
  ];
  const inbox: { from: string; role: string; slot: Slot }[] = [
    { from: "Club President", role: "BOARD", slot: "inbox.president" },
    { from: ctx.captain?.name ?? "Captain", role: "CAPTAIN", slot: "inbox.captain" },
    { from: "List Manager", role: "FOOTBALL DEPT", slot: "inbox.listManager" },
    { from: "Head of Fitness", role: "FOOTBALL DEPT", slot: "inbox.fitness" },
    { from: "Senior Assistant", role: "FOOTBALL DEPT", slot: "inbox.assistant" },
  ];
  const messages = inbox.map((m) => ({ ...m, msg: say(m.slot) })).filter((m) => m.msg);
  const patience = ctx.patience;

  return (
    <div data-screen-label="4 Day one dashboard" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{`@media (max-width: 560px){ .d1-task{flex-direction:column!important;align-items:flex-start!important;gap:6px!important} }`}</style>
      <section style={{ ...card, padding: "18px 22px", display: "flex", alignItems: "center", gap: 20, flexWrap: "wrap" }}>
        <Tile id={club.abbreviation} size={64} font={22} />
        <div style={{ flex: "1 1 280px", minWidth: 0 }}>
          <div style={label}>
            SENIOR COACH · {coachName} · PRE-SEASON {year}
          </div>
          <h1 style={{ margin: "4px 0 2px", font: `700 38px/1 ${COND}`, color: "#fff" }}>
            {clubNameParts(club)[0]} <span style={{ color: "var(--accT)" }}>{club.nickname}</span>
          </h1>
          <div style={{ font: `400 14px ${BARLOW}`, color: "#aab3c3" }}>{say("dashSubline")}</div>
        </div>
        <div style={{ display: "flex", gap: 28, flexWrap: "wrap" }}>
          {facts.map((x) => (
            <div key={x.k}>
              <div style={{ font: `500 10px ${MONO}`, letterSpacing: "1.2px", color: "#9aa4b5" }}>{x.k}</div>
              <div style={{ font: `700 28px ${COND}`, color: "#fff" }}>{x.v}</div>
            </div>
          ))}
        </div>
      </section>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "stretch" }}>
        <section
          style={{
            flex: "2 1 540px",
            minWidth: 0,
            position: "relative",
            overflow: "hidden",
            background: "color-mix(in oklch, var(--deep) 55%, #10151f)",
            border: "1px solid color-mix(in oklch, var(--acc) 30%, transparent)",
            borderRadius: 16,
            padding: "22px 24px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <div style={{ ...label, color: "#b3bccb" }}>BEFORE ROUND 1 · YOUR FIRST WEEK</div>
            <div style={{ font: `600 12px ${MONO}`, color: "var(--accT)" }}>
              {doneCount} / {TASKS.length} DONE
            </div>
          </div>
          {TASKS.map((t) => {
            const ok = !!done[t.key];
            return (
              <div key={t.key} style={{ display: "flex", gap: 14, alignItems: "center", padding: "12px 14px", background: "rgba(0,0,0,.25)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 12 }}>
                <button
                  onClick={() => toggleTask(t.key)}
                  aria-pressed={ok}
                  aria-label={ok ? `Mark "${t.title}" not done` : `Mark "${t.title}" done`}
                  style={{
                    flex: "none",
                    width: 26,
                    height: 26,
                    borderRadius: 7,
                    border: `1.5px solid ${ok ? "var(--acc)" : "rgba(255,255,255,.25)"}`,
                    background: ok ? "var(--acc)" : "transparent",
                    color: "var(--on)",
                    font: `700 14px ${BARLOW}`,
                    cursor: "pointer",
                  }}
                >
                  {ok ? "✓" : ""}
                </button>
                <button className="d1-task" onClick={() => onGo(t.key)} style={{ minWidth: 0, flex: 1, display: "flex", alignItems: "center", gap: 14, background: "transparent", border: 0, padding: 0, textAlign: "left", cursor: "pointer" }}>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: "block", font: `700 17px ${COND}`, color: ok ? "#8f9ab0" : "#fff", textDecoration: ok ? "line-through" : "none", letterSpacing: ".3px" }}>{t.title}</span>
                    <span style={{ display: "block", font: `400 13px/1.4 ${BARLOW}`, color: "#aab3c3", textWrap: "pretty" }}>{say(`taskBlurb.${t.key}` as Slot)}</span>
                  </span>
                  <span style={{ flex: "none", font: `600 11px ${MONO}`, letterSpacing: ".8px", color: "var(--accT)" }}>{t.tab} →</span>
                </button>
              </div>
            );
          })}
        </section>

        <section style={{ ...card, flex: "1 1 300px", minWidth: 0, padding: "20px 22px", display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={label}>
            ROUND 1 · {slot} · {ctx.daysToR1} DAYS
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
              <Tile id={club.abbreviation} size={58} font={19} />
              <div style={{ font: `700 15px ${BARLOW}`, color: "#fff", textAlign: "center" }}>{club.name}</div>
            </div>
            <div style={{ font: `600 13px ${MONO}`, color: "#7e889a" }}>VS</div>
            {opp && (
              <div style={{ ...clubVarsByName(opp.name), flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                  <Tile id={opp.abbreviation} size={58} font={19} />
                  <div style={{ font: `700 15px ${BARLOW}`, color: "#fff", textAlign: "center" }}>{opp.name}</div>
                </div>
              </div>
            )}
          </div>
          <div style={{ font: `400 13px ${BARLOW}`, color: "#aab3c3", textAlign: "center" }}>
            {venue} · {isHome ? "Home" : "Away"}
            {lastMet ? ` · ${lastMet}` : ""}
          </div>
          <button onClick={() => onGo("start")} style={{ marginTop: "auto", background: "var(--acc)", color: "var(--on)", border: 0, borderRadius: 9, padding: "12px 18px", font: `700 15px ${BARLOW}`, cursor: "pointer" }}>
            Start the season
          </button>
        </section>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,420px),1fr))", gap: 16, alignItems: "start" }}>
        <section style={{ ...card, padding: "18px 20px", display: "flex", flexDirection: "column" }}>
          <div style={{ ...label, marginBottom: 6 }}>INBOX · {messages.length} NEW</div>
          {messages.map((m) => (
            <div key={m.slot} style={{ display: "flex", gap: 12, padding: "12px 0", borderTop: "1px solid rgba(255,255,255,.06)" }}>
              <div style={{ width: 8, height: 8, flex: "none", borderRadius: "50%", background: "var(--acc)", marginTop: 7 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ font: `600 15px ${BARLOW}`, color: "#eef2f8" }}>{m.from}</span>
                  <span style={{ font: `500 10px ${MONO}`, letterSpacing: "1px", color: "#8f9ab0", whiteSpace: "nowrap" }}>{m.role}</span>
                </div>
                <div style={{ font: `400 14px/1.45 ${BARLOW}`, color: "#b8c1cf", textWrap: "pretty" }}>{m.msg}</div>
              </div>
            </div>
          ))}
        </section>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <section style={{ ...card, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={label}>THE BOARD'S BRIEF</div>
            <div style={{ font: `700 26px/1.1 ${COND}`, color: "#fff", textWrap: "balance" }}>{say("boardBrief")}</div>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <span style={{ font: `600 10px ${MONO}`, letterSpacing: "1px", color: "#9aa4b5" }}>PATIENCE</span>
              <span style={{ flex: 1, height: 6, borderRadius: 3, background: "rgba(255,255,255,.08)", overflow: "hidden" }}>
                <span style={{ display: "block", height: "100%", width: `${(patience / 5) * 100}%`, background: "var(--acc)", borderRadius: 3 }} />
              </span>
              <span style={{ font: `600 12px ${MONO}`, color: "#dfe5ee" }}>{patience >= 4 ? "HIGH" : patience >= 3 ? "MEDIUM" : "LOW"}</span>
            </div>
            <div style={{ font: `500 12px ${MONO}`, color: "#8f9ab0" }}>
              {ctx.expectation.toUpperCase()} · {ctx.contractYears}-YEAR DEAL
            </div>
          </section>
          <section style={{ ...card, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={label}>LINE RATINGS VS LEAGUE</div>
            {lines.map((l) => {
              const d = l.gapToLeague;
              const col = d > 1.5 ? RISE : d < -1.5 ? FALL : WARN;
              return (
                <div key={l.line} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ font: `700 15px ${COND}`, color: "#fff" }}>
                      {l.line} <span style={{ font: `500 12px ${BARLOW}`, color: "#8f9ab0" }}>({l.players.length})</span>
                    </span>
                    <span style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                      <span style={{ font: `600 13px ${MONO}`, color: "#fff" }}>{l.avgOvr.toFixed(1)}</span>
                      <span style={{ font: `600 11px ${MONO}`, color: col, background: "rgba(255,255,255,.05)", padding: "2px 6px", borderRadius: 4 }}>
                        {d > 0 ? "+" : ""}
                        {d.toFixed(1)}
                      </span>
                    </span>
                  </div>
                  <div style={{ height: 5, borderRadius: 3, background: "rgba(255,255,255,.07)", overflow: "hidden" }}>
                    <div style={{ width: `${Math.min(100, l.avgOvr * 1.4)}%`, height: "100%", background: "var(--acc)", borderRadius: 3 }} />
                  </div>
                </div>
              );
            })}
          </section>
        </div>
      </div>
    </div>
  );
}
