"""
Bot Engine — Re-entry Averaging with Per-Lot Profit Booking
============================================================

Strategy:
  - Buy 1 lot initially.
  - Each lot tracks its OWN entry price and exits independently when
    current_ltp >= lot.entry_ltp + profit_pts  (scaling out one-by-one).
  - When current_ltp drops by `avg_reentry_pts` below the LAST lot added,
    a new lot is added (averaging down), up to `1 + max_reentries` total.
  - Hedge: on every BUY, also BUY 1 lot of opposite side (CE→PE, PE→CE).
  - After all lots are closed, the bot re-watches for a fresh initial entry.

Example (profit_pts=5, avg_reentry_pts=5, max_reentries=2):
  Lot-1 @ ₹100 → added when bot starts
  LTP → ₹95  → Lot-2 added @ ₹95
  LTP → ₹90  → Lot-3 added @ ₹90  [max reached]
  LTP → ₹95  → Lot-3 exits (+5) ✅
  LTP → ₹100 → Lot-2 exits (+5) ✅
  LTP → ₹105 → Lot-1 exits (+5) ✅  → all closed, re-watch
"""
import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional

logger = logging.getLogger(__name__)


# ── Enums & data models ────────────────────────────────────────────────────────

class BotStatus(str, Enum):
    IDLE      = "idle"
    RUNNING   = "running"   # watching, no open lots yet / after all lots closed
    IN_TRADE  = "intrade"   # at least 1 lot open
    STOPPED   = "stopped"
    ERROR     = "error"


@dataclass
class OpenLot:
    """Represents a single open lot position."""
    lot_number: int
    entry_ltp: float
    target_ltp: float       # entry_ltp + profit_pts
    order_id: str
    hedge_order_id: str = ""
    sell_order_id: str = "" # populated if auto-sell is used


@dataclass
class BotRowConfig:
    underlying: str         # "NIFTY"
    expiry: str             # "24DEC"
    side: str               # "CE" | "PE"
    strike_label: str       # "OTM1" | "ATM" | "ITM1"
    strike: int
    symbol: str             # full NSE trading symbol e.g. "NIFTY24DEC22450CE"
    lots: int               # lots per entry (usually 1)
    lot_size: int           # contract lot size e.g. 50 for NIFTY
    profit_pts: float       # exit each lot when LTP rises this many pts from its entry
    avg_reentry_pts: float  # add a new lot when LTP drops this many pts from last entry
    max_reentries: int      # max ADDITIONAL lots beyond the first (total = 1 + max_reentries)
    hedge: bool
    hedge_symbol: str = ""  # opposite-side symbol
    broker: str = "aliceblue"
    paper_mode: bool = True
    auto_sell: bool = False # place target limit sell order immediately after buy


@dataclass
class BotRowState:
    config: BotRowConfig
    status: BotStatus = BotStatus.IDLE
    open_lots: list = field(default_factory=list)   # list[OpenLot]
    current_ltp: float = 0.0
    lots_closed_today: int = 0
    total_points_today: float = 0.0
    total_pnl_today: float = 0.0
    current_reentries: int = 0  # Re-entries in the CURRENT trade cycle
    trade_log: list = field(default_factory=list)

    # ── Derived helpers ──────────────────────────────────────────────────────
    @property
    def open_lot_count(self) -> int:
        return len(self.open_lots)

    @property
    def last_lot(self) -> Optional[OpenLot]:
        return self.open_lots[-1] if self.open_lots else None

    @property
    def max_lots_total(self) -> int:
        return 1 + self.config.max_reentries


# ── Bot Engine ─────────────────────────────────────────────────────────────────

class BotEngine:
    """
    Manages all running bot-row asyncio tasks.
    Each row = one independent averaging bot.
    """

    def __init__(self):
        self._rows:  dict[str, BotRowState] = {}
        self._tasks: dict[str, asyncio.Task] = {}
        
        # Global limits
        self.max_profit_limit: float = 0.0  # 0.0 means unlimited
        self.max_loss_limit: float = 0.0    # 0.0 means unlimited
        self.global_trading_halted: bool = False


    def add_row(self, row_id: str, config: BotRowConfig):
        self._rows[row_id] = BotRowState(config=config)

    def update_config(self, row_id: str, config: BotRowConfig):
        """Hot-update config while bot is idle/stopped."""
        if row_id in self._rows:
            self._rows[row_id].config = config

    def get_state(self, row_id: str) -> Optional[BotRowState]:
        return self._rows.get(row_id)

    def get_all_states(self) -> dict[str, BotRowState]:
        return self._rows

    # ── Control ───────────────────────────────────────────────────────────────

    async def start_row(self, row_id: str):
        if row_id not in self._rows:
            raise KeyError(f"Row {row_id} not found")
        task = self._tasks.get(row_id)
        if task and not task.done():
            logger.warning("Row %s already running", row_id)
            return
        state = self._rows[row_id]
        state.status = BotStatus.RUNNING
        self._tasks[row_id] = asyncio.create_task(
            self._run_row(row_id, state),
            name=f"bot-{row_id}",
        )
        logger.info("▶ Started row %s [%s %s %s]",
                    row_id, state.config.underlying, state.config.side, state.config.strike_label)

    async def stop_row(self, row_id: str):
        state = self._rows.get(row_id)
        if state:
            state.status = BotStatus.STOPPED
            if state.open_lots:
                asyncio.create_task(self._close_all_lots_on_stop(row_id, state))
                
        task = self._tasks.get(row_id)
        if task and not task.done():
            task.cancel()
        logger.info("⏹ Stopped row %s", row_id)

    async def _close_all_lots_on_stop(self, row_id: str, state: BotRowState):
        """Immediately market sell all open lots when user stops the bot."""
        try:
            exit_ltp = await self._fetch_ltp(state.config)
            logger.info("[%s] Stopping... closing %d open lots at ₹%.1f", row_id, len(state.open_lots), exit_ltp)
            
            for lot in list(state.open_lots):
                if lot.sell_order_id:
                    # Cancel the open limit order on broker
                    await self._cancel_order(state.config, lot.sell_order_id)
                    lot.sell_order_id = "" # Force market sell in _close_lot
                await self._close_lot(state, lot, exit_ltp, "manual")
                
            state.open_lots.clear()
            logger.info("[%s] All open lots closed due to stop.", row_id)
        except Exception as e:
            logger.error("[%s] Error closing lots on stop: %s", row_id, e, exc_info=True)

    async def _cancel_order(self, cfg: BotRowConfig, order_id: str) -> bool:
        """Helper to cancel an active limit order."""
        if cfg.paper_mode or not order_id:
            return True
        if cfg.broker == "aliceblue":
            from app.brokers import aliceblue
            return await aliceblue.cancel_order(order_id)
        from app.brokers import zerodha
        return await zerodha.cancel_order(order_id)

    async def stop_all(self):
        for row_id in list(self._tasks):
            await self.stop_row(row_id)

    async def kill_all(self):
        """Stop all bots + cancel any open positions."""
        await self.stop_all()
        for state in self._rows.values():
            for lot in state.open_lots:
                await self._place_sell(state.config, lot.order_id)
            state.open_lots.clear()
            state.status = BotStatus.IDLE
        logger.warning("☠ Kill-all executed — all positions flattened")

    # ── Core loop ─────────────────────────────────────────────────────────────

    async def _run_row(self, row_id: str, state: BotRowState):
        cfg = state.config
        try:
            while state.status not in (BotStatus.STOPPED,):
                ltp = await self._fetch_ltp(cfg)
                state.current_ltp = ltp

                # ── Phase A: No open lots → enter first lot ────────────────
                if not state.open_lots:
                    if state.status == BotStatus.RUNNING and not self.global_trading_halted:
                        lot = await self._open_lot(state, ltp)
                        logger.info("[%s] Lot-1 BUY @ ₹%.1f  target ₹%.1f",
                                    row_id, ltp, lot.target_ltp)

                # ── Phase B: Has open lots ─────────────────────────────────
                else:
                    state.status = BotStatus.IN_TRADE

                    # B1: Check each lot for profit exit (scaling out)
                    exited_lots = []
                    for lot in state.open_lots:
                        if ltp >= lot.target_ltp:
                            await self._close_lot(state, lot, ltp, "target")
                            exited_lots.append(lot)
                            logger.info("[%s] Lot-%d EXIT @ ₹%.1f (+%.1f pts)",
                                        row_id, lot.lot_number, ltp, cfg.profit_pts)
                    for lot in exited_lots:
                        state.open_lots.remove(lot)

                    # B2: After exits, if all closed → back to RUNNING (watching)
                    if not state.open_lots:
                        state.status = BotStatus.RUNNING
                        state.current_reentries = 0 # RESET re-entry count for fresh cycle
                        logger.info("[%s] All lots closed. Watching for re-entry.", row_id)

                    # B3: Averaging down — add lot if price dropped enough
                    elif state.current_reentries < cfg.max_reentries:
                        last = state.last_lot
                        reentry_trigger = last.entry_ltp - cfg.avg_reentry_pts
                        if ltp <= reentry_trigger:
                            # Use strict cycle-based limit check
                            if state.current_reentries < cfg.max_reentries:
                                lot = await self._open_lot(state, ltp)
                                logger.info("[%s] Lot-%d ADD (avg-down) @ ₹%.1f  trigger ₹%.1f [Cycle Limit %d/%d]",
                                            row_id, lot.lot_number, ltp, reentry_trigger, 
                                            state.current_reentries, cfg.max_reentries)
                            else:
                                logger.debug("[%s] Re-entry limit reached (%d/%d), skipping trigger.", 
                                             row_id, state.current_reentries, cfg.max_reentries)

                    # B4: Active Stoploss Check (M2M)
                    # Check global limits even if no specific event occurred
                    self._check_global_pnl_limits()

                await asyncio.sleep(0.02)  # Faster reaction to UI signals and price ticks

        except asyncio.CancelledError:
            logger.info("[%s] Cancelled", row_id)

        except Exception as e:
            logger.error("[%s] Error: %s", row_id, e, exc_info=True)
            state.status = BotStatus.ERROR
            from app.services.notifier import send_error_alert
            asyncio.create_task(send_error_alert(row_id, str(e)))

    # ── Order helpers ──────────────────────────────────────────────────────────

    async def _open_lot(self, state: BotRowState, ltp: float) -> OpenLot:
        """Buy 1 lot (+ hedge if enabled). Returns the OpenLot added."""
        import time
        t0 = time.time()
        cfg = state.config
        lot_number = len(state.open_lots) + 1
        
        # Fire both legs concurrently if hedged
        coros = [self._place_buy(cfg)]
        if cfg.hedge and cfg.hedge_symbol:
            coros.append(self._place_hedge_buy(cfg))
            
        results = await asyncio.gather(*coros)
        order_id = results[0]
        hedge_order_id = results[1] if len(results) > 1 else ""
        
        logger.info("  ↳ _open_lot broker API call completed in %.1f ms", (time.time() - t0) * 1000)

        target_ltp = round(ltp + cfg.profit_pts, 2)
        sell_order_id = ""

        # Place Auto Sell Limit order if enabled
        if cfg.auto_sell:
            sell_order_id = await self._place_sell(cfg, "", is_limit=True, limit_price=target_ltp)
            logger.info("  ↳ _open_lot immediately placed limit sell obj %s @ ₹%.1f", sell_order_id, target_ltp)

        lot = OpenLot(
            lot_number=lot_number,
            entry_ltp=ltp,
            target_ltp=target_ltp,
            order_id=order_id,
            hedge_order_id=hedge_order_id,
            sell_order_id=sell_order_id,
        )
        if lot_number > 1:
            state.current_reentries += 1
            
        state.open_lots.append(lot)
        return lot

    async def _close_lot(self, state: BotRowState, lot: OpenLot, exit_ltp: float, reason: str):
        """Sell 1 lot (+ hedge if applicable). Log the trade."""
        cfg = state.config
        
        coros = []
        if not lot.sell_order_id:
            # If we haven't auto-placed a limit sell, do a market sell now
            coros.append(self._place_sell(cfg, lot.order_id))
            
        if lot.hedge_order_id:
            coros.append(self._place_sell(cfg, lot.hedge_order_id, hedge=True))
            
        if coros:
            await asyncio.gather(*coros)

        points = round(exit_ltp - lot.entry_ltp, 2)
        pnl    = round(points * cfg.lots * cfg.lot_size, 2)

        state.lots_closed_today  += 1
        state.total_points_today += points
        state.total_pnl_today    += pnl

        trade = {
            "id":           str(uuid.uuid4()),
            "time":         datetime.now().strftime("%H:%M:%S"),
            "side":         cfg.side,
            "strike_label": cfg.strike_label,
            "strike":       cfg.strike,
            "lot_number":   lot.lot_number,
            "entry_ltp":    lot.entry_ltp,
            "exit_ltp":     exit_ltp,
            "lots":         cfg.lots,
            "points":       points,
            "pnl":          pnl,
            "reason":       reason,
            "is_hedge":     False,
        }
        state.trade_log.append(trade)

        # Fire-and-forget: persist + notify
        asyncio.create_task(self._persist_trade(cfg, trade))
        from app.services.notifier import send_trade_alert
        asyncio.create_task(send_trade_alert(trade))

        # Check Global PnL Limits
        self._check_global_pnl_limits()

    async def _check_global_pnl_limits_async(self):
        """
        Calculates total Realized + Unrealized P&L (MTM).
        If loss limit hit, calls kill_all().
        """
        if self.global_trading_halted:
            return

        total_realized = sum(r.total_pnl_today for r in self._rows.values())
        total_unrealized = 0.0
        
        for state in self._rows.values():
            if state.status == BotStatus.IN_TRADE:
                for lot in state.open_lots:
                    # Point difference
                    pts = state.current_ltp - lot.entry_ltp
                    # PnL for this lot
                    lot_pnl = pts * state.config.lots * state.config.lot_size
                    total_unrealized += lot_pnl
        
        total_mtm = round(total_realized + total_unrealized, 2)
        
        max_profit = self.max_profit_limit
        max_loss = self.max_loss_limit
        
        halted = False
        reason = ""

        if max_profit > 0.0 and total_mtm >= max_profit:
            halted = True
            reason = f"MAX PROFIT REACHED (+₹{total_mtm:.1f} MTM)"
        elif max_loss > 0.0 and total_mtm <= -max_loss:
            halted = True
            reason = f"MAX LOSS REACHED (₹{total_mtm:.1f} MTM)"

        if halted:
            self.global_trading_halted = True
            logger.warning("🚨 GLOBAL TRADING HALTED! %s", reason)
            
            # IMMEDIATELY Kill All positions
            asyncio.create_task(self.kill_all())
            
            from app.services.notifier import send_error_alert
            asyncio.create_task(send_error_alert("GLOBAL_LIMIT", f"Trading Halted: {reason}. All positions closed."))

    def _check_global_pnl_limits(self):
        """Sync wrapper to fire off the async check."""
        asyncio.create_task(self._check_global_pnl_limits_async())


    # ── Broker helpers ─────────────────────────────────────────────────────────

    async def _fetch_ltp(self, cfg: BotRowConfig) -> float:
        if cfg.paper_mode:
            # Paper mode: simulate small random walk
            import random
            key = f"{cfg.symbol}_ltp"
            cached = getattr(self, key, None)
            base = cached if cached else 100.0
            new_ltp = round(base + random.uniform(-1.5, 1.5), 1)
            setattr(self, key, new_ltp)
            return new_ltp

        if cfg.broker == "aliceblue":
            from app.brokers import aliceblue
            # First try the shared LTP cache (populated by _ltp_poller_loop in main.py)
            cached = aliceblue.get_cached_ltp(cfg.symbol)
            if cached > 0.0:
                return cached
            # Cache cold (first tick) — fall back to direct call
            from datetime import datetime as _dt
            expiry_dt = _dt.strptime(cfg.expiry, "%d%b%y").date()
            return await aliceblue.get_option_ltp(
                underlying=cfg.underlying,
                expiry_dt=expiry_dt,
                strike=cfg.strike,
                option_type=cfg.side,
            )
        else:
            from app.brokers import zerodha
            return await zerodha.get_ltp("NFO", cfg.symbol)

    async def _place_buy(self, cfg: BotRowConfig) -> str:
        qty = cfg.lots * cfg.lot_size
        if cfg.paper_mode:
            oid = f"PAPER-BUY-{uuid.uuid4().hex[:8]}"
            logger.info("[PAPER] BUY %s x%d → %s", cfg.symbol, qty, oid)
            return oid
        if cfg.broker == "aliceblue":
            from app.brokers import aliceblue
            return await aliceblue.place_order(cfg.symbol, "NFO", "BUY", qty)
        from app.brokers import zerodha
        return await zerodha.place_order(cfg.symbol, "NFO", "BUY", qty)

    async def _place_sell(self, cfg: BotRowConfig, order_id: str, hedge: bool = False, is_limit: bool = False, limit_price: float = 0.0) -> str:
        qty = cfg.lots * cfg.lot_size
        symbol = cfg.hedge_symbol if hedge else cfg.symbol
        order_type = "LMT" if is_limit else "MKT"
        
        if cfg.paper_mode:
            oid = f"PAPER-SELL-{uuid.uuid4().hex[:8]}"
            logger.info("[PAPER] SELL %s x%d @ %s → %s", symbol, qty, limit_price if is_limit else "MKT", oid)
            return oid
            
        if cfg.broker == "aliceblue":
            from app.brokers import aliceblue
            return await aliceblue.place_order(symbol, "NFO", "SELL", qty, order_type=order_type, price=limit_price)
            
        from app.brokers import zerodha
        return await zerodha.place_order(symbol, "NFO", "SELL", qty)  # zero-dha not fully supporting limit parameters in placeholder yet

    async def _place_hedge_buy(self, cfg: BotRowConfig) -> str:
        qty = cfg.lots * cfg.lot_size
        if cfg.paper_mode:
            oid = f"PAPER-HEDGE-{uuid.uuid4().hex[:8]}"
            logger.info("[PAPER] HEDGE BUY %s x%d → %s", cfg.hedge_symbol, qty, oid)
            return oid
        if cfg.broker == "aliceblue":
            from app.brokers import aliceblue
            return await aliceblue.place_order(cfg.hedge_symbol, "NFO", "BUY", qty)
        from app.brokers import zerodha
        return await zerodha.place_order(cfg.hedge_symbol, "NFO", "BUY", qty)

    # ── Persistence ────────────────────────────────────────────────────────────

    async def _persist_trade(self, cfg: BotRowConfig, entry: dict):
        try:
            from app.database import SessionLocal
            from app.models import TradeLog
            async with SessionLocal() as db:
                trade = TradeLog(
                    id=entry["id"],
                    underlying=cfg.underlying,
                    expiry=cfg.expiry,
                    side=entry["side"],
                    strike_label=entry["strike_label"],
                    strike=entry["strike"],
                    lots=entry["lots"],
                    entry_ltp=entry["entry_ltp"],
                    exit_ltp=entry["exit_ltp"],
                    points=entry["points"],
                    pnl=entry["pnl"],
                    reason=entry["reason"],
                    is_hedge=entry["is_hedge"],
                    broker=cfg.broker,
                    paper_mode=cfg.paper_mode,
                    reentry_count=entry.get("lot_number", 1) - 1,
                )
                db.add(trade)
                await db.commit()
        except Exception as e:
            logger.error("Persist trade failed: %s", e)


# Global singleton
bot_engine = BotEngine()
