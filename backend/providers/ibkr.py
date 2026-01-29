"""IBKR data provider implementation using TWS API via ib_insync.

This provider is an alternative to Massive for users who have IBKR accounts
and don't want to pay for additional data subscriptions.

Requirements:
- TWS or IB Gateway must be running and connected
- API must be enabled in TWS/IBG settings
- Default port: 7496 (TWS) or 4001 (IBG)

Limitations:
- No company logo/branding URLs (use Massive for branding)
- News requires specific subscriptions (Dow Jones, Reuters, etc.)
- Requires live connection to TWS/IBG
"""

from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from ib_insync import Stock, Option, Contract, util
from .base import DataProviderInterface
from ..common.models import HistoricalBar
from ..common.utils import safe_float, safe_int, handle_api_error
from ..brokers.ibkr import ib_client

# Timeframe configuration for IBKR historical data
# Maps our timeframe codes to IBKR duration/bar size
TIMEFRAME_CONFIG = {
    "1Y": {"duration": "1 Y", "bar_size": "1 day"},
    "1M": {"duration": "1 M", "bar_size": "1 day"},
    "1W": {"duration": "1 W", "bar_size": "1 hour"},
    "1D": {"duration": "1 D", "bar_size": "5 mins"},
    "1H": {"duration": "3600 S", "bar_size": "1 min"},
}


@handle_api_error("fetch historical bars", module_name="IBKR")
def get_historical_bars(symbol: str, timeframe: str = "1M") -> dict:
    """
    Fetch historical OHLC bars from IBKR TWS API.

    Args:
        symbol: Stock ticker (e.g., "AAPL")
        timeframe: One of "1Y", "1M", "1W", "1D", "1H"

    Returns:
        Dict with symbol, timeframe, and bars list
    """
    symbol = symbol.upper().strip()

    if not ib_client.connected or not ib_client.ib.isConnected():
        return {
            "symbol": symbol,
            "timeframe": timeframe,
            "bars": [],
            "error": "Not connected to IBKR"
        }

    config = TIMEFRAME_CONFIG.get(timeframe.upper(), TIMEFRAME_CONFIG["1M"])

    try:
        # Create stock contract
        contract = Stock(symbol, 'SMART', 'USD')

        # Request historical data
        # whatToShow: TRADES, MIDPOINT, BID, ASK, etc.
        bars = ib_client.ib.reqHistoricalData(
            contract,
            endDateTime='',  # Empty string = now
            durationStr=config["duration"],
            barSizeSetting=config["bar_size"],
            whatToShow='TRADES',
            useRTH=True,  # Regular Trading Hours only
            formatDate=1
        )

        # Convert IBKR bars to our format
        result_bars = []
        for bar in bars:
            result_bars.append({
                "date": bar.date.isoformat() if hasattr(bar.date, 'isoformat') else str(bar.date),
                "open": safe_float(bar.open),
                "high": safe_float(bar.high),
                "low": safe_float(bar.low),
                "close": safe_float(bar.close),
                "volume": safe_int(bar.volume),
            })

        print(f"DEBUG [IBKR]: Retrieved {len(result_bars)} bars for {symbol} ({timeframe})")

        return {
            "symbol": symbol,
            "timeframe": timeframe.upper(),
            "bars": result_bars
        }

    except Exception as e:
        print(f"ERROR [IBKR]: Failed to fetch historical data for {symbol}: {e}")
        return {
            "symbol": symbol,
            "timeframe": timeframe,
            "bars": [],
            "error": str(e)
        }


@handle_api_error("fetch daily snapshot", module_name="IBKR")
def get_daily_snapshot(symbol: str) -> dict:
    """
    Get current price and daily change from IBKR.

    Uses market data subscription to get live prices.

    Args:
        symbol: Stock ticker (e.g., "AAPL")

    Returns:
        Dict with current_price, previous_close, change, change_pct
    """
    symbol = symbol.upper().strip()

    if not ib_client.connected or not ib_client.ib.isConnected():
        return {"symbol": symbol, "error": "Not connected to IBKR"}

    try:
        # Create stock contract
        contract = Stock(symbol, 'SMART', 'USD')

        # Ensure market data subscription
        ib_client._ensure_market_data(contract)

        # Get ticker snapshot
        ticker = ib_client.ib.ticker(contract)

        if ticker is None:
            return {"symbol": symbol, "error": "No market data available"}

        # Extract prices
        current_price = safe_float(ticker.marketPrice()) or safe_float(ticker.last) or safe_float(ticker.close)
        prev_close = safe_float(ticker.close)  # Previous day's close

        # Calculate change
        change = 0.0
        change_pct = 0.0
        if current_price > 0 and prev_close > 0:
            change = current_price - prev_close
            change_pct = (change / prev_close) * 100

        return {
            "symbol": symbol,
            "current_price": current_price,
            "previous_close": prev_close,
            "change": change,
            "change_pct": round(change_pct, 2)
        }

    except Exception as e:
        print(f"ERROR [IBKR]: Failed to fetch snapshot for {symbol}: {e}")
        return {"symbol": symbol, "error": str(e)}


@handle_api_error("fetch ticker details", module_name="IBKR")
def get_ticker_details(symbol: str) -> dict:
    """
    Fetch ticker details from IBKR.

    Note: IBKR provides limited company info compared to Massive.
    No logo or branding URLs are available.

    Args:
        symbol: Stock ticker (e.g., "AAPL")

    Returns:
        Dict with ticker details (name, exchange, etc.)
    """
    symbol = symbol.upper().strip()

    if not ib_client.connected or not ib_client.ib.isConnected():
        return {"symbol": symbol, "error": "Not connected to IBKR"}

    try:
        # Create stock contract
        contract = Stock(symbol, 'SMART', 'USD')

        # Request contract details
        details_list = ib_client.ib.reqContractDetails(contract)

        if not details_list:
            return {"symbol": symbol, "error": "No contract details found"}

        details = details_list[0]

        return {
            "symbol": symbol,
            "name": details.longName or symbol,
            "description": None,  # Not available from IBKR
            "homepage_url": None,  # Not available from IBKR
            "market_cap": None,  # Not available from IBKR
            "total_employees": None,  # Not available from IBKR
            "list_date": None,  # Not available from IBKR
            "branding": None,  # Not available from IBKR
            # IBKR-specific fields
            "exchange": details.contract.exchange,
            "primary_exchange": details.contract.primaryExchange,
            "industry": details.industry or None,
            "category": details.category or None,
            "subcategory": details.subcategory or None,
        }

    except Exception as e:
        print(f"ERROR [IBKR]: Failed to fetch ticker details for {symbol}: {e}")
        return {"symbol": symbol, "error": str(e)}


@handle_api_error("fetch news", module_name="IBKR")
def get_news(symbol: str, limit: int = 15) -> dict:
    """
    Fetch news headlines from IBKR.

    Note: Requires news subscriptions (Dow Jones, Reuters, etc.)
    Without subscriptions, this will return empty results.

    Args:
        symbol: Stock ticker (e.g., "AAPL")
        limit: Maximum headlines to return

    Returns:
        Dict with symbol and headlines list
    """
    symbol = symbol.upper().strip()

    if not ib_client.connected or not ib_client.ib.isConnected():
        return {
            "symbol": symbol,
            "headlines": [],
            "error": "Not connected to IBKR"
        }

    try:
        # Create stock contract
        contract = Stock(symbol, 'SMART', 'USD')

        # Qualify the contract to get conId
        ib_client.ib.qualifyContracts(contract)

        if not contract.conId:
            return {
                "symbol": symbol,
                "headlines": [],
                "error": "Could not qualify contract"
            }

        # Request historical news
        # Note: This requires news subscriptions
        end_datetime = datetime.now()
        start_datetime = end_datetime - timedelta(days=7)

        news = ib_client.ib.reqHistoricalNews(
            conId=contract.conId,
            providerCodes="",  # Empty = all providers
            startDateTime=start_datetime.strftime("%Y-%m-%d %H:%M:%S"),
            endDateTime=end_datetime.strftime("%Y-%m-%d %H:%M:%S"),
            totalResults=limit
        )

        headlines = []
        for article in news:
            headlines.append({
                "articleId": article.articleId,
                "headline": article.headline,
                "providerCode": article.providerCode,
                "providerName": article.providerCode,  # Use code as name
                "time": article.time.isoformat() if hasattr(article.time, 'isoformat') else str(article.time),
                "teaser": "",  # Not available in historical news
                "body": "",
                "url": "",
                "author": "",
                "imageUrl": None,
            })

        print(f"DEBUG [IBKR]: Retrieved {len(headlines)} headlines for {symbol}")

        return {
            "symbol": symbol,
            "headlines": headlines
        }

    except Exception as e:
        error_str = str(e)
        if "no data" in error_str.lower() or "354" in error_str:
            print(f"DEBUG [IBKR]: No news data for {symbol} (may require subscription)")
            return {
                "symbol": symbol,
                "headlines": [],
                "info": "No news data available. IBKR news requires specific subscriptions."
            }
        print(f"ERROR [IBKR]: Failed to fetch news for {symbol}: {e}")
        return {
            "symbol": symbol,
            "headlines": [],
            "error": str(e)
        }


def get_market_news(limit: int = 25) -> dict:
    """
    Fetch general market news from IBKR.

    Aggregates news from major market indices (SPY, QQQ, DIA).

    Args:
        limit: Maximum headlines to return

    Returns:
        Dict with headlines list
    """
    if not ib_client.connected or not ib_client.ib.isConnected():
        return {
            "headlines": [],
            "error": "Not connected to IBKR"
        }

    all_headlines = []
    seen_ids = set()
    market_tickers = ["SPY", "QQQ", "DIA"]

    for ticker in market_tickers:
        result = get_news(ticker, limit=15)
        for headline in result.get("headlines", []):
            article_id = headline.get("articleId", "")
            if article_id and article_id not in seen_ids:
                seen_ids.add(article_id)
                all_headlines.append(headline)

    # Sort by time descending
    all_headlines.sort(key=lambda x: x.get("time", ""), reverse=True)

    # Limit results
    all_headlines = all_headlines[:limit]

    print(f"DEBUG [IBKR]: Returning {len(all_headlines)} market news headlines")

    return {
        "headlines": all_headlines
    }


@handle_api_error("fetch news article", module_name="IBKR")
def get_news_article(article_id: str) -> dict:
    """
    Get full article content from IBKR.

    Args:
        article_id: The article ID from news headlines

    Returns:
        Dict with article content
    """
    if not ib_client.connected or not ib_client.ib.isConnected():
        return {"error": "Not connected to IBKR", "articleId": article_id}

    try:
        # Request article body
        article = ib_client.ib.reqNewsArticle(
            providerCode="",  # Required but can be empty
            articleId=article_id
        )

        if article:
            return {
                "articleId": article_id,
                "providerCode": "",
                "text": article.articleText or "",
                "title": "",  # Not returned by API
                "url": "",
                "author": ""
            }
        else:
            return {
                "articleId": article_id,
                "error": "Article not found or not available"
            }

    except Exception as e:
        print(f"ERROR [IBKR]: Failed to fetch article {article_id}: {e}")
        return {"error": str(e), "articleId": article_id}


@handle_api_error("fetch options chain", module_name="IBKR")
def get_options_chain(symbol: str, max_strikes: int = 30) -> dict:
    """
    Fetch options chain from IBKR TWS API.

    Uses reqSecDefOptParams to get available expirations and strikes,
    then fetches market data for each option.

    Args:
        symbol: Stock ticker (e.g., "AAPL")
        max_strikes: Maximum strikes to return (centered around ATM)

    Returns:
        Dict with expirations, strikes, calls, puts data
    """
    symbol = symbol.upper().strip()

    if not ib_client.connected or not ib_client.ib.isConnected():
        return {
            "symbol": symbol,
            "underlying_price": 0,
            "expirations": [],
            "strikes": [],
            "calls": {},
            "puts": {},
            "error": "Not connected to IBKR"
        }

    try:
        # Create and qualify underlying contract
        stock = Stock(symbol, 'SMART', 'USD')
        ib_client.ib.qualifyContracts(stock)

        if not stock.conId:
            return {
                "symbol": symbol,
                "underlying_price": 0,
                "expirations": [],
                "strikes": [],
                "calls": {},
                "puts": {},
                "error": "Could not qualify underlying contract"
            }

        # Get underlying price
        ib_client._ensure_market_data(stock)
        ticker = ib_client.ib.ticker(stock)
        underlying_price = 0.0
        if ticker:
            underlying_price = safe_float(ticker.marketPrice()) or safe_float(ticker.last) or safe_float(ticker.close)

        # Get option chain parameters
        chains = ib_client.ib.reqSecDefOptParams(
            underlyingSymbol=symbol,
            futFopExchange='',
            underlyingSecType='STK',
            underlyingConId=stock.conId
        )

        if not chains:
            return {
                "symbol": symbol,
                "underlying_price": underlying_price,
                "expirations": [],
                "strikes": [],
                "calls": {},
                "puts": {},
                "error": "No options chain found"
            }

        # Use SMART exchange chain (or first available)
        chain = None
        for c in chains:
            if c.exchange == 'SMART':
                chain = c
                break
        if not chain:
            chain = chains[0]

        # Get all expirations and strikes
        expirations = sorted(list(chain.expirations))
        all_strikes = sorted(list(chain.strikes))

        # Filter strikes centered around underlying price
        if underlying_price > 0 and len(all_strikes) > max_strikes:
            half = max_strikes // 2
            closest_idx = min(range(len(all_strikes)), key=lambda i: abs(all_strikes[i] - underlying_price))
            start_idx = max(0, closest_idx - half)
            end_idx = min(len(all_strikes), start_idx + max_strikes)
            strikes = all_strikes[start_idx:end_idx]
        else:
            strikes = all_strikes[:max_strikes] if len(all_strikes) > max_strikes else all_strikes

        # Build calls and puts dictionaries
        # Only fetch data for first 3 expirations to avoid too many requests
        calls = {}
        puts = {}
        expirations_to_fetch = expirations[:5] if len(expirations) > 5 else expirations

        for exp in expirations_to_fetch:
            calls[exp] = {}
            puts[exp] = {}

            for strike in strikes:
                for right in ['C', 'P']:
                    try:
                        opt = Option(symbol, exp, strike, right, 'SMART')
                        ib_client.ib.qualifyContracts(opt)

                        if opt.conId:
                            # Request market data
                            ib_client._ensure_market_data(opt)
                            opt_ticker = ib_client.ib.ticker(opt)

                            if opt_ticker:
                                # Build quote
                                bid = safe_float(opt_ticker.bid)
                                ask = safe_float(opt_ticker.ask)
                                last = safe_float(opt_ticker.last) or safe_float(opt_ticker.close)
                                mid = (bid + ask) / 2 if bid > 0 and ask > 0 else last

                                # Greeks
                                delta = gamma = theta = vega = iv = None
                                if opt_ticker.modelGreeks:
                                    delta = safe_float(opt_ticker.modelGreeks.delta)
                                    gamma = safe_float(opt_ticker.modelGreeks.gamma)
                                    theta = safe_float(opt_ticker.modelGreeks.theta)
                                    vega = safe_float(opt_ticker.modelGreeks.vega)
                                    iv = safe_float(opt_ticker.modelGreeks.impliedVol)
                                    if iv:
                                        iv = iv * 100  # Convert to percentage

                                quote = {
                                    "strike": strike,
                                    "expiration": exp,
                                    "bid": bid,
                                    "ask": ask,
                                    "last": last,
                                    "mid": mid,
                                    "volume": safe_int(opt_ticker.volume),
                                    "openInterest": 0,  # Not readily available via ticker
                                    "iv": iv,
                                    "delta": delta,
                                    "gamma": gamma,
                                    "theta": theta,
                                    "vega": vega,
                                }

                                strike_key = str(strike)
                                if right == 'C':
                                    calls[exp][strike_key] = quote
                                else:
                                    puts[exp][strike_key] = quote

                    except Exception as e:
                        # Skip individual option errors
                        continue

        # Filter to expirations with actual data
        expirations_with_data = [exp for exp in expirations_to_fetch if exp in calls and calls[exp]]

        print(f"DEBUG [IBKR]: Options chain for {symbol} - {len(expirations_with_data)} expirations, {len(strikes)} strikes")

        return {
            "symbol": symbol,
            "underlying_price": underlying_price,
            "expirations": expirations_with_data,
            "strikes": strikes,
            "calls": calls,
            "puts": puts,
        }

    except Exception as e:
        print(f"ERROR [IBKR]: Failed to fetch options chain for {symbol}: {e}")
        return {
            "symbol": symbol,
            "underlying_price": 0,
            "expirations": [],
            "strikes": [],
            "calls": {},
            "puts": {},
            "error": str(e)
        }


class IBKRProvider(DataProviderInterface):
    """IBKR data provider implementation.

    Provides market data via TWS API connection.
    Requires TWS or IB Gateway to be running and connected.
    """

    def __init__(self):
        self.cache_ttl = {
            "historical": 60,  # 1 minute
            "snapshot": 30,    # 30 seconds
            "news": 180,       # 3 minutes
            "options": 120     # 2 minutes
        }
        self._historical_cache = {}
        self._snapshot_cache = {}

    def _is_connected(self) -> bool:
        """Check if IBKR connection is available."""
        return ib_client.connected and ib_client.ib.isConnected()

    def get_historical_data(self, symbol: str, timeframe: str = "1M") -> List[HistoricalBar]:
        """Get historical price data from IBKR."""
        data = get_historical_bars(symbol, timeframe)

        if "error" not in data and "bars" in data:
            bars = []
            for bar_dict in data["bars"]:
                try:
                    bar = HistoricalBar(
                        date=datetime.fromisoformat(bar_dict["date"]) if isinstance(bar_dict["date"], str) else bar_dict["date"],
                        open=bar_dict["open"],
                        high=bar_dict["high"],
                        low=bar_dict["low"],
                        close=bar_dict["close"],
                        volume=bar_dict["volume"]
                    )
                    bars.append(bar)
                except Exception:
                    continue
            return bars

        return []

    def get_ticker_details(self, symbol: str) -> Dict[str, Any]:
        """Get ticker company details from IBKR."""
        return get_ticker_details(symbol)

    def get_daily_snapshot(self, symbol: str) -> Dict[str, Any]:
        """Get daily price snapshot from IBKR."""
        return get_daily_snapshot(symbol)

    def get_news(self, symbol: str, limit: int = 15) -> List[Dict[str, Any]]:
        """Get news headlines for a ticker from IBKR."""
        data = get_news(symbol, limit)
        return data.get("headlines", [])

    def get_market_news(self, limit: int = 25) -> List[Dict[str, Any]]:
        """Get general market news from IBKR."""
        data = get_market_news(limit)
        return data.get("headlines", [])

    def get_news_article(self, article_id: str) -> Dict[str, Any]:
        """Get full news article from IBKR."""
        return get_news_article(article_id)

    def get_options_chain(self, symbol: str, max_strikes: int = 30) -> Dict[str, Any]:
        """Get options chain data from IBKR."""
        return get_options_chain(symbol, max_strikes)

    def get_analyst_insights(self, symbol: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Get analyst ratings - Not supported by IBKR provider (requires premium news sub in API)."""
        return []
