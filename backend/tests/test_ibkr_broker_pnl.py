"""
Tests for IBKRBroker focusing on P&L fields.

Tests added for commit a13a8514ba23c5cce37453876051770ce3e8bcaf:
- Ensures daily_pnl field is properly populated from IBKR positions
- Ensures account field is properly populated from IBKR positions
"""

import pytest
from unittest.mock import MagicMock, patch
from backend.brokers.ibkr import IBKRBroker
from backend.common.models import Position


@pytest.fixture
def mock_ibkr_client():
    """Create a mock IBKR client."""
    with patch('backend.brokers.ibkr.IBClient') as MockClient:
        client = MockClient.return_value
        client.connected = True
        yield client


@pytest.fixture
def ibkr_broker(mock_ibkr_client):
    """Create an IBKRBroker instance with mocked client."""
    broker = IBKRBroker()
    broker.client = mock_ibkr_client
    return broker


def test_get_positions_includes_daily_pnl_and_account(ibkr_broker, mock_ibkr_client):
    """Test that get_positions properly includes daily_pnl and account fields."""
    # Setup mock position data from IBClient
    mock_positions = {
        'positions': [
            {
                'ticker': 'AAPL',
                'position_type': 'stock',
                'qty': 100,
                'cost_basis': 15000.0,
                'unrealized_pnl': 500.0,
                'daily_pnl': 75.0,  # New field
                'account': 'DU123456',  # New field
                'current_price': 155.0
            },
            {
                'ticker': 'SPY',
                'position_type': 'call',
                'qty': 10,
                'strike': 450.0,
                'expiry': '2026-02-20',
                'cost_basis': 2500.0,
                'unrealized_pnl': 300.0,
                'daily_pnl': -50.0,  # Negative daily P&L
                'account': 'DU123456',
                'current_price': 2.8,
                'delta': 0.45
            }
        ],
        'account_summaries': {}
    }

    mock_ibkr_client.get_positions.return_value = mock_positions

    # Execute
    positions = ibkr_broker.get_positions()

    # Assert
    assert len(positions) == 2

    # Check AAPL stock position
    aapl_pos = positions[0]
    assert isinstance(aapl_pos, Position)
    assert aapl_pos.ticker == 'AAPL'
    assert aapl_pos.position_type == 'stock'
    assert aapl_pos.daily_pnl == 75.0
    assert aapl_pos.account == 'DU123456'
    assert aapl_pos.unrealized_pnl == 500.0

    # Check SPY call position
    spy_pos = positions[1]
    assert isinstance(spy_pos, Position)
    assert spy_pos.ticker == 'SPY'
    assert spy_pos.position_type == 'call'
    assert spy_pos.daily_pnl == -50.0
    assert spy_pos.account == 'DU123456'
    assert spy_pos.unrealized_pnl == 300.0
    assert spy_pos.strike == 450.0


def test_get_positions_handles_missing_daily_pnl(ibkr_broker, mock_ibkr_client):
    """Test that get_positions handles missing daily_pnl field gracefully."""
    # Setup mock position data without daily_pnl
    mock_positions = {
        'positions': [
            {
                'ticker': 'GOOGL',
                'position_type': 'stock',
                'qty': 50,
                'cost_basis': 7500.0,
                'unrealized_pnl': 200.0,
                # daily_pnl is missing
                'account': 'DU789012',
                'current_price': 154.0
            }
        ],
        'account_summaries': {}
    }

    mock_ibkr_client.get_positions.return_value = mock_positions

    # Execute
    positions = ibkr_broker.get_positions()

    # Assert
    assert len(positions) == 1
    googl_pos = positions[0]
    assert googl_pos.ticker == 'GOOGL'
    assert googl_pos.daily_pnl is None or googl_pos.daily_pnl == 0.0
    assert googl_pos.account == 'DU789012'


def test_get_positions_handles_missing_account(ibkr_broker, mock_ibkr_client):
    """Test that get_positions handles missing account field gracefully."""
    # Setup mock position data without account
    mock_positions = {
        'positions': [
            {
                'ticker': 'MSFT',
                'position_type': 'stock',
                'qty': 75,
                'cost_basis': 30000.0,
                'unrealized_pnl': 1500.0,
                'daily_pnl': 100.0,
                # account is missing
                'current_price': 420.0
            }
        ],
        'account_summaries': {}
    }

    mock_ibkr_client.get_positions.return_value = mock_positions

    # Execute
    positions = ibkr_broker.get_positions()

    # Assert
    assert len(positions) == 1
    msft_pos = positions[0]
    assert msft_pos.ticker == 'MSFT'
    assert msft_pos.daily_pnl == 100.0
    assert msft_pos.account is None


def test_get_positions_with_options_includes_all_fields(ibkr_broker, mock_ibkr_client):
    """Test that options positions include all new and existing fields."""
    # Setup mock option position
    mock_positions = {
        'positions': [
            {
                'ticker': 'QQQ',
                'position_type': 'put',
                'qty': 5,
                'strike': 390.0,
                'expiry': '2026-01-30',
                'dte': 10,
                'cost_basis': 1500.0,
                'unrealized_pnl': -200.0,
                'daily_pnl': -75.0,
                'account': 'DU345678',
                'current_price': 2.6,
                'underlying_price': 400.0,
                'delta': -0.35,
                'gamma': 0.02,
                'theta': -0.15,
                'vega': 0.25,
                'iv': 0.22
            }
        ],
        'account_summaries': {}
    }

    mock_ibkr_client.get_positions.return_value = mock_positions

    # Execute
    positions = ibkr_broker.get_positions()

    # Assert
    assert len(positions) == 1
    qqq_pos = positions[0]

    # Check all fields are properly set
    assert qqq_pos.ticker == 'QQQ'
    assert qqq_pos.position_type == 'put'
    assert qqq_pos.qty == 5
    assert qqq_pos.strike == 390.0
    assert qqq_pos.expiry == '2026-01-30'
    assert qqq_pos.dte == 10
    assert qqq_pos.daily_pnl == -75.0
    assert qqq_pos.account == 'DU345678'
    assert qqq_pos.unrealized_pnl == -200.0

    # Check Greeks are preserved
    assert qqq_pos.delta == -0.35
    assert qqq_pos.gamma == 0.02
    assert qqq_pos.theta == -0.15
    assert qqq_pos.vega == 0.25
    assert qqq_pos.iv == 0.22


def test_multiple_accounts_positions(ibkr_broker, mock_ibkr_client):
    """Test handling positions from multiple accounts."""
    # Setup mock positions from different accounts
    mock_positions = {
        'positions': [
            {
                'ticker': 'AAPL',
                'position_type': 'stock',
                'qty': 100,
                'account': 'DU111111',
                'daily_pnl': 50.0,
                'unrealized_pnl': 300.0,
                'cost_basis': 15000.0,
                'current_price': 153.0
            },
            {
                'ticker': 'AAPL',
                'position_type': 'stock',
                'qty': 200,
                'account': 'DU222222',
                'daily_pnl': 100.0,
                'unrealized_pnl': 600.0,
                'cost_basis': 30000.0,
                'current_price': 153.0
            }
        ],
        'account_summaries': {}
    }

    mock_ibkr_client.get_positions.return_value = mock_positions

    # Execute
    positions = ibkr_broker.get_positions()

    # Assert
    assert len(positions) == 2

    # Positions should have different accounts
    accounts = {pos.account for pos in positions}
    assert accounts == {'DU111111', 'DU222222'}

    # Check daily P&L is correctly associated with each account
    for pos in positions:
        if pos.account == 'DU111111':
            assert pos.daily_pnl == 50.0
            assert pos.qty == 100
        elif pos.account == 'DU222222':
            assert pos.daily_pnl == 100.0
            assert pos.qty == 200