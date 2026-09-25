import { useState } from "react";
import { Card, DetailPanel, SectionLabel, StatusChip, Pips } from "./theme/primitives";
import { useGameStore } from "../store/useGameStore";
import { useSaveStore } from "../store/useSaveStore";
import { activeCampaignsOf, canLaunchCampaign, facilityLevel, marketingReturnMultiplier, marketingSlots } from "../engine/clubFinance";
import { defaultClubFinanceState } from "../types/clubFinance";
import { MARKETING_CAMPAIGNS, marketingCampaignDef, type CampaignRisk, type MarketingCampaignId } from "../types/marketing";

/**
 * Round 122 — [[Club Finance, Facilities, and Marketing]] part 2, the Marketing sub-tab of the Football
 * Department. Every number here is a fresh calibration, not a copy of anything Tyler specified — see
 * `types/marketing.ts`'s own doc comment for the full disclosure (no source CAMPS table existed to pull
 * from). A campaign launched here costs money immediately and pays out — with real risk-tier variance —
 * at the end of the NEXT off-season advance, not this one; see `types/clubFinance.ts`'s
 * `ActiveMarketingCampaign` doc comment for why campaigns can't resolve any faster in an engine with no
 * in-season weekly tick.
 *
 * Layout follows `List.tsx`'s own master/detail pattern (a `selectedCampaignId` state, a card grid on
 * the left, a sticky `DetailPanel` on the right) rather than inventing a new one.
 */
function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-AU")}`;
}

const RISK_TONE: Record<CampaignRisk, "good" | "warn" | "bad"> = { Low: "good", Medium: "warn", High: "bad" };

export function Marketing() {
  const myClub = useGameStore((s) => s.myClub);
  const clubFinance = useSaveStore((s) => s.clubFinance);
  const launchMarketingCampaign = useSaveStore((s) => s.launchMarketingCampaign);
  const state = clubFinance[myClub] ?? defaultClubFinanceState();
  const [selectedId, setSelectedId] = useState<MarketingCampaignId | null>(null);

  const active = activeCampaignsOf(state);
  const slots = marketingSlots(state);
  const selected = selectedId ? marketingCampaignDef(selectedId) : null;
  const selectedActive = selectedId ? active.find((c) => c.campaignId === selectedId) : undefined;

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div style={{ flex: "4 1 600px", minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        <Card padding="14px 16px">
          <SectionLabel>Marketing Department</SectionLabel>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6, flexWrap: "wrap", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ font: "700 22px/1 'Barlow Condensed',sans-serif", color: "#fff" }}>Level {facilityLevel(state, "marketing")}</span>
              <Pips level={facilityLevel(state, "marketing")} total={4} />
            </div>
            <span style={{ font: "600 12px 'IBM Plex Mono',monospace", color: "#c3ccdd" }}>
              {active.length} / {slots} campaign slots in use
            </span>
          </div>
          <div style={{ font: "500 12px Barlow,sans-serif", color: "#8f9ab0", marginTop: 6 }}>
            Every level of the Marketing Department facility (Facilities tab) adds +8% to every campaign's actual
            payout and, every 2 levels, one more concurrent campaign slot.
          </div>
        </Card>

        <Card padding="14px 16px">
          <SectionLabel>Running now</SectionLabel>
          {active.length === 0 ? (
            <div style={{ font: "400 14px Barlow,sans-serif", color: "#aab3c3", marginTop: 8 }}>No campaigns running. Pick one below.</div>
          ) : (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              {active.map((c) => {
                const def = marketingCampaignDef(c.campaignId);
                return (
                  <span
                    key={c.campaignId}
                    style={{
                      padding: "6px 12px",
                      borderRadius: 999,
                      background: "color-mix(in oklch, var(--acc) 18%, transparent)",
                      border: "1px solid var(--acc)",
                      font: "600 13px Barlow,sans-serif",
                      color: "#fff",
                    }}
                  >
                    {def.name} · resolves next off-season
                  </span>
                );
              })}
            </div>
          )}
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <SectionLabel>Campaigns</SectionLabel>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 10 }}>
            {MARKETING_CAMPAIGNS.map((def) => {
              const isActive = active.some((c) => c.campaignId === def.id);
              const isSelected = selectedId === def.id;
              return (
                <button
                  key={def.id}
                  type="button"
                  onClick={() => setSelectedId(def.id)}
                  style={{
                    textAlign: "left",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    padding: "12px 14px",
                    borderRadius: 12,
                    border: isSelected ? "1px solid var(--acc)" : "1px solid rgba(255,255,255,.08)",
                    background: isSelected ? "color-mix(in oklch, var(--acc) 12%, rgba(0,0,0,.2))" : "rgba(0,0,0,.2)",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                    <span style={{ font: "700 17px/1.15 'Barlow Condensed',sans-serif", color: "#fff" }}>{def.name}</span>
                    <StatusChip tone={RISK_TONE[def.risk]}>{def.risk}</StatusChip>
                  </div>
                  <span style={{ font: "500 13px/1.4 Barlow,sans-serif", color: "#c3ccdd" }}>{def.description}</span>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ font: "500 12px 'IBM Plex Mono',monospace", color: "#8f9ab0" }}>{money(def.cost)} · {def.durationWeeks}wk</span>
                    <span style={{ font: "600 12px 'IBM Plex Mono',monospace", color: "var(--accT)" }}>~{money(def.expectedReturn)}</span>
                  </div>
                  {isActive && <span style={{ font: "600 9px 'IBM Plex Mono',monospace", letterSpacing: ".8px", color: "#4fd69a" }}>RUNNING</span>}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div style={{ flex: "1.6 1 340px", minWidth: 0, position: "sticky", top: 12 }}>
        {selected ? (
          <DetailPanel>
            <SectionLabel style={{ color: "var(--accT)" }}>MARKETING CAMPAIGN · {selected.durationWeeks} WEEKS</SectionLabel>
            <div style={{ font: "700 28px/1.05 'Barlow Condensed',sans-serif", color: "#fff", marginTop: 4 }}>{selected.name}</div>
            <div style={{ font: "500 13px/1.45 Barlow,sans-serif", color: "#aab3c3", marginTop: 4 }}>{selected.description}</div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 8, marginTop: 14 }}>
              <StatTile value={money(selected.cost)} label="Cost" />
              <StatTile value={`~${money(selected.expectedReturn * marketingReturnMultiplier(state))}`} label="Exp. return" accent />
              <StatTile value={selected.risk} label="Risk" />
            </div>

            {selected.sideEffectNote && (
              <div
                style={{
                  marginTop: 12,
                  padding: "10px 12px",
                  borderRadius: 9,
                  background: "rgba(0,0,0,.2)",
                  border: "1px solid rgba(255,255,255,.07)",
                  font: "500 12px/1.4 Barlow,sans-serif",
                  color: "#c3ccdd",
                }}
              >
                {selected.sideEffectNote}
              </div>
            )}

            <div style={{ marginTop: 12, font: "500 12px Barlow,sans-serif", color: "#8f9ab0" }}>
              {selectedActive
                ? "Already running — resolves at the end of the next off-season."
                : `Budget after launch: ${money(state.budget - selected.cost)}`}
            </div>

            <div style={{ marginTop: 16 }}>
              {selectedActive ? (
                <div
                  style={{
                    background: "rgba(255,255,255,.06)",
                    color: "#8f9ab0",
                    borderRadius: 9,
                    padding: "12px 16px",
                    font: "600 14px Barlow,sans-serif",
                    textAlign: "center",
                  }}
                >
                  Already running
                </div>
              ) : (
                <button
                  type="button"
                  disabled={!canLaunchCampaign(state, selected.id)}
                  onClick={() => launchMarketingCampaign(selected.id)}
                  style={{
                    width: "100%",
                    border: 0,
                    borderRadius: 9,
                    padding: "12px 16px",
                    font: "700 14px Barlow,sans-serif",
                    cursor: canLaunchCampaign(state, selected.id) ? "pointer" : "default",
                    background: canLaunchCampaign(state, selected.id) ? "var(--acc)" : "rgba(255,255,255,.06)",
                    color: canLaunchCampaign(state, selected.id) ? "var(--on)" : "#8f9ab0",
                  }}
                >
                  {state.budget < selected.cost
                    ? "Can't afford"
                    : active.length >= slots
                      ? "No free campaign slot"
                      : `Launch · ${money(selected.cost)}`}
                </button>
              )}
            </div>
          </DetailPanel>
        ) : (
          <DetailPanel>
            <div style={{ font: "500 14px Barlow,sans-serif", color: "#aab3c3" }}>Click a campaign to see its detail and launch it.</div>
          </DetailPanel>
        )}
      </div>
    </div>
  );
}

function StatTile({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div style={{ padding: "10px 6px", borderRadius: 9, background: "rgba(0,0,0,.25)", border: "1px solid rgba(255,255,255,.07)", textAlign: "center" }}>
      <div style={{ font: "700 20px/1 'Barlow Condensed',sans-serif", color: accent ? "var(--accT)" : "#fff" }}>{value}</div>
      <div style={{ font: "600 9px 'IBM Plex Mono',monospace", letterSpacing: ".8px", color: "#8f9ab0", marginTop: 5 }}>{label.toUpperCase()}</div>
    </div>
  );
}
