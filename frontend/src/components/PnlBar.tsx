"use client";
import { TrendingUp, TrendingDown, BarChart2, Target, AlertTriangle, Activity } from "lucide-react";
import { useDashboard } from "@/context/DashboardContext";

export default function PnlBar() {
    const { liveData } = useDashboard();

    // Aggregate across all live rows
    let totalPnl = 0;
    let totalPoints = 0;
    let totalClosed = 0;
    let wins = 0;
    let losses = 0;

    for (const row of Object.values(liveData)) {
        totalPnl += row.total_pnl_today ?? 0;
        totalPoints += row.total_points_today ?? 0;
        totalClosed += row.lots_closed_today ?? 0;
        // Count from trade log
        for (const t of (row.trade_log ?? []) as { reason: string }[]) {
            if (t.reason === "target") wins++;
            else losses++;
        }
    }

    const winRate = wins + losses > 0 ? Math.round((wins / (wins + losses)) * 100) : 0;
    const pnlPositive = totalPnl >= 0;
    const ptsPositive = totalPoints >= 0;

    const stats = [
        {
            label: "Day P&L",
            value: `${pnlPositive ? "+" : ""}₹${Math.abs(totalPnl).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`,
            color: pnlPositive ? "var(--accent-green)" : "var(--accent-red)",
            icon: pnlPositive ? TrendingUp : TrendingDown,
        },
        {
            label: "Trades",
            value: String(totalClosed),
            color: "var(--accent-blue)",
            icon: BarChart2,
        },
        {
            label: "Wins",
            value: String(wins),
            color: "var(--accent-green)",
            icon: Target,
        },
        {
            label: "Losses",
            value: String(losses),
            color: losses > 0 ? "var(--accent-red)" : "var(--text-muted)",
            icon: AlertTriangle,
        },
        {
            label: "Win Rate",
            value: wins + losses > 0 ? `${winRate}%` : "—",
            color: winRate >= 50 ? "var(--accent-yellow)" : "var(--accent-red)",
            icon: Activity,
        },
        {
            label: "Points",
            value: wins + losses > 0 ? `${ptsPositive ? "+" : ""}${totalPoints.toFixed(1)}` : "—",
            color: ptsPositive ? "var(--accent-green)" : "var(--accent-red)",
            icon: ptsPositive ? TrendingUp : TrendingDown,
        },
    ];

    return (
        <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(6, 1fr)",
            gap: 12,
            marginBottom: 20,
        }}>
            {stats.map(({ label, value, color, icon: Icon }) => (
                <div key={label} style={{
                    background: "var(--bg-card)",
                    border: "1px solid var(--border)",
                    borderRadius: 12,
                    padding: "14px 16px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                            {label}
                        </span>
                        <Icon size={13} color={color} />
                    </div>
                    <span style={{ fontSize: 20, fontWeight: 700, color, fontVariantNumeric: "tabular-nums" }}>
                        {value}
                    </span>
                </div>
            ))}
        </div>
    );
}
