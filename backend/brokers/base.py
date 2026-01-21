"""Base broker interface that all broker implementations must follow."""

from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
from ..common.models import Position, AccountSummary, TradeOrder, OptionOrder, Order


class BrokerInterface(ABC):
    """Abstract base class for all broker implementations."""

    @abstractmethod
    async def connect(self) -> bool:
        """Connect to the broker API."""
        pass

    @abstractmethod
    def disconnect(self) -> None:
        """Disconnect from the broker API."""
        pass

    @abstractmethod
    def is_connected(self) -> bool:
        """Check if connected to the broker."""
        pass

    @abstractmethod
    def get_positions(self) -> List[Position]:
        """Get all current positions."""
        pass

    @abstractmethod
    def get_account_summary(self) -> Dict[str, AccountSummary]:
        """Get account summary information."""
        pass

    @abstractmethod
    def get_orders(self) -> List[Order]:
        """Get list of orders (pending and filled for the day)."""
        pass

    @abstractmethod
    def place_stock_order(self, order: TradeOrder) -> Dict[str, Any]:
        """Place a stock order."""
        pass

    @abstractmethod
    def place_option_order(self, order: OptionOrder) -> Dict[str, Any]:
        """Place an option order."""
        pass

    @abstractmethod
    def place_multileg_option_order(self, legs: List[Dict[str, Any]], order_type: str = "MARKET", limit_price: Optional[float] = None) -> Dict[str, Any]:
        """
        Place a multi-leg options order.
        
        Args:
            legs: List of leg dicts with keys:
                - symbol: Underlying symbol
                - expiry: Expiration date
                - strike: Strike price
                - right: "C" or "P"
                - action: "BUY" or "SELL"
                - quantity: Number of contracts
            order_type: "MARKET" or "LIMIT"
            limit_price: Required for LIMIT orders
        """
        pass

    @abstractmethod
    def get_option_chain(self, symbol: str, max_strikes: int = 30) -> Dict[str, Any]:
        """Get options chain for a symbol."""
        pass

    @abstractmethod
    def subscribe_to_market_data(self, symbol: str) -> bool:
        """Subscribe to live market data for a symbol."""
        pass

    @abstractmethod
    def get_market_price(self, symbol: str) -> Optional[float]:
        """Get current market price for a symbol."""
        pass