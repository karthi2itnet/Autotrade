"use client";
import { useDashboard } from "@/context/DashboardContext";
import Toolbar from "@/components/Toolbar";
import TradingGrid from "@/components/TradingGrid";
import TradeLogTable from "@/components/TradeLogTable";
import PnlBar from "@/components/PnlBar";
import { Wifi } from "lucide-react";
import Link from "next/link";

export default function Home() {
  const { state, liveData, updateCeRow, updatePeRow, startRow, stopRow, strikesLoaded, toolbarVisible } = useDashboard();
  const isEmpty = state.ceGrid.length === 0 && state.peGrid.length === 0;

  return (
    <main style={{ padding: "20px 24px", maxWidth: 1600, margin: "0 auto" }}>
      {/* Toolbar — toggled via Header button, hidden by default */}
      <div style={{
        maxHeight: toolbarVisible ? 200 : 0,
        overflow: "hidden",
        transition: "max-height 0.25s ease",
      }}>
        <Toolbar />
      </div>

      {/* Empty state — shown before broker connects */}
      {isEmpty && (
        <div style={{
          marginTop: 40,
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
          gap: 16, padding: "48px 24px",
          background: "var(--bg-card)",
          border: "1px solid var(--border)",
          borderRadius: 18,
          textAlign: "center",
        }}>
          <div style={{
            width: 64, height: 64, borderRadius: "50%",
            background: "rgba(59,123,255,0.1)",
            border: "1px solid rgba(59,123,255,0.25)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <Wifi size={28} color="var(--accent-blue)" />
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18, color: "var(--text-primary)", marginBottom: 8 }}>
              No grid data yet
            </div>
            <div style={{ fontSize: 14, color: "var(--text-muted)", maxWidth: 380, lineHeight: 1.7 }}>
              Connect your Alice Blue broker account to load live strikes and start trading.
            </div>
          </div>
          <Link href="/broker" style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "10px 24px", borderRadius: 10,
            background: "var(--accent-blue)", color: "#fff",
            fontWeight: 700, fontSize: 14, textDecoration: "none",
            border: "none", cursor: "pointer",
          }}>
            <Wifi size={15} /> Go to Broker Connect
          </Link>
        </div>
      )}

      {/* Dual grids — only shown once strikes are loaded */}
      {!isEmpty && (
        <div style={{ display: "flex", gap: 16, marginTop: 16, marginBottom: 20, flexWrap: "wrap", justifyContent: "center" }}>
          <TradingGrid side="CE" rows={state.ceGrid} liveData={liveData} onUpdateRow={updateCeRow} onStartRow={startRow} onStopRow={stopRow} />
          <TradingGrid side="PE" rows={state.peGrid} liveData={liveData} onUpdateRow={updatePeRow} onStartRow={startRow} onStopRow={stopRow} />
        </div>
      )}

      {/* Trade log */}
      <TradeLogTable />

      {/* Stats bar (P&L, Trades, Wins) moved to bottom as requested */}
      <div style={{ marginTop: 24, marginBottom: 24 }}>
        <PnlBar />
      </div>

    </main>
  );
}
