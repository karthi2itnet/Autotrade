"use client";
import { useEffect, useRef, useCallback } from "react";

export type WsRowState = {
    status: string;
    current_ltp: number;
    open_lot_count: number;
    max_lots_total: number;
    lots_closed_today: number;
    total_points_today: number;
    total_pnl_today: number;
    reentry_count: number;
    open_lots: {
        lot_number: number;
        entry_ltp: number;
        target_ltp: number;
        unrealized: number;
    }[];
    trade_log: object[];
};

export type WsBrokerTrade = {
    id: string;
    time: string;
    side: string;
    strike_label: string;
    symbol: string;
    entry_ltp: number;
    exit_ltp: number;
    lots: number;
    points: number;
    pnl: number;
    transaction: string;
    reason: string;
    source: string;
    type: "trade";
};

export type WsBrokerOrder = {
    id: string;
    order_id: string;
    time: string;
    side: string;
    symbol: string;
    transaction: string;  // "BUY" | "SELL"
    quantity: number;
    price: number;
    status: string;       // "complete" | "rejected" | "cancelled" | "open" | ...
    source: string;
    type: "order";
};

export type WsGlobalSettings = {
    max_profit_limit: number;
    max_loss_limit: number;
    global_trading_halted: boolean;
};

type WsMessage = {
    type: "state_update";
    rows: Record<string, WsRowState>;
    global_settings?: WsGlobalSettings;
    ltp_cache?: Record<string, number>;
    broker_trades?: WsBrokerTrade[];
    broker_orders?: WsBrokerOrder[];
    indices?: Record<string, number>;
};

type Options = {
    url?: string;
    onUpdate: (rows: Record<string, WsRowState>) => void;
    onGlobalSettingsUpdate?: (settings: WsGlobalSettings) => void;
    onLtpCacheUpdate?: (cache: Record<string, number>) => void;
    onTradesUpdate?: (trades: WsBrokerTrade[]) => void;
    onOrdersUpdate?: (orders: WsBrokerOrder[]) => void;
    onIndicesUpdate?: (indices: Record<string, number>) => void;
    onOpen?: () => void;
    onClose?: () => void;
    onError?: (e: Event) => void;
};

const RECONNECT_MS = 3000;

export function useTradeWebSocket({
    url,
    onUpdate,
    onGlobalSettingsUpdate,
    onLtpCacheUpdate,
    onTradesUpdate,
    onOrdersUpdate,
    onIndicesUpdate,
    onOpen,
    onClose,
    onError,
}: Options) {
    // Dynamically build the WS URL if one isn't provided
    const wsUrl = url ?? (() => {
        const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
        return apiBase.replace(/^http/, "ws") + "/ws";
    })();
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const mountedRef = useRef(true);

    const connect = useCallback(() => {
        if (!mountedRef.current) return;

        try {
            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => {
                if (process.env.NODE_ENV === "development") console.log("[WS] Connected");
                onOpen?.();
            };

            ws.onmessage = (evt) => {
                try {
                    const msg: WsMessage = JSON.parse(evt.data);
                    if (msg.type === "state_update") {
                        onUpdate(msg.rows);
                        if (msg.global_settings && onGlobalSettingsUpdate) {
                            onGlobalSettingsUpdate(msg.global_settings);
                        }
                        if (msg.ltp_cache && onLtpCacheUpdate) {
                            onLtpCacheUpdate(msg.ltp_cache);
                        }
                        if (msg.broker_trades && onTradesUpdate) {
                            onTradesUpdate(msg.broker_trades);
                        }
                        if (msg.broker_orders && onOrdersUpdate) {
                            onOrdersUpdate(msg.broker_orders);
                        }
                        if (msg.indices && onIndicesUpdate) {
                            onIndicesUpdate(msg.indices);
                        }
                    }
                } catch {
                    // ignore malformed frames
                }
            };

            ws.onclose = () => {
                if (process.env.NODE_ENV === "development") console.log("[WS] Closed — reconnecting in 3s");
                onClose?.();
                if (mountedRef.current) {
                    reconnectRef.current = setTimeout(connect, RECONNECT_MS);
                }
            };

            ws.onerror = (e) => {
                console.warn("[WS] Error", e);
                onError?.(e);
                ws.close();
            };
        } catch (e) {
            // Browser may block WS if backend offline — retry quietly
            if (mountedRef.current) {
                reconnectRef.current = setTimeout(connect, RECONNECT_MS);
            }
        }
    }, [url, onUpdate, onGlobalSettingsUpdate, onLtpCacheUpdate, onTradesUpdate, onOrdersUpdate, onIndicesUpdate, onOpen, onClose, onError]);

    useEffect(() => {
        mountedRef.current = true;
        connect();
        return () => {
            mountedRef.current = false;
            if (reconnectRef.current) clearTimeout(reconnectRef.current);
            wsRef.current?.close();
        };
    }, [connect]);

    const send = useCallback((data: object) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(data));
        }
    }, []);

    return { send };
}

