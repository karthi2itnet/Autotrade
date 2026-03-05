"use client";
import React, { useRef, useEffect, useState } from "react";
import { Activity, Wifi, WifiOff, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDashboard } from "@/context/DashboardContext";

// ── Index ticker cell ─────────────────────────────────────────────────────────
// Flashes green/red on every price change, then fades back to neutral.
const INDEX_META: Record<string, { label: string; color: string; decimals: number }> = {
    NIFTY: { label: "NIFTY", color: "#4d9fff", decimals: 2 },
    BANKNIFTY: { label: "BANKNIFTY", color: "#9b7efa", decimals: 2 },
    SENSEX: { label: "SENSEX", color: "#f9a825", decimals: 2 },
    INDIAVIX: { label: "INDIA VIX", color: "#00e676", decimals: 2 },
};

function IndexCell({ name, value }: { name: string; value: number }) {
    const meta = INDEX_META[name];
    const prevRef = useRef(value);
    const [flash, setFlash] = useState<"up" | "down" | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const prev = prevRef.current;
        if (value !== prev && prev !== 0 && value !== 0) {
            setFlash(value > prev ? "up" : "down");
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => setFlash(null), 400);
        }
        prevRef.current = value;
    }, [value]);

    const flashColor =
        flash === "up" ? "#00e676" :
            flash === "down" ? "#ff3d57" :
                meta.color;
    const flashBg =
        flash === "up" ? "rgba(0,230,118,0.14)" :
            flash === "down" ? "rgba(255,61,87,0.14)" :
                "transparent";

    const displayValue = value > 0
        ? value.toLocaleString("en-IN", { minimumFractionDigits: meta.decimals, maximumFractionDigits: meta.decimals })
        : "—";

    return (
        <div style={{
            display: "flex", flexDirection: "column", alignItems: "flex-end",
            padding: "2px 10px", borderRight: "1px solid var(--border)",
            minWidth: 100, transition: "background 0.4s",
            background: flashBg, borderRadius: 4,
        }}>
            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.8, color: "var(--text-muted)", textTransform: "uppercase" }}>
                {meta.label}
            </span>
            <span style={{
                fontSize: 12, fontWeight: 700,
                fontVariantNumeric: "tabular-nums",
                color: flashColor,
                transition: "color 0.4s",
                letterSpacing: "-0.3px",
            }}>
                {displayValue}
            </span>
        </div>
    );
}

// ── Live clock ────────────────────────────────────────────────────────────────
function Clock() {
    const [time, setTime] = useState("");
    useEffect(() => {
        const tick = () => setTime(new Date().toLocaleTimeString("en-IN", {
            hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
        }));
        tick();
        const id = setInterval(tick, 1000);
        return () => clearInterval(id);
    }, []);
    return (
        <span style={{ fontSize: 12, color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums", letterSpacing: "0.5px" }}>
            {time}
        </span>
    );
}

// ── Header ────────────────────────────────────────────────────────────────────
export default function Header() {
    const pathname = usePathname();
    const { wsConnected, state, marketIndices, toolbarVisible, toggleToolbar } = useDashboard();

    const navLink = (href: string, label: string) => {
        const active = pathname === href;
        return (
            <Link href={href} style={{
                fontSize: 13, fontWeight: 600, padding: "5px 14px", borderRadius: 8,
                color: active ? "var(--accent-blue)" : "var(--text-secondary)",
                background: active ? "rgba(59,123,255,0.12)" : "transparent",
                border: active ? "1px solid rgba(59,123,255,0.3)" : "1px solid transparent",
                textDecoration: "none", transition: "all 0.15s",
            }}>{label}</Link>
        );
    };

    return (
        <header style={{
            background: "var(--bg-secondary)",
            borderBottom: "1px solid var(--border)",
            position: "sticky", top: 0, zIndex: 100,
        }}>
            {/* ── Main bar ── */}
            <div style={{
                padding: "0 24px", height: 50,
                display: "flex", alignItems: "center", justifyContent: "space-between",
            }}>
                {/* Logo + Nav */}
                <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <Activity size={20} color="var(--accent-blue)" />
                        <span style={{ fontWeight: 700, fontSize: 17, letterSpacing: "-0.5px", color: "var(--text-primary)" }}>
                            Auto<span style={{ color: "var(--accent-blue)" }}>trade</span>
                        </span>
                        <span style={{
                            background: "rgba(59,123,255,0.15)", color: "var(--accent-blue)",
                            fontSize: 10, fontWeight: 600, padding: "2px 7px",
                            borderRadius: 20, border: "1px solid rgba(59,123,255,0.3)", letterSpacing: 1,
                        }}>PHASE 1</span>
                    </div>

                    <div style={{ width: 1, height: 20, background: "var(--border)" }} />

                    <nav style={{ display: "flex", gap: 4 }}>
                        {navLink("/", "Dashboard")}
                        {navLink("/broker", "Broker Connect")}

                        {/* Toolbar toggle */}
                        <button
                            onClick={toggleToolbar}
                            title={toolbarVisible ? "Hide toolbar" : "Show toolbar"}
                            style={{
                                display: "flex", alignItems: "center", gap: 5,
                                padding: "5px 12px", borderRadius: 8, cursor: "pointer",
                                fontSize: 12, fontWeight: 600,
                                border: toolbarVisible
                                    ? "1px solid rgba(59,123,255,0.4)"
                                    : "1px solid var(--border)",
                                background: toolbarVisible
                                    ? "rgba(59,123,255,0.12)"
                                    : "var(--bg-surface)",
                                color: toolbarVisible ? "var(--accent-blue)" : "var(--text-muted)",
                                transition: "all 0.2s",
                            }}>
                            <SlidersHorizontal size={13} />
                            Toolbar
                        </button>
                    </nav>
                </div>

                {/* Right side */}
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    {state.paperMode && (
                        <span style={{
                            fontSize: 11, fontWeight: 700, letterSpacing: 0.5,
                            color: "var(--accent-yellow)",
                            background: "rgba(255,215,64,0.12)",
                            border: "1px solid rgba(255,215,64,0.3)",
                            padding: "3px 10px", borderRadius: 20,
                        }}>PAPER MODE</span>
                    )}

                    {/* WS status */}
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={{
                            width: 7, height: 7, borderRadius: "50%", display: "inline-block",
                            background: wsConnected ? "var(--accent-green)" : "var(--text-muted)",
                            boxShadow: wsConnected ? "0 0 6px var(--accent-green)" : "none",
                        }} />
                        {wsConnected
                            ? <Wifi size={13} color="var(--accent-green)" />
                            : <WifiOff size={13} color="var(--text-muted)" />}
                        <span style={{ fontSize: 12, color: wsConnected ? "var(--accent-green)" : "var(--text-muted)", fontWeight: 500 }}>
                            {wsConnected ? "Live" : "Offline"}
                        </span>
                    </div>

                    <Clock />
                </div>
            </div>

            {/* ── Index ticker strip ── */}
            <div style={{
                borderTop: "1px solid var(--border)",
                background: "var(--bg-primary)",
                padding: "4px 24px",
                display: "flex", alignItems: "center", gap: 0,
                overflowX: "auto",
            }}>
                {/* label */}
                <span style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: 1,
                    color: "var(--text-muted)", textTransform: "uppercase",
                    paddingRight: 12, borderRight: "1px solid var(--border)",
                    marginRight: 4, whiteSpace: "nowrap",
                }}>
                    Market ⚡
                </span>

                {Object.keys(INDEX_META).map(key => (
                    <IndexCell key={key} name={key} value={marketIndices[key] ?? 0} />
                ))}

                <span style={{
                    fontSize: 9, color: "var(--text-muted)", marginLeft: 10,
                    whiteSpace: "nowrap",
                }}>
                    {wsConnected ? "● Live" : "○ Waiting for broker"}
                </span>
            </div>
        </header>
    );
}
