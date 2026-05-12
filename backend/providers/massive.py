"""Massive data provider implementation."""

import os
import re
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
import httpx
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

    # Format dates for Massive API
    # Use timestamps for intraday precision, strings for daily+
    if config["timespan"] in ["minute", "hour"]:
        from_val = int(from_date.timestamp() * 1000)
        to_val = int(now.timestamp() * 1000)
    else:
        from_val = from_date.strftime("%Y-%m-%d")
        to_val = now.strftime("%Y-%m-%d")

    # Call Massive.com Aggregates (Bars) API
    aggs = _client.get_aggs(
        ticker=symbol,
        multiplier=config["multiplier"],
        timespan=config["timespan"],
        from_=from_val,
        to=to_val,
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

    return {
        "symbol": symbol,
        "headlines": all_headlines
    }


def _fetch_analyst_insights(ticker: str, limit: int) -> list:
    """Fetch analyst insights from Massive (Benzinga)."""
    if not _client:
        return []

    insights = []
    try:
        # Check if client wrapper supports list_benzinga_analyst_insights
        # If not, we might need to handle Attribute Error or use alternative
        # Assuming module massive has been updated or supports it as user indicated
        if hasattr(_client, 'list_benzinga_analyst_insights'):
            res_iter = _client.list_benzinga_analyst_insights(
                ticker=ticker,
                limit=limit,
                sort="date.desc"
            )
            count = 0
            for item in res_iter:
                if count >= limit:
                    break
                count += 1
                
                # Normalize result
                insights.append({
                    "firm": getattr(item, 'firm', ''),
                    "rating_action": getattr(item, 'rating_action', ''),
                    "rating": getattr(item, 'rating', ''),
                    "price_target": getattr(item, 'price_target', None),
                    "date": getattr(item, 'date', ''),
                    "insight": getattr(item, 'insight', ''),
                    "company_name": getattr(item, 'company_name', ''),
                })
            print(f"DEBUG [Massive]: Retrieved {count} analyst insights for {ticker}")
        else:
            print("WARN [Massive]: client.list_benzinga_analyst_insights not available")
            
    except Exception as e:
        print(f"WARN [Massive]: Failed to fetch analyst insights for {ticker}: {e}")

    return insights


def get_analyst_insights(symbol: str, limit: int = 10) -> list:
    """Fetch analyst insights/ratings."""
    return _fetch_analyst_insights(symbol, limit)


# SEC Form 4 transaction codes — see https://www.sec.gov/about/forms/form4data.pdf
# Categorized as "discretionary" (open-market decision) vs "mechanical"
# (pre-planned, vesting, tax, gift, etc.) so the UI can highlight signal.
FORM4_CODE_META = {
    "P": {"label": "Open-market purchase", "category": "discretionary"},
    "S": {"label": "Open-market sale", "category": "discretionary"},
    "V": {"label": "Voluntary reported transaction", "category": "discretionary"},
    "A": {"label": "Grant / award", "category": "mechanical"},
    "M": {"label": "Option exercise / conversion", "category": "mechanical"},
    "F": {"label": "Shares withheld for taxes", "category": "mechanical"},
    "D": {"label": "Disposition to issuer", "category": "mechanical"},
    "G": {"label": "Gift", "category": "mechanical"},
    "I": {"label": "Discretionary transaction (plan)", "category": "mechanical"},
    "J": {"label": "Other (see footnote)", "category": "mechanical"},
    "K": {"label": "Equity swap", "category": "mechanical"},
    "L": {"label": "Small acquisition", "category": "mechanical"},
    "U": {"label": "Tender of shares", "category": "mechanical"},
    "W": {"label": "Will / inheritance", "category": "mechanical"},
    "X": {"label": "In-the-money option exercise", "category": "mechanical"},
    "C": {"label": "Conversion of derivative", "category": "mechanical"},
    "E": {"label": "Expiration of short position", "category": "mechanical"},
    "H": {"label": "Long-term expiration", "category": "mechanical"},
    "O": {"label": "Out-of-the-money option exercise", "category": "mechanical"},
    "Z": {"label": "Voting trust", "category": "mechanical"},
}


def _build_sec_filing_url(issuer_cik: Optional[str], accession_number: Optional[str]) -> Optional[str]:
    """Build a canonical EDGAR filing index URL from CIK + accession number."""
    if not issuer_cik or not accession_number:
        return None
    try:
        cik_int = int(str(issuer_cik))
    except (TypeError, ValueError):
        return None
    no_dashes = str(accession_number).replace("-", "")
    return f"https://www.sec.gov/Archives/edgar/data/{cik_int}/{no_dashes}/{accession_number}-index.htm"


def _annotate_form4_row(row: dict) -> dict:
    """Add human-readable label & category to a Form 4 row."""
    code = (row.get("transaction_code") or "").upper()
    meta = FORM4_CODE_META.get(code, {"label": code or "Unknown", "category": "mechanical"})
    row["transaction_label"] = meta["label"]
    row["transaction_category"] = meta["category"]

    # filing_url from the API is often null; synthesize from CIK + accession.
    if not row.get("filing_url"):
        row["filing_url"] = _build_sec_filing_url(row.get("issuer_cik"), row.get("accession_number"))

    # Role summary for the owner
    roles = []
    if row.get("is_director"):
        roles.append("Director")
    if row.get("is_officer"):
        roles.append("Officer")
    if row.get("is_ten_percent_owner"):
        roles.append("10% Owner")
    if row.get("is_other"):
        roles.append("Other")
    row["owner_roles"] = roles
    return row


_MASSIVE_BASE = "https://api.massive.com"


def _cached(cache, key: str, ttl: Optional[int], fetcher, is_valid=bool):
    """Return a cached value (truthy) if present; otherwise call `fetcher` and
    cache the result when `is_valid(result)` is True. Mirrors the existing
    pattern in MassiveProvider so callers can stay one-liners.
    """
    hit = cache.get(key, ttl)
    if hit:
        return hit
    value = fetcher()
    if is_valid(value):
        cache.set(key, value)
    return value


def _massive_get(path: str, params: dict, log_label: str, timeout: float = 15.0) -> list:
    """GET a Massive REST endpoint and return the `results` array.

    Returns [] on missing API key or any error (logged). The Python SDK
    doesn't yet expose every filings endpoint we need, so a few callers go
    through this raw helper.
    """
    if not _api_key:
        return []
    headers = {"Authorization": f"Bearer {_api_key}", "Accept-Encoding": "gzip"}
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.get(f"{_MASSIVE_BASE}{path}", params=params, headers=headers)
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        print(f"WARN [Massive]: GET {path} ({log_label}) failed: {e}")
        return []
    return data.get("results") or []


def _fetch_form4(query_params: dict, limit: int, log_label: str) -> list:
    """Fetch SEC Form 4 filings via Massive's REST API."""
    params = {
        **query_params,
        "limit": min(max(limit, 1), 1000),
        "sort": "filing_date.desc",
    }
    rows = _massive_get("/stocks/filings/vX/form-4", params, log_label)
    return [_annotate_form4_row(row) for row in rows]


def get_insider_trades(symbol: str, limit: int = 50) -> list:
    """Fetch SEC Form 4 insider transactions for a ticker."""
    return _fetch_form4({"tickers": symbol}, limit, log_label=symbol)


def get_insider_history(owner_cik: str, limit: int = 100) -> list:
    """Fetch SEC Form 4 transactions for a single insider across all companies."""
    # CIKs are 10-digit zero-padded; accept either form.
    cik = str(owner_cik).strip()
    if cik.isdigit():
        cik = cik.zfill(10)
    return _fetch_form4({"owner_cik": cik}, limit, log_label=f"owner={cik}")


# SEC Form 8-K item codes — mapped to a short title and category bucket so
# the UI can color-code and filter by event type.
FORM8K_ITEM_META = {
    "1.01": {"title": "Entry into Material Agreement", "category": "agreement"},
    "1.02": {"title": "Termination of Material Agreement", "category": "agreement"},
    "1.03": {"title": "Bankruptcy or Receivership", "category": "distress"},
    "1.04": {"title": "Mine Safety", "category": "other"},
    "2.01": {"title": "Completed Acquisition/Disposition", "category": "m_and_a"},
    "2.02": {"title": "Results of Operations", "category": "earnings"},
    "2.03": {"title": "Material Direct Obligation", "category": "distress"},
    "2.04": {"title": "Triggering Event", "category": "distress"},
    "2.05": {"title": "Exit / Disposal Costs", "category": "distress"},
    "2.06": {"title": "Material Impairment", "category": "distress"},
    "3.01": {"title": "Notice of Delisting", "category": "distress"},
    "3.02": {"title": "Unregistered Equity Sale", "category": "securities"},
    "3.03": {"title": "Modification of Rights", "category": "securities"},
    "4.01": {"title": "Auditor Change", "category": "governance"},
    "4.02": {"title": "Non-Reliance on Financials", "category": "distress"},
    "5.01": {"title": "Change in Control", "category": "leadership"},
    "5.02": {"title": "Officer / Director Change", "category": "leadership"},
    "5.03": {"title": "Bylaws / Charter Amendment", "category": "governance"},
    "5.04": {"title": "Trading Plan Suspension", "category": "governance"},
    "5.05": {"title": "Ethics Code Amendment", "category": "governance"},
    "5.07": {"title": "Shareholder Vote", "category": "governance"},
    "5.08": {"title": "Shareholder Nominations", "category": "governance"},
    "7.01": {"title": "Reg FD Disclosure", "category": "regfd"},
    "8.01": {"title": "Other Events", "category": "other"},
    "9.01": {"title": "Exhibits", "category": "other"},
}


_ITEM_REGEX = re.compile(r"Item\s+(\d{1,2}\.\d{2})", re.IGNORECASE)


def _parse_8k_items(items_text: Optional[str]) -> list:
    """Extract item codes from an 8-K body and annotate them."""
    if not items_text:
        return []
    found = []
    seen = set()
    for m in _ITEM_REGEX.finditer(items_text):
        code = m.group(1)
        if code in seen:
            continue
        seen.add(code)
        meta = FORM8K_ITEM_META.get(code, {"title": "Other Item", "category": "other"})
        found.append({"code": code, "title": meta["title"], "category": meta["category"]})
    return found


def _annotate_8k_row(row: dict) -> dict:
    """Add item-code classification and constructed SEC URL to an 8-K row."""
    row["items"] = _parse_8k_items(row.get("items_text"))
    # Categories present, deduped, for filter chips
    row["categories"] = sorted({i["category"] for i in row["items"]})
    if not row.get("filing_url"):
        row["filing_url"] = _build_sec_filing_url(row.get("cik"), row.get("accession_number"))
    return row


def _fetch_8k(ticker: str, limit: int) -> list:
    """Fetch parsed 8-K filings for a ticker via Massive's REST API."""
    params = {
        "ticker": ticker,
        "limit": min(max(limit, 1), 99),
        "sort": "filing_date.desc",
    }
    rows = _massive_get("/stocks/filings/8-K/vX/text", params, ticker)
    return [_annotate_8k_row(row) for row in rows]


def get_8k_filings(symbol: str, limit: int = 25) -> list:
    """Fetch recent 8-K filings for a ticker."""
    return _fetch_8k(symbol, limit)


# Known 10-K section identifiers from Massive's parser. We surface the
# narrative-rich ones in the UI; others can still be requested by section param.
FORM10K_SECTION_TITLES = {
    "business": "Business",
    "risk_factors": "Risk Factors",
    "mdna": "MD&A",
    "properties": "Properties",
    "legal_proceedings": "Legal Proceedings",
}


def _fetch_10k_sections(ticker: str, limit: int) -> list:
    """Fetch 10-K narrative sections for a ticker via Massive's REST API."""
    params = {
        "ticker": ticker,
        "limit": min(max(limit, 1), 99),
        "sort": "period_end.desc",
    }
    return _massive_get("/stocks/filings/10-K/vX/sections", params, ticker, timeout=20.0)


def get_10k_sections(symbol: str, limit: int = 20) -> dict:
    """Fetch latest 10-K sections for a ticker, grouped by section."""
    rows = _fetch_10k_sections(symbol, limit)
    if not rows:
        return {"period_end": None, "filing_date": None, "filing_url": None, "sections": []}

    # Filter to the most recent period_end so the UI shows a single filing.
    latest_period = rows[0].get("period_end")
    latest_rows = [r for r in rows if r.get("period_end") == latest_period]

    sections = []
    for r in latest_rows:
        section_id = r.get("section") or ""
        sections.append({
            "section": section_id,
            "title": FORM10K_SECTION_TITLES.get(section_id, section_id.replace("_", " ").title() or "Section"),
            "text": r.get("text") or "",
        })

    # Stable ordering: business first, risk_factors next, then the rest alphabetically
    priority = {"business": 0, "risk_factors": 1, "mdna": 2}
    sections.sort(key=lambda s: (priority.get(s["section"], 99), s["section"]))

    first = latest_rows[0]
    # filing_url shape: https://www.sec.gov/Archives/edgar/data/{cik}/{accession}.txt
    filing_url = first.get("filing_url") or ""
    accession_number = None
    if filing_url:
        try:
            tail = filing_url.rsplit("/", 1)[-1]
            accession_number = tail.rsplit(".", 1)[0]
        except Exception:
            accession_number = None

    return {
        "period_end": latest_period,
        "filing_date": first.get("filing_date"),
        "filing_url": filing_url or None,
        "cik": first.get("cik"),
        "accession_number": accession_number,
        "sections": sections,
    }


class MassiveProvider(DataProviderInterface):
    """Massive data provider implementation."""

    def __init__(self):
        self.cache_ttl = {
            "historical": 60,  # 1 minute
            "snapshot": 30,    # 30 seconds
            "news": 180,       # 3 minutes
            "options": None,   # Dynamic based on market hours
            "insights": 3600,  # 1 hour
            "form4": 900,      # 15 minutes
            "form8k": 900,     # 15 minutes
            "form10k": 86400,  # 24 hours (10-K is annual)
        }

    def get_historical_data(self, symbol: str, timeframe: str = "1M") -> List[HistoricalBar]:
        """Get historical price data from Massive."""
        def fetch() -> List[HistoricalBar]:
            data = get_historical_bars(symbol, timeframe)
            if "error" in data or "bars" not in data:
                return []
            return [
                HistoricalBar(
                    date=datetime.fromisoformat(b["date"]),
                    open=b["open"],
                    high=b["high"],
                    low=b["low"],
                    close=b["close"],
                    volume=b["volume"],
                )
                for b in data["bars"]
            ]
        return _cached(historical_cache, f"{symbol}:{timeframe}", self.cache_ttl["historical"], fetch)

    def get_ticker_details(self, symbol: str) -> Dict[str, Any]:
        """Get ticker company details from Massive."""
        return _cached(
            news_cache,
            f"details:{symbol}",
            3600,  # company details change rarely
            lambda: get_ticker_details(symbol),
            is_valid=lambda d: "error" not in d,
        )

    def get_daily_snapshot(self, symbol: str) -> Dict[str, Any]:
        """Get daily price snapshot from Massive."""
        return _cached(
            snapshot_cache,
            f"snapshot:{symbol}",
            self.cache_ttl["snapshot"],
            lambda: get_daily_snapshot(symbol),
            is_valid=lambda d: "error" not in d,
        )

    def get_news(self, symbol: str, limit: int = 15) -> List[Dict[str, Any]]:
        """Get news headlines for a ticker from Massive."""
        return _cached(
            news_cache,
            f"news:{symbol}",
            self.cache_ttl["news"],
            lambda: get_news(symbol, limit).get("headlines", []),
        )

    def get_analyst_insights(self, symbol: str, limit: int = 10) -> List[Dict[str, Any]]:
        """Get analyst ratings and insights from Massive."""
        return _cached(
            news_cache,
            f"insights:{symbol}",
            self.cache_ttl["insights"],
            lambda: get_analyst_insights(symbol, limit),
        )

    def get_market_news(self, limit: int = 25) -> List[Dict[str, Any]]:
        """Get general market news from Massive."""
        return _cached(
            news_cache,
            "news:market",
            self.cache_ttl["news"],
            lambda: get_market_news(limit).get("headlines", []),
        )

    def get_news_article(self, article_id: str) -> Dict[str, Any]:
        """Get full news article from Massive."""
        return _cached(
            news_cache,
            f"article:{article_id}",
            3600,  # articles are immutable
            lambda: get_news_article(article_id),
            is_valid=lambda d: "error" not in d,
        )

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

    def get_insider_trades(self, symbol: str, limit: int = 50) -> List[Dict[str, Any]]:
        """Get SEC Form 4 insider transactions from Massive."""
        return _cached(
            news_cache,
            f"form4:{symbol}:{limit}",
            self.cache_ttl["form4"],
            lambda: get_insider_trades(symbol, limit),
        )

    def get_insider_history(self, owner_cik: str, limit: int = 100) -> List[Dict[str, Any]]:
        """Get all SEC Form 4 transactions for a single insider across companies."""
        return _cached(
            news_cache,
            f"form4:owner:{owner_cik}:{limit}",
            self.cache_ttl["form4"],
            lambda: get_insider_history(owner_cik, limit),
        )

    def get_8k_filings(self, symbol: str, limit: int = 25) -> List[Dict[str, Any]]:
        """Get recent 8-K filings for a ticker from Massive."""
        return _cached(
            news_cache,
            f"form8k:{symbol}:{limit}",
            self.cache_ttl["form8k"],
            lambda: get_8k_filings(symbol, limit),
        )

    def get_10k_sections(self, symbol: str) -> Dict[str, Any]:
        """Get latest 10-K sections (Business, Risk Factors, etc.) for a ticker."""
        return _cached(
            news_cache,
            f"form10k:{symbol}",
            self.cache_ttl["form10k"],
            lambda: get_10k_sections(symbol),
            is_valid=lambda d: bool(d.get("sections")),
        )