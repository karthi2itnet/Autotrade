"use client";
import React, { useState, useRef, useEffect } from "react";
import { GridRowConfig, OptionSide, StrikeLabel } from "@/lib/types";
import { RowLiveData, rowId } from "@/context/DashboardContext";
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronUp, Play, Square } from "lucide-react";

const STATUS_MAP: Record<string, { label: string; color: string }> = {
    idle: { label: "Idle", color: "var(--text-muted)" },
    running: { label: "Watching", color: "var(--accent-blue)" },
    intrade: { label: "In Trade", color: "var(--accent-yellow)" },
    target: { label: "✓ Target", color: "var(--accent-green)" },
    sl: { label: "✗ SL Hit", color: "var(--accent-red)" },
    error: { label: "Error", color: "var(--accent-orange)" },
    stopped: { label: "Stopped", color: "var(--text-muted)" },
};

// ── LTP flash cell ─────────────────────────────────────────────────────────────
// Flashes green when price goes up, red when price goes down.
function LtpCell({ ltp, accentColor }: { ltp: number; accentColor: string }) {
    const prevRef = useRef<number>(ltp);
    const [flash, setFlash] = useState<"up" | "down" | null>(null);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const prev = prevRef.current;
        if (ltp !== prev && prev !== 0) {
            const dir = ltp > prev ? "up" : "down";
            setFlash(dir);
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => setFlash(null), 350);
        }
        prevRef.current = ltp;
    }, [ltp]);

    const flashBg =
        flash === "up" ? "rgba(0,230,118,0.18)" :
            flash === "down" ? "rgba(255,61,87,0.18)" :
                "transparent";
    const flashColor =
        flash === "up" ? "var(--accent-green)" :
            flash === "down" ? "var(--accent-red)" :
                accentColor;

    return (
        <span style={{
            fontSize: 12, fontWeight: 700,
            color: flashColor,
            fontVariantNumeric: "tabular-nums",
            background: flashBg,
            borderRadius: 4,
            padding: "1px 4px",
            display: "inline-block",
            transition: "background 0.35s ease, color 0.35s ease",
        }}>
            ₹{ltp.toFixed(1)}
        </span>
    );
}

interface TradingGridProps {
    side: OptionSide;
    rows: GridRowConfig[];
    liveData: Record<string, RowLiveData>;
    onUpdateRow: (index: number, updates: Partial<GridRowConfig>) => void;
    onStartRow: (id: string) => void;
    onStopRow: (id: string) => void;
}

const labelIcon = (label: StrikeLabel) => {
    if (label === "OTM1") return <TrendingUp size={12} />;
    if (label === "ITM1") return <TrendingDown size={12} />;
    return <Minus size={12} />;
};

function OpenLotsPanel({ live, side }: { live: RowLiveData; side: OptionSide }) {
    const accentColor = side === "CE" ? "var(--ce-color)" : "var(--pe-color)";
    if (!live.open_lots.length) return null;
    return (
        <div style={{ background: "var(--bg-primary)", borderTop: "1px solid var(--border)", padding: "10px 14px" }}>
            <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>
                Open Lots — {live.open_lot_count}/{live.max_lots_total}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {live.open_lots.map(lot => {
                    const isProfit = lot.unrealized >= 0;
                    const pct = Math.max(0, Math.min(100, (lot.unrealized / (lot.target_ltp - lot.entry_ltp)) * 100));
                    return (
                        <div key={lot.lot_number} style={{
                            background: "var(--bg-surface)",
                            border: `1px solid ${isProfit ? "rgba(0,230,118,0.3)" : "rgba(255,61,87,0.3)"}`,
                            borderRadius: 10, padding: "8px 12px", minWidth: 130,
                        }}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                                <span style={{ fontSize: 11, fontWeight: 700, color: accentColor }}>Lot-{lot.lot_number}</span>
                                <span style={{ fontSize: 11, fontWeight: 700, color: isProfit ? "var(--accent-green)" : "var(--accent-red)" }}>
                                    {isProfit ? "+" : ""}{lot.unrealized.toFixed(1)} pts
                                </span>
                            </div>
                            <div style={{ fontSize: 11, color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
                                Entry ₹{lot.entry_ltp.toFixed(1)} → ₹{lot.target_ltp.toFixed(1)}
                            </div>
                            <div style={{ marginTop: 6, height: 3, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
                                <div style={{
                                    height: "100%", width: `${pct}%`,
                                    background: isProfit ? "var(--accent-green)" : "var(--accent-red)",
                                    borderRadius: 2, transition: "width 0.5s ease",
                                }} />
                            </div>
                        </div>
                    );
                })}
            </div>
            <div style={{ marginTop: 10, display: "flex", gap: 20, fontSize: 11, color: "var(--text-muted)" }}>
                <span>Closed today: <b style={{ color: "var(--text-primary)" }}>{live.lots_closed_today}</b></span>
                <span>Total pts: <b style={{ color: live.total_points_today >= 0 ? "var(--accent-green)" : "var(--accent-red)" }}>
                    {live.total_points_today >= 0 ? "+" : ""}{live.total_points_today.toFixed(1)}
                </b></span>
                <span>P&amp;L: <b style={{ color: live.total_pnl_today >= 0 ? "var(--accent-green)" : "var(--accent-red)" }}>
                    {live.total_pnl_today >= 0 ? "+" : ""}₹{Math.abs(live.total_pnl_today).toLocaleString("en-IN")}
                </b></span>
            </div>
        </div>
    );
}

export default function TradingGrid({ side, rows, liveData, onUpdateRow, onStartRow, onStopRow }: TradingGridProps) {
    const isCE = side === "CE";
    const accentColor = isCE ? "var(--ce-color)" : "var(--pe-color)";
    const bgGlow = isCE ? "rgba(59,123,255,0.06)" : "rgba(255,61,87,0.06)";
    const borderAccent = isCE ? "rgba(59,123,255,0.3)" : "rgba(255,61,87,0.3)";
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
    const toggle = (label: string) => setExpandedRows(p => { const n = new Set(p); n.has(label) ? n.delete(label) : n.add(label); return n; });

    const hStyle: React.CSSProperties = {
        fontSize: 10, color: "var(--text-muted)", fontWeight: 600,
        letterSpacing: "0.5px", textTransform: "uppercase", textAlign: "center", padding: "6px 4px",
    };
    const cStyle: React.CSSProperties = {
        padding: "6px 4px", textAlign: "center",
        borderTop: "1px solid var(--border)", verticalAlign: "middle",
    };

    return (
        <div style={{ background: "var(--bg-card)", border: `1px solid ${borderAccent}`, borderRadius: 14, overflow: "hidden", flex: 1 }}>
            {/* Header */}
            <div style={{ padding: "12px 16px 10px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8, background: bgGlow }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: accentColor, boxShadow: `0 0 8px ${accentColor}` }} />
                <span style={{ fontWeight: 700, fontSize: 15, color: accentColor }}>{isCE ? "Call Buy" : "Put Buy"} Grid</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", background: "var(--bg-surface)", padding: "2px 8px", borderRadius: 20, border: "1px solid var(--border)" }}>{side}</span>
            </div>

            <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                    <thead>
                        <tr style={{ background: "var(--bg-surface)" }}>
                            <th style={{ ...hStyle, textAlign: "left", paddingLeft: 8 }}>Strike</th>
                            <th style={hStyle}>LTP</th>
                            <th style={hStyle}>Lots</th>
                            <th style={hStyle}>Re-entry Pts</th>
                            <th style={hStyle}>Profit Pts</th>
                            <th style={hStyle}>Max Re-entries</th>
                            <th style={hStyle}>Hedge</th>
                            <th style={hStyle}>Auto Sell</th>
                            <th style={hStyle}>Open Lots</th>
                            <th style={hStyle}>Status</th>
                            <th style={hStyle}>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map((row, i) => {
                            const id = rowId(side, row.strikeLabel);
                            const live = liveData[id];
                            const statusKey = live?.status ?? row.status;
                            const statusInfo = STATUS_MAP[statusKey] ?? STATUS_MAP.idle;
                            const displayLtp = live?.current_ltp && live.current_ltp > 0 ? live.current_ltp : row.ltp;
                            const openCount = live?.open_lot_count ?? 0;
                            const maxTotal = live?.max_lots_total ?? (1 + row.maxReentries);
                            const isExpanded = expandedRows.has(row.strikeLabel);
                            const isActive = statusKey === "intrade";

                            return (
                                <React.Fragment key={row.strikeLabel}>
                                    <tr style={{ background: isActive ? "rgba(255,215,64,0.04)" : "transparent", transition: "background 0.3s" }}>
                                        {/* Strike */}
                                        <td style={{ ...cStyle, textAlign: "left", paddingLeft: 8 }}>
                                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                                <span style={{
                                                    display: "inline-flex", alignItems: "center", gap: 2,
                                                    fontSize: 9, fontWeight: 700, color: accentColor,
                                                    background: `${accentColor}18`, border: `1px solid ${accentColor}40`,
                                                    padding: "1px 5px", borderRadius: 10,
                                                }}>{labelIcon(row.strikeLabel)} {row.strikeLabel}</span>
                                                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>
                                                    {row.strike.toLocaleString("en-IN")} {side}
                                                </span>
                                            </div>
                                        </td>

                                        {/* LTP — flashes green/red on tick */}
                                        <td style={cStyle}>
                                            <LtpCell ltp={displayLtp} accentColor={accentColor} />
                                        </td>

                                        {/* Lots */}
                                        <td style={cStyle}>
                                            <input type="number" min={1} max={50} className="grid-input" value={row.lots} style={{ width: 44 }}
                                                onChange={e => onUpdateRow(i, { lots: Number(e.target.value) })} />
                                        </td>

                                        {/* Re-entry Pts */}
                                        <td style={cStyle}>
                                            <input type="number" min={0.5} step={0.5} className="grid-input" value={row.avgReentryPoints} style={{ width: 48 }}
                                                onChange={e => onUpdateRow(i, { avgReentryPoints: Number(e.target.value) })} />
                                        </td>

                                        {/* Profit Pts */}
                                        <td style={cStyle}>
                                            <input type="number" min={0.5} step={0.5} className="grid-input" value={row.profitTakingPoints} style={{ width: 48 }}
                                                onChange={e => onUpdateRow(i, { profitTakingPoints: Number(e.target.value) })} />
                                        </td>

                                        {/* Max Re-entries */}
                                        <td style={cStyle}>
                                            <input type="number" min={0} max={20} className="grid-input" value={row.maxReentries} style={{ width: 44 }}
                                                onChange={e => onUpdateRow(i, { maxReentries: Number(e.target.value) })} />
                                        </td>

                                        {/* Hedge */}
                                        <td style={cStyle}>
                                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                                                <input type="checkbox" checked={row.hedge} style={{ width: 14, height: 14, cursor: "pointer" }}
                                                    onChange={e => onUpdateRow(i, { hedge: e.target.checked })} />
                                                {row.hedge && (
                                                    <span style={{ fontSize: 9, color: isCE ? "var(--pe-color)" : "var(--ce-color)", fontWeight: 600 }}>
                                                        Buy {isCE ? "PE" : "CE"}
                                                    </span>
                                                )}
                                            </div>
                                        </td>

                                        {/* Auto Sell */}
                                        <td style={cStyle}>
                                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                                                <input type="checkbox" checked={row.autoSell} style={{ width: 14, height: 14, cursor: "pointer" }}
                                                    onChange={e => onUpdateRow(i, { autoSell: e.target.checked })} />
                                                {row.autoSell && (
                                                    <span style={{ fontSize: 9, color: "var(--accent-green)", fontWeight: 600 }}>
                                                        Limit
                                                    </span>
                                                )}
                                            </div>
                                        </td>

                                        {/* Open Lots badge */}
                                        <td style={cStyle}>
                                            <button onClick={() => live && toggle(row.strikeLabel)} disabled={!live || openCount === 0}
                                                style={{
                                                    display: "flex", alignItems: "center", gap: 3, margin: "0 auto",
                                                    background: openCount > 0 ? `${accentColor}18` : "transparent",
                                                    border: `1px solid ${openCount > 0 ? `${accentColor}40` : "var(--border)"}`,
                                                    color: openCount > 0 ? accentColor : "var(--text-muted)",
                                                    borderRadius: 6, padding: "3px 6px",
                                                    fontSize: 10, fontWeight: 700, cursor: openCount > 0 ? "pointer" : "default",
                                                    transition: "all 0.2s",
                                                }}>
                                                {openCount}/{maxTotal}
                                                {openCount > 0 && (isExpanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
                                            </button>
                                        </td>

                                        {/* Status */}
                                        <td style={cStyle}>
                                            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                                                {isActive && (
                                                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent-yellow)", boxShadow: "0 0 5px var(--accent-yellow)", display: "inline-block" }} />
                                                )}
                                                <span style={{ fontSize: 10, fontWeight: 600, color: statusInfo.color }}>{statusInfo.label}</span>
                                            </div>
                                        </td>

                                        {/* Run / Stop button */}
                                        <td style={cStyle}>
                                            {(() => {
                                                const isStoppable = statusKey === "running" || statusKey === "intrade";
                                                return (
                                                    <button
                                                        onClick={() => isStoppable ? onStopRow(id) : onStartRow(id)}
                                                        title={isStoppable ? "Stop this trade" : "Start this trade"}
                                                        style={{
                                                            display: "inline-flex", alignItems: "center", gap: 4,
                                                            padding: "4px 8px", borderRadius: 6,
                                                            fontSize: 10, fontWeight: 700, cursor: "pointer",
                                                            border: `1px solid ${isStoppable ? "rgba(255,61,87,0.5)" : `${accentColor}55`}`,
                                                            background: isStoppable ? "rgba(255,61,87,0.12)" : `${accentColor}18`,
                                                            color: isStoppable ? "var(--accent-red)" : accentColor,
                                                            transition: "all 0.2s",
                                                        }}
                                                    >
                                                        {isStoppable
                                                            ? <><Square size={10} fill="currentColor" /> Stop</>
                                                            : <><Play size={10} fill="currentColor" /> Run</>}
                                                    </button>
                                                );
                                            })()}
                                        </td>
                                    </tr>

                                    {/* Open lots expandable panel */}
                                    {isExpanded && live && live.open_lots.length > 0 && (
                                        <tr key={`${row.strikeLabel}-lots`}>
                                            <td colSpan={11} style={{ padding: 0 }}>
                                                <OpenLotsPanel live={live} side={side} />
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
