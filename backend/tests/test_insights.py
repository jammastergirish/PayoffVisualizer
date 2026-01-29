
import pytest
from unittest.mock import MagicMock, patch
from backend.providers import massive, alpaca, ibkr
from backend.main import get_analyst_insights

# ==========================================
# Massive Provider Tests
# ==========================================

@patch('backend.providers.massive._client')
def test_massive_insights_fetching(mock_client):
    """Verify Massive provider correctly fetches and normalizes insights."""
    # Setup mock iterator response
    mock_insight = MagicMock()
    mock_insight.firm = "Firm A"
    mock_insight.rating_action = "Upgrade"
    mock_insight.rating = "Buy"
    mock_insight.price_target = 150.0
    mock_insight.date = "2026-01-29"
    mock_insight.insight = "Good stock"
    mock_insight.company_name = "Company A"
    
    mock_client.list_benzinga_analyst_insights.return_value = [mock_insight]

    # Execute
    result = massive.get_analyst_insights("AAPL", limit=5)

    # Verify
    assert len(result) == 1
    assert result[0]['firm'] == "Firm A"
    assert result[0]['rating'] == "Buy"
    assert result[0]['price_target'] == 150.0
    
    # Verify call args
    mock_client.list_benzinga_analyst_insights.assert_called_once_with(
        ticker="AAPL",
        limit=5,
        sort="date.desc"
    )

@patch('backend.providers.massive._client', None)
def test_massive_insights_no_client():
    """Verify empty list returned if client not initialized."""
    result = massive.get_analyst_insights("AAPL")
    assert result == []

# ==========================================
# Other Providers Tests
# ==========================================

def test_alpaca_insights_empty():
    """Verify Alpaca provider returns empty list."""
    provider = alpaca.AlpacaProvider()
    assert provider.get_analyst_insights("AAPL") == []

@patch('backend.providers.ibkr.ib_client')
def test_ibkr_insights_empty(mock_ib):
    """Verify IBKR provider returns empty list."""
    provider = ibkr.IBKRProvider()
    assert provider.get_analyst_insights("AAPL") == []

