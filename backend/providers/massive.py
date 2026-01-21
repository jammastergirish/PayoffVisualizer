"""Massive data provider implementation."""

import os
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from massive import RESTClient
from .base import DataProviderInterface
from ..common.models import HistoricalBar
from ..common.cache import historical_cache, snapshot_cache, news_cache, options_cache
from ..common.utils import handle_api_error, safe_float, safe_int, validate_symbol
from ..config_loader import config_loader

# Get Massive API key from config loader
massive_creds = config_loader.get_credentials('massive') or {}
_api_key = massive_creds.get('api_key') or os.getenv("MASSIVE_API_KEY")
if not _api_key:
    print("WARNING: MASSIVE_API_KEY not found in environment. Historical data will not work.")
    _client: Optional[RESTClient] = None
else:
    _client = RESTClient(api_key=_api_key)

# Timeframe configuration mapping
# Maps app timeframes to Massive API parameters
TIMEFRAME_CONFIG = {
    "1Y": {"multiplier": 1, "timespan": "day", "days_back": 365},
    "1M": {"multiplier": 1, "timespan": "hour", "days_back": 30},
    "1W": {"multiplier": 1, "timespan": "hour", "days_back": 7},
    "1D": {"multiplier": 5, "timespan": "minute", "days_back": 1},
    "1H": {"multiplier": 1, "timespan": "minute", "days_back": 0, "hours_back": 1},
}

@handle_api_error("fetch historical data", module_name="Massive", additional_data={"bars": []})
def get_historical_bars(symbol: str, timeframe: str = "1M") -> dict:
    """
    Fetch historical OHLC bars from Massive.com API.

    Args:
        symbol: Stock ticker (e.g., "AAPL")
        timeframe: One of "1Y", "1M", "1W", "1D", "1H"

    Returns:
        Dict with symbol, timeframe, and bars list
    """
    symbol = validate_symbol(symbol)

    if not _client:
        return {
            "symbol": symbol,
            "timeframe": timeframe,
            "bars": [],
            "error": "Massive API key not configured"
        }

    config = TIMEFRAME_CONFIG.get(timeframe.upper(), TIMEFRAME_CONFIG["1M"])

    # Calculate date range
    now = datetime.now()
    if "hours_back" in config:
        from_date = now - timedelta(hours=config["hours_back"])
    else:
        from_date = now - timedelta(days=config["days_back"])

    # Format dates for Massive API (YYYY-MM-DD or millisecond timestamp)
    from_str = from_date.strftime("%Y-%m-%d")
    to_str = now.strftime("%Y-%m-%d")

    # Call Massive.com Aggregates (Bars) API
    aggs = _client.get_aggs(
        ticker=symbol,
        multiplier=config["multiplier"],
        timespan=config["timespan"],
        from_=from_str,
        to=to_str,
        adjusted=True,
        sort="asc",
        limit=50000
    )

    # Convert response to our bar format using safe conversion utilities
    bars = []
    if aggs:
        for agg in aggs:
            # Convert timestamp (milliseconds) to ISO date string
            ts_ms = agg.timestamp if hasattr(agg, 'timestamp') else (agg.t if hasattr(agg, 't') else 0)
            dt = datetime.fromtimestamp(ts_ms / 1000)

            bars.append({
                "date": dt.isoformat(),
                "open": safe_float(getattr(agg, 'open', getattr(agg, 'o', 0))),
                "high": safe_float(getattr(agg, 'high', getattr(agg, 'h', 0))),
                "low": safe_float(getattr(agg, 'low', getattr(agg, 'l', 0))),
                "close": safe_float(getattr(agg, 'close', getattr(agg, 'c', 0))),
                "volume": safe_int(getattr(agg, 'volume', getattr(agg, 'v', 0))),
                "vwap": safe_float(getattr(agg, 'vwap', getattr(agg, 'vw', None))),
                "transactions": safe_int(getattr(agg, 'transactions', getattr(agg, 'n', None))),
            })

    print(f"DEBUG [Massive]: Retrieved {len(bars)} bars for {symbol} ({timeframe})")

    return {
        "symbol": symbol,
        "timeframe": timeframe.upper(),
        "bars": bars
    }

@handle_api_error("fetch daily snapshot", module_name="Massive")
def get_daily_snapshot(symbol: str) -> dict:
    """
    Get today's snapshot including current price and daily change.

    Args:
        symbol: Stock ticker (e.g., "AAPL")

    Returns:
        Dict with current_price, previous_close, change, change_pct
    """
    symbol = validate_symbol(symbol)

    if not _client:
        return {"symbol": symbol, "error": "Massive API key not configured"}

    # Get previous close from daily aggregates endpoint
    from_date = (datetime.now() - timedelta(days=5)).strftime("%Y-%m-%d")
    to_date = datetime.now().strftime("%Y-%m-%d")

    aggs = _client.get_aggs(
        ticker=symbol,
        multiplier=1,
        timespan="day",
        from_=from_date,
        to=to_date,
        adjusted=True,
        sort="desc",
        limit=2
    )

    if aggs and len(aggs) >= 1:
        # Most recent bar has current price (close), previous bar has prev close
        current = aggs[0]
        current_price = safe_float(getattr(current, 'close', getattr(current, 'c', 0)))

        if len(aggs) >= 2:
            prev = aggs[1]
            prev_close = safe_float(getattr(prev, 'close', getattr(prev, 'c', 0)))
        else:
            prev_close = safe_float(getattr(current, 'open', getattr(current, 'o', current_price)))

        change = current_price - prev_close
        change_pct = (change / prev_close * 100) if prev_close > 0 else 0

        return {
            "symbol": symbol,
            "current_price": current_price,
            "previous_close": prev_close,
            "change": change,
            "change_pct": change_pct
        }

    return {
        "symbol": symbol,
        "error": "No price data available"
    }

@handle_api_error("fetch ticker details", module_name="Massive")
def get_ticker_details(symbol: str) -> dict:
    """
    Fetch ticker details (company info, branding) from Massive.com API.

    Args:
        symbol: Stock ticker (e.g., "AAPL")

    Returns:
        Dict with ticker details including name, description, branding URLs
    """
    symbol = validate_symbol(symbol)

    if not _client:
        return {"symbol": symbol, "error": "Massive API key not configured"}

    # GET /v3/reference/tickers/{ticker}
    r = _client.get_ticker_details(ticker=symbol)

    if r and hasattr(r, 'name'):
        # Get branding URLs and append API key for authentication
        logo_url = None
        icon_url = None
        if hasattr(r, 'branding') and r.branding:
            base_logo = getattr(r.branding, 'logo_url', None)
            base_icon = getattr(r.branding, 'icon_url', None)
            if base_logo:
                logo_url = f"{base_logo}?apiKey={_api_key}"
            if base_icon:
                icon_url = f"{base_icon}?apiKey={_api_key}"

        return {
            "symbol": symbol,
            "name": getattr(r, 'name', None),
            "description": getattr(r, 'description', None),
            "homepage_url": getattr(r, 'homepage_url', None),
            "market_cap": getattr(r, 'market_cap', None),
            "total_employees": getattr(r, 'total_employees', None),
            "list_date": getattr(r, 'list_date', None),
            "branding": {
                "logo_url": logo_url,
                "icon_url": icon_url,
            } if (logo_url or icon_url) else None
        }

    return {"symbol": symbol, "error": "No details found"}

# =====================
# News Helper Functions
# =====================

def _parse_benzinga_article(article) -> dict:
    """Parse a Benzinga article into a standardized headline dict."""
    images = getattr(article, 'images', [])
    image_url = images[0] if images else None

    return {
        "articleId": str(getattr(article, 'benzinga_id', '')),
        "headline": getattr(article, 'title', ''),
        "providerCode": "BZ",
        "providerName": "Benzinga",
        "time": getattr(article, 'published', ''),
        "teaser": getattr(article, 'teaser', ''),
        "body": getattr(article, 'body', getattr(article, 'teaser', '')),
        "url": getattr(article, 'url', ''),
        "author": getattr(article, 'author', ''),
        "imageUrl": image_url,
    }

def _parse_reference_article(article) -> dict:
    """Parse a Reference news article into a standardized headline dict."""
    publisher = getattr(article, 'publisher', None)
    publisher_name = getattr(publisher, 'name', 'News') if publisher else 'News'
    provider_code = ''.join(c for c in publisher_name if c.isalpha())[:3].upper() or "NEWS"

    return {
        "articleId": str(getattr(article, 'id', '')),
        "headline": getattr(article, 'title', ''),
        "providerCode": provider_code,
        "providerName": publisher_name,
        "time": getattr(article, 'published_utc', ''),
        "teaser": getattr(article, 'description', ''),
        "body": getattr(article, 'description', ''),
        "url": getattr(article, 'article_url', ''),
        "author": getattr(article, 'author', ''),
        "imageUrl": getattr(article, 'image_url', None),
    }

def _fetch_benzinga_news(ticker: str, limit: int) -> list:
    """Fetch news from Benzinga API for a ticker."""
    if not _client:
        return []

    headlines = []
    try:
        news_iter = _client.list_benzinga_news_v2(
            tickers=ticker,
            limit=limit,
            sort="published.desc"
        )

        count = 0
        for article in news_iter:
            if count >= limit:
                break
            count += 1
            headlines.append(_parse_benzinga_article(article))

        print(f"DEBUG [Massive]: Retrieved {count} Benzinga headlines for {ticker}")

    except Exception as e:
        print(f"WARN [Massive]: Failed to fetch Benzinga news for {ticker}: {e}")

    return headlines

def _fetch_reference_news(ticker: str, limit: int) -> list:
    """Fetch news from Reference News API for a ticker."""
    if not _client:
        return []

    headlines = []
    try:
        ref_news_iter = _client.list_ticker_news(
            ticker=ticker,
            limit=limit,
            order="desc",
            sort="published_utc"
        )

        count = 0
        for article in ref_news_iter:
            if count >= limit:
                break
            count += 1
            headlines.append(_parse_reference_article(article))

        print(f"DEBUG [Massive]: Retrieved {count} reference news headlines for {ticker}")

    except Exception as e:
        print(f"WARN [Massive]: Failed to fetch reference news for {ticker}: {e}")

    return headlines

def get_news(symbol: str, limit: int = 15) -> dict:
    """
    Fetch news headlines from multiple Massive.com sources:
    - Benzinga (list_benzinga_news_v2)
    - Reference news (list_ticker_news - /v2/reference/news)

    Results are merged and sorted by datetime DESC.

    Args:
        symbol: Stock ticker (e.g., "AAPL")
        limit: Maximum total headlines to return (default 15, max 50)

    Returns:
        Dict with symbol and headlines list
    """
    if not _client:
        return {
            "symbol": symbol,
            "headlines": [],
            "error": "Massive API key not configured"
        }

    # Clamp limit to reasonable range (max 50 total)
    limit = max(1, min(limit, 50))
    per_source_limit = 25  # Fetch 25 from each source, then merge and trim to limit

    # Fetch from both sources using helper functions
    all_headlines = []
    all_headlines.extend(_fetch_benzinga_news(symbol, per_source_limit))
    all_headlines.extend(_fetch_reference_news(symbol, per_source_limit))

    # Sort by time descending (newest first)
    all_headlines.sort(key=lambda x: x.get("time", ""), reverse=True)

    # Limit total results
    all_headlines = all_headlines[:limit]

    print(f"DEBUG [Massive]: Returning {len(all_headlines)} total headlines for {symbol}")

    return {
        "symbol": symbol,
        "headlines": all_headlines
    }

def get_market_news(limit: int = 25) -> dict:
    """
    Fetch general market news from multiple sources.

    Gets news from major market indices and general market coverage.
    Results are merged and sorted by datetime DESC, deduplicated by headline.

    Args:
        limit: Maximum total headlines to return (default 25)

    Returns:
        Dict with headlines list
    """
    if not _client:
        return {
            "headlines": [],
            "error": "Massive API key not configured"
        }

    # Clamp limit to reasonable range
    limit = max(1, min(limit, 50))
    per_source_limit = 15  # Fetch from each source, then merge

    all_headlines = []
    seen_headlines = set()  # For deduplication

    # Market tickers to fetch news from
    market_tickers = ["SPY", "QQQ", "DIA", "IWM", "VIX", "GOLD"]

    for ticker in market_tickers:
        # Fetch from both sources using helper functions
        benzinga_news = _fetch_benzinga_news(ticker, per_source_limit)
        reference_news = _fetch_reference_news(ticker, per_source_limit)

        # Add with deduplication
        for headline in benzinga_news + reference_news:
            title = headline.get("headline", "")
            if title and title not in seen_headlines:
                seen_headlines.add(title)
                all_headlines.append(headline)

    # Sort by time descending (newest first)
    all_headlines.sort(key=lambda x: x.get("time", ""), reverse=True)

    # Limit total results
    all_headlines = all_headlines[:limit]

    print(f"DEBUG [Massive]: Returning {len(all_headlines)} market news headlines")

    return {
        "headlines": all_headlines
    }

def get_news_article(article_id: str) -> dict:
    """
    Get full article content from Benzinga.

    Note: The Benzinga API returns full article body in the news list,
    so we fetch with a filter on benzinga_id.

    Args:
        article_id: The benzinga_id of the article

    Returns:
        Dict with article content
    """
    if not _client:
        return {"error": "Massive API key not configured"}

    try:
        # Fetch the specific article by benzinga_id
        # The massive package list_benzinga_news_v2 might not support filtering by id
        # Try fetching recent news and filtering, or use the id directly if supported

        # Try fetching with limit=1 - this won't filter by ID but shows the pattern
        # For now, return a message directing user to the article URL
        # since Benzinga doesn't have a single-article fetch endpoint

        return {
            "articleId": article_id,
            "providerCode": "BZ",
            "text": "Full article content is available at the news source. Click the headline to view the full article.",
            "title": "",
            "url": "",
            "author": "",
            "error": "Direct article fetch not supported. Article body is included in headline response."
        }

    except Exception as e:
        print(f"ERROR [Massive]: Failed to fetch article {article_id}: {e}")
        return {"error": str(e), "articleId": article_id}

def get_options_chain(symbol: str, max_strikes: int = 30, max_contracts: int = 2000) -> dict:
    """
    Fetch options chain snapshot from Massive.com API.

    Uses the list_snapshot_options_chain endpoint which returns all options
    contracts for an underlying with bid/ask/last prices, Greeks, IV, etc.

    Note: Requires Massive.com Options Starter subscription or higher.

    Args:
        symbol: Stock ticker (e.g., "AAPL")
        max_strikes: Maximum strikes to return (centered around ATM)

    Returns:
        Dict with expirations, strikes, calls, puts data
    """
    if not _client:
        return {
            "symbol": symbol,
            "underlying_price": 0,
            "expirations": [],
            "strikes": [],
            "calls": {},
            "puts": {},
            "error": "Massive API key not configured"
        }

    try:
        # First, get the underlying stock's current price from daily snapshot
        print(f"DEBUG [Massive]: Fetching options chain for {symbol}...")
        underlying_snapshot = get_daily_snapshot(symbol)
        underlying_price = underlying_snapshot.get("current_price", 0.0) if underlying_snapshot else 0.0
        print(f"DEBUG [Massive]: Underlying price for {symbol}: ${underlying_price:.2f}")

        # Early exit if no underlying price
        if underlying_price <= 0:
            print(f"WARNING [Massive]: No underlying price for {symbol}, fetching anyway...")

        # Get the options chain snapshot
        # This returns an iterator of OptionContractSnapshot objects
        chain_iter = _client.list_snapshot_options_chain(symbol)

        # Collect all option contracts
        all_contracts = []
        expirations_set = set()
        strikes_set = set()

        contract_count = 0
        strike_range = None

        # Pre-calculate strike range if we have underlying price
        if underlying_price > 0:
            # Calculate reasonable strike range (±50% of underlying price)
            min_strike = underlying_price * 0.5
            max_strike = underlying_price * 1.5
            strike_range = (min_strike, max_strike)
            print(f"DEBUG [Massive]: Filtering strikes between ${min_strike:.2f} and ${max_strike:.2f}")

        for opt in chain_iter:
            contract_count += 1

            # Stop early if we've processed enough contracts
            if contract_count > max_contracts:
                print(f"DEBUG [Massive]: Reached max contracts limit ({max_contracts})")
                break

            # Log progress less frequently
            if contract_count % 1000 == 0:
                print(f"DEBUG [Massive]: Processed {contract_count} contracts, found {len(all_contracts)} valid...")

            # Extract underlying price from first contract
            if underlying_price == 0 and hasattr(opt, 'underlying_asset'):
                ua = opt.underlying_asset
                if ua and hasattr(ua, 'price'):
                    underlying_price = float(ua.price) if ua.price else 0.0

            # Extract contract details
            details = opt.details if hasattr(opt, 'details') else None
            if not details:
                continue

            # Get expiration and strike
            expiry = str(details.expiration_date) if hasattr(details, 'expiration_date') else None
            # Round strike to 2 decimal places to avoid floating point comparison issues
            strike_raw = float(details.strike_price) if hasattr(details, 'strike_price') else None
            strike = round(strike_raw, 2) if strike_raw is not None else None
            contract_type = str(details.contract_type).upper() if hasattr(details, 'contract_type') else None

            if not expiry or strike is None or contract_type not in ['CALL', 'PUT', 'C', 'P']:
                continue

            # Early filtering: skip strikes way out of range
            if strike_range and (strike < strike_range[0] or strike > strike_range[1]):
                continue  # Skip this contract early

            expirations_set.add(expiry)
            strikes_set.add(strike)

            # Extract day snapshot data (this is where today's prices are!)
            day = opt.day if hasattr(opt, 'day') else None

            # Prices from day snapshot
            close_price = float(day.close) if day and hasattr(day, 'close') and day.close else 0.0
            open_price = float(day.open) if day and hasattr(day, 'open') and day.open else 0.0
            high_price = float(day.high) if day and hasattr(day, 'high') and day.high else 0.0
            low_price = float(day.low) if day and hasattr(day, 'low') and day.low else 0.0
            vwap = float(day.vwap) if day and hasattr(day, 'vwap') and day.vwap else 0.0
            volume = int(day.volume) if day and hasattr(day, 'volume') and day.volume else 0

            # Extract last_trade for options that haven't traded today but have historical trades
            last_trade = opt.last_trade if hasattr(opt, 'last_trade') else None
            last_trade_price = float(last_trade.price) if last_trade and hasattr(last_trade, 'price') and last_trade.price else 0.0

            # Extract last_quote for bid/ask (more reliable than day high/low)
            last_quote = opt.last_quote if hasattr(opt, 'last_quote') else None
            quote_bid = float(last_quote.bid) if last_quote and hasattr(last_quote, 'bid') and last_quote.bid else 0.0
            quote_ask = float(last_quote.ask) if last_quote and hasattr(last_quote, 'ask') and last_quote.ask else 0.0

            # Use close price as "last", falling back to last_trade_price
            last = close_price if close_price > 0 else last_trade_price

            # For bid/ask: prefer last_quote, then day high/low, then close price
            if quote_bid > 0 and quote_ask > 0:
                bid = quote_bid
                ask = quote_ask
                mid = (quote_bid + quote_ask) / 2
            elif high_price > 0 and low_price > 0 and high_price != low_price:
                bid = low_price
                ask = high_price
                mid = (high_price + low_price) / 2
            elif last > 0:
                bid = last
                ask = last
                mid = last
            else:
                bid = 0.0
                ask = 0.0
                mid = 0.0

            # Extract greeks
            greeks = opt.greeks if hasattr(opt, 'greeks') else None
            delta = float(greeks.delta) if greeks and hasattr(greeks, 'delta') and greeks.delta else None
            gamma = float(greeks.gamma) if greeks and hasattr(greeks, 'gamma') and greeks.gamma else None
            theta = float(greeks.theta) if greeks and hasattr(greeks, 'theta') and greeks.theta else None
            vega = float(greeks.vega) if greeks and hasattr(greeks, 'vega') and greeks.vega else None

            # Extract IV
            iv = None
            if hasattr(opt, 'implied_volatility') and opt.implied_volatility:
                iv = float(opt.implied_volatility) * 100  # Convert to percentage

            # Extract open interest
            oi = int(opt.open_interest) if hasattr(opt, 'open_interest') and opt.open_interest else 0

            all_contracts.append({
                "expiration": expiry,
                "strike": strike,
                "type": "C" if contract_type in ['CALL', 'C'] else "P",
                "bid": bid,
                "ask": ask,
                "last": last,
                "mid": mid,
                "volume": volume,
                "openInterest": oi,
                "iv": iv,
                "delta": delta,
                "gamma": gamma,
                "theta": theta,
                "vega": vega,
            })

        if not all_contracts:
            return {
                "symbol": symbol,
                "underlying_price": underlying_price,
                "expirations": [],
                "strikes": [],
                "calls": {},
                "puts": {},
                "error": "No options data returned. Check API subscription level."
            }

        # Sort expirations and strikes
        expirations = sorted(list(expirations_set))
        all_strikes = sorted(list(strikes_set))

        # Filter strikes to those nearest underlying price
        if underlying_price > 0 and len(all_strikes) > max_strikes:
            half = max_strikes // 2
            closest_idx = min(range(len(all_strikes)), key=lambda i: abs(all_strikes[i] - underlying_price))
            start_idx = max(0, closest_idx - half)
            end_idx = min(len(all_strikes), start_idx + max_strikes)
            strikes = all_strikes[start_idx:end_idx]
        else:
            strikes = all_strikes[:max_strikes] if len(all_strikes) > max_strikes else all_strikes

        # Round strikes in filtered set for consistent comparison
        strikes_set_filtered = set(round(s, 2) for s in strikes)

        # Build calls and puts dictionaries
        calls = {}  # expiry -> strike -> quote
        puts = {}   # expiry -> strike -> quote

        for contract in all_contracts:
            exp = contract["expiration"]
            strike = round(contract["strike"], 2)  # Ensure consistent rounding for comparison

            # Skip strikes outside our filtered range
            if strike not in strikes_set_filtered:
                continue

            quote = {
                "strike": strike,
                "expiration": exp,
                "bid": contract["bid"],
                "ask": contract["ask"],
                "last": contract["last"],
                "mid": contract["mid"],
                "volume": contract["volume"],
                "openInterest": contract["openInterest"],
                "iv": contract["iv"],
                "delta": contract["delta"],
                "gamma": contract["gamma"],
                "theta": contract["theta"],
                "vega": contract["vega"],
            }

            # Use string key for consistent JSON serialization
            strike_key = str(strike)

            if contract["type"] == "C":
                if exp not in calls:
                    calls[exp] = {}
                calls[exp][strike_key] = quote
            else:
                if exp not in puts:
                    puts[exp] = {}
                puts[exp][strike_key] = quote

        # Filter expirations to only those that have actual data
        expirations_with_data = [exp for exp in expirations if exp in calls or exp in puts]

        print(f"DEBUG [Massive]: Options chain for {symbol} - {len(expirations_with_data)} expirations, {len(strikes)} strikes, {len(all_contracts)} valid contracts from {contract_count} total processed")

        return {
            "symbol": symbol,
            "underlying_price": underlying_price,
            "expirations": expirations_with_data,  # Only expirations with data
            "strikes": strikes,
            "calls": calls,
            "puts": puts,
        }

    except Exception as e:
        error_msg = str(e)
        print(f"ERROR [Massive]: Failed to fetch options chain for {symbol}: {e}")

        # Check for authorization error
        if "NOT_AUTHORIZED" in error_msg or "not entitled" in error_msg.lower():
            return {
                "symbol": symbol,
                "underlying_price": 0,
                "expirations": [],
                "strikes": [],
                "calls": {},
                "puts": {},
                "error": "Options data requires Massive.com Options subscription. Upgrade at https://polygon.io/pricing"
            }

        return {
            "symbol": symbol,
            "underlying_price": 0,
            "expirations": [],
            "strikes": [],
            "calls": {},
            "puts": {},
            "error": error_msg
        }


class MassiveProvider(DataProviderInterface):
    """Massive data provider implementation."""

    def __init__(self):
        self.cache_ttl = {
            "historical": 60,  # 1 minute
            "snapshot": 30,    # 30 seconds
            "news": 180,       # 3 minutes
            "options": None    # Dynamic based on market hours
        }

    def get_historical_data(self, symbol: str, timeframe: str = "1M") -> List[HistoricalBar]:
        """Get historical price data from Massive."""
        cache_key = f"{symbol}:{timeframe}"

        # Check cache
        cached = historical_cache.get(cache_key, self.cache_ttl["historical"])
        if cached:
            return cached

        # Fetch from Massive
        data = get_historical_bars(symbol, timeframe)

        if "error" not in data and "bars" in data:
            # Convert to HistoricalBar objects
            bars = []
            for bar_dict in data["bars"]:
                bar = HistoricalBar(
                    date=datetime.fromisoformat(bar_dict["date"]),
                    open=bar_dict["open"],
                    high=bar_dict["high"],
                    low=bar_dict["low"],
                    close=bar_dict["close"],
                    volume=bar_dict["volume"]
                )
                bars.append(bar)

            # Cache the result
            historical_cache.set(cache_key, bars)
            return bars

        return []

    def get_ticker_details(self, symbol: str) -> Dict[str, Any]:
        """Get ticker company details from Massive."""
        # This typically doesn't change often, could use longer cache
        cache_key = f"details:{symbol}"
        cached = news_cache.get(cache_key, 3600)  # 1 hour cache
        if cached:
            return cached

        data = get_ticker_details(symbol)
        if "error" not in data:
            news_cache.set(cache_key, data)
        return data

    def get_daily_snapshot(self, symbol: str) -> Dict[str, Any]:
        """Get daily price snapshot from Massive."""
        cache_key = f"snapshot:{symbol}"

        cached = snapshot_cache.get(cache_key, self.cache_ttl["snapshot"])
        if cached:
            return cached

        data = get_daily_snapshot(symbol)
        if "error" not in data:
            snapshot_cache.set(cache_key, data)
        return data

    def get_news(self, symbol: str, limit: int = 15) -> List[Dict[str, Any]]:
        """Get news headlines for a ticker from Massive."""
        cache_key = f"news:{symbol}"

        cached = news_cache.get(cache_key, self.cache_ttl["news"])
        if cached:
            return cached

        data = get_news(symbol, limit)
        if "headlines" in data:
            news_cache.set(cache_key, data["headlines"])
            return data["headlines"]
        return []

    def get_market_news(self, limit: int = 25) -> List[Dict[str, Any]]:
        """Get general market news from Massive."""
        cache_key = "news:market"

        cached = news_cache.get(cache_key, self.cache_ttl["news"])
        if cached:
            return cached

        data = get_market_news(limit)
        if "headlines" in data:
            news_cache.set(cache_key, data["headlines"])
            return data["headlines"]
        return []

    def get_news_article(self, article_id: str) -> Dict[str, Any]:
        """Get full news article from Massive."""
        cache_key = f"article:{article_id}"

        # Articles don't change, cache for longer
        cached = news_cache.get(cache_key, 3600)  # 1 hour
        if cached:
            return cached

        data = get_news_article(article_id)
        if "error" not in data:
            news_cache.set(cache_key, data)
        return data

    def get_options_chain(self, symbol: str, max_strikes: int = 30) -> Dict[str, Any]:
        """Get options chain data from Massive."""
        cache_key = f"options:{symbol}"

        # Dynamic TTL based on market hours
        cached = options_cache.get_with_metadata(cache_key)
        if cached:
            return cached

        data = get_options_chain(symbol, max_strikes)
        if "error" not in data:
            options_cache.set(cache_key, data)
        return data