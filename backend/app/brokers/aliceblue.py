"""
Alice Blue (Ant API) broker adapter.

This module keeps a single in-memory session and runs a background
keepalive loop to prevent token expiry.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from app.config import settings

logger = logging.getLogger(__name__)

_alice: Any | None = None
_user_id: str = ""
_keepalive_task: asyncio.Task | None = None

# Persistent async HTTP client — reuses TCP+TLS connection across calls (no per-call handshake)
_http_client: httpx.AsyncClient | None = None

_ALICE_BASE_URL = "https://ant.aliceblueonline.com/rest/AliceBlueAPIService/api/"
_PLACE_ORDER_URL = _ALICE_BASE_URL + "placeOrder/executePlaceOrder"

# ── Shared LTP cache ──────────────────────────────────────────────────────────
# Maps symbol -> last LTP. Populated by bulk_poll_ltps().
_ltp_cache: dict[str, float] = {}

# Registry of (underlying, expiry_str, strike, option_type, symbol) tuples tracked.
# Each entry is everything needed to resolve the instrument.
_symbol_registry: list[tuple[str, str, int, str, str]] = []

# Instrument object cache: (underlying, expiry_str, strike, option_type) -> pya3 Instrument
# Avoids re-scanning the 5 MB NFO.csv on every order / LTP poll.
_instrument_cache: dict[tuple, object] = {}

# ── Market index cache ────────────────────────────────────────────────────────
# Populated by bulk_poll_indices(). Keyed by our display label.
_index_cache: dict[str, float] = {
    "NIFTY":     0.0,
    "BANKNIFTY": 0.0,
    "SENSEX":    0.0,
    "INDIAVIX":  0.0,
}

# (exchange, symbol-as-known-to-Alice-Blue) for each index
_INDEX_INSTRUMENTS = [
    ("NSE",     "NIFTY 50",       "NIFTY"),
    ("NSE",     "Nifty Bank",     "BANKNIFTY"),
    ("BSE",     "SENSEX",         "SENSEX"),
    ("NSE",     "INDIA VIX",      "INDIAVIX"),
]


def _require_sdk():
    try:
        from pya3 import Aliceblue  # type: ignore
        import requests

        # Monkey-patch get_contract_master to fix the 'time' module call bug
        def patched_get_contract_master(self, exchange):
            if len(exchange) == 3 or exchange == 'INDICES':
                url = self.base_url_c % exchange.upper()
                response = requests.get(url)
                logger.info(f"Downloading contract master for {exchange}...")
                with open(f"{exchange.upper()}.csv", "w") as f:
                    f.write(response.text)
                return self._error_response("Today contract File Downloaded")
            return self._error_response("Invalid Exchange parameter")

        Aliceblue.get_contract_master = patched_get_contract_master

    except ImportError as e:  # pragma: no cover
        raise RuntimeError(
            "Alice Blue SDK not installed. Add 'pya3' to requirements and install it in backend venv."
        ) from e
    return Aliceblue


async def connect(user_id: str = "", api_key: str = "", twofa: str = "") -> dict:
    """
    Login to Alice Blue.

    Params can be passed from API request; falls back to .env for user_id/api_key.
    The 2FA code is typically time-based and should be provided at connect time.
    Starts a background keepalive task after successful login.
    """
    global _alice, _user_id, _keepalive_task

    user_id = user_id or settings.aliceblue_user_id
    api_key = api_key or settings.aliceblue_api_key

    if not user_id or not api_key:
        raise RuntimeError("Missing Alice Blue credentials (user_id/api_key)")
    if not twofa:
        raise RuntimeError("Missing Alice Blue 2FA/TOTP code (twofa)")

    Aliceblue = _require_sdk()
    alice = Aliceblue(user_id=user_id, api_key=api_key)

    # Different pya3 versions have used different kwarg names; try the common ones.
    try:
        session_id = alice.get_session_id(twoFA=twofa)
    except TypeError:
        try:
            session_id = alice.get_session_id(twofa=twofa)
        except TypeError:
            # Modern version: (self, data=None)
            session_id = alice.get_session_id(data={"twoFA": twofa})

    if not session_id:
        raise RuntimeError("Alice Blue login failed (empty session_id)")

    _alice = alice
    _user_id = user_id
    logger.info("Alice Blue connected: %s", user_id)

    # Cancel any previous keepalive task before starting a fresh one
    if _keepalive_task and not _keepalive_task.done():
        _keepalive_task.cancel()
    _keepalive_task = asyncio.create_task(
        _run_keepalive(),
        name="alice-keepalive",
    )

    # Warm up the persistent HTTP client now so first order is instant
    _get_http_client()

    return {"status": "connected", "broker": "aliceblue", "client_id": user_id}


def _get_http_client() -> httpx.AsyncClient:
    """Return (or create) the shared persistent async HTTP client."""
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(10.0),
            limits=httpx.Limits(max_keepalive_connections=5, keepalive_expiry=60),
        )
    return _http_client


async def _place_order_direct(
    instrument,       # pya3 Instrument namedtuple
    transaction_type: str,  # "BUY" or "SELL"
    quantity: int,
    order_type: str = "MKT", # "MKT" or "LMT"
    price: float = 0.0,
) -> dict:
    """
    Directly POST a market order to Alice Blue's REST API using the persistent
    httpx.AsyncClient. Bypasses pya3's synchronous requests.post so there is
    no per-call TCP/TLS handshake — should complete in < 500 ms.
    """
    alice = get_client()
    auth_header = f"Bearer {alice.user_id.upper()} {alice.session_id}"

    payload = [{
        "complexty":      "regular",
        "discqty":        0,
        "exch":           instrument.exchange,
        "pCode":          "MIS",       # Intraday
        "price":          price if order_type == "LMT" else 0.0,
        "prctyp":         "L" if order_type == "LMT" else "MKT",
        "qty":            quantity,
        "ret":            "DAY",
        "symbol_id":      str(instrument.token),
        "trading_symbol": instrument.name,
        "transtype":      transaction_type.upper(),
        "stopLoss":       None,
        "target":         None,
        "trailing_stop_loss": None,
        "trigPrice":      None,
        "orderTag":       None,
    }]

    client = _get_http_client()
    t0 = __import__("time").time()
    response = await client.post(
        _PLACE_ORDER_URL,
        json=payload,
        headers={
            "X-SAS-Version":  "2.0",
            "User-Agent":     "Codifi API Connect - Python Lib 1.0.30",
            "Authorization":  auth_header,
        },
    )
    elapsed_ms = (__import__("time").time() - t0) * 1000
    logger.info("[Alice Blue] Direct httpx place_order took %.1f ms  status=%s", elapsed_ms, response.status_code)

    data = response.json()
    # pya3 returns a list with one element
    if isinstance(data, list) and len(data) == 1:
        data = data[0]
    return data



async def _run_keepalive():
    """
    Background task: ping Alice Blue every 5 minutes to keep the session alive.

    pya3's get_profile() is the lightest authenticated call available.
    On failure we log a warning but do not destroy the session — the next
    successful ping will restore the healthy state naturally.
    """
    PING_INTERVAL = 5 * 60   # 5 minutes

    logger.info("[Keepalive] Started for Alice Blue session")
    while True:
        await asyncio.sleep(PING_INTERVAL)
        alice = _alice
        if alice is None:
            logger.info("[Keepalive] Session gone — stopping keepalive")
            break
        try:
            # get_profile is the lightest authenticated endpoint
            result = alice.get_profile()
            if isinstance(result, dict) and result.get("stat") == "Ok":
                logger.debug("[Keepalive] Session alive ✓")
            else:
                logger.warning("[Keepalive] Unexpected profile response: %s", result)
        except Exception as exc:
            logger.warning("[Keepalive] Ping failed: %s", exc)


def is_connected() -> bool:
    return _alice is not None


def get_client():
    if _alice is None:
        raise RuntimeError("Alice Blue not connected. Call connect() first.")
    return _alice


def register_symbol(
    underlying: str,
    expiry_str: str,   # e.g. "2026-03-06"
    strike: int,
    option_type: str,  # "CE" or "PE"
    symbol: str,       # full trading symbol, used as cache key
) -> None:
    """
    Register an option instrument so bulk_poll_ltps() will include it.
    Safe to call multiple times — duplicates are ignored.
    """
    entry = (underlying, expiry_str, strike, option_type.upper(), symbol)
    if entry not in _symbol_registry:
        _symbol_registry.append(entry)
        logger.info("[LTP registry] +%s (%s %s %s %s)", symbol, underlying, expiry_str, strike, option_type)


def get_cached_ltp(symbol: str) -> float:
    """Return the last polled LTP for a symbol, or 0.0 if not yet cached."""
    return _ltp_cache.get(symbol, 0.0)


async def bulk_poll_ltps() -> dict[str, float]:
    """
    Fetch LTP for every registered symbol concurrently using asyncio.gather.
    Results are stored in _ltp_cache and also returned.
    Safe to call even before any symbols are registered (returns {}).

    By running all get_option_ltp() calls in parallel the total time is
    approximately 1× REST latency instead of N× (sequential), allowing
    the poller loop to run far more frequently.
    """
    global _ltp_cache
    if not _alice or not _symbol_registry:
        return {}

    # Snapshot the registry to avoid mutation during iteration
    registry_snapshot = list(_symbol_registry)
    symbols = [sym for _, _, _, _, sym in registry_snapshot]

    # Fire all LTP requests concurrently
    coros = [
        get_option_ltp(underlying, expiry_str, strike, option_type)
        for underlying, expiry_str, strike, option_type, _ in registry_snapshot
    ]
    responses = await asyncio.gather(*coros, return_exceptions=True)

    results: dict[str, float] = {}
    for symbol, result in zip(symbols, responses):
        if isinstance(result, Exception):
            logger.debug("[LTP poll] %s: %s", symbol, result)
            # Keep the previous cached value on error
            results[symbol] = _ltp_cache.get(symbol, 0.0)
        else:
            results[symbol] = result

    _ltp_cache.update(results)
    logger.debug("[LTP poll] Fetched %d symbols: %s", len(results), results)
    return results


async def _fetch_index_ltp(exchange: str, symbol: str) -> float:
    """Fetch LTP for a single cash/index instrument by exchange+symbol."""
    alice = get_client()
    inst = await asyncio.to_thread(alice.get_instrument_by_symbol, exchange, symbol)
    info = await asyncio.to_thread(alice.get_scrip_info, inst)
    for k in ("Ltp", "ltp", "last_traded_price", "LastTradedPrice"):
        if k in info:
            return float(info[k])
    if isinstance(info, dict) and "data" in info and isinstance(info["data"], dict):
        for k in ("Ltp", "ltp", "last_traded_price"):
            if k in info["data"]:
                return float(info["data"][k])
    raise RuntimeError(f"Cannot parse scrip info for {exchange}:{symbol}")


async def bulk_poll_indices() -> dict[str, float]:
    """
    Fetch LTPs for NIFTY, BANKNIFTY, SENSEX, and INDIA VIX concurrently.
    Results are stored in _index_cache and returned.
    Returns {} if not connected or if all fetches fail.
    """
    global _index_cache
    if not _alice:
        return dict(_index_cache)

    coros = [_fetch_index_ltp(exch, sym) for exch, sym, _ in _INDEX_INSTRUMENTS]
    labels = [label for _, _, label in _INDEX_INSTRUMENTS]
    responses = await asyncio.gather(*coros, return_exceptions=True)

    for label, result in zip(labels, responses):
        if isinstance(result, Exception):
            logger.debug("[Index poll] %s: %s", label, result)
            # retain last known value
        else:
            _index_cache[label] = result

    return dict(_index_cache)

async def get_ltp(exchange: str, symbol: str) -> float:
    """
    Get Last Traded Price for a cash-market/index symbol.

    Notes:
    - Alice Blue uses instruments; this helper resolves by symbol then reads scrip info.
    - For indices, symbols can vary by SDK version. Callers may need to pass the exact symbol
      as per the Alice Blue contract master (e.g. 'NIFTY', 'Nifty 50', etc).
    """
    import asyncio
    alice = get_client()
    inst = await asyncio.to_thread(alice.get_instrument_by_symbol, exchange, symbol)
    info = await asyncio.to_thread(alice.get_scrip_info, inst)
    # pya3 typically returns dict with 'Ltp'
    for k in ("Ltp", "ltp", "last_traded_price", "LastTradedPrice"):
        if k in info:
            return float(info[k])
    # fallback: some versions nest under 'data'
    if isinstance(info, dict) and "data" in info and isinstance(info["data"], dict):
        data = info["data"]
        for k in ("Ltp", "ltp", "last_traded_price"):
            if k in data:
                return float(data[k])
    raise RuntimeError(f"Unexpected scrip info format for {exchange}:{symbol}")


async def get_option_ltp(
    underlying: str,
    expiry_dt,          # datetime.date object OR "YYYY-MM-DD" string
    strike: int,
    option_type: str,   # "CE" or "PE"
) -> float:
    """
    Get LTP for an NFO option using pya3's structured get_instrument_for_fno API.
    This avoids building a symbol string that might not match Alice Blue's contract master.
    Accepts expiry_dt as either a datetime.date or a "YYYY-MM-DD" string.
    """
    alice = get_client()

    # pya3's get_instrument_for_fno internally calls: datetime.strptime(expiry_date, "%Y-%m-%d").date()
    # so we MUST pass it as a formatted string, not a datetime object!
    if hasattr(expiry_dt, "strftime"):
        expiry_str = expiry_dt.strftime("%Y-%m-%d")
    else:
        expiry_str = str(expiry_dt)  # already a string like "2026-03-06"

    is_call = option_type.upper() in ("CE", "CALL")
    cache_key = (underlying, expiry_str, int(strike), option_type.upper())

    # Check cache first — avoids re-scanning the 5 MB NFO CSV on every poll
    inst = _instrument_cache.get(cache_key)
    if inst is None:
        inst = await asyncio.to_thread(
            alice.get_instrument_for_fno,
            exch="NFO",
            symbol=underlying,
            expiry_date=expiry_str,
            is_fut=False,
            strike=strike,
            is_CE=is_call,
        )
        # If not found, pya3 returns {'stat': 'Not_ok', 'emsg': 'No Data'} instead of None
        if inst is None or isinstance(inst, dict):
            emsg = inst.get("emsg", "Unknown") if isinstance(inst, dict) else "None returned"
            raise RuntimeError(
                f"Instrument not found in Alice Blue contract master: "
                f"{underlying} {expiry_str} {strike} {option_type} ({emsg})"
            )
        # Store in cache for future fast lookups
        _instrument_cache[cache_key] = inst
        logger.debug("[Instrument cache] Stored %s (cache size=%d)", cache_key, len(_instrument_cache))

    info = await asyncio.to_thread(alice.get_scrip_info, inst)
    for k in ("Ltp", "ltp", "last_traded_price", "LastTradedPrice"):
        if k in info:
            return float(info[k])
    if isinstance(info, dict) and "data" in info and isinstance(info["data"], dict):
        data = info["data"]
        for k in ("Ltp", "ltp", "last_traded_price"):
            if k in data:
                return float(data[k])
    raise RuntimeError(
        f"Unexpected scrip info format for {underlying} {expiry_str} {strike} {option_type}"
    )


def get_order_book() -> list[dict]:
    """
    Fetch today's order book from Alice Blue.
    Returns a list of order dicts (raw pya3 response).
    """
    alice = get_client()
    result = alice.get_order_history("")  # empty string = all orders
    if isinstance(result, list):
        return result
    if isinstance(result, dict) and result.get("stat") == "Not_ok":
        logger.warning("Alice Blue order book: %s", result.get("emsg", "error"))
        return []
    return []


def get_trade_book() -> list[dict]:
    """
    Fetch today's trade book (filled orders) from Alice Blue.
    Returns a list of trade dicts (raw pya3 response).
    """
    alice = get_client()
    result = alice.get_trade_book()
    if isinstance(result, list):
        return result
    if isinstance(result, dict) and result.get("stat") == "Not_ok":
        logger.warning("Alice Blue trade book: %s", result.get("emsg", "error"))
        return []
    return []


def get_positions() -> list[dict]:
    """
    Fetch today's net day-wise positions from Alice Blue.
    Returns a list of position dicts.
    """
    alice = get_client()
    result = alice.get_daywise_positions()
    if isinstance(result, list):
        return result
    if isinstance(result, dict) and result.get("stat") == "Not_ok":
        logger.warning("Alice Blue positions: %s", result.get("emsg", "error"))
        return []
    return []


async def place_order(
    tradingsymbol: str,
    exchange: str,
    transaction_type: str,  # "BUY" | "SELL"
    quantity: int,
    order_type: str = "MKT",
    price: float = 0.0,
) -> str:
    """
    Place a market order.
    Resolves the exact Alice Blue instrument object by looking up the symbol
    in our option registry first, ensuring NFO options resolve reliably.
    """
    alice = get_client()
    import time
    t0 = time.time()
    
    # Options strictly require structured lookup
    registry_entry = next((e for e in _symbol_registry if e[4] == tradingsymbol), None)
    
    if registry_entry and exchange == "NFO":
        underlying, expiry_str, strike, option_type, _ = registry_entry
        is_call = option_type.upper() in ("CE", "CALL")
        cache_key = (underlying, expiry_str, int(strike), option_type.upper())

        # Check cache first — skips the 8-second NFO.csv scan on repeated orders
        inst = _instrument_cache.get(cache_key)
        if inst is None:
            logger.info("[Alice Blue] Cache MISS for %s — running NFO CSV scan...", tradingsymbol)
            inst = await asyncio.to_thread(
                alice.get_instrument_for_fno,
                exch="NFO",
                symbol=underlying,
                expiry_date=expiry_str,
                is_fut=False,
                strike=strike,
                is_CE=is_call,
            )
            if inst and not isinstance(inst, dict):
                _instrument_cache[cache_key] = inst
                logger.info("[Alice Blue] Cache STORED for %s (total=%d)", tradingsymbol, len(_instrument_cache))
        else:
            logger.info("[Alice Blue] Cache HIT for %s — skipping CSV scan", tradingsymbol)
    else:
        inst = await asyncio.to_thread(alice.get_instrument_by_symbol, exchange, tradingsymbol)

    t1 = time.time()
    msg1 = f"    [Alice Blue] Instrument lookup took {(t1 - t0) * 1000:.1f} ms"
    logger.info(msg1)


    if inst is None or isinstance(inst, dict):
        emsg = inst.get("emsg", "Unknown") if isinstance(inst, dict) else "None returned"
        logger.error("Alice Blue place_order failed: %s instrument not found (%s)", tradingsymbol, emsg)
        raise RuntimeError(f"Instrument '{tradingsymbol}' not found in broker master: {emsg}")

    # Use direct async httpx call — avoids pya3's synchronous requests.post and per-call TLS handshake
    resp = await _place_order_direct(inst, transaction_type, quantity, order_type=order_type, price=price)

    # Extract order number from response  
    if isinstance(resp, dict):
        for k in ("NOrdNo", "order_id", "orderid", "data"):
            if k in resp:
                v = resp[k]
                if isinstance(v, str):
                    return v
                if isinstance(v, dict):
                    for kk in ("NOrdNo", "order_id", "orderid"):
                        if kk in v and v[kk]:
                            return str(v[kk])
    return "ALICEBLUE-ORDER"

async def cancel_order(order_id: str) -> bool:
    """Cancel an open order."""
    alice = get_client()
    try:
        # pya3: cancel_order(order_id)
        result = await asyncio.to_thread(alice.cancel_order, order_id)
        if isinstance(result, dict) and result.get("stat") == "Not_ok":
            logger.warning("Alice Blue cancel order %s failed: %s", order_id, result.get("emsg", "error"))
            return False
        logger.info("Alice Blue order cancelled: %s", order_id)
        return True
    except Exception as e:
        logger.error("Alice Blue cancel order %s failed: %s", order_id, e)
        return False
