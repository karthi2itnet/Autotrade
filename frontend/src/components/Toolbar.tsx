"use client";
import React, { useState } from "react";
import { useDashboard } from "@/context/DashboardContext";
import { Underlying, Expiry, BrokerName } from "@/lib/types";
import { Play, Square, Zap, FlaskConical, RefreshCw } from "lucide-react";
import clsx from "clsx";

const underlyings: Underlying[] = ["NIFTY"];
const expiries: Expiry[] = ["weekly", "monthly"];
const brokers: { id: BrokerName; label: string }[] = [
    { id: "aliceblue", label: "Alice Blue" },
    { id: "zerodha", label: "Zerodha" },
];

export default function Toolbar() {
    const { state, setUnderlying, setExpiry, setBroker, togglePaperMode, startAll, stopAll, killAll, loadStrikes, strikesLoaded } = useDashboard();
    const [loadingStrikes, setLoadingStrikes] = useState(false);

    const handleLoadStrikes = async () => {
        setLoadingStrikes(true);
        try { await loadStrikes(); } catch { } finally { setLoadingStrikes(false); }
    };


    const selectStyle = {
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        color: "var(--text-primary)",
        borderRadius: 8,
        padding: "6px 12px",
        fontSize: 13,
        fontWeight: 500,
        outline: "none",
        cursor: "pointer",
    };

    const btnBase: React.CSSProperties = {
        display: "flex", alignItems: "center", gap: 6,
        padding: "7px 16px", borderRadius: 8, fontSize: 13, fontWeight: 600,
        border: "none", cursor: "pointer", transition: "opacity 0.2s",
    };

    return (
        <div style={{
            background: "var(--bg-secondary)",
            borderBottom: "1px solid var(--border)",
            padding: "10px 24px",
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
        }}>
            {/* Underlying */}
            <div style={{ display: "flex", gap: 4 }}>
                {underlyings.map(u => (
                    <button key={u} onClick={() => setUnderlying(u)} style={{
                        ...btnBase,
                        padding: "6px 14px",
                        background: state.underlying === u ? "rgba(59,123,255,0.2)" : "var(--bg-surface)",
                        color: state.underlying === u ? "var(--accent-blue)" : "var(--text-secondary)",
                        border: `1px solid ${state.underlying === u ? "rgba(59,123,255,0.5)" : "var(--border)"}`,
                    }}>{u}</button>
                ))}
            </div>

            <div style={{ width: 1, height: 28, background: "var(--border)" }} />

            {/* Expiry */}
            <select style={selectStyle} value={state.expiry} onChange={e => setExpiry(e.target.value as Expiry)}>
                {expiries.map(e => <option key={e} value={e}>{e.charAt(0).toUpperCase() + e.slice(1)}</option>)}
            </select>

            {/* Broker */}
            <select style={selectStyle} value={state.broker} onChange={e => setBroker(e.target.value as BrokerName)}>
                {brokers.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>

            <div style={{ width: 1, height: 28, background: "var(--border)" }} />

            {/* Paper Mode */}
            <button onClick={togglePaperMode} style={{
                ...btnBase,
                background: state.paperMode ? "rgba(255,215,64,0.15)" : "var(--bg-surface)",
                color: state.paperMode ? "var(--accent-yellow)" : "var(--text-secondary)",
                border: `1px solid ${state.paperMode ? "rgba(255,215,64,0.4)" : "var(--border)"}`,
            }}>
                <FlaskConical size={14} />
                {state.paperMode ? "Paper Mode ON" : "Paper Mode OFF"}
            </button>

            {/* Load Strikes */}
            <button onClick={handleLoadStrikes} disabled={loadingStrikes} style={{
                ...btnBase,
                background: strikesLoaded ? "rgba(0,230,118,0.12)" : "rgba(59,123,255,0.12)",
                color: strikesLoaded ? "var(--accent-green)" : "var(--accent-blue)",
                border: `1px solid ${strikesLoaded ? "rgba(0,230,118,0.3)" : "rgba(59,123,255,0.3)"}`,
                opacity: loadingStrikes ? 0.6 : 1,
            }}>
                <RefreshCw size={13} style={{ animation: loadingStrikes ? "spin 1s linear infinite" : "none" }} />
                {loadingStrikes ? "Loading…" : strikesLoaded ? "Reload Strikes" : "Load Strikes"}
            </button>

            <div style={{ flex: 1 }} />

            {/* Action Buttons */}
            <button onClick={startAll} style={{ ...btnBase, background: "rgba(0,230,118,0.15)", color: "var(--accent-green)", border: "1px solid rgba(0,230,118,0.35)" }}>
                <Play size={14} fill="var(--accent-green)" /> Start All
            </button>
            <button onClick={stopAll} style={{ ...btnBase, background: "rgba(59,123,255,0.15)", color: "var(--accent-blue)", border: "1px solid rgba(59,123,255,0.35)" }}>
                <Square size={14} /> Stop All
            </button>
            <button onClick={killAll} style={{ ...btnBase, background: "rgba(255,61,87,0.15)", color: "var(--accent-red)", border: "1px solid rgba(255,61,87,0.35)" }}>
                <Zap size={14} /> Kill All
            </button>
        </div>
    );
}
