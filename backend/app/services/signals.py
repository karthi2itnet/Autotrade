import asyncio
import time
import logging
from typing import Dict, List, Optional
from dataclasses import dataclass, field
from datetime import datetime

from app.brokers import aliceblue
from app.services.option_chain import get_strike_set

logger = logging.getLogger(__name__)

CANDLE_TIMEFRAME_SEC = 180  # 3 minutes
SMA_PERIOD = 9

@dataclass
class Candle:
    start_time: float
    open: float
    high: float
    low: float
    close: float
    volume: int
    is_closed: bool = False

@dataclass
class SignalEvent:
    time: float
    nifty_close: float
    sma9: float
    direction: str  # "UP" or "DOWN"
    message: str

class SignalEngine:
    def __init__(self):
        self.candles: List[Candle] = []
        self.current_candle: Optional[Candle] = None
        self.signals: List[SignalEvent] = []
        self.is_running = False

    async def start(self):
        if self.is_running: return
        self.is_running = True
        logger.info("SignalEngine started (3-min Nifty SMA-9 + ATP)")
        asyncio.create_task(self._poll_nifty_loop())

    async def stop(self):
        self.is_running = False

    def get_chart_data(self) -> Dict:
        """Return data formatted for lightweight-charts."""
        # Return all closed candles and current candle
        chart_candles = []
        for c in self.candles + ([self.current_candle] if self.current_candle else []):
            if c:
                chart_candles.append({
                    "time": int(c.start_time),
                    "open": c.open,
                    "high": c.high,
                    "low": c.low,
                    "close": c.close,
                })
        
        # Calculate SMA for the chart
        sma_data = []
        closes = [c["close"] for c in chart_candles]
        for i in range(len(closes)):
            if i >= SMA_PERIOD - 1:
                sma_val = sum(closes[i - SMA_PERIOD + 1 : i + 1]) / SMA_PERIOD
                sma_data.append({"time": chart_candles[i]["time"], "value": round(sma_val, 2)})
            
        return {
            "candles": chart_candles,
            "sma9": sma_data,
            "signals": [{"time": int(s.time), "direction": s.direction, "message": s.message} for s in self.signals]
        }

    async def _poll_nifty_loop(self):
        while self.is_running:
            try:
                # Get Nifty LTP from aliceblue index cache (updates every 100ms in main.py)
                ltp = aliceblue.get_cached_ltp("NIFTY")
                if ltp <= 0:
                    ltp = aliceblue._index_cache.get("NIFTY", 0.0)
                
                if ltp > 0:
                    await self._process_tick(ltp)
            except Exception as e:
                logger.error("SignalEngine tick error: %s", e)
                
            await asyncio.sleep(1.0) # Check every 1s

    async def _process_tick(self, ltp: float):
        now = time.time()
        
        # Align to 3-minute boundaries (wall clock)
        # 180 seconds. e.g. 10:00:00 = 0 mod 180
        candle_start = now - (now % CANDLE_TIMEFRAME_SEC)

        if not self.current_candle:
            self.current_candle = Candle(start_time=candle_start, open=ltp, high=ltp, low=ltp, close=ltp, volume=0)
            return

        if candle_start > self.current_candle.start_time:
            # Close the current candle
            self.current_candle.is_closed = True
            self.candles.append(self.current_candle)
            
            # Keep max 100 candles in memory (5 hours of 3-min)
            if len(self.candles) > 100:
                self.candles.pop(0)
                
            # Evaluate signals before creating new candle
            await self._evaluate_signals()
            
            # Start new candle
            self.current_candle = Candle(start_time=candle_start, open=ltp, high=ltp, low=ltp, close=ltp, volume=0)
        else:
            # Update current candle
            self.current_candle.high = max(self.current_candle.high, ltp)
            self.current_candle.low = min(self.current_candle.low, ltp)
            self.current_candle.close = ltp

    async def _evaluate_signals(self):
        if len(self.candles) < SMA_PERIOD + 1:
            return  # Not enough data for Previous SMA and Current SMA
            
        # Get the last two closed candles
        curr_candle = self.candles[-1]
        prev_candle = self.candles[-2]
        
        # Calculate Current SMA-9 and Previous SMA-9
        closes = [c.close for c in self.candles]
        curr_sma = sum(closes[-SMA_PERIOD:]) / SMA_PERIOD
        prev_sma = sum(closes[-SMA_PERIOD-1:-1]) / SMA_PERIOD
        
        logger.debug(f"[SignalEngine] Prev: {prev_candle.close:.1f} vs SMA {prev_sma:.1f} | Curr: {curr_candle.close:.1f} vs SMA {curr_sma:.1f}")

        # Check Crossover
        cross_up = prev_candle.close <= prev_sma and curr_candle.close > curr_sma
        cross_down = prev_candle.close >= prev_sma and curr_candle.close < curr_sma
        
        if cross_up:
            await self._check_atp_logic("UP", "CE")
        elif cross_down:
            await self._check_atp_logic("DOWN", "PE")


    async def _check_atp_logic(self, direction: str, side: str):
        """
        Evaluate (ATP - LTP) of ITM1 < (ATP - LTP) of ATM
        """
        logger.info(f"SignalEngine: Detected Nifty SMA {direction} cross. Checking {side} ATP logic...")
        try:
            # 1. Get current strike chain for Nifty weekly
            strike_set = await get_strike_set("NIFTY", "weekly", "aliceblue")
            
            if side == "CE":
                atm_strike = strike_set.atm
                itm_strike = strike_set.itm1_ce
            else:
                atm_strike = strike_set.atm
                itm_strike = strike_set.itm1_pe
                
            # 2. Extract instrument from aliceblue
            from datetime import datetime as _dt
            expiry_dt = _dt.strptime(strike_set.expiry, "%d%b%y").date()
            
            atm_inst = await self._get_inst("NIFTY", expiry_dt, atm_strike, side)
            itm_inst = await self._get_inst("NIFTY", expiry_dt, itm_strike, side)
            
            if not atm_inst or not itm_inst:
                logger.warning("SignalEngine: Could not find instruments for ATP logic.")
                return
                
            # 3. Fetch Scrip Info to get ATP and LTP
            atm_info = await asyncio.to_thread(aliceblue.get_client().get_scrip_info, atm_inst)
            itm_info = await asyncio.to_thread(aliceblue.get_client().get_scrip_info, itm_inst)
            
            atm_atp, atm_ltp = self._parse_info(atm_info)
            itm_atp, itm_ltp = self._parse_info(itm_info)
            
            if atm_atp == 0 or itm_atp == 0:
                logger.warning("SignalEngine: ATP parse failed %s %s", atm_info, itm_info)
                return
                
            atm_diff = atm_atp - atm_ltp
            itm_diff = itm_atp - itm_ltp
            
            logger.info(f"SignalEngine: {side} ATM({atm_strike}) ATP={atm_atp:.1f} LTP={atm_ltp:.1f} Diff={atm_diff:.2f}")
            logger.info(f"SignalEngine: {side} ITM({itm_strike}) ATP={itm_atp:.1f} LTP={itm_ltp:.1f} Diff={itm_diff:.2f}")
            
            # THE LOGIC:
            if itm_diff < atm_diff:
                msg = f"BUY {side} Signal | ITM Diff ({itm_diff:.1f}) < ATM Diff ({atm_diff:.1f})"
                logger.info(f"🟢 SignalEngine -> {msg}")
                self.signals.append(SignalEvent(
                    time=time.time(),
                    nifty_close=self.candles[-1].close,
                    sma9=sum([c.close for c in self.candles[-SMA_PERIOD:]]) / SMA_PERIOD,
                    direction=direction,
                    message=msg
                ))
            else:
                logger.info(f"🔴 SignalEngine -> {side} ATP logic failed.")
            
        except Exception as e:
            logger.error("SignalEngine ATP Logic Error: %s", e, exc_info=True)


    async def _get_inst(self, underlying, expiry_dt, strike, side):
        alice = aliceblue.get_client()
        is_ce = side.upper() == "CE"
        expiry_str = expiry_dt.strftime("%Y-%m-%d")
        return await asyncio.to_thread(
            alice.get_instrument_for_fno,
            exch="NFO",
            symbol=underlying,
            expiry_date=expiry_str,
            is_fut=False,
            strike=strike,
            is_CE=is_ce,
        )

    def _parse_info(self, info: dict) -> tuple[float, float]:
        """Returns (atp, ltp)"""
        atp = 0.0
        ltp = 0.0
        
        # Check root
        for k in ("AveragePrice", "average_price", "vprc", "Vprc", "AvgPrice"):
            if k in info: atp = float(info[k])
        for k in ("Ltp", "ltp", "last_traded_price"):
            if k in info: ltp = float(info[k])
            
        # Check 'data' nested
        if isinstance(info, dict) and "data" in info and isinstance(info["data"], dict):
            d = info["data"]
            for k in ("AveragePrice", "average_price", "vprc", "Vprc", "AvgPrice"):
                if k in d: atp = float(d[k])
            for k in ("Ltp", "ltp", "last_traded_price"):
                if k in d: ltp = float(d[k])
                
        return atp, ltp

# Global Instance
signal_engine = SignalEngine()
