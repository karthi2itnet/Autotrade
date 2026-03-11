"use client";
import React from "react";
import dynamic from "next/dynamic";

const NiftyChart = dynamic(() => import("@/components/NiftyChart"), { ssr: false });

export default function ChartPage() {
    return (
        <div style={{ padding: 24, paddingBottom: 60 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: 10 }}>
                    Nifty Signal Chart
                </h1>
                <div style={{ padding: "8px 16px", background: "var(--bg-surface)", borderRadius: 8, fontSize: 13, color: "var(--text-secondary)" }}>
                    3m Timeframe • <span style={{ color: "#3B7BFF", fontWeight: 600 }}>SMA-9 Crossover</span> • ATP Logic Evaluator
                </div>
            </div>

            <div style={{
                background: "var(--bg-card)",
                border: "1px solid var(--border)",
                borderRadius: 14,
                padding: "20px",
                display: "flex",
                flexDirection: "column",
                gap: 20
            }}>
                <div style={{ height: 600 }}>
                    <NiftyChart height={600} />
                </div>

                <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5, padding: "12px", background: "var(--bg-surface)", borderRadius: 8 }}>
                    <strong>Signal Generation Logic:</strong>
                    <ul style={{ margin: "8px 0 0 0", paddingLeft: 20 }}>
                        <li>Wait for the 3-minute Nifty 50 candle to close.</li>
                        <li>Check if the closing price crossed the 9-period Simple Moving Average (SMA-9).</li>
                        <li>If <strong>UP</strong>: Evaluates CE Options. Signal fires if `(ATP - LTP) of ITM &lt; (ATP - LTP) of ATM`.</li>
                        <li>If <strong>DOWN</strong>: Evaluates PE Options. Signal fires if `(ATP - LTP) of ITM &lt; (ATP - LTP) of ATM`.</li>
                    </ul>
                </div>
            </div>
        </div>
    );
}
