const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export const api = {
    // Broker
    brokerStatus: () =>
        fetch(`${API_BASE}/api/broker/status`).then(r => r.json()),

    connectBroker: (broker: string, payload: object) =>
        fetch(`${API_BASE}/api/broker/connect`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ broker, ...payload }),
        }).then(r => r.json()),

    zerodhaLoginUrl: () =>
        fetch(`${API_BASE}/api/broker/zerodha/login-url`).then(r => r.json()),

    // Strikes
    fetchStrikes: async (underlying: string, expiry: string, broker: string) => {
        const r = await fetch(`${API_BASE}/api/strikes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ underlying, expiry, broker }),
        });
        if (!r.ok) {
            const err = await r.json().catch(() => ({ detail: r.statusText }));
            throw new Error(err?.detail ?? "Strike fetch failed");
        }
        return r.json();
    },

    // Bot control
    configureBotRow: (payload: object) =>
        fetch(`${API_BASE}/api/bot/configure`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        }).then(r => r.json()),

    /**
     * Run button: configure + start a single row in one request.
     * This is the main entry-point for the Action column's Run button.
     */
    runRow: (payload: object) =>
        fetch(`${API_BASE}/api/bot/run-row`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        }).then(async r => {
            if (!r.ok) {
                const err = await r.json().catch(() => ({ detail: r.statusText }));
                throw new Error(err?.detail ?? "Run row failed");
            }
            return r.json();
        }),

    stopRow: (rowId: string) =>
        fetch(`${API_BASE}/api/bot/${rowId}/stop`, { method: "POST" }).then(r => r.json()),

    startAll: () =>
        fetch(`${API_BASE}/api/bot/start-all`, { method: "POST" }).then(r => r.json()),

    stopAll: () =>
        fetch(`${API_BASE}/api/bot/stop-all`, { method: "POST" }).then(r => r.json()),

    killAll: () =>
        fetch(`${API_BASE}/api/bot/kill-all`, { method: "POST" }).then(r => r.json()),

    getGlobalSettings: () =>
        fetch(`${API_BASE}/api/global-settings`).then(r => r.json()),

    setGlobalSettings: (payload: object) =>
        fetch(`${API_BASE}/api/global-settings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
        }).then(r => r.json()),

    // Trades & Orders
    getTodayTrades: () =>
        fetch(`${API_BASE}/api/trades/today`).then(r => r.json()),

    getTodayOrders: () =>
        fetch(`${API_BASE}/api/orders/today`).then(r => r.json()),

    getNiftyChart: () =>
        fetch(`${API_BASE}/api/chart/nifty`).then(r => r.json()),
};

