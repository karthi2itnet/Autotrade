import uuid
from datetime import datetime
from sqlalchemy import String, Integer, Float, Boolean, DateTime, Enum
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base

class TradeLog(Base):
    __tablename__ = "trade_logs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    underlying: Mapped[str] = mapped_column(String(20))
    expiry: Mapped[str] = mapped_column(String(20))
    side: Mapped[str] = mapped_column(String(4))          # CE | PE
    strike_label: Mapped[str] = mapped_column(String(10)) # OTM1|ATM|ITM1
    strike: Mapped[int] = mapped_column(Integer)
    lots: Mapped[int] = mapped_column(Integer)
    entry_ltp: Mapped[float] = mapped_column(Float)
    exit_ltp: Mapped[float] = mapped_column(Float)
    points: Mapped[float] = mapped_column(Float)
    pnl: Mapped[float] = mapped_column(Float)
    reason: Mapped[str] = mapped_column(String(20))       # target|sl|manual
    is_hedge: Mapped[bool] = mapped_column(Boolean, default=False)
    broker: Mapped[str] = mapped_column(String(30))
    paper_mode: Mapped[bool] = mapped_column(Boolean, default=True)
    reentry_count: Mapped[int] = mapped_column(Integer, default=0)


class BotState(Base):
    """Persists bot row configuration across restarts."""
    __tablename__ = "bot_states"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    underlying: Mapped[str] = mapped_column(String(20))
    side: Mapped[str] = mapped_column(String(4))
    strike_label: Mapped[str] = mapped_column(String(10))
    strike: Mapped[int] = mapped_column(Integer, default=0)
    lots: Mapped[int] = mapped_column(Integer, default=1)
    avg_reentry_points: Mapped[float] = mapped_column(Float, default=5.0)
    profit_taking_points: Mapped[float] = mapped_column(Float, default=3.0)
    max_reentries: Mapped[int] = mapped_column(Integer, default=3)
    hedge: Mapped[bool] = mapped_column(Boolean, default=False)
