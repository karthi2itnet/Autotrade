"use client";
import React, { useEffect, useState, useCallback } from "react";
import { useDashboard } from "@/context/DashboardContext";
import { WsBrokerTrade, WsBrokerOrder } from "@/hooks/useTradeWebSocket";
import { ArrowUpRight, ArrowDownRight, Clock, RefreshCw, ListOrdered, CheckCircle } from "lucide-react";
import { api } from "@/lib/api";

// ── helpers ────────────────────────────────────────────────────────────────────

function sideColor(side: string) {
    if (side === "CE") return { bg: "rgba(59,123,255,0.15)", color: "var(--ce-color)", border: "rgba(59,123,255,0.3)" };
    if (side === "PE") return { bg: "rgba(255,61,87,0.15)", color: "var(--pe-color)", border: "rgba(255,61,87,0.3)" };
    if (side === "BUY") return { bg: "rgba(0,230,118,0.12)", color: "var(--accent-green)", border: "rgba(0,230,118,0.25)" };
    if (side === "SELL") return { bg: "rgba(255,61,87,0.12)", color: "var(--accent-red)", border: "rgba(255,61,87,0.25)" };
    return { bg: "var(--bg-surface)", color: "var(--text-muted)", border: "var(--border)" };
}

function txnColor(txn: string) {
    if (txn === "BUY") return { bg: "rgba(0,230,118,0.12)", color: "var(--accent-green)", border: "rgba(0,230,118,0.25)" };
    if (txn === "SELL") return { bg: "rgba(255,61,87,0.12)", color: "var(--accent-red)", border: "rgba(255,61,87,0.25)" };
    return { bg: "var(--bg-surface)", color: "var(--text-muted)", border: "var(--border)" };
}

const STATUS_STYLE: Record<string, { color: string; bg: string; border: string }> = {
    complete: { color: "var(--accent-green)", bg: "rgba(0,230,118,0.1)", border: "rgba(0,230,118,0.3)" },
    complete_and_not_traded: { color: "var(--accent-green)", bg: "rgba(0,230,118,0.1)", border: "rgba(0,230,118,0.3)" },
    rejected: { color: "var(--accent-red)", bg: "rgba(255,61,87,0.1)", border: "rgba(255,61,87,0.3)" },
    cancelled: { color: "var(--accent-orange)", bg: "rgba(255,152,0,0.1)", border: "rgba(255,152,0,0.3)" },
    open: { color: "var(--accent-blue)", bg: "rgba(59,123,255,0.1)", border: "rgba(59,123,255,0.3)" },
    pending: { color: "var(--accent-blue)", bg: "rgba(59,123,255,0.1)", border: "rgba(59,123,255,0.3)" },
    trigger_pending: { color: "var(--accent-yellow)", bg: "rgba(255,215,64,0.1)", border: "rgba(255,215,64,0.3)" },
};
function statusStyle(s: string) {
    return STATUS_STYLE[s.toLowerCase()] ?? { color: "var(--text-muted)", bg: "var(--bg-surface)", border: "var(--border)" };
}

// ── shared cell styles ─────────────────────────────────────────────────────────
const cellStyle: React.CSSProperties = {
    padding: "10px 14px", fontSize: 13,
    borderTop: "1px solid var(--border)",
    color: "var(--text-primary)", fontVariantNumeric: "tabular-nums",
};
const hStyle: React.CSSProperties = {
    padding: "8px 14px", fontSize: 11, fontWeight: 600,
    color: "var(--text-muted)", textTransform: "uppercase",
    letterSpacing: "0.5px", textAlign: "left",
};

function Badge({ text, style }: { text: string; style: { color: string; bg: string; border: string } }) {
    return (
        <span style={{
            fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 12,
            background: style.bg, color: style.color, border: `1px solid ${style.border}`,
        }}>{text}</span>
    );
}

function EmptyRow({ loading, msg }: { loading: boolean; msg: string }) {
    if (loading) return (
        <tr><td colSpan={10} style={{ padding: "32px 16px", textAlign: "center", color: "var(--text-muted)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
                <RefreshCw size={14} style={{ animation: "spin 1s linear infinite" }} /> Loading…
            </div>
        </td></tr>
    );
    return (
        <tr><td colSpan={10} style={{ padding: "40px 16px", textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
            {msg}
        </td></tr>
    );
}

// ── Trades tab ─────────────────────────────────────────────────────────────────
function TradesTab({ trades, loading }: { trades: WsBrokerTrade[]; loading: boolean }) {
    const totalPnl = trades.reduce((s, t) => s + (t.pnl ?? 0), 0);
    return (
        <>
            {/* summary bar */}
            <div style={{ padding: "6px 16px", borderBottom: "1px solid var(--border)", display: "flex", gap: 16, alignItems: "center", background: "var(--bg-primary)", fontSize: 12 }}>
                <span style={{ color: "var(--accent-green)" }}>✓ {trades.filter(t => t.pnl > 0).length} wins</span>
                <span style={{ color: "var(--accent-red)" }}>✗ {trades.filter(t => t.pnl < 0).length} losses</span>
                <span style={{ fontWeight: 700, color: totalPnl >= 0 ? "var(--accent-green)" : "var(--accent-red)" }}>
                    {totalPnl >= 0 ? "+" : ""}₹{totalPnl.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                </span>
            </div>
            <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ background: "var(--bg-secondary)" }}>
                            <th style={hStyle}>Time</th>
                            <th style={hStyle}>Side</th>
                            <th style={hStyle}>Txn</th>
                            <th style={hStyle}>Symbol</th>
                            <th style={{ ...hStyle, color: "var(--accent-green)" }}>Entry ₹</th>
                            <th style={{ ...hStyle, color: "var(--accent-red)" }}>Exit ₹</th>
                            <th style={hStyle}>Qty</th>
                            <th style={hStyle}>P&amp;L</th>
                        </tr>
                    </thead>
                    <tbody>
                        {!loading && trades.length === 0
                            ? <EmptyRow loading={false} msg="No executed trades yet today" />
                            : loading
                                ? <EmptyRow loading={true} msg="" />
                                : trades.map((t, i) => {
                                    const sc = sideColor(t.side);
                                    const tc = txnColor(t.transaction);
                                    const entryPrice = t.entry_ltp > 0 ? `₹${t.entry_ltp.toFixed(2)}` : "—";
                                    const exitPrice = t.exit_ltp > 0 ? `₹${t.exit_ltp.toFixed(2)}` : "—";
                                    return (
                                        <tr key={t.id ?? i}
                                            onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-surface)")}
                                            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                                            style={{ transition: "background 0.2s" }}>
                                            <td style={{ ...cellStyle, color: "var(--text-secondary)" }}>{t.time}</td>
                                            <td style={cellStyle}><Badge text={t.side} style={sc} /></td>
                                            <td style={cellStyle}><Badge text={t.transaction || t.reason?.toUpperCase() || "—"} style={tc} /></td>
                                            <td style={{ ...cellStyle, fontFamily: "monospace", fontSize: 11 }}>{t.symbol}</td>
                                            <td style={{ ...cellStyle, color: t.entry_ltp > 0 ? "var(--accent-green)" : "var(--text-muted)", fontWeight: t.entry_ltp > 0 ? 600 : 400 }}>{entryPrice}</td>
                                            <td style={{ ...cellStyle, color: t.exit_ltp > 0 ? "var(--accent-red)" : "var(--text-muted)", fontWeight: t.exit_ltp > 0 ? 600 : 400 }}>{exitPrice}</td>
                                            <td style={cellStyle}>{t.lots}</td>
                                            <td style={cellStyle}>
                                                {t.pnl !== 0
                                                    ? <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                                        {t.pnl >= 0 ? <ArrowUpRight size={13} color="var(--accent-green)" /> : <ArrowDownRight size={13} color="var(--accent-red)" />}
                                                        <span style={{ color: t.pnl >= 0 ? "var(--accent-green)" : "var(--accent-red)", fontWeight: 700 }}>
                                                            {t.pnl >= 0 ? "+" : ""}₹{Math.abs(t.pnl).toLocaleString("en-IN", { maximumFractionDigits: 2 })}
                                                        </span>
                                                    </div>
                                                    : <span style={{ color: "var(--text-muted)" }}>—</span>}
                                            </td>
                                        </tr>
                                    );
                                })}
                    </tbody>
                </table>
            </div>
        </>
    );
}

// ── Orders tab ─────────────────────────────────────────────────────────────────
function OrdersTab({ orders, loading }: { orders: WsBrokerOrder[]; loading: boolean }) {
    const complete = orders.filter(o => o.status.startsWith("complete")).length;
    const rejected = orders.filter(o => o.status === "rejected").length;
    const open = orders.filter(o => ["open", "pending", "trigger_pending"].includes(o.status)).length;

    return (
        <>
            {/* summary bar */}
            <div style={{ padding: "6px 16px", borderBottom: "1px solid var(--border)", display: "flex", gap: 16, alignItems: "center", background: "var(--bg-primary)", fontSize: 12 }}>
                <span style={{ color: "var(--accent-green)" }}>✓ {complete} complete</span>
                <span style={{ color: "var(--accent-red)" }}>✗ {rejected} rejected</span>
                <span style={{ color: "var(--accent-blue)" }}>⏳ {open} open</span>
            </div>
            <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ background: "var(--bg-secondary)" }}>
                            <th style={hStyle}>Time</th>
                            <th style={hStyle}>Order ID</th>
                            <th style={hStyle}>Side</th>
                            <th style={hStyle}>Txn</th>
                            <th style={hStyle}>Symbol</th>
                            <th style={hStyle}>Qty</th>
                            <th style={hStyle}>Price</th>
                            <th style={hStyle}>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {!loading && orders.length === 0
                            ? <EmptyRow loading={false} msg="No orders placed today" />
                            : loading
                                ? <EmptyRow loading={true} msg="" />
                                : orders.map((o, i) => {
                                    const sc = sideColor(o.side);
                                    const tc = txnColor(o.transaction);
                                    const ss = statusStyle(o.status);
                                    return (
                                        <tr key={`${o.id ?? 'order'}-${i}`}
                                            onMouseEnter={e => (e.currentTarget.style.background = "var(--bg-surface)")}
                                            onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                                            style={{ transition: "background 0.2s" }}>
                                            <td style={{ ...cellStyle, color: "var(--text-secondary)" }}>{o.time}</td>
                                            <td style={{ ...cellStyle, fontFamily: "monospace", fontSize: 11, color: "var(--text-secondary)" }}>{o.order_id || "—"}</td>
                                            <td style={cellStyle}><Badge text={o.side || "—"} style={sc} /></td>
                                            <td style={cellStyle}><Badge text={o.transaction || "—"} style={tc} /></td>
                                            <td style={{ ...cellStyle, fontFamily: "monospace", fontSize: 11 }}>{o.symbol}</td>
                                            <td style={cellStyle}>{o.quantity}</td>
                                            <td style={cellStyle}>{o.price > 0 ? `₹${o.price.toFixed(2)}` : "MKT"}</td>
                                            <td style={cellStyle}><Badge text={o.status} style={ss} /></td>
                                        </tr>
                                    );
                                })}
                    </tbody>
                </table>
            </div>
        </>
    );
}

// ── Main component ─────────────────────────────────────────────────────────────
type Tab = "trades" | "orders";

export default function TradeLogTable() {
    const { brokerTrades, brokerOrders, wsConnected } = useDashboard();

    const [tab, setTab] = useState<Tab>("trades");
    const [apiTrades, setApiTrades] = useState<WsBrokerTrade[]>([]);
    const [apiOrders, setApiOrders] = useState<WsBrokerOrder[]>([]);
    const [tradesLoading, setTradesLoading] = useState(true);
    const [ordersLoading, setOrdersLoading] = useState(true);
    const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

    // Initial HTTP fetch (before first WS push)
    const loadAll = useCallback(async () => {
        setTradesLoading(true);
        setOrdersLoading(true);
        try {
            const [trades, orders] = await Promise.all([
                api.getTodayTrades(),
                api.getTodayOrders(),
            ]);
            if (Array.isArray(trades)) setApiTrades(trades as WsBrokerTrade[]);
            if (Array.isArray(orders)) setApiOrders(orders as WsBrokerOrder[]);
            setLastRefresh(new Date());
        } catch (e) {
            console.warn("Initial load failed:", e);
        } finally {
            setTradesLoading(false);
            setOrdersLoading(false);
        }
    }, []);

    useEffect(() => { loadAll(); }, [loadAll]);

    // WS updates override the API snapshot
    useEffect(() => {
        if (brokerTrades.length > 0) {
            setApiTrades(brokerTrades);
            setTradesLoading(false);
            setLastRefresh(new Date());
        }
    }, [brokerTrades]);

    useEffect(() => {
        if (brokerOrders.length > 0) {
            setApiOrders(brokerOrders);
            setOrdersLoading(false);
            setLastRefresh(new Date());
        }
    }, [brokerOrders]);

    const displayTrades = brokerTrades.length > 0 ? brokerTrades : apiTrades;
    const displayOrders = brokerOrders.length > 0 ? brokerOrders : apiOrders;

    const tabBtn = (t: Tab, icon: React.ReactNode, label: string, count: number): React.ReactNode => (
        <button
            onClick={() => setTab(t)}
            style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "7px 14px", borderRadius: 8, cursor: "pointer",
                border: tab === t ? "1px solid var(--accent-blue)" : "1px solid transparent",
                background: tab === t ? "rgba(59,123,255,0.12)" : "transparent",
                color: tab === t ? "var(--accent-blue)" : "var(--text-muted)",
                fontSize: 12, fontWeight: 600, transition: "all 0.2s",
            }}>
            {icon}
            {label}
            <span style={{
                fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10,
                background: tab === t ? "var(--accent-blue)" : "var(--bg-surface)",
                color: tab === t ? "#fff" : "var(--text-muted)",
                border: `1px solid ${tab === t ? "var(--accent-blue)" : "var(--border)"}`,
            }}>{count}</span>
        </button>
    );

    return (
        <div style={{
            background: "var(--bg-card)", border: "1px solid var(--border)",
            borderRadius: 14, overflow: "hidden", marginTop: 20,
        }}>
            {/* Header */}
            <div style={{
                padding: "10px 16px", borderBottom: "1px solid var(--border)",
                display: "flex", alignItems: "center", justifyContent: "space-between",
                background: "var(--bg-surface)",
            }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Clock size={15} color="var(--text-secondary)" />
                    <span style={{ fontWeight: 700, fontSize: 14, color: "var(--text-primary)" }}>Today&apos;s Activity</span>

                    {wsConnected && (
                        <span style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--accent-green)" }}>
                            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent-green)", boxShadow: "0 0 5px var(--accent-green)", display: "inline-block" }} />
                            Live
                        </span>
                    )}
                    {lastRefresh && (
                        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>
                            · {lastRefresh.toLocaleTimeString("en-IN")}
                        </span>
                    )}
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    {/* tabs */}
                    {tabBtn("trades", <CheckCircle size={13} />, "Executed Trades", displayTrades.length)}
                    {tabBtn("orders", <ListOrdered size={13} />, "Orders", displayOrders.length)}

                    {/* manual refresh */}
                    <button
                        onClick={loadAll}
                        title="Refresh from broker"
                        style={{
                            display: "flex", alignItems: "center", gap: 4,
                            padding: "6px 10px", borderRadius: 8, cursor: "pointer",
                            border: "1px solid var(--border)", background: "transparent",
                            color: "var(--text-muted)", fontSize: 11, marginLeft: 6,
                            transition: "all 0.2s",
                        }}>
                        <RefreshCw size={12} />
                        Refresh
                    </button>
                </div>
            </div>

            {/* Tab content */}
            {tab === "trades"
                ? <TradesTab trades={displayTrades} loading={tradesLoading} />
                : <OrdersTab orders={displayOrders} loading={ordersLoading} />}
        </div>
    );
}
