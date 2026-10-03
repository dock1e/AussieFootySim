import { useEffect, useMemo, type CSSProperties, type ReactNode } from "react";
import { useGameStore } from "../store/useGameStore";
import { useSaveStore } from "../store/useSaveStore";
import { useCareerStore, DEFAULT_COACH_NAME } from "../store/useCareerStore";
import { clubByName } from "../types/club";
import { defaultClubFinanceState, type ClubFinanceSeasonRecord } from "../types/clubFinance";
import { financeMilestones, historyOf, leagueStandingFor, moneyShort } from "../engine/clubFinance";
import { MEANING_TOKENS, clubTokensFor } from "../theme/clubTokens";
import { clubThemeStyle } from "../theme/useClubTheme";
import { BARLOW, COND, MONO } from "./matchday/shared";
import { Confetti } from "./splash/BigGameSplash";
import { FINANCE_LABEL, ON_FIELD_LABEL, chairNote, confidenceLabel, reviewHeadline } from "../narrative/annualReport";
import { contractEndYear } from "../engine/boardReview";
import { JobMarket } from "./JobMarket";
import { changesInYear } from "../engine/seniorCoaches";

/**
 * ROADMAP #14 — the Annual Report ceremony. Shown once, full screen, the first time the app is open
 * after an off-season closes the coach's books (the newest `sim` history row is newer than
 * `annualReportSeenYear`). It reads that row and nothing else: the season's revenue, result, members
 * and net assets against the year before, where the club now ranks in the AFL, the milestones it hit,
 * and the board's verdict and confidence. Same visual language as the Big Game Splash (club colours,
 * confetti on a good year, Space or Continue to close).
 */

const RISE = MEANING_TOKENS.rise;
const FALL = MEANING_TOKENS.fall;

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${s}`;
}

/**
 * Mounted once in App. Shows the unseen Annual Report if there is one; otherwise, if the board has
 * sacked the coach or let the contract lapse, the job market (which can't be dismissed — the coach
 * takes a job or retires to a new game).
 */
export function AnnualReportHost({ onOpenHistory, onRetire }: { onOpenHistory: () => void; onRetire: () => void }) {
  const myClub = useGameStore((s) => s.myClub);
  const clubFinance = useSaveStore((s) => s.clubFinance);
  const markSeen = useSaveStore((s) => s.markAnnualReportSeen);
  const unemployed = useCareerStore((s) => s.coach?.unemployedSince !== undefined);
  const state = clubFinance[myClub] ?? defaultClubFinanceState();
  const history = historyOf(state);
  const latest = history.at(-1);
  if (!latest || latest.source !== "sim" || (state.annualReportSeenYear ?? 0) >= latest.year) {
    return unemployed ? <JobMarket onRetire={onRetire} /> : null;
  }
  return (
    <AnnualReport
      row={latest}
      previous={history.at(-2) ?? null}
      nextMembers={state.members}
      history={history}
      onContinue={() => markSeen(latest.year)}
      onOpenHistory={() => {
        markSeen(latest.year);
        onOpenHistory();
      }}
    />
  );
}

function Delta({ now, before, fmt }: { now: number | undefined; before: number | undefined; fmt: (n: number) => string }) {
  if (now === undefined || before === undefined) return null;
  const d = now - before;
  return <span style={{ font: `600 12px ${MONO}`, color: d >= 0 ? RISE : FALL }}>{`${d >= 0 ? "▲" : "▼"} ${fmt(Math.abs(d))}`}</span>;
}

function Stat({ label, value, children, color }: { label: string; value: string; children?: ReactNode; color?: string }) {
  return (
    <div style={{ background: "rgba(0,0,0,.3)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12, padding: "12px 14px", minWidth: 0 }}>
      <div style={{ font: `600 10px ${MONO}`, letterSpacing: "1.4px", color: "#aab3c3", textTransform: "uppercase" }}>{label}</div>
      <div style={{ font: `700 32px/1.05 ${COND}`, color: color ?? "#fff", marginTop: 4 }}>{value}</div>
      <div style={{ minHeight: 16 }}>{children}</div>
    </div>
  );
}

export function AnnualReport({
  row,
  previous,
  nextMembers,
  history,
  onContinue,
  onOpenHistory,
}: {
  row: ClubFinanceSeasonRecord;
  previous: ClubFinanceSeasonRecord | null;
  /** Next season's membership, already moved by this season's results — what the coach's year actually did to the member base. */
  nextMembers: number | undefined;
  history: readonly ClubFinanceSeasonRecord[];
  onContinue: () => void;
  onOpenHistory: () => void;
}) {
  const myClub = useGameStore((s) => s.myClub);
  const clubFinance = useSaveStore((s) => s.clubFinance);
  const coach = useCareerStore((s) => s.coach);
  const seniorCoaches = useSaveStore((s) => s.seniorCoaches);
  const coachingChanges = changesInYear(seniorCoaches, row.year);
  const coachName = coach?.name ?? DEFAULT_COACH_NAME;
  const abbr = clubByName(myClub)?.abbreviation;
  const milestones = useMemo(() => financeMilestones(history, myClub, clubFinance).filter((m) => m.year === row.year), [history, myClub, clubFinance, row.year]);
  const standing = leagueStandingFor(clubFinance, myClub);
  const note = chairNote(row, myClub, coachName);
  const board = row.board;
  const lostJob = board?.review === "sacked" || board?.review === "notRenewed";
  const goodYear = !lostJob && (milestones.length > 0 || (board !== undefined && board.onField !== "missed" && (board.finance === "record" || board.finance === "ahead")));
  const reducedMotion = useMemo(() => {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if ((e.code === "Space" || e.code === "Escape") && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        onContinue();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onContinue]);

  const page: CSSProperties = {
    ...clubThemeStyle(clubTokensFor(abbr)),
    position: "fixed",
    inset: 0,
    zIndex: 60,
    overflowY: "auto",
    background: "radial-gradient(120% 80% at 50% 0%, color-mix(in oklch, var(--deep) 75%, #0b0f17) 0, #0b0f17 70%)",
    color: "#fff",
  };
  const button = (primary: boolean): CSSProperties => ({
    border: primary ? 0 : "1px solid rgba(255,255,255,.25)",
    borderRadius: 10,
    padding: "11px 20px",
    font: `700 14px ${BARLOW}`,
    cursor: "pointer",
    background: primary ? "var(--acc)" : "transparent",
    color: primary ? "var(--on)" : "#fff",
  });
  const anim = (i: number): CSSProperties => (reducedMotion ? {} : { animation: `afs-up .5s ease ${0.12 * i}s both` });

  return (
    <div role="dialog" aria-modal="true" aria-label={`${row.year} Annual Report`} style={page}>
      <style>{`@keyframes afs-up{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}@keyframes afs-fall{0%{transform:translate3d(0,-10vh,0) rotate(0)}100%{transform:translate3d(var(--dx),110vh,0) rotate(var(--rot))}}`}</style>
      {goodYear && !reducedMotion && <Confetti colors={["var(--acc)", "#ffffff", "#e8c25a"]} />}
      <div style={{ position: "relative", zIndex: 6, maxWidth: 920, margin: "0 auto", padding: "40px 16px 48px", display: "flex", flexDirection: "column", gap: 22 }}>
        <div style={anim(0)}>
          <div style={{ font: `600 11px ${MONO}`, letterSpacing: "2px", color: "var(--accT)" }}>ANNUAL REPORT · YEAR ENDED 31 OCTOBER {row.year}</div>
          <div style={{ font: `700 clamp(36px, 7vw, 60px)/1 ${COND}`, marginTop: 6 }}>{myClub}</div>
          <div style={{ font: `500 15px ${BARLOW}`, color: "#c3cbd8", marginTop: 6 }}>
            {row.ladderRank ? `Finished ${ordinal(row.ladderRank)}${row.premiers ? " · Premiers" : row.madeFinals ? " · Finals" : ""}` : "Season complete"} · Senior coach {coachName}
          </div>
        </div>

        {note.length > 0 && (
          <blockquote style={{ ...anim(1), margin: 0, padding: "16px 18px", borderLeft: "3px solid var(--acc)", background: "rgba(255,255,255,.04)", borderRadius: "0 12px 12px 0" }}>
            {note.map((line) => (
              <p key={line} style={{ margin: "0 0 6px", font: `500 16px/1.5 ${BARLOW}`, color: "#eef2f8" }}>
                {line}
              </p>
            ))}
            <div style={{ font: `600 11px ${MONO}`, letterSpacing: "1.2px", color: "#8f9ab0", marginTop: 6 }}>— THE CHAIR, ON BEHALF OF THE BOARD</div>
          </blockquote>
        )}

        {board?.review && board.review !== "secure" && (
          <div
            role="status"
            style={{
              ...anim(1),
              padding: "14px 16px",
              borderRadius: 12,
              border: `1px solid ${board.review === "renewed" ? RISE : FALL}`,
              background: board.review === "renewed" ? "rgba(79,214,154,.08)" : "rgba(255,163,122,.08)",
            }}
          >
            <div style={{ font: `600 10px ${MONO}`, letterSpacing: "1.4px", color: board.review === "renewed" ? RISE : FALL }}>{reviewHeadline(board.review).tag}</div>
            <div style={{ font: `600 16px/1.45 ${BARLOW}`, color: "#fff", marginTop: 4 }}>{reviewHeadline(board.review, { years: board.renewedYears, through: row.year + (board.renewedYears ?? 0), club: myClub }).text}</div>
          </div>
        )}
        {board?.review === "secure" && coach && (
          <div style={{ ...anim(1), font: `500 13px ${BARLOW}`, color: "#aab3c3" }}>Your contract runs through the {contractEndYear(coach, row.year + 1)} season.</div>
        )}

        <div style={{ ...anim(2), display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>
          <Stat label="Revenue" value={moneyShort(row.revenue)}>
            <Delta now={row.revenue} before={previous?.revenue} fmt={moneyShort} />
          </Stat>
          <Stat label="Operating result" value={`${row.result >= 0 ? "+" : ""}${moneyShort(row.result)}`} color={row.result >= 0 ? RISE : FALL}>
            <Delta now={row.result} before={previous?.result} fmt={moneyShort} />
          </Stat>
          <Stat label={`Members for ${row.year + 1}`} value={(nextMembers ?? row.members)?.toLocaleString("en-AU") ?? "—"}>
            <Delta now={nextMembers} before={row.members} fmt={(n) => n.toLocaleString("en-AU")} />
          </Stat>
          <Stat label="Net assets" value={row.netAssets !== undefined ? moneyShort(row.netAssets) : "—"}>
            <Delta now={row.netAssets} before={previous?.netAssets} fmt={moneyShort} />
          </Stat>
        </div>

        <div style={{ ...anim(3), display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))", gap: 12 }}>
          {board && (
            <div style={{ background: "rgba(0,0,0,.3)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12, padding: "14px 16px" }}>
              <div style={{ font: `600 10px ${MONO}`, letterSpacing: "1.4px", color: "#aab3c3" }}>BOARD CONFIDENCE</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 4 }}>
                <span style={{ font: `700 40px/1 ${COND}` }}>{board.confidence}</span>
                <span style={{ font: `600 15px ${BARLOW}`, color: "var(--accT)" }}>{confidenceLabel(board.confidence)}</span>
                <span style={{ font: `600 13px ${MONO}`, color: board.delta >= 0 ? RISE : FALL }}>{`${board.delta >= 0 ? "+" : ""}${board.delta}`}</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,.1)", marginTop: 10, overflow: "hidden" }}>
                <div style={{ width: `${board.confidence}%`, height: "100%", background: "var(--acc)" }} />
              </div>
              <div style={{ font: `500 13px ${BARLOW}`, color: "#c3cbd8", marginTop: 10 }}>
                On field: <b style={{ color: board.onField === "missed" ? FALL : RISE }}>{ON_FIELD_LABEL[board.onField]}</b> · Finances:{" "}
                <b style={{ color: board.finance === "below" || board.finance === "heavyLoss" ? FALL : RISE }}>{FINANCE_LABEL[board.finance]}</b>
              </div>
            </div>
          )}
          {standing && (
            <div style={{ background: "rgba(0,0,0,.3)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 12, padding: "14px 16px" }}>
              <div style={{ font: `600 10px ${MONO}`, letterSpacing: "1.4px", color: "#aab3c3" }}>ACROSS THE AFL</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8, font: `500 14px ${BARLOW}`, color: "#eef2f8" }}>
                <span>Revenue: <b>{ordinal(standing.revenueRank)}</b></span>
                <span>Members: <b>{ordinal(standing.membersRank)}</b></span>
                <span>Result: <b>{ordinal(standing.resultRank)}</b></span>
                <span>Net assets: <b>{ordinal(standing.netAssetsRank)}</b></span>
              </div>
              {row.allocation !== undefined && (
                <div style={{ font: `500 13px ${BARLOW}`, color: "#c3cbd8", marginTop: 10 }}>
                  The board has put <b style={{ color: "var(--accT)" }}>{moneyShort(row.allocation)}</b> into the Football Dept budget for next season.
                </div>
              )}
            </div>
          )}
        </div>

        {milestones.length > 0 && (
          <div style={{ ...anim(4), display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ font: `600 10px ${MONO}`, letterSpacing: "1.4px", color: "#e8c25a" }}>MILESTONES THIS YEAR</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {milestones.map((m, i) => (
                <span key={`${m.kind}-${i}`} style={{ padding: "7px 12px", borderRadius: 999, border: "1px solid #e8c25a", color: "#fff3c4", font: `600 13px ${BARLOW}`, background: "rgba(232,194,90,.08)" }}>
                  ★ {m.label}
                </span>
              ))}
            </div>
          </div>
        )}

        {coachingChanges.length > 0 && (
          <div style={{ ...anim(4), display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ font: `600 10px ${MONO}`, letterSpacing: "1.4px", color: "#aab3c3" }}>COACHING CHANGES AROUND THE AFL</div>
            {coachingChanges.map((ch, i) => (
              <div key={`${ch.club}-${i}`} style={{ font: `500 14px ${BARLOW}`, color: "#dfe5ee" }}>
                <b style={{ color: "#fff" }}>{ch.club}</b>
                {ch.outgoing && ` ${ch.reason === "notRenewed" ? "didn't renew" : ch.reason === "replaced" ? "moved on" : "sacked"} ${ch.outgoing}`}
                {ch.incoming ? `${ch.outgoing ? "; " : " "}appointed ${ch.incoming === "you" ? coachName : ch.incoming}` : ch.outgoing ? "; the job is open" : ""}
              </div>
            ))}
          </div>
        )}

        <div style={{ ...anim(5), display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button type="button" style={button(true)} onClick={onContinue} autoFocus>
            {board?.review === "sacked" || board?.review === "notRenewed" ? "See who's hiring" : "Continue"}
          </button>
          <button type="button" style={button(false)} onClick={onOpenHistory}>
            See club history
          </button>
        </div>
      </div>
    </div>
  );
}
