import { useState } from "react";
import { Card, HeroCard, SectionLabel, Segmented, Watermark, BarSolidGhost } from "./theme/primitives";
import { useGameStore } from "../store/useGameStore";
import { useSaveStore } from "../store/useSaveStore";
import { ALL_PLAYERS } from "../data/loadPlayers";
import { SALARY_CAP, committedWages } from "../engine/contracts";
import { ASP_CLUB_LIMIT_PER_SEASON, FOOTBALL_DEPT_BASE_ALLOCATION, FOOTBALL_DEPT_SURPLUS_SHARE, aspAgreementsOf, aspCommittedForSeason, historyOf, moneyShort, projectedExpenseBreakdown, projectedRevenueBreakdown } from "../engine/clubFinance";
import { defaultClubFinanceState, type ClubFinanceState } from "../types/clubFinance";
import { playerFullName } from "../types/player";
import { Facilities } from "./Facilities";
import { AssistantCoaches } from "./AssistantCoaches";
import { Marketing } from "./Marketing";
import { ClubHistory } from "./ClubHistory";

/**
 * Round 122 — [[Club Finance, Facilities, and Marketing]] part 2. The Football Department screen,
 * unified into the sub-tabs Tyler's own uploaded UI redesign names: Overview, Assistant Coaches,
 * Facilities and Marketing — plus, from ROADMAP #14, Club History (the career "pride" view: every
 * season's books, milestones, and the board's verdict; see `ClubHistory.tsx`).
 *
 * ROADMAP #14 also moved the money onto a real scale: the header's "Projected result" is the club's
 * whole operating result (tens of millions in, tens of millions out, calibrated against its real 2025
 * annual report), while "Cash to invest" is still the Football Dept's discretionary budget — the board's
 * allocation out of that result, which is what Facilities and Marketing spend.
 *
 * The Additional Service Payments retention lever (the design note's section 4) is negotiated in
 * Contracts.tsx; its ongoing cost to this budget shows on the Overview (AspCard).
 */
export type FootballDeptTab = "overview" | "history" | "coaching" | "facilities" | "marketing";

const TABS: { value: FootballDeptTab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "history", label: "Club History" },
  { value: "coaching", label: "Assistant Coaches" },
  { value: "facilities", label: "Facilities" },
  { value: "marketing", label: "Marketing" },
];

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-AU")}`;
}

export function FootballDept({ initialTab = "overview" }: { initialTab?: FootballDeptTab }) {
  const [tab, setTab] = useState<FootballDeptTab>(initialTab);
  const myClub = useGameStore((s) => s.myClub);
  const clubFinance = useSaveStore((s) => s.clubFinance);
  const currentYear = useSaveStore((s) => s.year);
  const state = clubFinance[myClub] ?? defaultClubFinanceState();

  const revenueRows = projectedRevenueBreakdown(myClub, state);
  const expenseRows = projectedExpenseBreakdown(ALL_PLAYERS, myClub, currentYear, state);
  const totalRevenue = revenueRows.reduce((sum, r) => sum + r.value, 0);
  const totalExpense = expenseRows.reduce((sum, r) => sum + r.value, 0);
  const projectedResult = totalRevenue - totalExpense;

  return (
    <div className="flex flex-col gap-5">
      <HeroCard style={{ display: "flex", gap: 22, alignItems: "center", flexWrap: "wrap" }}>
        <Watermark>FD</Watermark>
        <div style={{ position: "relative", flex: "2 1 260px", minWidth: 0 }}>
          <SectionLabel>Football Department · {currentYear} season</SectionLabel>
          <div style={{ font: "700 30px/1.05 'Barlow Condensed',sans-serif", color: "#fff", marginTop: 3 }}>
            {myClub} <span style={{ color: "var(--accT)" }}>operations</span>
          </div>
        </div>
        <div style={{ position: "relative", flex: "1 1 150px" }}>
          <SectionLabel>Cash to invest</SectionLabel>
          <div style={{ font: "700 28px/1.1 'Barlow Condensed',sans-serif", color: "var(--accT)" }}>{money(state.budget)}</div>
          <div style={{ font: "500 12px Barlow,sans-serif", color: "#aab3c3" }}>Football Dept budget</div>
        </div>
        <div style={{ position: "relative", flex: "1 1 150px" }}>
          <SectionLabel>Projected result</SectionLabel>
          <div style={{ font: "700 28px/1.1 'Barlow Condensed',sans-serif", color: projectedResult >= 0 ? "#c4ecd8" : "#f4b8b8" }}>
            {projectedResult >= 0 ? "+" : ""}
            {moneyShort(projectedResult)}
          </div>
          <div style={{ font: "500 12px Barlow,sans-serif", color: "#aab3c3" }}>club operating result, before ladder &amp; finals</div>
        </div>
      </HeroCard>

      <Segmented options={TABS} value={tab} onChange={setTab} />

      {tab === "overview" && (
        <Overview
          revenueRows={revenueRows}
          expenseRows={expenseRows}
          totalRevenue={totalRevenue}
          totalExpense={totalExpense}
          myClub={myClub}
          budget={state.budget}
          members={state.members}
          lastAllocation={historyOf(state).at(-1)?.allocation}
          finance={state}
          onGoToFacilities={() => setTab("facilities")}
          onGoToMarketing={() => setTab("marketing")}
          onGoToHistory={() => setTab("history")}
        />
      )}
      {tab === "history" && <ClubHistory />}
      {tab === "coaching" && <AssistantCoaches />}
      {tab === "facilities" && <Facilities />}
      {tab === "marketing" && <Marketing />}
    </div>
  );
}

const linkButton = { background: "none", border: 0, padding: 0, color: "var(--accT)", font: "600 13px Barlow,sans-serif", cursor: "pointer" } as const;

/**
 * This season's projected P&L at real scale (`engine/clubFinance.ts`'s `projectedRevenueBreakdown`/
 * `projectedExpenseBreakdown`), how the Football Dept budget is funded, and the one real cap this
 * engine tracks (`committedWages` vs `SALARY_CAP`).
 */
function Overview({
  revenueRows,
  expenseRows,
  totalRevenue,
  totalExpense,
  myClub,
  budget,
  members,
  lastAllocation,
  finance,
  onGoToFacilities,
  onGoToMarketing,
  onGoToHistory,
}: {
  revenueRows: { label: string; value: number }[];
  expenseRows: { label: string; value: number }[];
  totalRevenue: number;
  totalExpense: number;
  myClub: string;
  budget: number;
  members: number | undefined;
  lastAllocation: number | undefined;
  finance: ClubFinanceState;
  onGoToFacilities: () => void;
  onGoToMarketing: () => void;
  onGoToHistory: () => void;
}) {
  const currentYear = useSaveStore((s) => s.year);
  const wages = committedWages(ALL_PLAYERS, myClub, currentYear);
  const capFraction = Math.min(1, wages / SALARY_CAP);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))", gap: 12, alignItems: "start" }}>
      <BreakdownCard title="Revenue · projected" rows={revenueRows} total={totalRevenue} note="Ladder finish, finals and a premiership add to this when the season ends (up to about +$5m)." />
      <BreakdownCard title="Expenses · projected" rows={expenseRows} total={totalExpense} note="Player payments are your live wage bill. A leaner list is a bigger result." />
      <Card padding="16px 18px" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <SectionLabel>Members & the Football Dept budget</SectionLabel>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ font: "700 30px/1 'Barlow Condensed',sans-serif", color: "#fff" }}>{members?.toLocaleString("en-AU") ?? "—"}</span>
          <span style={{ font: "500 13px Barlow,sans-serif", color: "#aab3c3" }}>members this season</span>
        </div>
        <div style={{ font: "500 13px/1.5 Barlow,sans-serif", color: "#c3ccdd" }}>
          Membership grows with ladder finishes, finals, a premiership, the Members &amp; Match-Day Experience facility and membership campaigns, and shrinks in bad years.
          Each off-season the board gives the Football Dept {money(FOOTBALL_DEPT_BASE_ALLOCATION)} plus {Math.round(FOOTBALL_DEPT_SURPLUS_SHARE * 100)}% of any surplus, plus all your campaign returns.
          {lastAllocation !== undefined ? ` Last off-season that came to ${money(lastAllocation)}.` : ""}
        </div>
        <div style={{ font: "500 13px Barlow,sans-serif", color: "#c3ccdd" }}>
          {budget > 0 ? `${money(budget)} available to spend right now.` : "No Football Dept budget available right now."}
        </div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <button type="button" onClick={onGoToFacilities} style={linkButton}>
            Upgrade facilities →
          </button>
          <button type="button" onClick={onGoToMarketing} style={linkButton}>
            Launch a campaign →
          </button>
          <button type="button" onClick={onGoToHistory} style={linkButton}>
            Club history →
          </button>
        </div>
      </Card>
      <AspCard finance={finance} year={currentYear} />
      <Card padding="16px 18px" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <SectionLabel>Caps</SectionLabel>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ font: "600 14px Barlow,sans-serif", color: "#eef2f8" }}>Player payments vs salary cap</span>
          <span style={{ font: "600 12px 'IBM Plex Mono',monospace", color: "#fff" }}>
            {money(wages)} / {money(SALARY_CAP)}
          </span>
        </div>
        <BarSolidGhost solid={capFraction} ghost={1} />
        <div style={{ font: "500 12px Barlow,sans-serif", color: "#8f9ab0" }}>
          Assistant coach salaries are capped separately on the Assistant Coaches tab, and are already inside the club's football operations costs above.
        </div>
      </Card>
    </div>
  );
}

function BreakdownCard({ title, rows, total, note }: { title: string; rows: { label: string; value: number }[]; total: number; note?: string }) {
  return (
    <Card padding="16px 18px">
      <SectionLabel style={{ marginBottom: 6 }}>{title}</SectionLabel>
      {rows.map((row) => (
        <div key={row.label} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0" }}>
          <span style={{ font: "500 14px Barlow,sans-serif", color: "#dfe5ee" }}>{row.label}</span>
          <span style={{ font: "600 13px 'IBM Plex Mono',monospace", color: "#fff", textAlign: "right" }}>{money(row.value)}</span>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 10, marginTop: 4, borderTop: "1px solid rgba(255,255,255,.1)" }}>
        <span style={{ font: "700 14px Barlow,sans-serif", color: "#fff" }}>Total</span>
        <span style={{ font: "700 14px 'IBM Plex Mono',monospace", color: "#fff" }}>{money(total)}</span>
      </div>
      {note && <div style={{ font: "500 12px Barlow,sans-serif", color: "#8f9ab0", marginTop: 8 }}>{note}</div>}
    </Card>
  );
}

/**
 * ROADMAP #14 — the club's off-cap Additional Service Payments: who's on one, how much, until when, and
 * how much of the season limit is used. Agreements are made in the Contracts negotiation; this card is
 * where their ongoing cost to the Football Dept budget shows up.
 */
function AspCard({ finance, year }: { finance: ClubFinanceState; year: number }) {
  const agreements = aspAgreementsOf(finance);
  const thisSeason = aspCommittedForSeason(finance, year);
  const nextSeason = aspCommittedForSeason(finance, year + 1);
  return (
    <Card padding="16px 18px" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <SectionLabel>Additional Service Payments · off-cap</SectionLabel>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ font: "600 14px Barlow,sans-serif", color: "#eef2f8" }}>This season vs club limit</span>
        <span style={{ font: "600 12px 'IBM Plex Mono',monospace", color: "#fff" }}>
          {money(thisSeason)} / {money(ASP_CLUB_LIMIT_PER_SEASON)}
        </span>
      </div>
      <BarSolidGhost solid={Math.min(1, thisSeason / ASP_CLUB_LIMIT_PER_SEASON)} ghost={1} />
      {agreements.length === 0 ? (
        <div style={{ font: "500 13px/1.5 Barlow,sans-serif", color: "#aab3c3" }}>
          None yet. When the cap won&apos;t fit a player you want to keep, add an off-cap top-up in the Contracts negotiation. It&apos;s paid from this budget.
        </div>
      ) : (
        agreements.map((a) => {
          const p = ALL_PLAYERS.find((x) => x.PlayerID === a.playerId);
          return (
            <div key={a.playerId} style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
              <span style={{ font: "500 14px Barlow,sans-serif", color: "#dfe5ee" }}>{p ? playerFullName(p) : `Player ${a.playerId}`}</span>
              <span style={{ font: "600 13px 'IBM Plex Mono',monospace", color: "#fff" }}>
                {money(a.amountPerYear)}/yr to {a.endYear}
              </span>
            </div>
          );
        })
      )}
      {nextSeason > 0 && (
        <div style={{ font: "500 12px Barlow,sans-serif", color: "#8f9ab0" }}>{money(nextSeason)} comes out of the budget at the end of this season for next season&apos;s payments.</div>
      )}
    </Card>
  );
}