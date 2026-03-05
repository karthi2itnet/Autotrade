"use client";
import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from "react";
import {
    DashboardState, GridRowConfig, Underlying, Expiry, BrokerName, StrikeLabel
} from "@/lib/types";
import { useTradeWebSocket, WsRowState, WsBrokerTrade, WsBrokerOrder } from "@/hooks/useTradeWebSocket";
import { api } from "@/lib/api";

// ── Row ID helpers ─────────────────────────────────────────────────────────────
export const rowId = (side: string, label: StrikeLabel) => `${side}-${label}`;

const STRIKE_LABELS: StrikeLabel[] = ["OTM1", "ATM", "ITM1"];

// ── Per-lot data coming from WS (separate from grid config) ───────────────────
export type RowLiveData = WsRowState;

interface DashboardContextType {
    state: DashboardState;
    liveData: Record<string, RowLiveData>;
    brokerTrades: WsBrokerTrade[];
    brokerOrders: WsBrokerOrder[];
    marketIndices: Record<string, number>;
    toolbarVisible: boolean;
    toggleToolbar: () => void;
    wsConnected: boolean;
    strikesLoaded: boolean;
    updateCeRow: (index: number, updates: Partial<GridRowConfig>) => void;
    updatePeRow: (index: number, updates: Partial<GridRowConfig>) => void;
    setUnderlying: (u: Underlying) => void;
    setExpiry: (e: Expiry) => void;
    setBroker: (b: BrokerName) => void;
    togglePaperMode: () => void;
    startAll: () => void;
    stopAll: () => void;
    killAll: () => void;
    startRow: (id: string) => void;
    stopRow: (id: string) => void;
    loadStrikes: () => Promise<void>;
}

const defaultState: DashboardState = {
    underlying: "NIFTY",
    expiry: "weekly",
    broker: "aliceblue",
    paperMode: false,
    running: false,
    ceGrid: [],
    peGrid: [],
    trades: [],
    strikes: [],
};

const DashboardContext = createContext<DashboardContextType | null>(null);

export const DashboardProvider = ({ children }: { children: React.ReactNode }) => {
    const [state, setState] = useState<DashboardState>(defaultState);
    const [liveData, setLiveData] = useState<Record<string, RowLiveData>>({});
    const [brokerTrades, setBrokerTrades] = useState<WsBrokerTrade[]>([]);
    const [brokerOrders, setBrokerOrders] = useState<WsBrokerOrder[]>([]);
    const [marketIndices, setMarketIndices] = useState<Record<string, number>>({ NIFTY: 0, BANKNIFTY: 0, SENSEX: 0, INDIAVIX: 0 });
    const [toolbarVisible, setToolbarVisible] = useState(false);
    const [wsConnected, setWsConnected] = useState(false);
    const [strikesLoaded, setStrikesLoaded] = useState(false);
    const toggleToolbar = useCallback(() => setToolbarVisible(v => !v), []);

    // Refs that always hold the LATEST values — safe to read inside async callbacks
    const resolvedExpiryRef = useRef<string>("");
    const lotSizeRef = useRef<number>(75);
    const gridRef = useRef<{ ce: GridRowConfig[]; pe: GridRowConfig[] }>({ ce: [], pe: [] });
    const dashStateRef = useRef(state);

    // Keep refs in sync on every render
    useEffect(() => {
        gridRef.current = { ce: state.ceGrid, pe: state.peGrid };
        dashStateRef.current = state;
    });

    // ── WebSocket: receive live row states ──────────────────────────────────────
    const handleWsUpdate = useCallback((rows: Record<string, WsRowState>) => {
        setLiveData(rows);
        setState(s => {
            const applyLive = (grid: GridRowConfig[], side: string) =>
                grid.map(row => {
                    const id = rowId(side, row.strikeLabel);
                    const live = rows[id];
                    if (!live) return row;
                    return {
                        ...row,
                        ltp: live.current_ltp > 0 ? live.current_ltp : row.ltp,
                        status: live.status as GridRowConfig["status"],
                    };
                });
            return {
                ...s,
                ceGrid: applyLive(s.ceGrid, "CE"),
                peGrid: applyLive(s.peGrid, "PE"),
            };
        });
    }, []);

    // ── WebSocket: receive live LTP cache (updates even idle rows) ──────────────
    const handleLtpCacheUpdate = useCallback((cache: Record<string, number>) => {
        if (!cache || Object.keys(cache).length === 0) return;
        setState(s => {
            const applyCache = (grid: GridRowConfig[]) =>
                grid.map(row => {
                    const ltp = row.symbol ? cache[row.symbol] : undefined;
                    if (ltp && ltp > 0) return { ...row, ltp };
                    return row;
                });
            return {
                ...s,
                ceGrid: applyCache(s.ceGrid),
                peGrid: applyCache(s.peGrid),
            };
        });
    }, []);

    const handleTradesUpdate = useCallback((trades: WsBrokerTrade[]) => {
        setBrokerTrades(trades);
    }, []);

    const handleOrdersUpdate = useCallback((orders: WsBrokerOrder[]) => {
        setBrokerOrders(orders);
    }, []);

    const handleIndicesUpdate = useCallback((indices: Record<string, number>) => {
        setMarketIndices(prev => ({ ...prev, ...indices }));
    }, []);

    useTradeWebSocket({
        onUpdate: handleWsUpdate,
        onLtpCacheUpdate: handleLtpCacheUpdate,
        onTradesUpdate: handleTradesUpdate,
        onOrdersUpdate: handleOrdersUpdate,
        onIndicesUpdate: handleIndicesUpdate,
        onOpen: () => setWsConnected(true),
        onClose: () => setWsConnected(false),
    });

    // ── Row config updates ──────────────────────────────────────────────────────
    const updateCeRow = useCallback((index: number, updates: Partial<GridRowConfig>) =>
        setState(s => { const g = [...s.ceGrid]; g[index] = { ...g[index], ...updates }; return { ...s, ceGrid: g }; }), []);

    const updatePeRow = useCallback((index: number, updates: Partial<GridRowConfig>) =>
        setState(s => { const g = [...s.peGrid]; g[index] = { ...g[index], ...updates }; return { ...s, peGrid: g }; }), []);

    // ── Load live strikes from broker ───────────────────────────────────────────
    const loadStrikes = useCallback(async () => {
        const { underlying, expiry, broker } = state;
        try {
            const data = await api.fetchStrikes(underlying, expiry, broker);
            if (!data?.ce || !data?.pe) throw new Error("Invalid strikes response");

            // Store expiry + lot_size for use in startRow later
            resolvedExpiryRef.current = data.expiry ?? expiry;
            lotSizeRef.current = data.lot_size ?? 75;

            const makeRow = (
                label: StrikeLabel,
                strike: number,
                ltp: number,
                symbol: string,
                hedgeSymbol: string,
            ): GridRowConfig => ({
                strikeLabel: label,
                strike,
                symbol,
                ltp,
                lots: 1,
                avgReentryPoints: 5,
                profitTakingPoints: 5,
                maxReentries: 2,
                hedge: false,
                hedgeSymbol,
                status: "idle",
                tradesCount: 0,
                reentryCount: 0,
            });

            // Build grids — we store the opposite-side symbol as hedge symbol
            const ceGrid: GridRowConfig[] = STRIKE_LABELS.map(label => {
                const info = data.ce[label] ?? { strike: 0, ltp: 0, symbol: "" };
                // Hedge for a CE buy = buy PE at the same strike (ATM/near)
                const hedgeInfo = data.pe[label] ?? { symbol: "" };
                return makeRow(label, info.strike, info.ltp, info.symbol, hedgeInfo.symbol);
            });
            const peGrid: GridRowConfig[] = STRIKE_LABELS.map(label => {
                const info = data.pe[label] ?? { strike: 0, ltp: 0, symbol: "" };
                const hedgeInfo = data.ce[label] ?? { symbol: "" };
                return makeRow(label, info.strike, info.ltp, info.symbol, hedgeInfo.symbol);
            });

            setState(s => ({ ...s, ceGrid, peGrid }));
            setStrikesLoaded(true);
        } catch (err) {
            console.error("loadStrikes failed:", err);
            throw err;
        }
    }, [state]);

    // ── Selectors ───────────────────────────────────────────────────────────────
    const setUnderlying = (u: Underlying) => setState(s => ({ ...s, underlying: u }));
    const setExpiry = (e: Expiry) => setState(s => ({ ...s, expiry: e }));
    const setBroker = (b: BrokerName) => setState(s => ({ ...s, broker: b }));
    const togglePaperMode = () => setState(s => ({ ...s, paperMode: !s.paperMode }));

    // ── Bot controls ───────────────────────────────────────────────────────────
    const startAll = async () => {
        setState(s => ({ ...s, running: true }));
        try { await api.startAll(); } catch { /* backend offline — paper mode handles it */ }
    };
    const stopAll = async () => {
        setState(s => ({ ...s, running: false }));
        try { await api.stopAll(); } catch { }
    };
    const killAll = async () => {
        setState(s => ({ ...s, running: false }));
        try { await api.killAll(); } catch { }
    };

    /**
     * Run button handler.
     *
     * Reads grid data via gridRef / dashStateRef (always current) instead of
     * the closed-over `state` to avoid stale-closure issues.
     */
    const startRow = useCallback(async (id: string) => {
        // id = "CE-ATM", "PE-OTM1", etc. — split on FIRST dash only
        const dashIdx = id.indexOf("-");
        const side = id.slice(0, dashIdx);
        const strikeLabel = id.slice(dashIdx + 1) as StrikeLabel;

        // Read LATEST grid from the ref — never stale
        const grid = side === "CE" ? gridRef.current.ce : gridRef.current.pe;
        const row = grid.find(r => r.strikeLabel === strikeLabel);
        const s = dashStateRef.current;

        if (!row) {
            // Shouldn't normally reach here since the button is only rendered when grid is populated
            alert(`Cannot start "${id}": row data missing.\nPlease click "Load Strikes" to refresh.`);
            return;
        }
        if (!row.strike || row.strike === 0) {
            alert(`Cannot start "${id}": strike price is 0.\nPlease reload strikes.`);
            return;
        }

        // Pass "" for symbol — backend builds it from underlying+expiry+strike+side if empty
        const symbol = (row.symbol && row.symbol.length > 4) ? row.symbol : "";
        const lotSize = lotSizeRef.current > 0 ? lotSizeRef.current : 0;

        // Fire-and-forget: do NOT await the API call.
        // Alice Blue's place_order REST call takes 4-8 s. The bot starts immediately on the
        // backend — we let it run in the background and receive confirmation via WebSocket.
        console.time(`runRow-${id}`);
        api.runRow({
            row_id: id,
            underlying: s.underlying,
            expiry: resolvedExpiryRef.current || s.expiry,
            side,
            strike_label: strikeLabel,
            strike: row.strike,
            symbol,
            lots: row.lots,
            lot_size: lotSize,
            profit_taking_pts: row.profitTakingPoints,
            avg_reentry_pts: row.avgReentryPoints,
            max_reentries: row.maxReentries,
            hedge: row.hedge,
            hedge_symbol: row.hedgeSymbol ?? "",
            broker: s.broker,
            paper_mode: s.paperMode,
        }).then(result => {
            console.timeEnd(`runRow-${id}`);
            console.info(`[Run] ✓ ${id}  strike=${row.strike}  symbol=${result?.symbol}  expiry=${result?.expiry}`);
        }).catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`[Run] ✗ ${id}:`, msg);
            alert(`⚠️ Could not start ${id}:\n${msg}`);
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);   // empty deps — reads latest data via refs, never stale



    const stopRow = async (id: string) => {
        try { await api.stopRow(id); } catch { }
    };

    return (
        <DashboardContext.Provider value={{
            state, liveData, brokerTrades, brokerOrders, marketIndices,
            toolbarVisible, toggleToolbar,
            wsConnected, strikesLoaded,
            updateCeRow, updatePeRow,
            setUnderlying, setExpiry, setBroker, togglePaperMode,
            startAll, stopAll, killAll,
            startRow, stopRow,
            loadStrikes,
        }}>
            {children}
        </DashboardContext.Provider>
    );
};

export const useDashboard = () => {
    const ctx = useContext(DashboardContext);
    if (!ctx) throw new Error("useDashboard must be used within DashboardProvider");
    return ctx;
};
