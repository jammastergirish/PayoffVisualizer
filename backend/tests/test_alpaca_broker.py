"""
Tests for AlpacaBroker focusing on P&L fields.

Tests added for commit a13a8514ba23c5cce37453876051770ce3e8bcaf:
- Ensures daily_pnl field is properly populated from Alpaca API
"""

import pytest
from unittest.mock import MagicMock, patch
from backend.brokers.alpaca import AlpacaBroker
from backend.common.models import Position


class MockAlpacaPosition:
    """Mock Alpaca position object."""
    def __init__(self, symbol='AAPL', qty=100, cost_basis=15000.0,
                 unrealized_pl=500.0, unrealized_intraday_pl=50.0,
                 current_price=155.0, asset_class='us_equity'):
        self.symbol = symbol
        self.qty = qty
        self.cost_basis = cost_basis
        self.unrealized_pl = unrealized_pl
        self.unrealized_intraday_pl = unrealized_intraday_pl
        self.current_price = current_price
        self.asset_class = asset_class


@pytest.fixture
def mock_trading_client():
    """Create a mock Alpaca TradingClient."""
    with patch('backend.brokers.alpaca._get_trading_client') as mock_get_client:
        client = MagicMock()
        mock_get_client.return_value = client
        yield client


@pytest.fixture
def alpaca_broker(mock_trading_client):
    """Create an AlpacaBroker instance with mocked client."""
    broker = AlpacaBroker()
    broker.connected = True
    return broker


def test_get_positions_includes_daily_pnl(alpaca_broker, mock_trading_client):
    """Test that get_positions properly includes daily_pnl from unrealized_intraday_pl."""
    # Setup mock positions
    mock_positions = [
        MockAlpacaPosition(
            symbol='AAPL',
            qty=100,
            cost_basis=15000.0,
            unrealized_pl=500.0,
            unrealized_intraday_pl=75.0,  # This should map to daily_pnl
            current_price=155.0
        ),
        MockAlpacaPosition(
            symbol='GOOGL',
            qty=50,
            cost_basis=7500.0,
            unrealized_pl=-200.0,
            unrealized_intraday_pl=-30.0,  # Negative daily P&L
            current_price=148.0
        )
    ]

    mock_trading_client.get_all_positions.return_value = mock_positions

    # Execute
    positions = alpaca_broker.get_positions()

    # Assert
    assert len(positions) == 2

    # Check AAPL position
    aapl_pos = positions[0]
    assert aapl_pos.ticker == 'AAPL'
    assert aapl_pos.daily_pnl == 75.0
    assert aapl_pos.unrealized_pnl == 500.0
    assert aapl_pos.cost_basis == 15000.0

    # Check GOOGL position
    googl_pos = positions[1]
    assert googl_pos.ticker == 'GOOGL'
    assert googl_pos.daily_pnl == -30.0
    assert googl_pos.unrealized_pnl == -200.0


def test_get_positions_handles_none_daily_pnl(alpaca_broker, mock_trading_client):
    """Test that get_positions handles None values for unrealized_intraday_pl."""
    # Create position with None intraday P&L
    mock_position = MockAlpacaPosition(
        symbol='TSLA',
        qty=10,
        cost_basis=2000.0,
        unrealized_pl=100.0,
        current_price=210.0
    )
    mock_position.unrealized_intraday_pl = None  # Explicitly set to None

    mock_trading_client.get_all_positions.return_value = [mock_position]

    # Execute
    positions = alpaca_broker.get_positions()

    # Assert
    assert len(positions) == 1
    tsla_pos = positions[0]
    assert tsla_pos.ticker == 'TSLA'
    assert tsla_pos.daily_pnl == 0.0  # Should default to 0.0 when None


def test_get_positions_handles_string_daily_pnl(alpaca_broker, mock_trading_client):
    """Test that get_positions handles string values for unrealized_intraday_pl."""
    # Create position with string intraday P&L (as might come from API)
    mock_position = MockAlpacaPosition(
        symbol='NVDA',
        qty=25,
        cost_basis=12500.0,
        unrealized_pl='1250.50',  # String value
        current_price=550.0
    )
    mock_position.unrealized_intraday_pl = '125.75'  # String value

    mock_trading_client.get_all_positions.return_value = [mock_position]

    # Execute
    positions = alpaca_broker.get_positions()

    # Assert
    assert len(positions) == 1
    nvda_pos = positions[0]
    assert nvda_pos.ticker == 'NVDA'
    assert nvda_pos.daily_pnl == 125.75  # Should be converted to float
    assert nvda_pos.unrealized_pnl == 1250.50  # Should be converted to float


def test_position_to_dict_includes_daily_pnl():
    """Test that Position.to_dict() includes daily_pnl when present."""
    position = Position(
        ticker='SPY',
        position_type='stock',
        qty=100,
        cost_basis=45000.0,
        unrealized_pnl=500.0,
        daily_pnl=150.0,
        current_price=455.0
    )

    pos_dict = position.to_dict()

    assert 'daily_pnl' in pos_dict
    assert pos_dict['daily_pnl'] == 150.0
    assert pos_dict['unrealized_pnl'] == 500.0


def test_position_to_dict_excludes_none_daily_pnl():
    """Test that Position.to_dict() excludes daily_pnl when None."""
    position = Position(
        ticker='QQQ',
        position_type='stock',
        qty=50,
        cost_basis=20000.0,
        unrealized_pnl=300.0,
        daily_pnl=None,  # Explicitly None
        current_price=406.0
    )

    pos_dict = position.to_dict()

    # Should not include None values
    assert 'daily_pnl' not in pos_dict
    assert 'unrealized_pnl' in pos_dict
    assert pos_dict['unrealized_pnl'] == 300.0