import { Card, SectionLabel, Pips, StatusChip, HeroCard, Watermark } from "./theme/primitives";
import { useGameStore } from "../store/useGameStore";
import { useSaveStore } from "../store/useSaveStore";
import { facilityLevel, facilityUpgradeCost } from "../engine/clubFinance";
import { FACILITY_DEFS, defaultClubFinanceState, type FacilityCategory, type FacilityDef } from "../types/clubFinance";

/**
 * Round 121 — [[Club Finance, Facilities, and Marketing]]. The Facilities sub-tab of the Football
 * Department: `myClub`'s discretionary budget plus all 13 facilities, grouped into the same 4
 * categories the design note and `types/clubFinance.ts` use (Training/Recovery/Development/
 * Commercial). Marketing campaigns and the ASP retention lever are deliberately NOT here — see the
 * design note's "Club Finance + Facilities first" split; this screen is Facilities only.
 *
 * Every facility card honestly discloses whether its effect is actually wired into the engine yet
 * (`FacilityDef.wired`) — a `wired: false` facility still shows a real level, cost, and upgrade
 * button (its money and persisted level are completely real), it just says so in its effect line
 * rather than implying a payoff nothing in the engine currently reads.
 */
const CATEGORY_ORDER: FacilityCategory[] = ["Training", "Recovery", "Development", "Commercial"];

function money(n: number): string {
  return `$${n.toLocaleString("en-AU")}`;
}

export function Facilities() {
  const myClub = useGameStore((s) => s.myClub);
  const clubFinance = useSaveStore((s) => s.clubFinance);
  const upgradeFacility = useSaveStore((s) => s.upgradeFacility);
  const state = clubFinance[myClub] ?? defaultClubFinanceState();

  return (
    <div className="flex flex-col gap-5">
      <HeroCard style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
        <Watermark>FAC</Watermark>
        <div style={{ position: "relative" }}>
          <SectionLabel>Football Department Budget</SectionLabel>
          <div style={{ font: "700 40px/1.1 'Barlow Condensed',sans-serif", color: "#fff", marginTop: 4 }}>{money(state.budget)}</div>
          <div style={{ font: "500 12px Barlow,sans-serif", color: "#aab3c3", marginTop: 4 }}>
            Discretionary — carries forward each off-season from real revenue minus running costs. Spend it on facility
            upgrades below; the Marketing campaigns and retention-payment lever come in a later round.
          </div>
        </div>
      </HeroCard>

      {CATEGORY_ORDER.map((cat) => (
        <div key={cat} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SectionLabel>{cat}</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12 }}>
            {FACILITY_DEFS.filter((f) => f.category === cat).map((f) => (
              <FacilityCard key={f.id} def={f} level={facilityLevel(state, f.id)} budget={state.budget} onUpgrade={() => upgradeFacility(f.id)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function FacilityCard({ def, level, budget, onUpgrade }: { def: FacilityDef; level: number; budget: number; onUpgrade: () => void }) {
  const cost = facilityUpgradeCost(def.id, level);
  const maxed = cost === null;
  const affordable = cost !== null && budget >= cost;
  return (
    <Card padding="14px 16px" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ font: "700 14px Barlow,sans-serif", color: "#fff" }}>{def.name}</div>
        {!def.wired && <StatusChip tone="warn">not yet wired</StatusChip>}
      </div>
      <div style={{ font: "500 12px/1.4 Barlow,sans-serif", color: "#aab3c3" }}>{def.description}</div>
      <Pips level={level} total={def.maxLevel === 5 ? 5 : def.maxLevel} />
      <div style={{ font: "500 11px Barlow,sans-serif", color: "#8f9ab0" }}>
        {def.wired ? def.effectLabel : `Effect: ${def.effectLabel}`}
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 4 }}>
        <span style={{ font: "600 11px 'IBM Plex Mono',monospace", color: "#c3ccdd" }}>
          Level {level} / {def.maxLevel}
        </span>
        <button
          type="button"
          disabled={maxed || !affordable}
          onClick={onUpgrade}
          style={{
            border: 0,
            borderRadius: 8,
            padding: "6px 12px",
            font: "700 12px Barlow,sans-serif",
            cursor: maxed || !affordable ? "default" : "pointer",
            background: maxed ? "rgba(255,255,255,.08)" : affordable ? "var(--acc)" : "rgba(255,255,255,.08)",
            color: maxed ? "#8f9ab0" : affordable ? "var(--on)" : "#8f9ab0",
          }}
        >
          {maxed ? "Max level" : `Upgrade · ${money(cost)}`}
        </button>
      </div>
    </Card>
  );
}
