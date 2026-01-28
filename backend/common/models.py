"""Common data models shared across brokers and data providers."""

from dataclasses import dataclass
from typing import Optional, Literal, List, Dict, Any
from datetime import datetime
from pydantic import BaseModel


@dataclass
class Position:
    """Universal position model for any broker."""
    ticker: str
    position_type: Literal['stock', 'call', 'put']
    qty: float
    account: Optional[str] = None
    strike: Optional[float] = None
    expiry: Optional[str] = None
    dte: Optional[int] = None
    cost_basis: Optional[float] = 0.0
    unrealized_pnl: Optional[float] = 0.0
    daily_pnl: Optional[float] = 0.0
    current_price: Optional[float] = 0.0
    underlying_price: Optional[float] = None
    # Greeks
    delta: Optional[float] = None
    gamma: Optional[float] = None
    theta: Optional[float] = None
    vega: Optional[float] = None
    iv: Optional[float] = None

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {k: v for k, v in self.__dict__.items() if v is not None}


@dataclass
class AccountSummary:
    """Universal account summary model."""
    account: str
    net_liquidation: float
    total_cash: float
    buying_power: float
    unrealized_pnl: float = 0.0
    realized_pnl: float = 0.0
    daily_pnl: float = 0.0

    def to_dict(self) -> dict:
        return self.__dict__


class TradeOrder(BaseModel):
    """Universal trade order model."""
    symbol: str
    action: Literal["BUY", "SELL"]
    quantity: int
    order_type: Literal["MARKET", "LIMIT", "TRAIL"]
    limit_price: Optional[float] = None
    trailing_amount: Optional[float] = None
    trailing_percent: Optional[float] = None
    tif: Literal["DAY", "GTC"] = "DAY"
    account: Optional[str] = None


class OptionOrder(BaseModel):
    """Universal option order model."""
    symbol: str
    expiry: str  # YYYYMMDD format
    strike: float
    right: Literal["C", "P"]
    action: Literal["BUY", "SELL"]
    quantity: int
    order_type: Literal["MARKET", "LIMIT"]
    limit_price: Optional[float] = None
    account: Optional[str] = None


@dataclass
class HistoricalBar:
    """Universal bar data model."""
    date: datetime
    open: float
    high: float
    low: float
    close: float
    volume: int

    def to_dict(self) -> dict:
        return {
            "date": self.date.isoformat() if isinstance(self.date, datetime) else self.date,
            "open": self.open,
            "high": self.high,
            "low": self.low,
            "close": self.close,
            "volume": self.volume
        }


@dataclass
class OptionQuote:
    """Universal option quote model."""
    strike: float
    bid: float
    ask: float
    last: float
    mid: float
    volume: int
    open_interest: int
    iv: Optional[float] = None
    delta: Optional[float] = None
    gamma: Optional[float] = None
    theta: Optional[float] = None
    vega: Optional[float] = None

    def to_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items() if v is not None}


@dataclass
class Order:
    """Unified order model for any broker."""
    order_id: str
    symbol: str
    action: Literal["BUY", "SELL"]
    quantity: float
    order_type: Literal["MARKET", "LIMIT"]
    status: Literal["Pending", "Filled", "Cancelled", "Working", "Submitted"]
    limit_price: Optional[float] = None
    filled_quantity: float = 0.0
    average_fill_price: Optional[float] = None
    time_placed: Optional[str] = None # ISO format
    account: Optional[str] = None
    # Option details
    asset_type: Literal["stock", "option"] = "stock"
    strike: Optional[float] = None
    expiry: Optional[str] = None # YYYY-MM-DD
    option_type: Optional[Literal["call", "put"]] = None
    stop_price: Optional[float] = None
    
    def to_dict(self) -> dict:
        return {k: v for k, v in self.__dict__.items() if v is not None}