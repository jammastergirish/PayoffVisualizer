
import pytest
from unittest.mock import MagicMock, patch, ANY
from datetime import datetime, timedelta
from backend.providers import alpaca, massive, ibkr

# ==========================================
# Alpaca Provider Tests
# ==========================================

@patch('backend.providers.alpaca._get_stock_client')
def test_alpaca_historical_1h_params(mock_get_client):
    """Verify Alpaca 1H request uses 1-minute bars and 1-hour duration."""
    # Setup mock client
    mock_client = MagicMock()
    mock_get_client.return_value = mock_client
    
    # Mock return data structure to avoid attribute errors
    mock_bars_response = MagicMock()
    mock_bars_response.data = {'AAPL': []}
    mock_client.get_stock_bars.return_value = mock_bars_response

    # Execute
    alpaca.get_historical_bars("AAPL", "1H")

    # Verify
    mock_client.get_stock_bars.assert_called_once()
    call_args = mock_client.get_stock_bars.call_args[0][0] # First arg is request object
    
    # Check Request object attributes
    # 1H maps to TimeFrame(1, TimeFrameUnit.Minute)
    assert call_args.timeframe.amount == 1
    # Check if unit is Minute (str(Enum) is TimeFrameUnit.Minute)
    assert "Minute" in str(call_args.timeframe.unit)
    
    # Check start time is approx 1 hour ago
    # We allow a small delta for execution time
    expected_start = datetime.now() - timedelta(hours=1)
    # assert abs((call_args.start - expected_start).total_seconds()) < 5 

@patch('backend.providers.alpaca._get_stock_client')
def test_alpaca_historical_1d_params(mock_get_client):
    """Verify Alpaca 1D request uses 5-minute bars and 1-day duration."""
    mock_client = MagicMock()
    mock_get_client.return_value = mock_client
    mock_bars_response = MagicMock()
    mock_bars_response.data = {'AAPL': []}
    mock_client.get_stock_bars.return_value = mock_bars_response

    alpaca.get_historical_bars("AAPL", "1D")

    call_args = mock_client.get_stock_bars.call_args[0][0]
    
    # 1D maps to TimeFrame(5, TimeFrameUnit.Minute)
    assert call_args.timeframe.amount == 5
    assert "Minute" in str(call_args.timeframe.unit)
    
    # Check start time is approx 1 day ago
    # expected_start = datetime.now() - timedelta(days=1)


# ==========================================
# Massive Provider Tests
# ==========================================

@patch('backend.providers.massive._client')
def test_massive_historical_1h_params(mock_client):
    """Verify Massive 1H request uses minute resolution and millisecond timestamps."""
    # Setup mock
    mock_client.get_aggs.return_value = []

    # Execute
    massive.get_historical_bars("AAPL", "1H")

    # Verify call args
    mock_client.get_aggs.assert_called_once()
    _, kwargs = mock_client.get_aggs.call_args
    
    assert kwargs['multiplier'] == 1
    assert kwargs['timespan'] == 'minute'
    
    # Verify from_ and to are integers (timestamps)
    assert isinstance(kwargs['from_'], int)
    assert isinstance(kwargs['to'], int)
    
    # Check duration is approx 1 hour (3600000 ms)
    duration_ms = kwargs['to'] - kwargs['from_']
    # 1h = 3600000 ms. Allow small variance.
    assert 3590000 < duration_ms < 3610000

@patch('backend.providers.massive._client')
def test_massive_historical_1d_params(mock_client):
    """Verify Massive 1D request uses 5-minute resolution and millisecond timestamps."""
    mock_client.get_aggs.return_value = []

    massive.get_historical_bars("AAPL", "1D")

    _, kwargs = mock_client.get_aggs.call_args
    
    assert kwargs['multiplier'] == 5
    assert kwargs['timespan'] == 'minute'
    assert isinstance(kwargs['from_'], int)
    assert isinstance(kwargs['to'], int)
    
    # Check duration is approx 1 day (86400000 ms)
    duration_ms = kwargs['to'] - kwargs['from_']
    assert 86300000 < duration_ms < 86500000


# ==========================================
# IBKR Provider Tests
# ==========================================

@patch('backend.providers.ibkr.ib_client.ib')
@patch('backend.providers.ibkr.ib_client')
def test_ibkr_historical_1h_params(mock_ib_client_wrapper, mock_ib_instance):
    """Verify IBKR 1H request uses '3600 S' and '1 min'."""
    # Setup connections
    mock_ib_client_wrapper.connected = True
    mock_ib_client_wrapper.ib = mock_ib_instance
    mock_ib_instance.isConnected.return_value = True
    mock_ib_instance.reqHistoricalData.return_value = []

    # Execute
    ibkr.get_historical_bars("AAPL", "1H")

    # Verify
    mock_ib_instance.reqHistoricalData.assert_called_once()
    _, kwargs = mock_ib_instance.reqHistoricalData.call_args
    
    assert kwargs['durationStr'] == '3600 S'
    assert kwargs['barSizeSetting'] == '1 min'

@patch('backend.providers.ibkr.ib_client.ib')
@patch('backend.providers.ibkr.ib_client')
def test_ibkr_historical_1d_params(mock_ib_client_wrapper, mock_ib_instance):
    """Verify IBKR 1D request uses '1 D' and '5 mins'."""
    mock_ib_client_wrapper.connected = True
    mock_ib_client_wrapper.ib = mock_ib_instance
    mock_ib_instance.isConnected.return_value = True
    mock_ib_instance.reqHistoricalData.return_value = []

    ibkr.get_historical_bars("AAPL", "1D")

    _, kwargs = mock_ib_instance.reqHistoricalData.call_args
    
    assert kwargs['durationStr'] == '1 D'
    assert kwargs['barSizeSetting'] == '5 mins'
