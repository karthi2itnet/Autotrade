"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Wifi, WifiOff, CheckCircle, AlertCircle, ExternalLink, Loader, RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { useDashboard } from "@/context/DashboardContext";

type BrokerStatus = "idle" | "connecting" | "connected" | "error";

interface BrokerConfig {
    status: BrokerStatus;
    error: string;
}

const CARD_STYLE: React.CSSProperties = {
    background: "var(--bg-card)",
    border: "1px solid var(--border)",
    borderRadius: 16,
    padding: 28,
    flex: 1,
    minWidth: 320,
};

const INPUT_STYLE: React.CSSProperties = {
    width: "100%",
    background: "var(--bg-primary)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: "10px 14px",
    color: "var(--text-primary)",
    fontSize: 13,
    outline: "none",
    fontFamily: "inherit",
};

const LABEL_STYLE: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    letterSpacing: "0.5px",
    marginBottom: 6,
    display: "block",
};

function PasswordInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
    const [show, setShow] = useState(false);
    return (
        <div style={{ position: "relative" }}>
            <input
                type={show ? "text" : "password"}
                style={{ ...INPUT_STYLE, paddingRight: 40 }}
                value={value}
                onChange={e => onChange(e.target.value)}
                placeholder={placeholder}
            />
            <button
                type="button"
                onClick={() => setShow(p => !p)}
                style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", display: "flex" }}>
                {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
        </div>
    );
}

function StatusBadge({ status, error }: { status: BrokerStatus; error: string }) {
    const map: Record<BrokerStatus, { icon: React.ReactNode; text: string; color: string }> = {
        idle: { icon: <WifiOff size={14} />, text: "Not connected", color: "var(--text-muted)" },
        connecting: { icon: <Loader size={14} className="animate-spin" />, text: "Connecting…", color: "var(--accent-yellow)" },
        connected: { icon: <CheckCircle size={14} />, text: "Connected", color: "var(--accent-green)" },
        error: { icon: <AlertCircle size={14} />, text: error || "Error", color: "var(--accent-red)" },
    };
    const s = map[status];
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: s.color, fontSize: 13, fontWeight: 600 }}>
            {s.icon} {s.text}
        </div>
    );
}

// ── Alice Blue Card ─────────────────────────────────────────────────────────────
function AliceBlueCard() {
    const { loadStrikes } = useDashboard();
    const router = useRouter();
    const [cfg, setCfg] = useState({ userId: "", apiKey: "", twofa: "" });
    const [broker, setBroker] = useState<BrokerConfig>({ status: "idle", error: "" });
    const [strikeStatus, setStrikeStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");

    const connect = async () => {
        if (!cfg.userId || !cfg.apiKey || !cfg.twofa) {
            setBroker({ status: "error", error: "All fields required" });
            return;
        }
        setBroker({ status: "connecting", error: "" });
        try {
            await api.connectBroker("aliceblue", {
                user_id: cfg.userId,
                api_key: cfg.apiKey,
                twofa: cfg.twofa,
            });
            setBroker({ status: "connected", error: "" });
            // Auto-load live strikes right after connecting
            setStrikeStatus("loading");
            try {
                await loadStrikes();
                setStrikeStatus("loaded");
                // Auto-redirect to dashboard upon successful strike load
                setTimeout(() => router.push("/"), 800);
            } catch {
                setStrikeStatus("error");
            }
        } catch (e: unknown) {
            setBroker({ status: "error", error: e instanceof Error ? e.message : "Connection failed" });
        }
    };

    const reloadStrikes = async () => {
        setStrikeStatus("loading");
        try {
            await loadStrikes();
            setStrikeStatus("loaded");
            setTimeout(() => router.push("/"), 800);
        } catch {
            setStrikeStatus("error");
        }
    };

    return (
        <div style={CARD_STYLE}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
                <div>
                    <div style={{ fontWeight: 700, fontSize: 17, color: "var(--text-primary)", marginBottom: 4 }}>Alice Blue</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Ant API — API Key + 2FA</div>
                </div>
                <div style={{
                    width: 44, height: 44, borderRadius: 12,
                    background: "rgba(255,140,0,0.15)",
                    border: "1px solid rgba(255,140,0,0.3)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 20,
                }}>🅱️</div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                    <label style={LABEL_STYLE}>User ID</label>
                    <input style={INPUT_STYLE} placeholder="e.g. AB1234" value={cfg.userId} onChange={e => setCfg(p => ({ ...p, userId: e.target.value }))} />
                </div>
                <div>
                    <label style={LABEL_STYLE}>API Key</label>
                    <PasswordInput value={cfg.apiKey} onChange={v => setCfg(p => ({ ...p, apiKey: v }))} placeholder="Your Alice Blue API key" />
                </div>
                <div>
                    <label style={LABEL_STYLE}>2FA / TOTP</label>
                    <PasswordInput value={cfg.twofa} onChange={v => setCfg(p => ({ ...p, twofa: v }))} placeholder="Your 2FA / TOTP code" />
                    <span style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, display: "block" }}>
                        Use your app-generated 2FA (TOTP) at the time of login
                    </span>
                </div>
            </div>

            <div style={{ marginTop: 24, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <StatusBadge status={broker.status} error={broker.error} />
                <button
                    onClick={connect}
                    disabled={broker.status === "connecting" || broker.status === "connected"}
                    style={{
                        background: broker.status === "connected" ? "var(--accent-green)" : "var(--accent-blue)",
                        color: "#fff", border: "none", borderRadius: 10,
                        padding: "10px 22px", fontWeight: 700, fontSize: 13,
                        cursor: broker.status === "connecting" || broker.status === "connected" ? "not-allowed" : "pointer",
                        opacity: broker.status === "connecting" ? 0.7 : 1,
                        display: "flex", alignItems: "center", gap: 6,
                    }}>
                    {broker.status === "connected" ? <><CheckCircle size={14} /> Connected</> :
                        broker.status === "connecting" ? <><Loader size={14} /> Connecting…</> :
                            <><Wifi size={14} /> Connect</>}
                </button>
            </div>

            {/* Strike load status — shown only after connect attempt */}
            {strikeStatus !== "idle" && (
                <div style={{
                    marginTop: 14, padding: "10px 14px", borderRadius: 10,
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    background: strikeStatus === "loaded" ? "rgba(0,230,118,0.08)" : strikeStatus === "error" ? "rgba(255,61,87,0.08)" : "rgba(59,123,255,0.08)",
                    border: `1px solid ${strikeStatus === "loaded" ? "rgba(0,230,118,0.25)" : strikeStatus === "error" ? "rgba(255,61,87,0.25)" : "rgba(59,123,255,0.25)"}`,
                }}>
                    <div style={{
                        display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600,
                        color: strikeStatus === "loaded" ? "var(--accent-green)" : strikeStatus === "error" ? "var(--accent-red)" : "var(--accent-blue)"
                    }}>
                        {strikeStatus === "loading" && <Loader size={14} className="animate-spin" />}
                        {strikeStatus === "loaded" && <CheckCircle size={14} />}
                        {strikeStatus === "error" && <AlertCircle size={14} />}
                        {strikeStatus === "loading" ? "Loading live strikes…" :
                            strikeStatus === "loaded" ? "Strikes loaded ✓ — Grid is ready" :
                                "Strike load failed — check broker connection"}
                    </div>
                    {(strikeStatus === "loaded" || strikeStatus === "error") && (
                        <button onClick={reloadStrikes} title="Reload strikes" style={{
                            background: "none", border: "none", cursor: "pointer",
                            color: "var(--text-muted)", display: "flex", padding: 4,
                        }}>
                            <RefreshCw size={14} />
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}

// ── Zerodha Card ────────────────────────────────────────────────────────────────
function ZerodhaCard() {
    const [cfg, setCfg] = useState({ apiKey: "", apiSecret: "" });
    const [broker, setBroker] = useState<BrokerConfig>({ status: "idle", error: "" });
    const [loginUrl, setLoginUrl] = useState("");
    const [requestToken, setRequestToken] = useState("");

    const getLoginUrl = async () => {
        if (!cfg.apiKey) { setBroker({ status: "error", error: "API Key required" }); return; }
        try {
            const data = await api.zerodhaLoginUrl();
            setLoginUrl(data.url ?? "");
        } catch {
            setBroker({ status: "error", error: "Could not fetch login URL" });
        }
    };

    const connect = async () => {
        if (!cfg.apiKey || !cfg.apiSecret || !requestToken) {
            setBroker({ status: "error", error: "API Key, API Secret, and request_token required" });
            return;
        }
        setBroker({ status: "connecting", error: "" });
        try {
            await api.connectBroker("zerodha", {
                api_key: cfg.apiKey,
                api_secret: cfg.apiSecret,
                request_token: requestToken,
            });
            setBroker({ status: "connected", error: "" });
        } catch (e: unknown) {
            setBroker({ status: "error", error: e instanceof Error ? e.message : "Connection failed" });
        }
    };

    return (
        <div style={CARD_STYLE}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
                <div>
                    <div style={{ fontWeight: 700, fontSize: 17, color: "var(--text-primary)", marginBottom: 4 }}>Zerodha</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Kite Connect — OAuth Login</div>
                </div>
                <div style={{
                    width: 44, height: 44, borderRadius: 12,
                    background: "rgba(34,197,94,0.12)",
                    border: "1px solid rgba(34,197,94,0.25)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 20,
                }}>🪁</div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                <div>
                    <label style={LABEL_STYLE}>API Key</label>
                    <input style={INPUT_STYLE} placeholder="e.g. kitefront_…" value={cfg.apiKey} onChange={e => setCfg(p => ({ ...p, apiKey: e.target.value }))} />
                </div>
                <div>
                    <label style={LABEL_STYLE}>API Secret</label>
                    <PasswordInput value={cfg.apiSecret} onChange={v => setCfg(p => ({ ...p, apiSecret: v }))} placeholder="Your Kite API secret" />
                </div>

                {/* Zerodha OAuth flow */}
                <div style={{
                    background: "rgba(59,123,255,0.07)",
                    border: "1px solid rgba(59,123,255,0.2)",
                    borderRadius: 10, padding: "14px 16px",
                }}>
                    <div style={{ fontSize: 12, color: "var(--accent-blue)", fontWeight: 600, marginBottom: 8 }}>
                        Zerodha uses OAuth — 2-step login
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
                        1. Click <b style={{ color: "var(--text-primary)" }}>Get Login URL</b> below<br />
                        2. Log in on Zerodha, copy the <code style={{ color: "var(--accent-blue)" }}>request_token</code> from the redirect URL<br />
                        3. Paste it below and click <b style={{ color: "var(--text-primary)" }}>Connect</b>
                    </div>
                </div>

                <button onClick={getLoginUrl} style={{
                    background: "var(--bg-surface)", border: "1px solid var(--border)",
                    color: "var(--text-primary)", borderRadius: 8,
                    padding: "9px 16px", fontWeight: 600, fontSize: 13,
                    cursor: "pointer", display: "flex", alignItems: "center", gap: 6, width: "fit-content",
                }}>
                    <ExternalLink size={13} /> Get Login URL
                </button>

                {loginUrl && (
                    <a href={loginUrl} target="_blank" rel="noreferrer" style={{
                        fontSize: 12, color: "var(--accent-blue)",
                        wordBreak: "break-all", textDecoration: "underline",
                    }}>{loginUrl}</a>
                )}

                <div style={{ marginTop: 6 }}>
                    <label style={LABEL_STYLE}>request_token</label>
                    <input style={INPUT_STYLE} placeholder="Paste request_token from redirect URL" value={requestToken} onChange={e => setRequestToken(e.target.value)} />
                </div>
            </div>

            <div style={{ marginTop: 24, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <StatusBadge status={broker.status} error={broker.error} />
                <button
                    onClick={connect}
                    disabled={broker.status === "connecting" || broker.status === "connected"}
                    style={{
                        background: broker.status === "connected" ? "var(--accent-green)" : "var(--accent-blue)",
                        color: "#fff", border: "none", borderRadius: 10,
                        padding: "10px 22px", fontWeight: 700, fontSize: 13,
                        cursor: broker.status === "connecting" || broker.status === "connected" ? "not-allowed" : "pointer",
                        opacity: broker.status === "connecting" ? 0.7 : 1,
                        display: "flex", alignItems: "center", gap: 6,
                    }}>
                    {broker.status === "connected" ? <><CheckCircle size={14} /> Connected</> :
                        broker.status === "connecting" ? <><Loader size={14} /> Connecting…</> :
                            <><Wifi size={14} /> Connect</>}
                </button>
            </div>
        </div>
    );
}

// ── Page ────────────────────────────────────────────────────────────────────────
export default function BrokerConnectPage() {
    return (
        <div style={{ minHeight: "100vh", background: "var(--bg-primary)" }}>
            <main style={{ padding: "32px 24px", maxWidth: 1000, margin: "0 auto" }}>
                {/* Page title */}
                <div style={{ marginBottom: 32 }}>
                    <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--text-primary)", marginBottom: 6 }}>
                        Broker Connect
                    </h1>
                    <p style={{ fontSize: 14, color: "var(--text-muted)" }}>
                        Connect your broker account to enable live trading. Credentials are stored in memory only — never persisted to disk.
                    </p>
                </div>

                {/* Cards */}
                <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
                    <AliceBlueCard />
                    <ZerodhaCard />
                </div>

                {/* Security note */}
                <div style={{
                    marginTop: 28,
                    background: "rgba(255,215,64,0.07)",
                    border: "1px solid rgba(255,215,64,0.2)",
                    borderRadius: 12, padding: "14px 18px",
                    display: "flex", gap: 10, alignItems: "flex-start",
                }}>
                    <AlertCircle size={16} color="var(--accent-yellow)" style={{ marginTop: 1, flexShrink: 0 }} />
                    <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--accent-yellow)", marginBottom: 4 }}>Security Note</div>
                        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.7 }}>
                            Your API keys and TOTP secret are sent to the local backend server only and are not stored in any database or file.
                            They exist in memory for the current session. Always run this application on a secure, private machine.
                        </div>
                    </div>
                </div>
            </main>
        </div>
    );
}
