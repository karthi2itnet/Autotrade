"""
FastAPI main application.
Provides REST API and WebSocket for the Autotrade frontend.
"""
import asyncio
import json
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import init_db, get_db
from app.config import settings
from app.services.bot_engine import bot_engine, BotRowConfig, BotStatus
from app.services.option_chain import get_strike_set
from app.services import notifier

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

# ── WebSocket connection manager ───────────────────────────────────────────────

class WSManager:
    def __init__(self):
        self.connections: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.connections.append(ws)

    def disconnect(self, ws: WebSocket):
        self.connections.remove(ws)

    async def broadcast(self, data: dict):
        text = json.dumps(data)
        for ws in list(self.connections):
            try:
                await ws.send_text(text)
            except Exception:
                self.connections.remove(ws)

ws_manager = WSManager()

# ── App lifecycle ──────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    logger.info("Database initialised")
    # Fast loop: push LTP + row state to frontend every 250 ms
    asyncio.create_task(_push_state_loop())
    # Fast loop: poll live option LTPs from broker every 250 ms (concurrent REST)
    asyncio.create_task(_ltp_poller_loop())
    # Fast loop: poll NIFTY/BANKNIFTY/SENSEX/VIX every 250 ms
    asyncio.create_task(_index_poller_loop())
    # Slow loop: refresh broker trade book every 5 s
    asyncio.create_task(_broker_trades_loop())
    yield
    await bot_engine.stop_all()

app = FastAPI(title="Autotrade API", version="1.0.0", lifespan=lifespan)

app.add_middleware(CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# ── Request/Response models ────────────────────────────────────────────────────

class BrokerConnectRequest(BaseModel):
    broker: str
    # Common fields (varies by broker)
    user_id: str = ""        # aliceblue
    api_key: str = ""        # aliceblue / zerodha
    api_secret: str = ""     # zerodha
    twofa: str = ""          # aliceblue (time-based 2FA/TOTP code)
    request_token: str = ""  # zerodha (oauth redirect token)

class BotRowRequest(BaseModel):
    row_id: str
    underlying: str
    expiry: str
    side: str
    strike_label: str
    strike: int
    symbol: str
    lots: int
    lot_size: int
    profit_taking_pts: float
    avg_reentry_pts: float
    max_reentries: int
    hedge: bool
    hedge_symbol: str = ""
    broker: str = "aliceblue"
    paper_mode: bool = True

class StrikeRequest(BaseModel):
    underlying: str
    expiry: str
    broker: str

# ── Broker endpoints ───────────────────────────────────────────────────────────

@app.post("/api/broker/connect")
async def broker_connect(req: BrokerConnectRequest):
    try:
        if req.broker == "aliceblue":
            from app.brokers import aliceblue
            result = await aliceblue.connect(user_id=req.user_id, api_key=req.api_key, twofa=req.twofa)
        elif req.broker == "zerodha":
            from app.brokers import zerodha
            result = await zerodha.connect(
                request_token=req.request_token,
                api_key=req.api_key,
                api_secret=req.api_secret,
            )
        else:
            raise HTTPException(400, "Unknown broker")
        await notifier.send_connection_alert(req.broker, "connected")
        return result
    except Exception as e:
        raise HTTPException(500, str(e))

@app.get("/")
async def root():
    return {"status": "Autotrade Backend is running"}

@app.get("/api/status")
async def health_status():
    return {"status": "ok"}
    
@app.get("/api/broker/status")
async def broker_status():
    from app.brokers import aliceblue, zerodha
    return {
        "aliceblue": aliceblue.is_connected(),
        "zerodha":  zerodha.is_connected(),
    }

@app.get("/api/debug/ltp")
async def debug_ltp():
    """Debug endpoint: inspect live LTP cache and symbol registry."""
    from app.brokers import aliceblue
    return {
        "connected": aliceblue.is_connected(),
        "registry_count": len(aliceblue._symbol_registry),
        "registry": [
            {"underlying": u, "expiry_iso": e, "strike": s, "side": t, "symbol": sym}
            for u, e, s, t, sym in aliceblue._symbol_registry
        ],
        "ltp_cache": dict(aliceblue._ltp_cache),
    }

@app.get("/api/broker/zerodha/login-url")
async def zerodha_login_url():
    from app.brokers import zerodha
    return {"url": zerodha.get_login_url()}


@app.get("/api/broker/ltp")
async def broker_ltp(broker: str, exchange: str, symbol: str):
    """
    Lightweight sanity-check endpoint: fetch LTP for a symbol using the connected broker.
    Example: /api/broker/ltp?broker=aliceblue&exchange=NSE&symbol=NIFTY
    """
    try:
        if broker == "aliceblue":
            from app.brokers import aliceblue
            return {"ltp": await aliceblue.get_ltp(exchange, symbol)}
        if broker == "zerodha":
            from app.brokers import zerodha
            return {"ltp": await zerodha.get_ltp(exchange, symbol)}
        raise HTTPException(400, "Unknown broker")
    except Exception as e:
        raise HTTPException(500, str(e))

# ── Option chain endpoint ──────────────────────────────────────────────────────

LOT_SIZES = {
    "NIFTY":      65,
    "BANKNIFTY":  30,
    "FINNIFTY":   65,
    "MIDCPNIFTY": 50,
}

def _build_symbol(underlying: str, expiry: str, strike: int, side: str) -> str:
    """Build the NFO trading symbol string, e.g. NIFTY10MAR2622500CE"""
    return f"{underlying}{expiry}{strike}{side}"

@app.post("/api/strikes")
async def fetch_strikes(req: StrikeRequest):
    try:
        strike_set = await get_strike_set(req.underlying, req.expiry, req.broker)
        expiry = strike_set.expiry          # resolved e.g. "10MAR26"
        lot_size = LOT_SIZES.get(req.underlying.upper(), 75)

        def _entry(strike: int, side: str, ltp: float) -> dict:
            return {
                "strike": strike,
                "ltp":    ltp,
                "symbol": _build_symbol(req.underlying, expiry, strike, side),
            }

        result = {
            "spot":     strike_set.spot_price,
            "atm":      strike_set.atm,
            "expiry":   expiry,
            "lot_size": lot_size,
            "ce": {
                "OTM1": _entry(strike_set.otm1_ce, "CE", strike_set.otm1_ce_ltp),
                "ATM":  _entry(strike_set.atm,     "CE", strike_set.atm_ce_ltp),
                "ITM1": _entry(strike_set.itm1_ce, "CE", strike_set.itm1_ce_ltp),
            },
            "pe": {
                "OTM1": _entry(strike_set.otm1_pe, "PE", strike_set.otm1_pe_ltp),
                "ATM":  _entry(strike_set.atm,     "PE", strike_set.atm_pe_ltp),
                "ITM1": _entry(strike_set.itm1_pe, "PE", strike_set.itm1_pe_ltp),
            },
        }

        # Register all 6 symbols with the live LTP poller so idle rows get
        # price updates immediately (without needing to click Run first).
        if req.broker == "aliceblue":
            from app.brokers import aliceblue
            from datetime import datetime as _dt
            try:
                expiry_iso = _dt.strptime(expiry, "%d%b%y").strftime("%Y-%m-%d")
                for side_key, side_str in [("ce", "CE"), ("pe", "PE")]:
                    for label in ("OTM1", "ATM", "ITM1"):
                        entry = result[side_key][label]
                        aliceblue.register_symbol(
                            req.underlying, expiry_iso,
                            entry["strike"], side_str, entry["symbol"]
                        )
            except Exception as reg_err:
                logger.warning("Symbol registration in fetch_strikes failed: %s", reg_err)

        return result
    except Exception as e:
        raise HTTPException(500, str(e))


class RunRowRequest(BaseModel):
    """Combined configure + start in one shot (used by the Run button)."""
    row_id:            str
    underlying:        str
    expiry:            str          # "weekly", "monthly", or resolved e.g. "10MAR26"
    side:              str          # "CE" or "PE"
    strike_label:      str          # "OTM1" | "ATM" | "ITM1"
    strike:            int
    symbol:            str  = ""    # built on the backend if not supplied
    lots:              int  = 1
    lot_size:          int  = 0     # 0 = auto-derive from underlying
    profit_taking_pts: float = 5.0
    avg_reentry_pts:   float = 5.0
    max_reentries:     int  = 2
    hedge:             bool = False
    hedge_symbol:      str  = ""
    broker:            str  = "aliceblue"
    paper_mode:        bool = True

import time
from fastapi import BackgroundTasks

@app.post("/api/bot/run-row")
async def run_row(req: RunRowRequest, background_tasks: BackgroundTasks):
    """Configure + immediately start a single grid row (Run button handler)."""
    t0 = time.time()
    from app.services.option_chain import resolve_expiry

    # ── Resolve "weekly"/"monthly" → concrete date string e.g. "10MAR26" ──────
    resolved_expiry = resolve_expiry(req.expiry, req.underlying)

    # ── Derive lot_size if not supplied ────────────────────────────────────────
    lot_size = req.lot_size if req.lot_size > 0 else LOT_SIZES.get(req.underlying.upper(), 75)

    # ── Build symbol if frontend didn't supply one ─────────────────────────────
    symbol = req.symbol.strip() or _build_symbol(req.underlying, resolved_expiry, req.strike, req.side)

    logger.info(
        "run_row: %s  underlying=%s  expiry=%s→%s  strike=%s  symbol=%s  paper=%s",
        req.row_id, req.underlying, req.expiry, resolved_expiry,
        req.strike, symbol, req.paper_mode,
    )

    cfg = BotRowConfig(
        underlying      = req.underlying,
        expiry          = resolved_expiry,
        side            = req.side,
        strike_label    = req.strike_label,
        strike          = req.strike,
        symbol          = symbol,
        lots            = req.lots,
        lot_size        = lot_size,
        profit_pts      = req.profit_taking_pts,
        avg_reentry_pts = req.avg_reentry_pts,
        max_reentries   = req.max_reentries,
        hedge           = req.hedge,
        hedge_symbol    = req.hedge_symbol,
        broker          = req.broker,
        paper_mode      = req.paper_mode,
    )
    # (Re-)register config — safe even if already registered
    bot_engine.add_row(req.row_id, cfg)
    
    # Register symbol(s) in the live LTP poller via background task
    # so the API returns 200 OK instantly instead of waiting for broker lookups.
    background_tasks.add_task(
        _register_symbols_for_row, 
        req.broker, req.underlying, resolved_expiry, req.strike, req.side, symbol, req.hedge_symbol
    )
    
    await bot_engine.start_row(req.row_id)
    t_end = time.time()
    logger.info("run_row API handler finished in %.1f ms", (t_end - t0) * 1000)
    return {"status": "started", "row_id": req.row_id, "symbol": symbol, "expiry": resolved_expiry}


# ── Bot control endpoints ──────────────────────────────────────────────────────

@app.post("/api/bot/configure")
async def configure_bot(req: BotRowRequest):
    cfg = BotRowConfig(
        underlying      = req.underlying,
        expiry          = req.expiry,
        side            = req.side,
        strike_label    = req.strike_label,
        strike          = req.strike,
        symbol          = req.symbol,
        lots            = req.lots,
        lot_size        = req.lot_size,
        profit_pts      = req.profit_taking_pts,   # BotRowConfig uses profit_pts
        avg_reentry_pts = req.avg_reentry_pts,
        max_reentries   = req.max_reentries,
        hedge           = req.hedge,
        hedge_symbol    = req.hedge_symbol,
        broker          = req.broker,
        paper_mode      = req.paper_mode,
    )
    bot_engine.add_row(req.row_id, cfg)
    return {"status": "configured", "row_id": req.row_id}

@app.post("/api/bot/{row_id}/start")
async def start_bot(row_id: str):
    await bot_engine.start_row(row_id)
    return {"status": "started", "row_id": row_id}

@app.post("/api/bot/{row_id}/stop")
async def stop_bot(row_id: str):
    await bot_engine.stop_row(row_id)
    return {"status": "stopped", "row_id": row_id}

@app.post("/api/bot/stop-all")
async def stop_all():
    await bot_engine.stop_all()
    return {"status": "all_stopped"}

@app.post("/api/bot/kill-all")
async def kill_all():
    await bot_engine.kill_all()
    return {"status": "killed"}

@app.get("/api/bot/state")
async def get_bot_state():
    states = bot_engine.get_all_states()
    return {
        row_id: _serialize_state(s)
        for row_id, s in states.items()
    }

def _serialize_state(s) -> dict:
    return {
        "status":             s.status.value,
        "current_ltp":        s.current_ltp,
        "open_lot_count":     s.open_lot_count,
        "max_lots_total":     s.max_lots_total,
        "lots_closed_today":  s.lots_closed_today,
        "total_points_today": s.total_points_today,
        "total_pnl_today":    s.total_pnl_today,
        "open_lots": [
            {
                "lot_number": lot.lot_number,
                "entry_ltp":  lot.entry_ltp,
                "target_ltp": lot.target_ltp,
                "unrealized": round(s.current_ltp - lot.entry_ltp, 2),
            }
            for lot in s.open_lots
        ],
        "trade_log": s.trade_log[-20:],
    }

# ── Trade + Order history endpoints ──────────────────────────────────────────

def _map_alice_trade(t: dict) -> dict:
    """
    Normalise a raw pya3 trade-book entry (filled orders) to frontend format.
    Trade book = actual FILLS (executions). One fill per partial fill.
    """
    sym        = t.get("trading_symbol") or t.get("Tsym", "UNKNOWN")
    txn_type   = (t.get("transactiontype") or t.get("Trantype", "")).upper()
    qty        = int(t.get("Qty", 0))
    fill_price = float(t.get("Avgprc") or t.get("Price") or t.get("Prc", 0))
    order_time = t.get("orderentrytime") or t.get("Ttm") or t.get("ExchOrdID") or "Live"

    if isinstance(order_time, str) and " " in order_time:
        order_time = order_time.split()[-1][:8]

    side = sym[-2:] if len(sym) >= 2 and sym[-2:] in ("CE", "PE") else txn_type or "BUY"

    return {
        "id":           f"trade-{sym}-{t.get('norenordno') or t.get('NOrdNum', '')}",
        "time":         order_time,
        "side":         side,
        "strike_label": "-",
        "symbol":       sym,
        "entry_ltp":    fill_price if txn_type == "BUY"  else 0.0,
        "exit_ltp":     fill_price if txn_type == "SELL" else 0.0,
        "lots":         qty,
        "points":       0.0,
        "pnl":          0.0,
        "transaction":  txn_type,   # "BUY" | "SELL"
        "reason":       txn_type.lower() or "broker",
        "source":       "broker",
        "type":         "trade",
    }


def _map_alice_order(o: dict) -> dict:
    """
    Normalise a raw pya3 order-book entry to frontend format.
    Order book = all placed orders (pending, complete, rejected, cancelled).

    Common pya3 keys:
      trading_symbol/Tsym, transactiontype/Trantype, Status/status,
      Qty, Avgprc/Price/Prc, orderentrytime/Ttm, norenordno/NOrdNum
    """
    sym        = o.get("trading_symbol") or o.get("Tsym", "UNKNOWN")
    txn_type   = (o.get("transactiontype") or o.get("Trantype", "")).upper()
    qty        = int(o.get("Qty", 0))
    price      = float(o.get("Avgprc") or o.get("Price") or o.get("Prc", 0))
    status     = (o.get("Status") or o.get("status") or o.get("Ordvaldate") or "unknown").lower()
    order_time = o.get("orderentrytime") or o.get("Ttm") or "Live"
    order_id   = o.get("norenordno") or o.get("NOrdNum") or o.get("order_id", "")

    if isinstance(order_time, str) and " " in order_time:
        order_time = order_time.split()[-1][:8]

    side = sym[-2:] if len(sym) >= 2 and sym[-2:] in ("CE", "PE") else txn_type or "—"

    return {
        "id":           f"order-{order_id}-{sym}",
        "order_id":     str(order_id),
        "time":         order_time,
        "side":         side,
        "symbol":       sym,
        "transaction":  txn_type,   # "BUY" | "SELL"
        "quantity":     qty,
        "price":        price,
        "status":       status,     # "complete", "rejected", "cancelled", "open", etc.
        "source":       "broker",
        "type":         "order",
    }


async def _fetch_broker_trades() -> list[dict]:
    """Pull trade book (fills) from connected broker (Alice Blue)."""
    from app.brokers import aliceblue
    if not aliceblue.is_connected():
        return []
    try:
        raw = aliceblue.get_trade_book()
        if not isinstance(raw, list):
            logger.warning("Broker trade fetch returned non-list: %s", raw)
            return []
        return [_map_alice_trade(t) for t in raw]
    except Exception as exc:
        logger.warning("Broker trade fetch failed: %s", exc)
        return []


async def _fetch_broker_orders() -> list[dict]:
    """Pull order book (all placed orders) from connected broker (Alice Blue)."""
    from app.brokers import aliceblue
    if not aliceblue.is_connected():
        return []
    try:
        raw = aliceblue.get_order_book()
        if not isinstance(raw, list):
            logger.warning("Broker order fetch returned non-list: %s", raw)
            return []
        return [_map_alice_order(o) for o in raw]
    except Exception as exc:
        logger.warning("Broker order fetch failed: %s", exc)
        return []


@app.get("/api/trades/today")
async def get_trades_today(db: AsyncSession = Depends(get_db)):
    """Return today's filled trades from the broker trade book."""
    broker_trades = await _fetch_broker_trades()
    broker_trades.sort(key=lambda t: t["time"], reverse=True)
    return broker_trades


@app.get("/api/orders/today")
async def get_orders_today():
    """Return today's orders (all statuses) from the broker order book."""
    broker_orders = await _fetch_broker_orders()
    broker_orders.sort(key=lambda o: o["time"], reverse=True)
    return broker_orders


# ── Symbol registration helper ────────────────────────────────────────────────

def _register_symbols_for_row(
    broker: str,
    underlying: str,
    resolved_expiry: str,   # e.g. "10MAR26"
    strike: int,
    side: str,              # "CE" or "PE"
    symbol: str,
    hedge_symbol: str = "",
) -> None:
    """
    Convert the broker-format expiry (e.g. "10MAR26") to ISO "YYYY-MM-DD" and
    register both the primary symbol and hedge symbol (if any) with the LTP poller.
    """
    if broker != "aliceblue":
        return
    from app.brokers import aliceblue
    from datetime import datetime as _dt
    try:
        expiry_iso = _dt.strptime(resolved_expiry, "%d%b%y").strftime("%Y-%m-%d")
    except ValueError:
        logger.warning("_register_symbols_for_row: cannot parse expiry '%s'", resolved_expiry)
        return

    aliceblue.register_symbol(underlying, expiry_iso, strike, side, symbol)
    if hedge_symbol:
        # Hedge is always the opposite side at the same strike
        opp_side = "PE" if side.upper() == "CE" else "CE"
        aliceblue.register_symbol(underlying, expiry_iso, strike, opp_side, hedge_symbol)


# ── WebSocket endpoint ─────────────────────────────────────────────────────────

@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws_manager.connect(ws)
    try:
        while True:
            await ws.receive_text()  # keep-alive
    except WebSocketDisconnect:
        ws_manager.disconnect(ws)

# ── Background broadcast loop ────────────────────────────────────────────────

# Shared broker-trade snapshot — refreshed by _broker_trades_loop (every 5 s)
_cached_broker_trades: list[dict] = []
_cached_broker_orders: list[dict] = []


async def _ltp_poller_loop():
    """
    Background task: poll live LTPs from Alice Blue every 250 ms.
    All registered option symbols are fetched concurrently (asyncio.gather),
    so the total time is ~1x REST latency instead of Nx, keeping the
    _ltp_cache fresh for the UI.
    """
    while True:
        try:
            from app.brokers import aliceblue
            if aliceblue.is_connected():
                await aliceblue.bulk_poll_ltps()
        except Exception as e:
            logger.debug("LTP poller error: %s", e)
        await asyncio.sleep(0.25)   # 4 polls per second


async def _index_poller_loop():
    """
    Background task: poll NIFTY, BANKNIFTY, SENSEX, INDIA VIX every 250 ms.
    Results go into aliceblue._index_cache, which is included in WS broadcasts.
    """
    while True:
        try:
            from app.brokers import aliceblue
            if aliceblue.is_connected():
                await aliceblue.bulk_poll_indices()
        except Exception as e:
            logger.debug("Index poller error: %s", e)
        await asyncio.sleep(0.25)


async def _broker_trades_loop():
    """
    Slow background task: refresh both the broker trade book and order book
    every 5 seconds and update the shared caches used by the WS broadcast.
    """
    global _cached_broker_trades, _cached_broker_orders
    while True:
        try:
            _cached_broker_trades = await _fetch_broker_trades()
        except Exception as e:
            logger.debug("Broker trades refresh error: %s", e)
        try:
            _cached_broker_orders = await _fetch_broker_orders()
        except Exception as e:
            logger.debug("Broker orders refresh error: %s", e)
        await asyncio.sleep(5)


async def _push_state_loop():
    """
    Fast background task: push bot row states + live LTP cache to all WS
    clients every 250 ms so the LTP column in the grid updates ~4x/sec.
    Broker trades are included from the 5-second cache to avoid slowing
    down the hot path.
    """
    while True:
        try:
            states = bot_engine.get_all_states()
            from app.brokers import aliceblue
            ltp_cache = dict(aliceblue._ltp_cache)    # option LTP snapshot
            index_cache = dict(aliceblue._index_cache) # index price snapshot
            payload = {
                "type": "state_update",
                "rows": {
                    row_id: _serialize_state(s)
                    for row_id, s in states.items()
                },
                "ltp_cache": ltp_cache,
                "indices": index_cache,
                "broker_trades": _cached_broker_trades,
                "broker_orders": _cached_broker_orders,
            }
            await ws_manager.broadcast(payload)
        except Exception as e:
            logger.debug("Push error: %s", e)
        await asyncio.sleep(0.25)  # broadcast 4x per second
