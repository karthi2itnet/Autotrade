"""
Zerodha KiteConnect broker adapter.
Handles login URL generation, access token exchange, option chain, and order placement.
"""
import logging
from kiteconnect import KiteConnect
from app.config import settings

logger = logging.getLogger(__name__)

_kite: KiteConnect | None = None
_api_key: str = ""
_api_secret: str = ""


def get_client() -> KiteConnect:
    global _kite
    if _kite is None:
        raise RuntimeError("Zerodha not connected. Call connect() first.")
    return _kite


def get_login_url() -> str:
    """Returns the Zerodha login URL for the user to authorise."""
    api_key = _api_key or settings.zerodha_api_key
    kite = KiteConnect(api_key=api_key)
    return kite.login_url()


async def connect(request_token: str, api_key: str = "", api_secret: str = "") -> dict:
    """
    Exchange request_token for access_token and initialise session.
    Call this after the user completes Zerodha web login.
    """
    global _kite, _api_key, _api_secret
    try:
        _api_key = api_key or settings.zerodha_api_key
        _api_secret = api_secret or settings.zerodha_api_secret
        _kite = KiteConnect(api_key=_api_key)
        data = _kite.generate_session(request_token, api_secret=_api_secret)
        _kite.set_access_token(data["access_token"])
        logger.info("Zerodha connected: %s", data.get("user_id"))
        return {"status": "connected", "broker": "zerodha", "client_id": data.get("user_id")}
    except Exception as e:
        logger.error("Zerodha connection failed: %s", e)
        raise


def is_connected() -> bool:
    return _kite is not None


async def get_ltp(exchange: str, tradingsymbol: str) -> float:
    """Get Last Traded Price."""
    kite = get_client()
    key = f"{exchange}:{tradingsymbol}"
    quote = kite.ltp([key])
    return float(quote[key]["last_price"])


async def get_option_chain(underlying: str, expiry: str) -> list[dict]:
    """
    Fetch all strikes for a given underlying and expiry from the instruments list.
    Returns list of {strike, ce_symbol, pe_symbol}.
    """
    kite = get_client()
    instruments = kite.instruments("NFO")
    results = []
    for inst in instruments:
        if inst["name"] == underlying and str(inst["expiry"]) == expiry:
            results.append({
                "strike": inst["strike"],
                "instrument_type": inst["instrument_type"],
                "tradingsymbol": inst["tradingsymbol"],
                "instrument_token": inst["instrument_token"],
            })
    return results


async def place_order(
    tradingsymbol: str,
    exchange: str,
    transaction_type: str,  # "BUY" | "SELL"
    quantity: int,
    order_type: str = "MARKET",
    price: float = 0,
    product: str = "MIS",
) -> str:
    """Place an order, return order ID."""
    kite = get_client()
    order_id = kite.place_order(
        variety=KiteConnect.VARIETY_REGULAR,
        exchange=exchange,
        tradingsymbol=tradingsymbol,
        transaction_type=transaction_type,
        quantity=quantity,
        product=product,
        order_type=order_type,
        price=price if order_type != "MARKET" else None,
    )
    logger.info("Zerodha order placed: %s | %s %s x%d", order_id, transaction_type, tradingsymbol, quantity)
    return str(order_id)


async def cancel_order(order_id: str) -> bool:
    """Cancel an open order."""
    kite = get_client()
    try:
        kite.cancel_order(variety=KiteConnect.VARIETY_REGULAR, order_id=order_id)
        return True
    except Exception as e:
        logger.error("Cancel order failed: %s", e)
        return False
