"""
Telegram notification service.
Sends alerts on trade events, errors, and connection status.
"""
import logging
import httpx
from app.config import settings

logger = logging.getLogger(__name__)

BASE_URL = f"https://api.telegram.org/bot{settings.telegram_bot_token}"


async def send_message(text: str):
    """Send a raw message to the configured Telegram chat."""
    if not settings.telegram_bot_token or not settings.telegram_chat_id:
        logger.debug("Telegram not configured, skipping notification.")
        return
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(f"{BASE_URL}/sendMessage", json={
                "chat_id": settings.telegram_chat_id,
                "text": text,
                "parse_mode": "Markdown",
            })
    except Exception as e:
        logger.warning("Telegram send failed: %s", e)


async def send_trade_alert(trade: dict):
    emoji = "✅" if trade["reason"] == "target" else "🛑"
    pnl_str = f"+₹{trade['pnl']:,.0f}" if trade["pnl"] >= 0 else f"-₹{abs(trade['pnl']):,.0f}"
    msg = (
        f"{emoji} *Trade Closed*\n"
        f"Side: `{trade['side']}` | Strike: `{trade['strike_label']} {trade['strike']}`\n"
        f"Entry: ₹{trade['entry_ltp']:.1f} → Exit: ₹{trade['exit_ltp']:.1f}\n"
        f"Points: `{trade['points']:+.1f}` | Lots: `{trade['lots']}`\n"
        f"P&L: *{pnl_str}* | Reason: `{trade['reason'].upper()}`"
    )
    await send_message(msg)


async def send_connection_alert(broker: str, status: str):
    emoji = "🟢" if status == "connected" else "🔴"
    await send_message(f"{emoji} *{broker.title()}* {status}")


async def send_error_alert(row_id: str, error: str):
    await send_message(f"⚠️ *Bot Error* [{row_id}]\n`{error}`")
