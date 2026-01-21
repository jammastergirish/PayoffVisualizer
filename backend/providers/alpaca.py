"""Alpaca data provider implementation using alpaca-py SDK.

This provider uses Alpaca Markets API for:
- Historical stock/options data
- Real-time snapshots
- News headlines and articles
- Ticker details

Requirements:
- ALPACA_API_KEY and ALPACA_API_SECRET in credentials.json or .env
- alpaca-py package installed

Benefits over other providers:
- No desktop app required (unlike IBKR)
- Free news data (unlike IBKR which requires subscriptions)
- Paper trading support
"""

import os
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional

from .base import DataProviderInterface
from ..common.models import HistoricalBar
from ..common.utils import safe_float, safe_int, handle_api_error
from ..config_loader import config_loader

# Lazy imports to avoid startup errors if alpaca-py not installed
# Lazy imports to avoid startup errors if alpaca-py not installed
_alpaca_clients = {}


def _get_stock_client():
    """Get or create StockHistoricalDataClient."""
    if 'stock' not in _alpaca_clients:
        try:
            from alpaca.data.historical import StockHistoricalDataClient
            alpaca_creds = config_loader.get_credentials('alpaca') or {}
            api_key = alpaca_creds.get('api_key') or os.getenv("ALPACA_API_KEY")
            api_secret = alpaca_creds.get('api_secret') or os.getenv("ALPACA_API_SECRET")
            if api_key and api_secret:
                _alpaca_clients['stock'] = StockHistoricalDataClient(api_key, api_secret)
            else:
                _alpaca_clients['stock'] = StockHistoricalDataClient()  # Free tier
        except ImportError:
            return None
    return _alpaca_clients.get('stock')


def _get_option_client():
    """Get or create OptionHistoricalDataClient."""
    if 'option' not in _alpaca_clients:
        try:
            from alpaca.data.historical import OptionHistoricalDataClient
            alpaca_creds = config_loader.get_credentials('alpaca') or {}
            api_key = alpaca_creds.get('api_key') or os.getenv("ALPACA_API_KEY")
            api_secret = alpaca_creds.get('api_secret') or os.getenv("ALPACA_API_SECRET")
            if api_key and api_secret:
                _alpaca_clients['option'] = OptionHistoricalDataClient(api_key, api_secret)
            else:
                return None  # Options require auth
        except ImportError:
            return None
    return _alpaca_clients.get('option')


def _get_news_client():
    """Get or create NewsClient."""
    if 'news' not in _alpaca_clients:
        try:
            from alpaca.data.historical import NewsClient
            alpaca_creds = config_loader.get_credentials('alpaca') or {}
            api_key = alpaca_creds.get('api_key') or os.getenv("ALPACA_API_KEY")
            api_secret = alpaca_creds.get('api_secret') or os.getenv("ALPACA_API_SECRET")
            # NewsClient requires authentication
            if api_key and api_secret:
                _alpaca_clients['news'] = NewsClient(api_key, api_secret)
            else:
                 # Try creating without keys if they allow public data, otherwise catch error
                 _alpaca_clients['news'] = NewsClient()
        except ImportError:
            return None
        except Exception as e:
            print(f"ERROR [Alpaca]: Failed to initialize news client: {e}")
            return None
    return _alpaca_clients.get('news')


def _get_trading_client():
    """Get or create TradingClient for asset info."""
    if 'trading' not in _alpaca_clients:
        try:
            from alpaca.trading.client import TradingClient
            alpaca_creds = config_loader.get_credentials('alpaca') or {}
            api_key = alpaca_creds.get('api_key') or os.getenv("ALPACA_API_KEY")
            api_secret = alpaca_creds.get('api_secret') or os.getenv("ALPACA_API_SECRET")
            paper = alpaca_creds.get('paper', os.getenv("ALPACA_PAPER", "true").lower() == "true")
            if api_key and api_secret:
                _alpaca_clients['trading'] = TradingClient(api_key, api_secret, paper=paper)
            else:
                return None
        except ImportError:
            return None
    return _alpaca_clients.get('trading')


# Timeframe mapping
TIMEFRAME_MAP = {
    "1Y": {"days": 365, "timeframe": "Day"},
    "1M": {"days": 30, "timeframe": "Day"},
    "1W": {"days": 7, "timeframe": "Hour"},
    "1D": {"days": 1, "timeframe": "Hour"},
    "1H": {"days": 1, "timeframe": "Minute"},
}


@handle_api_error("fetch historical bars", module_name="Alpaca")
def get_historical_bars(symbol: str, timeframe: str = "1M") -> dict:
    """
    Fetch historical OHLC bars from Alpaca.

    Args:
        symbol: Stock ticker (e.g., "AAPL")
        timeframe: One of "1Y", "1M", "1W", "1D", "1H"

    Returns:
        Dict with symbol, timeframe, and bars list
    """
    symbol = symbol.upper().strip()
    client = _get_stock_client()

    if client is None:
        return {
            "symbol": symbol,
            "timeframe": timeframe,
            "bars": [],
            "error": "Alpaca client not available"
        }

    try:
        from alpaca.data.requests import StockBarsRequest
        from alpaca.data.timeframe import TimeFrame

        config = TIMEFRAME_MAP.get(timeframe.upper(), TIMEFRAME_MAP["1M"])
        end = datetime.now()
        start = end - timedelta(days=config["days"])

        # Map timeframe string to TimeFrame enum
        tf_map = {
            "Day": TimeFrame.Day,
            "Hour": TimeFrame.Hour,
            "Minute": TimeFrame.Minute,
        }
        tf = tf_map.get(config["timeframe"], TimeFrame.Day)

        request = StockBarsRequest(
            symbol_or_symbols=symbol,
            timeframe=tf,
            start=start,
            end=end
        )

        bars_data = client.get_stock_bars(request)

        # Convert to our format
        result_bars = []
        
        # Check if data exists in dictionary-like structure or .data attribute
        bars_dict = bars_data.data if hasattr(bars_data, 'data') else bars_data
        
        if symbol in bars_dict:
            for bar in bars_dict[symbol]:
                result_bars.append({
                    "date": bar.timestamp.isoformat(),
                    "open": safe_float(bar.open),
                    "high": safe_float(bar.high),
                    "low": safe_float(bar.low),
                    "close": safe_float(bar.close),
                    "volume": safe_int(bar.volume),
                })
        else:
             print(f"DEBUG [Alpaca]: Symbol {symbol} not found in bar data. Keys: {list(bars_data.keys()) if hasattr(bars_data, 'keys') else 'No keys'}")

        print(f"DEBUG [Alpaca]: Retrieved {len(result_bars)} bars for {symbol} ({timeframe})")

        return {
            "symbol": symbol,
            "timeframe": timeframe.upper(),
            "bars": result_bars
        }

    except Exception as e:
        print(f"ERROR [Alpaca]: Failed to fetch historical data for {symbol}: {e}")
        return {
            "symbol": symbol,
            "timeframe": timeframe,
            "bars": [],
            "error": str(e)
        }


@handle_api_error("fetch daily snapshot", module_name="Alpaca")
def get_daily_snapshot(symbol: str) -> dict:
    """
    Get current price and daily change from Alpaca.

    Args:
        symbol: Stock ticker (e.g., "AAPL")

    Returns:
        Dict with current_price, previous_close, change, change_pct
    """
    symbol = symbol.upper().strip()
    client = _get_stock_client()

    if client is None:
        return {"symbol": symbol, "error": "Alpaca client not available"}

    try:
        from alpaca.data.requests import StockSnapshotRequest

        request = StockSnapshotRequest(symbol_or_symbols=symbol)
        snapshots = client.get_stock_snapshot(request)

        if symbol not in snapshots:
            return {"symbol": symbol, "error": "No snapshot data available"}

        snapshot = snapshots[symbol]

        # Get prices from snapshot
        current_price = safe_float(snapshot.latest_trade.price) if snapshot.latest_trade else 0.0
        prev_close = safe_float(snapshot.previous_daily_bar.close) if snapshot.previous_daily_bar else 0.0

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
        print(f"ERROR [Alpaca]: Failed to fetch snapshot for {symbol}: {e}")
        return {"symbol": symbol, "error": str(e)}


@handle_api_error("fetch ticker details", module_name="Alpaca")
def get_ticker_details(symbol: str) -> dict:
    """
    Fetch ticker details from Alpaca.

    Args:
        symbol: Stock ticker (e.g., "AAPL")

    Returns:
        Dict with ticker details
    """
    symbol = symbol.upper().strip()
    client = _get_trading_client()

    if client is None:
        return {"symbol": symbol, "error": "Alpaca trading client not available"}

    try:
        asset = client.get_asset(symbol)

        return {
            "symbol": symbol,
            "name": asset.name or symbol,
            "description": None,  # Not available from Alpaca
            "homepage_url": None,  # Not available
            "market_cap": None,  # Not available
            "total_employees": None,  # Not available
            "list_date": None,  # Not available
            "branding": None,  # Not available
            # Alpaca-specific fields
            "exchange": asset.exchange.value if asset.exchange else None,
            "asset_class": asset.asset_class.value if asset.asset_class else None,
            "tradable": asset.tradable,
            "fractionable": asset.fractionable,
            "shortable": asset.shortable,
        }

    except Exception as e:
        print(f"ERROR [Alpaca]: Failed to fetch ticker details for {symbol}: {e}")
        return {"symbol": symbol, "error": str(e)}


# In-memory news cache (alpaca provides content in list)
_news_cache = {}

def _parse_article(article) -> dict:
    """Helper to parse Alpaca news article (dict or object)."""
    is_dict = isinstance(article, dict)
    
    # Helper to get field
    def get_f(key, obj_attr):
        return article[key] if is_dict else getattr(article, obj_attr, None)

    # Extract images
    images = get_f("images", "images") or []
    image_url = None
    if images:
        first_img = images[0]
        image_url = first_img.get("url") if isinstance(first_img, dict) else first_img.url
        
        for img in images:
            s = str(img.get("size") if isinstance(img, dict) else img.size)
            u = img.get("url") if isinstance(img, dict) else img.url
            if "small" in s.lower() or "thumb" in s.lower():
                image_url = u
                break

    item = {
        "articleId": str(get_f("id", "id")),
        "headline": get_f("headline", "headline"),
        "providerCode": get_f("source", "source"),
        "providerName": get_f("source", "source"),
        "time": get_f("created_at", "created_at").isoformat() if get_f("created_at", "created_at") else "",
        "teaser": get_f("summary", "summary") or "",
        "body": get_f("content", "content") or "",
        "url": get_f("url", "url") or "",
        "author": get_f("author", "author") or "",
        "imageUrl": image_url,
    }
    
    symbols = get_f("symbols", "symbols")
    if symbols:
        item["symbols"] = symbols
        
    return item


@handle_api_error("fetch news", module_name="Alpaca")
def get_news(symbol: str, limit: int = 15) -> dict:
    """
    Fetch news headlines from Alpaca.

    Alpaca provides free news data from Benzinga.

    Args:
        symbol: Stock ticker (e.g., "AAPL")
        limit: Maximum headlines to return

    Returns:
        Dict with symbol and headlines list
    """
    symbol = symbol.upper().strip()
    client = _get_news_client()

    if client is None:
        return {
            "symbol": symbol,
            "headlines": [],
            "error": "Alpaca news client not available"
        }

    try:
        from alpaca.data.requests import NewsRequest

        request = NewsRequest(
            symbols=symbol,
            limit=limit
        )

        news_data = client.get_news(request)

        headlines = []
        # Alpaca NewsSet supports subscript access for 'news'
        try:
            news_items = news_data["news"]
        except (KeyError, TypeError):
             news_items = []
             
        for article in news_items:
            try:
                parsed = _parse_article(article)
                breakpoints = [] # Debug
                _news_cache[parsed["articleId"]] = parsed
                headlines.append(parsed)
            except Exception:
                continue

        print(f"DEBUG [Alpaca]: Retrieved {len(headlines)} headlines for {symbol}")

        return {
            "symbol": symbol,
            "headlines": headlines
        }

    except Exception as e:
        print(f"ERROR [Alpaca]: Failed to fetch news for {symbol}: {e}")
        return {
            "symbol": symbol,
            "headlines": [],
            "error": str(e)
        }


def get_market_news(limit: int = 25) -> dict:
    """
    Fetch general market news from Alpaca.

    Args:
        limit: Maximum headlines to return

    Returns:
        Dict with headlines list
    """
    client = _get_news_client()

    if client is None:
        return {
            "headlines": [],
            "error": "Alpaca news client not available"
        }

    try:
        from alpaca.data.requests import NewsRequest

        # Get general market news (no symbol filter)
        request = NewsRequest(limit=limit)
        news_data = client.get_news(request)

        headlines = []
        # Alpaca NewsSet supports subscript access for 'news'
        try:
            news_items = news_data["news"]
        except (KeyError, TypeError):
             news_items = []

        for article in news_items:
            try:
                parsed = _parse_article(article)
                _news_cache[parsed["articleId"]] = parsed
                headlines.append(parsed)
            except Exception:
                continue

        print(f"DEBUG [Alpaca]: Returning {len(headlines)} market news headlines")

        return {"headlines": headlines}

    except Exception as e:
        print(f"ERROR [Alpaca]: Failed to fetch market news: {e}")
        return {"headlines": [], "error": str(e)}


@handle_api_error("fetch news article", module_name="Alpaca")
def get_news_article(article_id: str) -> dict:
    """
    Get full article content from Alpaca.

    Note: Article content is already included in news response,
    so this returns the cached data if available.

    Args:
        article_id: The article ID from news headlines

    Returns:
        Dict with article content
    """
    # Try to retrieve from cache first (populated by get_news/get_market_news)
    if article_id in _news_cache:
        return _news_cache[article_id]
        
    return {
        "articleId": article_id,
        "error": "Article not found in cache. Access news lists first.",
        "headline": "Content Not Found",
        "body": "Unable to retrieve article content. Please refresh the news feed.", 
    }


@handle_api_error("fetch options chain", module_name="Alpaca")
def get_options_chain(symbol: str, max_strikes: int = 30) -> dict:
    """
    Fetch options chain from Alpaca.

    Args:
        symbol: Stock ticker (e.g., "AAPL")
        max_strikes: Maximum strikes to return

    Returns:
        Dict with expirations, strikes, calls, puts data
    """
    symbol = symbol.upper().strip()
    trading_client = _get_trading_client()
    option_client = _get_option_client()

    if option_client is None:
        return {
            "symbol": symbol,
            "underlying_price": 0,
            "expirations": [],
            "strikes": [],
            "calls": {},
            "puts": {},
            "error": "Alpaca option client not available (requires authenticatiion)"
        }

    try:
        from alpaca.data.requests import OptionChainRequest
        from alpaca.data.models import OptionsSnapshot

        # Get underlying price first
        underlying_price = 0.0
        stock_client = _get_stock_client()
        if stock_client:
            try:
                from alpaca.data.requests import StockSnapshotRequest
                snapshot = stock_client.get_stock_snapshot(StockSnapshotRequest(symbol_or_symbols=symbol))
                if symbol in snapshot and snapshot[symbol].latest_trade:
                    underlying_price = safe_float(snapshot[symbol].latest_trade.price)
            except Exception:
                pass

        # Get option chain (snapshots)
        # Note: get_option_chain returns latest quotes/trades/greeks for all active contracts
        # This can be large, so we might need to filter if possible, but the API 
        # usually handles one underlying well.
        
        request = OptionChainRequest(underlying_symbol=symbol)
        chain_data = option_client.get_option_chain(request)

        # Build chain structure
        expirations = set()
        all_strikes = set()
        calls = {}
        puts = {}

        # chain_data is a dict keyed by symbol -> OptionsSnapshot
        # keys are e.g. 'AAPL240315C00150000'
        
        for contract_symbol, snapshot in chain_data.items():
            # Parse symbol to get details
             # Format: SYMBOL + YYMMDD + C/P + strike
             # Or rely on snapshot details if available? 
             # Snapshot has latest_quote, latest_trade, greeks.
             # We need to parse strict format.
             
             # Typical format length depends on ticker length.
             # but we know last 8 is strike, then 1 is right, then 6 is date.
             # so suffix is 15 chars.
             
             if len(contract_symbol) < 15:
                 continue
                 
             suffix = contract_symbol[-15:]
             date_str = suffix[:6] # YYMMDD
             right_char = suffix[6] # C or P
             strike_str = suffix[7:]
             
             try:
                 # Date 
                 exp = f"20{date_str}" # YYYYMMDD
                 expirations.add(exp)
                 
                 # Strike
                 strike = float(strike_str) / 1000.0
                 all_strikes.add(strike)
                 
                 if exp not in calls:
                     calls[exp] = {}
                     puts[exp] = {}
                 
                 strike_key = str(strike)
                 
                 # Extract data
                 latest_quote = snapshot.latest_quote
                 latest_trade = snapshot.latest_trade
                 greeks = snapshot.greeks
                 
                 quote = {
                     "strike": strike,
                     "expiration": exp,
                     "bid": safe_float(latest_quote.bid_price) if latest_quote else 0.0,
                     "ask": safe_float(latest_quote.ask_price) if latest_quote else 0.0,
                     "last": safe_float(latest_trade.price) if latest_trade else 0.0,
                     "mid": 0, # Calc later
                     "volume": safe_int(latest_trade.size) if latest_trade else 0, # Daily volume more accurate?
                     "openInterest": 0, # Not in snapshot usually?
                     "iv": safe_float(snapshot.implied_volatility) if snapshot.implied_volatility else None,
                     "delta": safe_float(greeks.delta) if greeks else None,
                     "gamma": safe_float(greeks.gamma) if greeks else None,
                     "theta": safe_float(greeks.theta) if greeks else None,
                     "vega": safe_float(greeks.vega) if greeks else None,
                     "symbol": contract_symbol,
                 }
                 quote["mid"] = (quote["bid"] + quote["ask"]) / 2 if (quote["bid"] and quote["ask"]) else quote["last"]
                 
                 if right_char == 'C':
                     calls[exp][strike_key] = quote
                 elif right_char == 'P':
                     puts[exp][strike_key] = quote
                     
             except Exception:
                 continue

        # Sort and limit
        expirations = sorted(list(expirations))[:5]
        all_strikes = sorted(list(all_strikes))

        # Filter strikes around ATM
        if underlying_price > 0 and len(all_strikes) > max_strikes:
            half = max_strikes // 2
            closest_idx = min(range(len(all_strikes)), key=lambda i: abs(all_strikes[i] - underlying_price))
            start_idx = max(0, closest_idx - half)
            end_idx = min(len(all_strikes), start_idx + max_strikes)
            strikes = all_strikes[start_idx:end_idx]
        else:
            strikes = all_strikes[:max_strikes]

        print(f"DEBUG [Alpaca]: Options chain for {symbol} - {len(expirations)} expirations, {len(strikes)} strikes")

        return {
            "symbol": symbol,
            "underlying_price": underlying_price,
            "expirations": expirations,
            "strikes": strikes,
            "calls": calls,
            "puts": puts,
        }

    except Exception as e:
        print(f"ERROR [Alpaca]: Failed to fetch options chain for {symbol}: {e}")
        return {
            "symbol": symbol,
            "underlying_price": 0,
            "expirations": [],
            "strikes": [],
            "calls": {},
            "puts": {},
            "error": str(e)
        }


class AlpacaProvider(DataProviderInterface):
    """Alpaca data provider implementation.

    Provides market data and news via Alpaca Markets API.
    Free tier available for basic data, paid tier for real-time.
    """

    def __init__(self):
        self.cache_ttl = {
            "historical": 60,
            "snapshot": 30,
            "news": 180,
            "options": 120
        }

    def get_historical_data(self, symbol: str, timeframe: str = "1M") -> List[HistoricalBar]:
        """Get historical price data from Alpaca."""
        data = get_historical_bars(symbol, timeframe)

        if "error" not in data and "bars" in data:
            bars = []
            for bar_dict in data["bars"]:
                try:
                    bar = HistoricalBar(
                        date=datetime.fromisoformat(bar_dict["date"].replace('Z', '+00:00')) if isinstance(bar_dict["date"], str) else bar_dict["date"],
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
        """Get ticker company details from Alpaca."""
        return get_ticker_details(symbol)

    def get_daily_snapshot(self, symbol: str) -> Dict[str, Any]:
        """Get daily price snapshot from Alpaca."""
        return get_daily_snapshot(symbol)

    def get_news(self, symbol: str, limit: int = 15) -> List[Dict[str, Any]]:
        """Get news headlines for a ticker from Alpaca."""
        data = get_news(symbol, limit)
        return data.get("headlines", [])

    def get_market_news(self, limit: int = 25) -> List[Dict[str, Any]]:
        """Get general market news from Alpaca."""
        data = get_market_news(limit)
        return data.get("headlines", [])

    def get_news_article(self, article_id: str) -> Dict[str, Any]:
        """Get full news article from Alpaca."""
        return get_news_article(article_id)

    def get_options_chain(self, symbol: str, max_strikes: int = 30) -> Dict[str, Any]:
        """Get options chain data from Alpaca."""
        return get_options_chain(symbol, max_strikes)
