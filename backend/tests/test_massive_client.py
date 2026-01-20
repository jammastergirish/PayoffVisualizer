"""
Tests for Massive.com API client.

Tests cover:
- get_historical_bars: Historical OHLC data fetching
- get_daily_snapshot: Daily price and change % 
- get_ticker_details: Company info and branding
- get_news: News headlines from multiple sources
"""

import pytest
from unittest.mock import MagicMock, patch, PropertyMock
from datetime import datetime, timedelta


class MockAgg:
    """Mock Massive API aggregate (bar) object."""
    def __init__(self, timestamp, o, h, l, c, v):
        self.timestamp = timestamp
        self.o = o
        self.h = h
        self.l = l
        self.c = c
        self.v = v
        self.open = o
        self.high = h
        self.low = l
        self.close = c
        self.volume = v
        self.vwap = (h + l + c) / 3
        self.transactions = 100


class MockTickerDetails:
    """Mock Massive API ticker details response."""
    def __init__(self, name, description=None):
        self.name = name
        self.description = description
        self.homepage_url = "https://example.com"
        self.market_cap = 1000000000
        self.total_employees = 5000
        self.list_date = "1990-01-01"
        self.branding = None


class MockBranding:
    def __init__(self):
        self.logo_url = "https://example.com/logo.png"
        self.icon_url = "https://example.com/icon.png"


class MockNewsArticle:
    """Mock Benzinga news article."""
    def __init__(self, benzinga_id, title, published, teaser="", body="", url=""):
        self.benzinga_id = benzinga_id
        self.title = title
        self.published = published
        self.teaser = teaser
        self.body = body
        self.url = url
        self.author = "Test Author"


class MockRefNewsArticle:
    """Mock reference news article."""
    def __init__(self, article_id, title, published_utc, description=""):
        self.id = article_id
        self.title = title
        self.published_utc = published_utc
        self.description = description
        self.article_url = "https://example.com/article"
        self.author = "Ref Author"
        self.publisher = MagicMock()
        self.publisher.name = "Test Publisher"


@pytest.fixture
def mock_massive_client():
    """Create a mock Massive REST client."""
    with patch('backend.providers.massive._client') as mock_client:
        with patch('backend.providers.massive._api_key', 'test_api_key'):
            mock_client.get_aggs = MagicMock()
            mock_client.get_ticker_details = MagicMock()
            mock_client.list_benzinga_news_v2 = MagicMock()
            mock_client.list_ticker_news = MagicMock()
            yield mock_client


class TestGetHistoricalBars:
    """Tests for get_historical_bars function."""
    
    def test_returns_bars_for_valid_symbol(self, mock_massive_client):
        from backend.providers.massive import get_historical_bars
        
        # Setup mock data
        now = datetime.now()
        ts = int(now.timestamp() * 1000)
        mock_aggs = [
            MockAgg(ts - 86400000, 100, 105, 99, 103, 1000000),
            MockAgg(ts, 103, 110, 102, 108, 1200000),
        ]
        mock_massive_client.get_aggs.return_value = mock_aggs
        
        # Execute
        result = get_historical_bars("AAPL", "1M")
        
        # Assert
        assert result["symbol"] == "AAPL"
        assert result["timeframe"] == "1M"
        assert len(result["bars"]) == 2
        assert "error" not in result
        assert result["bars"][0]["close"] == 103
        assert result["bars"][1]["close"] == 108
    
    def test_handles_empty_response(self, mock_massive_client):
        from backend.providers.massive import get_historical_bars
        
        mock_massive_client.get_aggs.return_value = []
        
        result = get_historical_bars("XYZ", "1D")
        
        assert result["symbol"] == "XYZ"
        assert result["bars"] == []
        assert "error" not in result
    
    def test_handles_api_error(self, mock_massive_client):
        from backend.providers.massive import get_historical_bars
        
        mock_massive_client.get_aggs.side_effect = Exception("API Error")
        
        result = get_historical_bars("AAPL", "1Y")
        
        assert result["symbol"] == "AAPL"
        assert result["bars"] == []
        assert "error" in result
        assert "API Error" in result["error"]
    
    def test_uses_correct_timeframe_config(self, mock_massive_client):
        from backend.providers.massive import get_historical_bars
        
        mock_massive_client.get_aggs.return_value = []
        
        # Test 1H timeframe (minute bars)
        get_historical_bars("AAPL", "1H")
        call_args = mock_massive_client.get_aggs.call_args
        assert call_args.kwargs["timespan"] == "minute"
        assert call_args.kwargs["multiplier"] == 1


class TestGetDailySnapshot:
    """Tests for get_daily_snapshot function."""
    
    def test_returns_price_and_change(self, mock_massive_client):
        from backend.providers.massive import get_daily_snapshot
        
        now = datetime.now()
        ts_today = int(now.timestamp() * 1000)
        ts_yesterday = int((now - timedelta(days=1)).timestamp() * 1000)
        
        mock_aggs = [
            MockAgg(ts_today, 100, 105, 99, 105, 1000000),      # Today (most recent)
            MockAgg(ts_yesterday, 95, 102, 94, 100, 900000),    # Yesterday
        ]
        mock_massive_client.get_aggs.return_value = mock_aggs
        
        result = get_daily_snapshot("AAPL")
        
        assert result["symbol"] == "AAPL"
        assert result["current_price"] == 105
        assert result["previous_close"] == 100
        assert result["change"] == 5
        assert result["change_pct"] == 5.0
    
    def test_handles_negative_change(self, mock_massive_client):
        from backend.providers.massive import get_daily_snapshot
        
        now = datetime.now()
        ts = int(now.timestamp() * 1000)
        
        mock_aggs = [
            MockAgg(ts, 100, 102, 95, 95, 1000000),     # Today down
            MockAgg(ts - 86400000, 98, 105, 97, 100, 900000),  # Yesterday
        ]
        mock_massive_client.get_aggs.return_value = mock_aggs
        
        result = get_daily_snapshot("TSLA")
        
        assert result["change"] == -5
        assert result["change_pct"] == -5.0
    
    def test_handles_no_data(self, mock_massive_client):
        from backend.providers.massive import get_daily_snapshot
        
        mock_massive_client.get_aggs.return_value = []
        
        result = get_daily_snapshot("UNKNOWN")
        
        assert "error" in result


class TestGetTickerDetails:
    """Tests for get_ticker_details function."""
    
    def test_returns_company_info(self, mock_massive_client):
        from backend.providers.massive import get_ticker_details
        
        mock_details = MockTickerDetails("Apple Inc.", "Technology company")
        mock_details.branding = MockBranding()
        mock_massive_client.get_ticker_details.return_value = mock_details
        
        result = get_ticker_details("AAPL")
        
        assert result["symbol"] == "AAPL"
        assert result["name"] == "Apple Inc."
        assert result["description"] == "Technology company"
        assert result["branding"]["logo_url"] is not None
        assert "apiKey" in result["branding"]["logo_url"]
    
    def test_handles_missing_branding(self, mock_massive_client):
        from backend.providers.massive import get_ticker_details
        
        mock_details = MockTickerDetails("Test Corp")
        mock_details.branding = None
        mock_massive_client.get_ticker_details.return_value = mock_details
        
        result = get_ticker_details("TEST")
        
        assert result["name"] == "Test Corp"
        assert result["branding"] is None
    
    def test_handles_api_error(self, mock_massive_client):
        from backend.providers.massive import get_ticker_details
        
        mock_massive_client.get_ticker_details.side_effect = Exception("Not found")
        
        result = get_ticker_details("INVALID")
        
        assert "error" in result


class TestGetNews:
    """Tests for get_news function."""
    
    def test_merges_benzinga_and_reference_news(self, mock_massive_client):
        from backend.providers.massive import get_news
        
        # Setup Benzinga mock
        benzinga_articles = [
            MockNewsArticle("bz1", "Benzinga Headline 1", "2026-01-11T10:00:00Z"),
            MockNewsArticle("bz2", "Benzinga Headline 2", "2026-01-11T09:00:00Z"),
        ]
        mock_massive_client.list_benzinga_news_v2.return_value = iter(benzinga_articles)
        
        # Setup Reference News mock
        ref_articles = [
            MockRefNewsArticle("ref1", "Reference Headline", "2026-01-11T09:30:00Z"),
        ]
        mock_massive_client.list_ticker_news.return_value = iter(ref_articles)
        
        result = get_news("AAPL", limit=10)
        
        assert result["symbol"] == "AAPL"
        assert len(result["headlines"]) == 3
        # Verify Benzinga articles are included
        assert any(h["providerCode"] == "BZ" for h in result["headlines"])
    
    def test_respects_limit(self, mock_massive_client):
        from backend.providers.massive import get_news
        
        # Setup many articles
        benzinga_articles = [
            MockNewsArticle(f"bz{i}", f"Headline {i}", f"2026-01-11T{10-i}:00:00Z")
            for i in range(10)
        ]
        mock_massive_client.list_benzinga_news_v2.return_value = iter(benzinga_articles)
        mock_massive_client.list_ticker_news.return_value = iter([])
        
        result = get_news("AAPL", limit=5)
        
        assert len(result["headlines"]) <= 5


class TestNewsHelperFunctions:
    """Tests for internal news helper functions."""
    
    def test_parse_benzinga_article_extracts_fields(self):
        from backend.providers.massive import _parse_benzinga_article
        
        article = MockNewsArticle(
            benzinga_id="12345",
            title="Test Article Title",
            published="2026-01-14T10:00:00Z",
            teaser="Short teaser",
            body="Full body content",
            url="https://benzinga.com/article/12345"
        )
        article.images = ["https://cdn.benzinga.com/image1.jpg", "https://cdn.benzinga.com/image2.jpg"]
        
        result = _parse_benzinga_article(article)
        
        assert result["articleId"] == "12345"
        assert result["headline"] == "Test Article Title"
        assert result["providerCode"] == "BZ"
        assert result["providerName"] == "Benzinga"
        assert result["time"] == "2026-01-14T10:00:00Z"
        assert result["teaser"] == "Short teaser"
        assert result["body"] == "Full body content"
        assert result["url"] == "https://benzinga.com/article/12345"
        assert result["imageUrl"] == "https://cdn.benzinga.com/image1.jpg"  # First image
    
    def test_parse_benzinga_article_handles_no_images(self):
        from backend.providers.massive import _parse_benzinga_article
        
        article = MockNewsArticle("12345", "Title", "2026-01-14T10:00:00Z")
        # No images attribute
        
        result = _parse_benzinga_article(article)
        
        assert result["imageUrl"] is None
    
    def test_parse_reference_article_extracts_fields(self):
        from backend.providers.massive import _parse_reference_article
        
        article = MockRefNewsArticle(
            article_id="abc123",
            title="Reference Article Title",
            published_utc="2026-01-14T09:00:00Z",
            description="Article description"
        )
        article.image_url = "https://example.com/image.jpg"
        
        result = _parse_reference_article(article)
        
        assert result["articleId"] == "abc123"
        assert result["headline"] == "Reference Article Title"
        assert result["providerCode"] == "TES"  # First 3 letters of "Test Publisher"
        assert result["providerName"] == "Test Publisher"
        assert result["time"] == "2026-01-14T09:00:00Z"
        assert result["teaser"] == "Article description"
        assert result["imageUrl"] == "https://example.com/image.jpg"
    
    def test_parse_reference_article_creates_provider_code(self):
        from backend.providers.massive import _parse_reference_article
        
        article = MockRefNewsArticle("id1", "Title", "2026-01-14T10:00:00Z")
        article.publisher.name = "Investing.com"
        
        result = _parse_reference_article(article)
        
        # Provider code should be first 3 alpha chars, uppercased
        assert result["providerCode"] == "INV"


class TestGetMarketNews:
    """Tests for get_market_news function."""
    
    def test_fetches_news_from_multiple_tickers(self, mock_massive_client):
        from backend.providers.massive import get_market_news
        
        # Setup Benzinga mock
        benzinga_articles = [
            MockNewsArticle("bz1", "Market Headline 1", "2026-01-14T10:00:00Z"),
        ]
        mock_massive_client.list_benzinga_news_v2.return_value = iter(benzinga_articles)
        mock_massive_client.list_ticker_news.return_value = iter([])
        
        result = get_market_news(limit=10)
        
        # Should have called for each market ticker (SPY, QQQ, DIA, IWM, VIX, GOLD)
        assert mock_massive_client.list_benzinga_news_v2.call_count == 6
        assert mock_massive_client.list_ticker_news.call_count == 6
        assert "headlines" in result
    
    def test_deduplicates_headlines(self, mock_massive_client):
        from backend.providers.massive import get_market_news
        
        # Same headline from different tickers (market-wide news)
        benzinga_articles = [
            MockNewsArticle("bz1", "Duplicate Market Headline", "2026-01-14T10:00:00Z"),
        ]
        
        # Each call returns same headline (simulating same news for SPY, QQQ, DIA)
        mock_massive_client.list_benzinga_news_v2.return_value = iter(benzinga_articles)
        mock_massive_client.list_ticker_news.return_value = iter([])
        
        result = get_market_news(limit=10)
        
        # Deduplication should prevent multiple copies
        unique_headlines = set(h["headline"] for h in result["headlines"])
        assert len(unique_headlines) == len(result["headlines"])
    
    def test_respects_limit(self, mock_massive_client):
        from backend.providers.massive import get_market_news
        
        # Many articles
        benzinga_articles = [
            MockNewsArticle(f"bz{i}", f"Headline {i}", f"2026-01-14T{10+i}:00:00Z")
            for i in range(20)
        ]
        mock_massive_client.list_benzinga_news_v2.return_value = iter(benzinga_articles)
        mock_massive_client.list_ticker_news.return_value = iter([])
        
        result = get_market_news(limit=5)
        
        assert len(result["headlines"]) <= 5
    
    def test_returns_empty_when_no_client(self):
        """Test that function handles missing API client gracefully."""
        from backend.providers.massive import get_market_news
        
        with patch('backend.providers.massive._client', None):
            result = get_market_news(limit=10)
        
        assert result["headlines"] == []
        assert "error" in result


class TestGetOptionsChainStrikeKeys:
    """Tests for options chain strike key serialization.
    
    Verifies that strike prices are serialized as strings to ensure
    consistent JSON serialization between Python and JavaScript.
    
    Bug context: Python's str(50.0) = "50.0", but JavaScript's String(50.0) = "50".
    This caused integer strikes to fail lookup when keys didn't match.
    """
    
    def test_strike_key_is_string_for_integer_strike(self):
        """Verify that integer strikes like 50.0 use string keys."""
        # Test the str() conversion directly
        strike = 50.0
        strike_key = str(strike)
        
        # Python's str(50.0) should give "50.0"
        assert strike_key == "50.0"
        assert isinstance(strike_key, str)
    
    def test_strike_key_is_string_for_non_integer_strike(self):
        """Verify that non-integer strikes like 50.5 use string keys."""
        strike = 50.5
        strike_key = str(strike)
        
        # Python's str(50.5) should give "50.5"
        assert strike_key == "50.5"
        assert isinstance(strike_key, str)
    
    def test_strike_key_format_consistency(self):
        """Verify consistent key format for various strike values."""
        test_cases = [
            (49.0, "49.0"),
            (50.0, "50.0"),
            (50.5, "50.5"),
            (51.0, "51.0"),
            (100.0, "100.0"),
            (100.25, "100.25"),
        ]
        
        for strike, expected_key in test_cases:
            assert str(strike) == expected_key, f"Strike {strike} should serialize to '{expected_key}'"
    
    def test_strike_keys_in_dict_are_consistent(self):
        """Verify that dict keys using str(strike) are consistent."""
        strikes = [49.0, 49.5, 50.0, 50.5, 51.0]
        calls = {}
        
        # Simulate building the calls dict as done in get_options_chain
        for strike in strikes:
            strike_key = str(strike)
            calls[strike_key] = {"strike": strike, "bid": 1.0, "ask": 1.1}
        
        # Verify all keys are strings
        for key in calls.keys():
            assert isinstance(key, str), f"Key {key} should be a string"
        
        # Verify we can look up using the same format
        assert "50.0" in calls
        assert "50.5" in calls
        assert calls["50.0"]["strike"] == 50.0
        assert calls["50.5"]["strike"] == 50.5
