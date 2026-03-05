// Shared types for Autotrade

export type Underlying = "NIFTY" | "BANKNIFTY" | "FINNIFTY";
export type Expiry = "weekly" | "monthly";
export type StrikeLabel = "OTM1" | "ATM" | "ITM1";
export type OptionSide = "CE" | "PE";
export type BotStatus = "idle" | "running" | "intrade" | "target" | "sl" | "error" | "stopped";
export type BrokerName = "aliceblue" | "zerodha";

export interface BrokerAccount {
    id: string;
    name: BrokerName;
    label: string;
    connected: boolean;
    clientId?: string;
}

export interface StrikeInfo {
    label: StrikeLabel;
    ceStrike: number;
    peStrike: number;
    ceLtp: number;
    peLtp: number;
}

export interface GridRowConfig {
    strikeLabel: StrikeLabel;
    strike: number;
    symbol: string;   // e.g. "NIFTY10MAR2622500CE" — set from strikes response
    ltp: number;
    lots: number;
    avgReentryPoints: number;
    profitTakingPoints: number;
    maxReentries: number;
    hedge: boolean;
    hedgeSymbol: string;   // opposite-side symbol if hedge is enabled
    status: BotStatus;
    tradesCount: number;
    reentryCount: number;
    entryLtp?: number;
}

export interface TradeLog {
    id: string;
    time: string;
    side: OptionSide;
    strikeLabel: StrikeLabel;
    strike: number;
    entryLtp: number;
    exitLtp: number;
    lots: number;
    points: number;
    pnl: number;
    reason: "target" | "sl" | "manual";
    isHedge: boolean;
}

export interface DashboardState {
    underlying: Underlying;
    expiry: Expiry;
    broker: BrokerName;
    paperMode: boolean;
    running: boolean;
    ceGrid: GridRowConfig[];
    peGrid: GridRowConfig[];
    trades: TradeLog[];
    strikes: StrikeInfo[];
}
