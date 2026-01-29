"""Base data provider interface for market data."""

from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
from datetime import datetime
from ..common.models import HistoricalBar


class DataProviderInterface(ABC):
    """Abstract base class for all data provider implementations."""

    @abstractmethod
    def get_historical_data(self, symbol: str, timeframe: str = "1M") -> List[HistoricalBar]:
        """Get historical price data."""
        pass

    @abstractmethod
    def get_ticker_details(self, symbol: str) -> Dict[str, Any]:
        """Get ticker company details (name, logo, etc)."""
        pass

    @abstractmethod
    def get_daily_snapshot(self, symbol: str) -> Dict[str, Any]:
        """Get daily price snapshot (open, high, low, close, change)."""
        pass

    @abstractmethod
    def get_news(self, symbol: str, limit: int = 15) -> List[Dict[str, Any]]:
        """Get news headlines for a specific ticker."""
        pass

    @abstractmethod
    def get_market_news(self, limit: int = 25) -> List[Dict[str, Any]]:
        """Get general market news."""
        pass

    @abstractmethod
    def get_news_article(self, article_id: str) -> Dict[str, Any]:
        """Get full news article content."""
        pass

    @abstractmethod
    def get_analyst_insights(self, symbol: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Get analyst ratings and insights."""
        pass

    @abstractmethod
    def get_options_chain(self, symbol: str, max_strikes: int = 30) -> Dict[str, Any]:
        """Get options chain data."""
        pass