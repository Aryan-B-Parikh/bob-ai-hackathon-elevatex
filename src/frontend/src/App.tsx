// App shell + tab nav ONLY. Feature work lives in src/tabs/*.tsx (see TEAM_PLAN.md).
import { useState } from "react";
import { TABS, type TabId } from "./tabs";

export default function App() {
  const [tab, setTab] = useState<TabId>("overview");
  const Current = (TABS.find((t) => t.id === tab) ?? TABS[0]).Component;

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-10" style={{ background: "rgba(11,18,32,0.92)", borderBottom: "1px solid var(--line)", backdropFilter: "blur(6px)" }}>
        <div className="mx-auto max-w-[1500px] px-5 py-3 flex flex-wrap items-center gap-4">
          <div>
            <div className="font-semibold">PortFlow SBX</div>
            <div className="muted text-[11px]">San Pedro Bay · LightGBM forecast · CP-SAT optimiser · SimPy ops layer · IBM Bob via MCP</div>
          </div>
          <nav className="flex gap-1 flex-wrap">
            {TABS.map((t) => (
              <button key={t.id} onClick={() => setTab(t.id)} className="px-3 py-1.5 rounded-md text-sm"
                style={{
                  background: tab === t.id ? "var(--panel-2)" : "transparent",
                  color: tab === t.id ? "var(--accent)" : "var(--text)",
                  border: "1px solid",
                  borderColor: tab === t.id ? "var(--line)" : "transparent",
                }}>
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-[1500px] px-5 py-5">
        <Current />
      </main>
      <footer className="mx-auto max-w-[1500px] px-5 py-6 muted text-xs">
        Forecast: LightGBM (quantile bands) · Anomalies: scikit-learn Isolation Forest · Optimiser: OR-Tools CP-SAT (BAP/QCAP) ·
        Simulation: SimPy · API: FastAPI · DB: PostgreSQL · Agent: IBM Bob (MCP). Terminal capacity: real Port of Long Beach
        fact sheets; vessel/history layer: labelled DEMO_AIS.
      </footer>
    </div>
  );
}
