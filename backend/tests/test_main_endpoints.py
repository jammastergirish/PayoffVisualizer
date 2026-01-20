"""
Integration tests for FastAPI endpoints.

Tests cover all endpoints in main.py:
- Health check
- Portfolio (IBKR)
- Historical data (Massive)
- Ticker details (Massive)
- Snapshot (Massive)
- News (Massive)
- Watchlist CRUD
"""

import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def mock_broker():
    """Mock broker to avoid real broker connections."""
    with patch('backend.config.config._broker') as mock:
        if mock:
            mock.is_connected.return_value = False
        yield mock


@pytest.fixture
def client():
    """Create FastAPI test client."""
    from backend.main import app
    return TestClient(app)


class TestHealthEndpoint:
    """Tests for GET /api/health endpoint."""
    
    def test_health_check_returns_status(self, client):
        response = client.get("/api/health")
        
        assert response.status_code == 200
        data = response.json()
        assert "status" in data
        assert "broker_connected" in data
        assert data["status"] == "ok"
    
    def test_health_check_shows_disconnected(self, client, mock_broker):
        mock_broker.is_connected.return_value = False
        
        response = client.get("/api/health")
        
        assert response.json()["broker_connected"] == False


class TestPortfolioEndpoint:
    """Tests for GET /api/portfolio endpoint."""
    
    def test_returns_error_when_disconnected(self, client, mock_broker):
        mock_broker.is_connected.return_value = False
        
        response = client.get("/api/portfolio")
        
        assert response.status_code == 200
        data = response.json()
        assert "error" in data
        assert data["positions"] == []
    
    def test_returns_positions_when_connected(self, client, mock_broker):
        mock_broker.is_connected.return_value = True
        mock_broker.get_positions.return_value = [{"ticker": "AAPL", "qty": 100}]
        mock_broker.get_account_summary.return_value = {}
        
        response = client.get("/api/portfolio")
        
        assert response.status_code == 200
        data = response.json()
        assert "positions" in data
        assert len(data["positions"]) == 1
        assert data["positions"][0]["ticker"] == "AAPL"


class TestHistoricalEndpoint:
    """Tests for GET /api/historical/{symbol} endpoint."""
    
    def test_fetches_historical_data(self, client):
        with patch('backend.main.data_provider.get_historical_data') as mock_bars:
            # Mock HistoricalBar objects
            from backend.common.models import HistoricalBar
            from datetime import datetime
            mock_bars.return_value = [
                HistoricalBar(date=datetime(2026, 1, 1), open=149.0, high=151.0, low=148.0, close=150.0, volume=1000000)
            ]
            
            response = client.get("/api/historical/aapl")
            
            assert response.status_code == 200
            mock_bars.assert_called_with("AAPL", "1M")
    
    def test_accepts_timeframe_parameter(self, client):
        with patch('backend.main.data_provider.get_historical_data') as mock_bars:
            mock_bars.return_value = []  # Empty list of bars
            
            response = client.get("/api/historical/tsla?timeframe=1y")
            
            mock_bars.assert_called_with("TSLA", "1Y")
    
    def test_uppercases_symbol(self, client):
        with patch('backend.main.data_provider.get_historical_data') as mock_bars:
            mock_bars.return_value = []  # Empty list of bars
            
            client.get("/api/historical/nvda")
            
            mock_bars.assert_called_with("NVDA", "1M")


class TestTickerEndpoint:
    """Tests for GET /api/ticker/{symbol} endpoint."""
    
    def test_fetches_ticker_details(self, client):
        with patch('backend.main.data_provider.get_ticker_details') as mock_details:
            mock_details.return_value = {
                "symbol": "AAPL",
                "name": "Apple Inc.",
                "description": "Technology company"
            }
            
            response = client.get("/api/ticker/aapl")
            
            assert response.status_code == 200
            data = response.json()
            assert data["name"] == "Apple Inc."
            mock_details.assert_called_with("AAPL")


class TestSnapshotEndpoint:
    """Tests for GET /api/snapshot/{symbol} endpoint."""
    
    def test_fetches_price_snapshot(self, client):
        with patch('backend.main.data_provider.get_daily_snapshot') as mock_snapshot:
            mock_snapshot.return_value = {
                "symbol": "GOOG",
                "current_price": 175.50,
                "previous_close": 173.00,
                "change": 2.50,
                "change_pct": 1.45
            }
            
            response = client.get("/api/snapshot/goog")
            
            assert response.status_code == 200
            data = response.json()
            assert data["current_price"] == 175.50
            assert data["change_pct"] == 1.45


class TestNewsEndpoint:
    """Tests for GET /api/news/{symbol} endpoint."""
    
    def test_fetches_news_headlines(self, client):
        with patch('backend.main.news_provider.get_news') as mock_news:
            # news_provider.get_news returns just the headlines list
            mock_news.return_value = [
                {"headline": "Tesla announces new model", "providerCode": "BZ"}
            ]
            
            response = client.get("/api/news/tsla")
            
            assert response.status_code == 200
            data = response.json()
            assert len(data["headlines"]) == 1
            mock_news.assert_called_with("TSLA", 15)  # Default limit
    
    def test_accepts_limit_parameter(self, client):
        with patch('backend.main.news_provider.get_news') as mock_news:
            mock_news.return_value = []  # Empty headlines list
            
            client.get("/api/news/aapl?limit=30")
            
            mock_news.assert_called_with("AAPL", 30)


class TestNewsArticleEndpoint:
    """Tests for GET /api/news/article/{article_id} endpoint."""
    
    def test_fetches_article(self, client):
        with patch('backend.main.news_provider.get_news_article') as mock_article:
            mock_article.return_value = {
                "articleId": "123",
                "text": "Full article text..."
            }
            
            response = client.get("/api/news/article/123")
            
            assert response.status_code == 200
            mock_article.assert_called_with("123")
