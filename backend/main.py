import os
import asyncio
import nest_asyncio
from datetime import datetime
from contextlib import asynccontextmanager
from typing import Optional, Literal, List
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .config import config
from .providers.factory import DataProviderFactory
from .llm_client import analyze_market_news, analyze_ticker_news, analyze_8k_filings
from .common.models import TradeOrder
from .common.utils import validate_symbol, format_error_response
from .common.cache import options_cache, historical_cache, snapshot_cache
from .config_loader import config_loader

# ============================================
# PROVIDER CONFIGURATION
# ============================================
# Load providers from config_loader (handles both .env and credentials.json)
providers = config_loader.get_providers()
DATA_PROVIDER = providers.get('data', 'massive').lower()
NEWS_PROVIDER = providers.get('news', 'massive').lower()
BROKERAGE_PROVIDER = providers.get('brokerage', 'ibkr').lower()

# Create data provider (for routes that use it directly)
data_provider = DataProviderFactory.create(DATA_PROVIDER)
if data_provider is None:
    print(f"WARNING: Unknown DATA_PROVIDER '{DATA_PROVIDER}', falling back to 'massive'")
    DATA_PROVIDER = "massive"
    data_provider = DataProviderFactory.create("massive")

# Create separate news provider
news_provider = DataProviderFactory.create(NEWS_PROVIDER)
if news_provider is None:
    print(f"WARNING: Unknown NEWS_PROVIDER '{NEWS_PROVIDER}', falling back to 'massive'")
    NEWS_PROVIDER = "massive"
    news_provider = DataProviderFactory.create("massive")

print(f"Providers: data={DATA_PROVIDER}, news={NEWS_PROVIDER}, brokerage={BROKERAGE_PROVIDER}")

# Patch asyncio to allow nested event loops
nest_asyncio.apply()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    broker = config.broker
    if broker:
        # Run connect in background
        asyncio.create_task(broker.connect())
    yield
    # Shutdown
    if config.broker:
        config.broker.disconnect()

app = FastAPI(lifespan=lifespan)

# Allow CORS for local development and LAN access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/api/health")
def health():
    broker = config.broker
    # For stateless data/news providers, we assume they are "ok" if configured.
    # Future enhancement: Add health_check methods to DataProviderInterface.
    return {
        "status": "ok", 
        "broker_connected": broker.is_connected() if broker else False,
        "ib_connected": broker.is_connected() if broker else False, # Keep for backward compat for a moment
        "data_connected": data_provider is not None,
        "news_connected": news_provider is not None,
        "providers": {
            "data": DATA_PROVIDER,
            "news": NEWS_PROVIDER,
            "brokerage": BROKERAGE_PROVIDER
        }
    }

# ============================================
# IBKR ENDPOINTS (Live Data Only)
# - Positions, P&L, Greeks
# - Real-time market data
# ============================================

@app.get("/api/portfolio")
def get_portfolio():
    broker = config.broker
    if not broker or not broker.is_connected():
        return format_error_response(f"Not connected to {BROKERAGE_PROVIDER.upper()}", positions=[])
    
    data = broker.get_positions()
    summary = broker.get_account_summary()
    
    if isinstance(data, list):
         # Convert objects to dicts if they aren't already (IBKR broker returns Pydantic/dataclass objects?)
         # IBKR.get_positions returns List[Position] object.
         # Fastapi handles dataclass serialization automatically usually, but let's be safe
         return {"positions": data, "summary": summary}
         
    # If data is already a dict, merge summary
    if isinstance(data, dict):
        data["summary"] = summary
        return data
        
    return data

@app.post("/api/trade")
def place_trade(order: TradeOrder):
    """
    Place a stock order through configured broker.
    """
    broker = config.broker
    if not broker or not broker.is_connected():
        return format_error_response(f"Not connected to {BROKERAGE_PROVIDER.upper()}", success=False)
    
    result = broker.place_stock_order(order)
    return result


class OptionLeg(BaseModel):
    symbol: str
    expiry: str  # YYYYMMDD format
    strike: float
    right: Literal["C", "P"]
    action: Literal["BUY", "SELL"]
    quantity: int


class OptionsTradeOrder(BaseModel):
    legs: List[OptionLeg]
    order_type: Literal["MARKET", "LIMIT"] = "MARKET"
    limit_price: Optional[float] = None


@app.post("/api/options/trade")
def place_options_trade(order: OptionsTradeOrder):
    """
    Place an options order through configured broker.
    """
    broker = config.broker
    if not broker or not broker.is_connected():
        return format_error_response(f"Not connected to {BROKERAGE_PROVIDER.upper()}", success=False)
    
    # Convert Pydantic models to dicts
    legs_data = [leg.model_dump() for leg in order.legs]
    
    # Use multi-leg method on broker interface
    result = broker.place_multileg_option_order(
        legs=legs_data,
        order_type=order.order_type,
        limit_price=order.limit_price
    )
    
    return result

    return result

@app.get("/api/orders")
def get_orders():
    """
    Get all pending and filled orders for the day from the active broker.
    """
    broker = config.broker
    if not broker or not broker.is_connected():
        return format_error_response(f"Not connected to {BROKERAGE_PROVIDER.upper()}", orders=[])
    
    orders = broker.get_orders()
    # Convert dataclasses to dicts
    orders_data = [o.to_dict() for o in orders]
    
    return {"orders": orders_data, "provider": BROKERAGE_PROVIDER}

@app.get("/api/options-chain/{symbol}")

def get_options_chain_endpoint(symbol: str, max_strikes: int = 30, force_refresh: bool = False):
    """
    Get options chain for a symbol with caching.

    Args:
        symbol: Stock ticker (e.g., AAPL)
        max_strikes: Maximum number of strikes to return (centered around ATM)
        force_refresh: Force refresh the cache

    Returns:
        Options chain with expirations, strikes, calls, and puts data
    """
    symbol_validated = validate_symbol(symbol)
    cache_key = f"{symbol_validated}_{max_strikes}"

    # Check cache unless force refresh
    if not force_refresh:
        cached_result = options_cache.get_with_metadata(cache_key)
        if cached_result:
            return {**cached_result["data"], **cached_result}

    # Fetch fresh data from configured provider
    data = data_provider.get_options_chain(symbol_validated, max_strikes)

    # Cache the result if successful
    if not data.get("error"):
        options_cache.set(cache_key, data)

    return {**data, "cached": False, "provider": DATA_PROVIDER}


# ============================================
# DATA PROVIDER ENDPOINTS (Historical + News + Company Info)
# Uses DATA_PROVIDER env var to select provider (massive or ibkr)
# ============================================

@app.get("/api/historical/{symbol}")
def get_historical_data(symbol: str, timeframe: str = "1M"):
    """
    Get historical price data for a symbol with smart caching.

    Args:
        symbol: Stock ticker (e.g., AAPL)
        timeframe: One of 1Y, 1M, 1W, 1D, 1H
    """
    cache_key = f"{validate_symbol(symbol)}_{timeframe.upper()}"

    # Check cache with dynamic TTL based on timeframe
    if timeframe.upper() in ["1H", "1D"]:
        ttl = 60  # 1 minute for intraday
    elif timeframe.upper() == "1W":
        ttl = 120  # 2 minutes for weekly
    else:
        ttl = 300  # 5 minutes for monthly/yearly

    cached_result = historical_cache.get_with_metadata(cache_key, ttl)
    if cached_result:
        return {**cached_result["data"], **cached_result}

    # Fetch fresh data from configured provider
    bars = data_provider.get_historical_data(validate_symbol(symbol), timeframe.upper())
    
    # Convert HistoricalBar objects to dicts for JSON serialization
    data = {
        "symbol": validate_symbol(symbol),
        "timeframe": timeframe.upper(),
        "bars": [bar.to_dict() if hasattr(bar, 'to_dict') else bar for bar in bars] if bars else []
    }

    # Cache if successful
    if data["bars"]:
        historical_cache.set(cache_key, data)

    return {**data, "provider": DATA_PROVIDER}


@app.get("/api/ticker/{symbol}")
def get_ticker_info(symbol: str):
    """
    Get ticker details (company name, description, logo).
    
    Args:
        symbol: Stock ticker (e.g., AAPL)
    """
    result = data_provider.get_ticker_details(validate_symbol(symbol))
    return {**result, "provider": DATA_PROVIDER}


@app.get("/api/snapshot/{symbol}")
def get_price_snapshot(symbol: str, force_refresh: bool = False):
    """
    Get current price and daily change for a symbol with smart caching.

    Args:
        symbol: Stock ticker (e.g., AAPL)
        force_refresh: Force bypass cache
    """
    cache_key = validate_symbol(symbol)

    # Check cache unless force refresh
    if not force_refresh:
        # Use market-hours-aware TTL from cache manager
        cached_result = snapshot_cache.get_with_metadata(cache_key)
        if cached_result:
            return {**cached_result["data"], **cached_result}

    # Fetch fresh data from configured provider
    data = data_provider.get_daily_snapshot(validate_symbol(symbol))

    # Cache if successful
    if data and not data.get("error"):
        snapshot_cache.set(cache_key, data)

    return {**data, "provider": DATA_PROVIDER}


@app.get("/api/news/market")
def get_market_news_headlines(limit: int = 25):
    """
    Get general market news across major indices.
    
    Args:
        limit: Max number of headlines (1-50, default 25)
    """
    headlines = news_provider.get_market_news(limit)
    return {"headlines": headlines, "provider": NEWS_PROVIDER}


@app.get("/api/news/{symbol}")
def get_news_headlines(symbol: str, limit: int = 15):
    """
    Get news headlines for a symbol.
    
    Args:
        symbol: Stock ticker (e.g., AAPL)
        limit: Max number of headlines (1-100, default 15)
    """
    headlines = news_provider.get_news(validate_symbol(symbol), limit)
    return {"symbol": validate_symbol(symbol), "headlines": headlines, "provider": NEWS_PROVIDER}


@app.get("/api/news/article/{article_id}")
def get_article(article_id: str):
    """
    Get full article content.
    
    Args:
        article_id: The article ID
    """
    result = news_provider.get_news_article(article_id)
    return {**result, "provider": NEWS_PROVIDER}


@app.get("/api/insider-trades/{symbol}")
def get_insider_trades(symbol: str, limit: int = 50):
    """
    Get SEC Form 4 insider transactions for a ticker.

    Args:
        symbol: Stock ticker (e.g., AAPL)
        limit: Max number of rows (default 50)
    """
    sym = validate_symbol(symbol)
    trades = news_provider.get_insider_trades(sym, limit)
    return {"symbol": sym, "trades": trades, "provider": NEWS_PROVIDER}


@app.get("/api/filings-8k/{symbol}")
def get_8k_filings(symbol: str, limit: int = 25):
    """
    Get recent SEC Form 8-K filings (current reports) for a ticker.

    Args:
        symbol: Stock ticker (e.g., AAPL)
        limit: Max number of filings (default 25, max 99)
    """
    sym = validate_symbol(symbol)
    filings = news_provider.get_8k_filings(sym, limit)
    return {"symbol": sym, "filings": filings, "provider": NEWS_PROVIDER}


@app.get("/api/insider-history/{owner_cik}")
def get_insider_history(owner_cik: str, limit: int = 100):
    """
    Get an insider's Form 4 transaction history across every company they're
    an insider of, looked up by SEC owner CIK.

    Args:
        owner_cik: SEC Central Index Key of the reporting owner (digits only)
        limit: Max number of rows (default 100)
    """
    # CIK is digits-only; reject anything else to keep the path safe.
    cik = "".join(ch for ch in owner_cik if ch.isdigit())
    if not cik:
        return {"owner_cik": owner_cik, "trades": [], "provider": NEWS_PROVIDER, "error": "invalid CIK"}
    trades = news_provider.get_insider_history(cik, limit)
    return {"owner_cik": cik, "trades": trades, "provider": NEWS_PROVIDER}


@app.get("/api/insights/{symbol}")
def get_analyst_insights(symbol: str, limit: int = 10):
    """
    Get analyst insights and ratings from data provider.
    
    Args:
        symbol: Stock ticker (e.g., AAPL)
        limit: Max number of insights (default 10)
    """
    # Use news_provider or data_provider? Massive is usually DATA but Benzinga is NEWS.
    # The method is on DataProviderInterface (implemented by MassiveProvider).
    # Since news_provider might be MassiveProvider instance, and get_analyst_insights is on it,
    # we can try news_provider first, then data_provider.
    # Actually, in main.py logic:
    # data_provider = DataProviderFactory.create(DATA_PROVIDER)
    # news_provider = DataProviderFactory.create(NEWS_PROVIDER)
    
    # Insights are closer to "News" but stored in MassiveProvider which handles both.
    # Let's try standardizing on "news_provider" for this if it supports it.
    
    provider = news_provider
    provider_name = NEWS_PROVIDER
    
    # Fallback to data provider if news provider doesn't support insights (e.g. IBKR/Alpaca) 
    # but Massive (Data) does.
    # Actually MassiveProvider implements both interfaces.
    
    insights = provider.get_analyst_insights(validate_symbol(symbol), limit)
    
    return {
        "symbol": validate_symbol(symbol), 
        "insights": insights, 
        "provider": provider_name
    }


# ============================================
# Cache Management Endpoint
# ============================================

@app.post("/api/cache/clear")
def clear_cache(cache_type: str = "all"):
    """Clear various caches. Useful for debugging or forcing fresh data."""
    cleared = []

    if cache_type in ["all", "options"]:
        options_cache.clear()
        cleared.append("options")

    if cache_type in ["all", "historical"]:
        historical_cache.clear()
        cleared.append("historical")

    if cache_type in ["all", "snapshot"]:
        snapshot_cache.clear()
        cleared.append("snapshot")

    return {"status": "success", "cleared": cleared}

@app.get("/api/cache/stats")
def get_cache_stats():
    """Get cache statistics for monitoring."""
    return {
        "options_chain": options_cache.stats(),
        "historical": historical_cache.stats(),
        "snapshot": snapshot_cache.stats(),
        "server_time": datetime.now().isoformat(),
        "market_hours_cache_ttl": options_cache.get_market_hours_ttl()
    }


# ==================
# LLM Analysis Routes
# ==================

class ArticleForAnalysis(BaseModel):
    headline: str
    body: str | None = None

class MarketNewsAnalysisRequest(BaseModel):
    articles: list[ArticleForAnalysis]
    tickers: list[str]

class TickerNewsAnalysisRequest(BaseModel):
    articles: list[ArticleForAnalysis]
    ticker: str

class FilingItem(BaseModel):
    code: str
    title: str | None = None

class Filing8kForAnalysis(BaseModel):
    filing_date: str | None = None
    items: list[FilingItem] = []
    items_text: str | None = None

class Filing8kAnalysisRequest(BaseModel):
    filings: list[Filing8kForAnalysis]
    ticker: str


@app.post("/api/llm/analyze-market-news")
def llm_analyze_market_news(request: MarketNewsAnalysisRequest):
    """
    Analyze market news articles for portfolio impact using LLM.
    
    Returns AI-generated summary of how articles affect the portfolio.
    """
    articles = [a.model_dump() for a in request.articles]
    result = analyze_market_news(articles, request.tickers)
    return result


@app.post("/api/llm/analyze-8k")
def llm_analyze_8k(request: Filing8kAnalysisRequest):
    """Analyze recent 8-K filings for a specific ticker using LLM."""
    filings = [f.model_dump() for f in request.filings]
    return analyze_8k_filings(filings, request.ticker)


@app.post("/api/llm/analyze-ticker-news")
def llm_analyze_ticker_news(request: TickerNewsAnalysisRequest):
    """
    Analyze news articles for a specific ticker using LLM.

    Returns AI-generated summary of how articles affect the stock.
    """
    articles = [a.model_dump() for a in request.articles]
    result = analyze_ticker_news(articles, request.ticker)
    return result
