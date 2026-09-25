import { useState } from "react";
import { Card, HeroCard, SectionLabel, Segmented, Watermark, BarSolidGhost } from "./theme/primitives";
import { useGameStore } from "../store/useGameStore";
import { useSaveStore } from "../store/useSaveStore";
import { ALL_PLAYERS } from "../data/loadPlayers";
import { SALARY_CAP, committedWages } from "../engine/contracts";
import { projectedExpenseBreakdown, projectedRevenueBreakdown } from "../engine/clubFinance";
import { defaultClubFinanceState } from "../types/clubFinance";
import { Facilities } from "./Facilities";
import { AssistantCoaches } from "./AssistantCoaches";
import { Marketing } from "./Marketing";

/**
 * Round 122 — [[Club Finance, Facilities, and Marketing]] part 2. The Football Department screen,
 * unified into the 4 sub-tabs Tyler's own uploaded UI redesign names: Overview, Assistant Coaches
 * (renamed from "Coaching & Scouting"), Facilities (round 121, unchanged mechanically), and Marketing
 * (new this round — see `Marketing.tsx`/`types/marketing.ts`). Matches the reference mockup's own
 * `fd.tabs` shape: one shared header (cash to invest, projected result) persists across every sub-tab,
 * so the budget figure isn't repeated per-tab the way round 121's standalone `Facilities` screen showed
 * it.
 *
 * The Additional Service Payments retention lever (the design note's own section 4) is still NOT built
 * — deliberately out of scope for this round too, since Tyler's ask this round named only these 4
 * sub-tabs. It lives inside `Contracts.tsx`'s negotiation flow when it eventually gets built, not here.
 */
type FootballDeptTab = "overview" | "coaching" | "facilities" | "marketing";

const TABS: { value: FootballDeptTab; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "coaching", label: "Assistant Coaches" },
  { value: "facilities", label: "Facilities" },
  { value: "marketing", label: "Marketing" },
];

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-AU")}`;
}

export function FootballDept() {
  const [tab, setTab] = useState<FootballDeptTab>("overview");
  const myClub = useGameStore((s) => s.myClub);
  const clubFinance = useSaveStore((s) => s.clubFinance);
  const currentYear = useSaveStore((s) => s.year);
  const seasonArchives = useSaveStore((s) => s.seasonArchives);
  const state = clubFinance[myClub] ?? defaultClubFinanceState();

  const revenueRows = projectedRevenueBreakdown(myClub, state, seasonArchives);
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
          <div style={{ font: "500 12px Barlow,sans-serif", color: "#aab3c3" }}>discretionary budget</div>
        </div>
        <div style={{ position: "relative", flex: "1 1 150px" }}>
          <SectionLabel>Projected result</SectionLabel>
          <div style={{ font: "700 28px/1.1 'Barlow Condensed',sans-serif", color: projectedResult >= 0 ? "#c4ecd8" : "#f4b8b8" }}>
            {projectedResult >= 0 ? "+" : ""}
            {money(projectedResult)}
          </div>
          <div style={{ font: "500 12px Barlow,sans-serif", color: "#aab3c3" }}>revenue minus expenses, this season</div>
        </div>
      </HeroCard>

      <Segmented options={TABS} value={tab} onChange={setTab} />

      {tab === "overview" && <Overview revenueRows={revenueRows} expenseRows={expenseRows} totalRevenue={totalRevenue} totalExpense={totalExpense} myClub={myClub} budget={state.budget} onGoToFacilities={() => setTab("facilities")} onGoToMarketing={() => setTab("marketing")} />}
      {tab === "coaching" && <AssistantCoaches />}
      {tab === "facilities" && <Facilities />}
      {tab === "marketing" && <Marketing />}
    </div>
  );
}

/**
 * The design note's own budget forecast — real revenue/expense breakdowns (`engine/clubFinance.ts`'s
 * `projectedRevenueBreakdown`/`projectedExpenseBreakdown`) plus the one real cap this engine actually
 * tracks (`committedWages` vs `SALARY_CAP`). The reference mockup also shows a "coaching & scouting vs
 * staff budget" cap — deliberately NOT built here: this round's research confirmed no coach-salary
 * concept exists anywhere in the engine (`types/coach.ts`'s `Coach` has no `salary` field, hiring one is
 * currently free), so a second cap bar would have nothing real to measure against. Disclosed as a gap
 * rather than fabricated — a real coach-cost model is future work, not this round's.
 */
function Overview({
  revenueRows,
  expenseRows,
  totalRevenue,
  totalExpense,
  myClub,
  budget,
  onGoToFacilities,
  onGoToMarketing,
}: {
  revenueRows: { label: string; value: number }[];
  expenseRows: { label: string; value: number }[];
  totalRevenue: number;
  totalExpense: number;
  myClub: string;
  budget: number;
  onGoToFacilities: () => void;
  onGoToMarketing: () => void;
}) {
  const currentYear = useSaveStore((s) => s.year);
  const wages = committedWages(ALL_PLAYERS, myClub, currentYear);
  const capFraction = Math.min(1, wages / SALARY_CAP);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))", gap: 12, alignItems: "start" }}>
      <BreakdownCard title="Revenue · projected" rows={revenueRows} total={totalRevenue} />
      <BreakdownCard title="Expenses · projected" rows={expenseRows} total={totalExpense} />
      <Card padding="16px 18px" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <SectionLabel>Where to spend it</SectionLabel>
        <div style={{ font: "500 13px/1.5 Barlow,sans-serif", color: "#c3ccdd" }}>
          {budget > 0 ? `${money(budget)} sitting in the discretionary budget right now.` : "No discretionary budget available this season."}
        </div>
        <div style={{ display: "flex", gap: 16 }}>
          <button type="button" onClick={onGoToFacilities} style={{ background: "none", border: 0, padding: 0, color: "var(--accT)", font: "600 13px Barlow,sans-serif", cursor: "pointer" }}>
            Upgrade facilities →
          </button>
          <button type="button" onClick={onGoToMarketing} style={{ background: "none", border: 0, padding: 0, color: "var(--accT)", font: "600 13px Barlow,sans-serif", cursor: "pointer" }}>
            Launch a campaign →
          </button>
        </div>
      </Card>
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
          Coaching &amp; scouting staff have no real salary cost in this engine yet — that cap isn't shown here rather
          than being invented.
        </div>
      </Card>
    </div>
  );
}

function BreakdownCard({ title, rows, total }: { title: string; rows: { label: string; value: number }[]; total: number }) {
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
    </Card>
  );
}
