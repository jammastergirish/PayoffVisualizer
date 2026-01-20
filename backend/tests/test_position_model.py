"""
Tests for Position model focusing on new fields.

Tests added for commit a13a8514ba23c5cce37453876051770ce3e8bcaf:
- Tests for the new daily_pnl field
- Tests for the new account field
- Tests for to_dict() method behavior with new fields
"""

import pytest
from backend.common.models import Position


def test_position_with_daily_pnl_and_account():
    """Test Position creation with daily_pnl and account fields."""
    position = Position(
        ticker='AAPL',
        position_type='stock',
        qty=100,
        account='DU123456',
        cost_basis=15000.0,
        unrealized_pnl=500.0,
        daily_pnl=75.0,
        current_price=155.0
    )

    assert position.ticker == 'AAPL'
    assert position.position_type == 'stock'
    assert position.qty == 100
    assert position.account == 'DU123456'
    assert position.daily_pnl == 75.0
    assert position.unrealized_pnl == 500.0


def test_position_default_values():
    """Test Position default values for new optional fields."""
    position = Position(
        ticker='GOOGL',
        position_type='stock',
        qty=50
    )

    # Check defaults
    assert position.account is None
    assert position.daily_pnl == 0.0
    assert position.unrealized_pnl == 0.0
    assert position.cost_basis == 0.0


def test_position_to_dict_includes_new_fields():
    """Test that to_dict() includes daily_pnl and account when set."""
    position = Position(
        ticker='MSFT',
        position_type='stock',
        qty=75,
        account='DU789012',
        cost_basis=30000.0,
        unrealized_pnl=1500.0,
        daily_pnl=125.0,
        current_price=420.0
    )

    pos_dict = position.to_dict()

    # Verify new fields are included
    assert 'account' in pos_dict
    assert pos_dict['account'] == 'DU789012'
    assert 'daily_pnl' in pos_dict
    assert pos_dict['daily_pnl'] == 125.0

    # Verify existing fields still work
    assert pos_dict['ticker'] == 'MSFT'
    assert pos_dict['unrealized_pnl'] == 1500.0


def test_position_to_dict_excludes_none_values():
    """Test that to_dict() excludes None values including new fields."""
    position = Position(
        ticker='NVDA',
        position_type='stock',
        qty=25,
        account=None,  # Explicitly None
        daily_pnl=0.0,  # Zero should be included
        unrealized_pnl=None  # None should be excluded
    )

    pos_dict = position.to_dict()

    # None values should be excluded
    assert 'account' not in pos_dict
    assert 'unrealized_pnl' not in pos_dict

    # Zero values should be included
    assert 'daily_pnl' in pos_dict
    assert pos_dict['daily_pnl'] == 0.0


def test_option_position_with_all_fields():
    """Test option Position with all fields including new ones."""
    position = Position(
        ticker='SPY',
        position_type='call',
        qty=10,
        account='DU345678',
        strike=450.0,
        expiry='2026-02-20',
        dte=30,
        cost_basis=2500.0,
        unrealized_pnl=300.0,
        daily_pnl=-50.0,
        current_price=2.8,
        underlying_price=448.0,
        delta=0.45,
        gamma=0.02,
        theta=-0.08,
        vega=0.15,
        iv=0.18
    )

    # Verify all fields
    assert position.account == 'DU345678'
    assert position.daily_pnl == -50.0
    assert position.strike == 450.0
    assert position.delta == 0.45

    # Check to_dict includes everything
    pos_dict = position.to_dict()
    assert pos_dict['account'] == 'DU345678'
    assert pos_dict['daily_pnl'] == -50.0
    assert pos_dict['strike'] == 450.0
    assert pos_dict['delta'] == 0.45


def test_negative_daily_pnl():
    """Test that negative daily_pnl values are handled correctly."""
    position = Position(
        ticker='TSLA',
        position_type='stock',
        qty=10,
        account='DU999999',
        daily_pnl=-125.50,
        unrealized_pnl=-250.0,
        cost_basis=2100.0,
        current_price=185.0
    )

    assert position.daily_pnl == -125.50
    assert position.unrealized_pnl == -250.0

    pos_dict = position.to_dict()
    assert pos_dict['daily_pnl'] == -125.50
    assert pos_dict['unrealized_pnl'] == -250.0


def test_position_fields_are_optional():
    """Test that new fields don't break minimal Position creation."""
    # Minimal position - only required fields
    position = Position(
        ticker='QQQ',
        position_type='stock',
        qty=50
    )

    # Should create successfully with defaults
    assert position is not None
    assert position.ticker == 'QQQ'
    assert position.position_type == 'stock'
    assert position.qty == 50

    # Optional fields should have proper defaults
    assert position.account is None
    assert position.daily_pnl == 0.0
    assert position.strike is None
    assert position.expiry is None


def test_multiple_positions_different_accounts():
    """Test creating multiple positions with different accounts."""
    positions = [
        Position(
            ticker='AAPL',
            position_type='stock',
            qty=100,
            account='Account1',
            daily_pnl=50.0
        ),
        Position(
            ticker='AAPL',
            position_type='stock',
            qty=200,
            account='Account2',
            daily_pnl=100.0
        ),
        Position(
            ticker='AAPL',
            position_type='stock',
            qty=150,
            account=None,  # No account specified
            daily_pnl=75.0
        )
    ]

    # Verify each position maintains its own account
    assert positions[0].account == 'Account1'
    assert positions[0].daily_pnl == 50.0

    assert positions[1].account == 'Account2'
    assert positions[1].daily_pnl == 100.0

    assert positions[2].account is None
    assert positions[2].daily_pnl == 75.0


def test_position_equality_not_affected_by_new_fields():
    """Test that Position instances with same ticker but different accounts are distinct."""
    pos1 = Position(
        ticker='SPY',
        position_type='stock',
        qty=100,
        account='ACC1',
        daily_pnl=10.0
    )

    pos2 = Position(
        ticker='SPY',
        position_type='stock',
        qty=100,
        account='ACC2',
        daily_pnl=10.0
    )

    # They should be different objects
    assert pos1 is not pos2

    # But have different account values
    assert pos1.account != pos2.account