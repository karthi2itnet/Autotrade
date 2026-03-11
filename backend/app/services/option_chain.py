"""
Option chain service.
Resolves OTM1, ATM, ITM1 strikes from live broker data.
"""
import logging
from dataclasses import dataclass
from datetime import date, timedelta
from app.config import settings

logger = logging.getLogger(__name__)

STRIKE_INTERVALS = {
    "NIFTY":      50,
    "BANKNIFTY":  100,
    "FINNIFTY":   50,
    "MIDCPNIFTY": 25,
    "SENSEX":     100,
}

@dataclass
class StrikeSet:
    underlying: str
    expiry: str
    spot_price: float
    atm: int
    otm1_ce: int
    itm1_ce: int
    otm1_pe: int
    itm1_pe: int
    atm_ce_ltp: float = 0.0
    atm_pe_ltp: float = 0.0
    otm1_ce_ltp: float = 0.0
    otm1_pe_ltp: float = 0.0
    itm1_ce_ltp: float = 0.0
    itm1_pe_ltp: float = 0.0


import calendar

# Weekly expiry weekday per underlying (Monday=0 … Sunday=6)
# SEBI current schedule (as of 2024-25 calendar):
#   NIFTY 50     → Thursday (3)
#   BANKNIFTY    → Wednesday (2)
#   FINNIFTY     → Tuesday  (1)
#   MIDCPNIFTY   → Monday   (0)
WEEKLY_EXPIRY_WEEKDAY: dict[str, int] = {
    "NIFTY":      1,   # Tuesday (User specified new schedule)
    "BANKNIFTY":  2,   # Wednesday
    "FINNIFTY":   1,   # Tuesday
    "MIDCPNIFTY": 0,   # Monday
}


def resolve_expiry(expiry_type: str, underlying: str = "") -> str:
    """
    Convert 'weekly' or 'monthly' to the actual NFO expiry date string.

    Weekly expiry weekday is per-underlying (see WEEKLY_EXPIRY_WEEKDAY).
    Monthly expiry is always the last Thursday of the month.

    If a real date string is already passed (e.g. '06MAR25'), it is returned as-is.
    Format returned: DDMONYY  e.g. '06MAR25' for Zerodha, or YYYY-MM-DD for others (handled by brokers).
    For now, we return YYYY-MM-DD Strings.
    """
    if expiry_type.upper() not in ("WEEKLY", "MONTHLY"):
        return expiry_type  # Assume it's already a formatted string

    today = date.today()

    if expiry_type == "weekly":
        target_weekday = WEEKLY_EXPIRY_WEEKDAY.get(underlying.upper(), 3)  # default Thursday
        days_ahead = (target_weekday - today.weekday()) % 7  # 0 = today IS the expiry day
        expiry_date = today + timedelta(days=days_ahead)

    else:  # monthly — last Thursday of the month for all underlyings
        year, month = today.year, today.month
        while True:
            thursdays = [
                date(year, month, d)
                for d in range(1, calendar.monthrange(year, month)[1] + 1)
                if date(year, month, d).weekday() == 3
            ]
            last_thu = thursdays[-1]
            if today <= last_thu:
                expiry_date = last_thu
                break
            # Past this month's expiry — roll forward
            if month == 12:
                month, year = 1, year + 1
            else:
                month += 1

    return expiry_date.strftime("%d%b%y").upper()  # e.g. "06MAR25"


def calc_atm(spot: float, interval: int) -> int:
    """Round spot price to nearest strike interval."""
    return round(spot / interval) * interval


async def get_strike_set(underlying: str, expiry: str, broker: str) -> StrikeSet:
    """
    Fetch spot price and compute OTM1, ATM, ITM1 strikes.
    broker: 'aliceblue' | 'zerodha'
    """
    u_upper = underlying.upper()
    interval = STRIKE_INTERVALS.get(u_upper, 50)
    if interval <= 0: interval = 50

    # Resolve 'weekly' / 'monthly' → concrete date string like '04MAR25'
    expiry = resolve_expiry(expiry, u_upper)
    logger.info("Resolved expiry for %s: %s (interval=%d)", u_upper, expiry, interval)

    # Get spot price from index feed
    spot = await _get_spot_price(u_upper, broker)
    atm = calc_atm(spot, interval)

    # CE: OTM is higher strike, ITM is lower strike
    otm1_ce = atm + interval
    itm1_ce = atm - interval

    # PE: OTM is lower strike, ITM is higher strike
    otm1_pe = atm - interval
    itm1_pe = atm + interval

    strike_set = StrikeSet(
        underlying=underlying,
        expiry=expiry,
        spot_price=spot,
        atm=atm,
        otm1_ce=otm1_ce,
        itm1_ce=itm1_ce,
        otm1_pe=otm1_pe,
        itm1_pe=itm1_pe,
    )

    # Fetch LTPs for all 6 options
    try:
        strike_set = await _fill_ltps(strike_set, underlying, expiry, broker)
    except Exception as e:
        logger.warning("LTP fill failed (will use 0): %s", e)

    return strike_set


async def _get_spot_price(underlying: str, broker: str) -> float:
    """Get current spot price of the index."""
    u_upper = underlying.upper()
    EXCHANGE_MAP = {
        "NIFTY": "NSE:NIFTY 50",
        "BANKNIFTY": "NSE:NIFTY BANK",
        "FINNIFTY": "NSE:NIFTY FIN SERVICE",
        "MIDCPNIFTY": "NSE:NIFTY MID SELECT",
        "SENSEX": "BSE:SENSEX"
    }
    if broker == "zerodha":
        from app.brokers import zerodha
        symbol = EXCHANGE_MAP.get(u_upper, f"NSE:{u_upper}")
        return await zerodha.get_ltp(*symbol.split(":"))
    else:
        from app.brokers import aliceblue
        # NOTE: index naming differs by broker contract master; try a couple common aliases.
        candidates = [
            underlying,
            "Nifty 50" if underlying == "NIFTY" else underlying,
            "NIFTY 50" if underlying == "NIFTY" else underlying,
            "Nifty Bank" if underlying == "BANKNIFTY" else underlying,
            "NIFTY BANK" if underlying == "BANKNIFTY" else underlying,
        ]
        last_err: Exception | None = None
        for sym in candidates:
            try:
                return await aliceblue.get_ltp("NSE", sym)
            except Exception as e:  # try next alias
                last_err = e
        raise last_err or RuntimeError("Could not resolve index symbol for Alice Blue")


async def _fill_ltps(s: StrikeSet, underlying: str, expiry: str, broker: str) -> StrikeSet:
    """
    Fill LTP for all 6 strike/side combos.
    - Zerodha: builds Kite-style symbol string  e.g. NIFTY06MAR2522500CE
    - Alice Blue: uses pya3 get_instrument_for_fno (no string parsing needed)
    """
    from datetime import datetime as _dt

    # Parse expiry date string -> date object (needed for Alice Blue)
    try:
        expiry_dt = _dt.strptime(expiry, "%d%b%y").date()
    except ValueError:
        expiry_dt = None
        logger.warning("Could not parse expiry date '%s' to date object", expiry)

    strikes = {
        "atm_ce":   (s.atm,     "CE"),
        "atm_pe":   (s.atm,     "PE"),
        "otm1_ce":  (s.otm1_ce, "CE"),
        "otm1_pe":  (s.otm1_pe, "PE"),
        "itm1_ce":  (s.itm1_ce, "CE"),
        "itm1_pe":  (s.itm1_pe, "PE"),
    }
    for key, (strike, side) in strikes.items():
        try:
            if broker == "zerodha":
                from app.brokers import zerodha
                symbol = build_zerodha_symbol(underlying, expiry, strike, side)
                ltp = await zerodha.get_ltp("NFO", symbol)
            else:  # aliceblue
                from app.brokers import aliceblue
                if expiry_dt is None:
                    raise RuntimeError("Cannot resolve expiry date for Alice Blue")
                ltp = await aliceblue.get_option_ltp(underlying, expiry_dt, strike, side)
            setattr(s, f"{key}_ltp", ltp)
        except Exception as exc:
            logger.warning("LTP fetch failed for %s %s %s %s: %s", underlying, expiry, strike, side, exc)
            setattr(s, f"{key}_ltp", 0.0)
    return s


def build_zerodha_symbol(underlying: str, expiry: str, strike: int, option_type: str) -> str:
    """
    Build NSE option symbol in Zerodha / Kite format.
    e.g. NIFTY06MAR2522500CE
    expiry must be DDMONYY format (e.g. '06MAR25').
    Alice Blue should NOT use this — use aliceblue.get_option_ltp() instead.
    """
    return f"{underlying}{expiry}{strike}{option_type}"


# Backward-compat alias
build_nfo_symbol = build_zerodha_symbol
