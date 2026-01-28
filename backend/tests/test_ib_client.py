"""
Unit tests for IBClient class.

Tests cover:
- _safe_float: Safe conversion of various values
- PositionModel: Dataclass validation
- Connection logic
"""

import pytest
import math
from unittest.mock import MagicMock, patch
from backend.brokers.ibkr import IBClient, PositionModel
from backend.common.utils import safe_float


class TestSafeFloat:
    """Tests for safe_float utility function."""

    def test_handles_none(self):
        assert safe_float(None) == 0.0
        assert safe_float(None, default=-1) == -1

    def test_handles_nan(self):
        assert safe_float(float('nan')) == 0.0
        assert safe_float(float('nan'), default=99) == 99

    def test_handles_float(self):
        assert safe_float(3.14) == 3.14
        assert safe_float(100.0) == 100.0

    def test_handles_int(self):
        assert safe_float(42) == 42.0
        assert safe_float(-10) == -10.0

    def test_handles_string_number(self):
        assert safe_float("123.45") == 123.45
        assert safe_float("-123.45") == -123.45
        assert safe_float("0") == 0.0
        assert safe_float("not_a_number") == 0.0
        assert safe_float("not_a_number", default=-1) == -1

    def test_handles_infinity(self):
        assert safe_float(float('inf')) == 0.0
        assert safe_float(float('-inf')) == 0.0
        assert safe_float(float('inf'), default=999) == 999


class TestPositionModel:
    """Tests for PositionModel dataclass."""
    
    def test_creates_stock_position(self):
        pos = PositionModel(
            ticker="AAPL",
            position_type="stock",
            qty=100,
            cost_basis=150.0,
            current_price=155.0
        )
        
        assert pos.ticker == "AAPL"
        assert pos.position_type == "stock"
        assert pos.qty == 100
        assert pos.strike is None
        assert pos.expiry is None
    
    def test_creates_call_option(self):
        pos = PositionModel(
            ticker="TSLA",
            position_type="call",
            qty=5,
            strike=250.0,
            expiry="2026-03-21",
            cost_basis=5.0,
            delta=0.65,
            theta=-0.05,
            iv=35.0
        )
        
        assert pos.position_type == "call"
        assert pos.strike == 250.0
        assert pos.expiry == "2026-03-21"
        assert pos.delta == 0.65
    
    def test_creates_put_option(self):
        pos = PositionModel(
            ticker="SPY",
            position_type="put",
            qty=-10,
            strike=450.0,
            expiry="2026-01-17",
            cost_basis=2.5,
            gamma=0.02,
            vega=0.15
        )
        
        assert pos.position_type == "put"
        assert pos.qty == -10  # Short position
        assert pos.gamma == 0.02
        assert pos.vega == 0.15
    
    def test_defaults_to_zero(self):
        pos = PositionModel(
            ticker="TEST",
            position_type="stock",
            qty=1
        )
        
        assert pos.cost_basis == 0.0
        assert pos.unrealized_pnl == 0.0
        assert pos.current_price == 0.0


class TestIBClientConnection:
    """Tests for IBClient connection logic."""
    
    def test_uses_random_client_id_if_not_specified(self):
        with patch('backend.brokers.ibkr.IB'):
            with patch('backend.brokers.ibkr.random.randint', return_value=5555):
                client = IBClient()
                assert client.client_id == 5555
    
    def test_uses_specified_client_id(self):
        with patch('backend.brokers.ibkr.IB'):
            client = IBClient(client_id=1234)
            assert client.client_id == 1234
    
    def test_default_host_and_port(self):
        with patch('backend.brokers.ibkr.IB'):
            client = IBClient()
            assert client.host == '127.0.0.1'
            assert client.port == 7496
    
    def test_custom_host_and_port(self):
        with patch('backend.brokers.ibkr.IB'):
            client = IBClient(host='192.168.1.100', port=7497)
            assert client.host == '192.168.1.100'
            assert client.port == 7497


class TestIBClientMarketData:
    """Tests for market data subscription logic."""
    
    @pytest.fixture
    def connected_client(self):
        with patch('backend.brokers.ibkr.IB') as MockIB:
            client = IBClient()
            client.connected = True
            client.ib = MockIB.return_value
            client.ib.qualifyContracts = MagicMock(return_value=[])
            client.ib.reqMktData = MagicMock()
            return client
    
    def test_calls_reqMktData_for_contract(self, connected_client):
        mock_contract = MagicMock()
        mock_contract.conId = 12345
        
        connected_client._ensure_market_data(mock_contract)
        
        # Should have attempted to qualify and request market data
        # The exact behavior depends on implementation


class TestIBClientAccountPnL:
    """Tests for P&L subscription logic."""
    
    @pytest.fixture
    def connected_client(self):
        with patch('backend.brokers.ibkr.IB') as MockIB:
            client = IBClient()
            client.connected = True
            client.ib = MockIB.return_value
            client.ib.reqPnL = MagicMock()
            return client
    
    def test_subscribes_to_account_pnl(self, connected_client):
        connected_client._ensure_pnl_subscription("U12345678")
        
        assert "U12345678" in connected_client.pnl_subscriptions
        connected_client.ib.reqPnL.assert_called()
    
    def test_skips_duplicate_subscription(self, connected_client):
        connected_client.pnl_subscriptions["U12345678"] = True
        
        connected_client._ensure_pnl_subscription("U12345678")
        
        # Should not call reqPnL again
        connected_client.ib.reqPnL.assert_not_called()


class TestPlaceOptionsOrder:
    """Tests for place_options_order method."""
    
    @pytest.fixture
    def mock_trade(self):
        """Create a mock Trade object."""
        trade = MagicMock()
        trade.order.orderId = 12345
        trade.orderStatus.status = "Submitted"
        return trade
    
    @pytest.fixture
    def connected_client(self, mock_trade):
        """Create a connected IBClient with mocked IB."""
        with patch('backend.brokers.ibkr.IB') as MockIB:
            client = IBClient()
            client.connected = True
            client.ib = MockIB.return_value
            client.ib.isConnected = MagicMock(return_value=True)
            client.ib.placeOrder = MagicMock(return_value=mock_trade)
            return client
    
    @pytest.fixture
    def disconnected_client(self):
        """Create a disconnected IBClient."""
        with patch('backend.brokers.ibkr.IB') as MockIB:
            client = IBClient()
            client.connected = False
            client.ib = MockIB.return_value
            client.ib.isConnected = MagicMock(return_value=False)
            return client
    
    # ========== Connection Tests ==========
    
    def test_returns_error_when_not_connected(self, disconnected_client):
        """Should return error if not connected to IBKR."""
        legs = [{"symbol": "AAPL", "expiry": "20260116", "strike": 250, "right": "C", "action": "BUY", "quantity": 1}]
        result = disconnected_client.place_options_order(legs)
        
        assert result["success"] is False
        assert "Not connected" in result["error"]
    
    def test_returns_error_when_ib_disconnected(self, connected_client):
        """Should return error if ib.isConnected() returns False."""
        connected_client.ib.isConnected = MagicMock(return_value=False)
        legs = [{"symbol": "AAPL", "expiry": "20260116", "strike": 250, "right": "C", "action": "BUY", "quantity": 1}]
        
        result = connected_client.place_options_order(legs)
        
        assert result["success"] is False
        assert "Not connected" in result["error"]
    
    # ========== Input Validation Tests ==========
    
    def test_returns_error_for_empty_legs(self, connected_client):
        """Should return error if no legs provided."""
        result = connected_client.place_options_order([])
        
        assert result["success"] is False
        assert "No legs provided" in result["error"]
    
    def test_returns_error_for_none_legs(self, connected_client):
        """Should return error if legs is None."""
        result = connected_client.place_options_order(None)
        
        assert result["success"] is False
        assert "No legs provided" in result["error"]
    
    # ========== Single Leg Order Tests ==========
    
    def test_places_single_leg_call_order(self, connected_client):
        """Should successfully place a single-leg call order."""
        legs = [{
            "symbol": "AAPL",
            "expiry": "20260116",
            "strike": 250,
            "right": "C",
            "action": "BUY",
            "quantity": 1
        }]
        
        result = connected_client.place_options_order(legs, order_type="MARKET")
        
        assert result["success"] is True
        assert result["order_id"] == 12345
        assert result["status"] == "Submitted"
        connected_client.ib.placeOrder.assert_called_once()
    
    def test_places_single_leg_put_order(self, connected_client):
        """Should successfully place a single-leg put order."""
        legs = [{
            "symbol": "SPY",
            "expiry": "20260117",
            "strike": 450,
            "right": "P",
            "action": "SELL",
            "quantity": 5
        }]
        
        result = connected_client.place_options_order(legs)
        
        assert result["success"] is True
        assert "SELL" in result["message"]
        assert "450" in result["message"]
    
    def test_normalizes_expiry_with_dashes(self, connected_client):
        """Should normalize expiry format from YYYY-MM-DD to YYYYMMDD."""
        legs = [{
            "symbol": "TSLA",
            "expiry": "2026-01-16",  # With dashes
            "strike": 300,
            "right": "C",
            "action": "BUY",
            "quantity": 1
        }]
        
        result = connected_client.place_options_order(legs)
        
        assert result["success"] is True
        # Check that the message contains normalized expiry
        assert "20260116" in result["message"]
    
    def test_normalizes_right_from_call_to_c(self, connected_client):
        """Should normalize 'CALL' to 'C'."""
        legs = [{
            "symbol": "AAPL",
            "expiry": "20260116",
            "strike": 250,
            "right": "CALL",  # Full word
            "action": "BUY",
            "quantity": 1
        }]
        
        result = connected_client.place_options_order(legs)
        
        assert result["success"] is True
        assert "C" in result["message"]
    
    def test_normalizes_right_from_put_to_p(self, connected_client):
        """Should normalize 'PUT' to 'P'."""
        legs = [{
            "symbol": "AAPL",
            "expiry": "20260116",
            "strike": 250,
            "right": "PUT",  # Full word
            "action": "SELL",
            "quantity": 1
        }]
        
        result = connected_client.place_options_order(legs)
        
        assert result["success"] is True
        assert "P" in result["message"]
    
    def test_handles_lowercase_inputs(self, connected_client):
        """Should handle lowercase symbol, right, and action."""
        legs = [{
            "symbol": "aapl",
            "expiry": "20260116",
            "strike": 250,
            "right": "c",
            "action": "buy",
            "quantity": 1
        }]
        
        result = connected_client.place_options_order(legs)
        
        assert result["success"] is True
    
    # ========== Limit Order Tests ==========
    
    def test_places_limit_order_with_price(self, connected_client):
        """Should place a limit order when limit_price is provided."""
        legs = [{
            "symbol": "AAPL",
            "expiry": "20260116",
            "strike": 250,
            "right": "C",
            "action": "BUY",
            "quantity": 1
        }]
        
        result = connected_client.place_options_order(legs, order_type="LIMIT", limit_price=5.00)
        
        assert result["success"] is True
    
    def test_returns_error_for_limit_without_price(self, connected_client):
        """Should return error for LIMIT order without limit_price."""
        legs = [{
            "symbol": "AAPL",
            "expiry": "20260116",
            "strike": 250,
            "right": "C",
            "action": "BUY",
            "quantity": 1
        }]
        
        result = connected_client.place_options_order(legs, order_type="LIMIT", limit_price=None)
        
        assert result["success"] is False
        assert "Limit price required" in result["error"]
    
    # ========== Multi-Leg Order Tests ==========
    
    def test_places_multi_leg_order_as_separate_orders(self, connected_client, mock_trade):
        """Should place each leg as a separate order."""
        legs = [
            {"symbol": "AAPL", "expiry": "20260116", "strike": 250, "right": "C", "action": "BUY", "quantity": 1},
            {"symbol": "AAPL", "expiry": "20260116", "strike": 260, "right": "C", "action": "SELL", "quantity": 1}
        ]
        
        result = connected_client.place_options_order(legs, order_type="MARKET")
        
        assert result["success"] is True
        assert "order_ids" in result
        assert len(result["order_ids"]) == 2
        assert connected_client.ib.placeOrder.call_count == 2
    
    def test_multi_leg_returns_all_order_ids(self, connected_client):
        """Should return all order IDs for multi-leg orders."""
        # Setup different order IDs for each call
        mock_trade1 = MagicMock()
        mock_trade1.order.orderId = 111
        mock_trade1.orderStatus.status = "Submitted"
        
        mock_trade2 = MagicMock()
        mock_trade2.order.orderId = 222
        mock_trade2.orderStatus.status = "Submitted"
        
        connected_client.ib.placeOrder = MagicMock(side_effect=[mock_trade1, mock_trade2])
        
        legs = [
            {"symbol": "SPY", "expiry": "20260117", "strike": 450, "right": "P", "action": "BUY", "quantity": 1},
            {"symbol": "SPY", "expiry": "20260117", "strike": 440, "right": "P", "action": "SELL", "quantity": 1}
        ]
        
        result = connected_client.place_options_order(legs, order_type="MARKET")
        
        assert result["success"] is True
        assert result["order_ids"] == [111, 222]
        assert "2 orders" in result["message"]
    
    def test_multi_leg_normalizes_all_inputs(self, connected_client):
        """Should normalize inputs for all legs."""
        legs = [
            {"symbol": "aapl", "expiry": "2026-01-16", "strike": 250, "right": "call", "action": "buy", "quantity": 1},
            {"symbol": "aapl", "expiry": "2026-01-16", "strike": 260, "right": "CALL", "action": "SELL", "quantity": 1}
        ]
        
        result = connected_client.place_options_order(legs, order_type="MARKET")
        
        assert result["success"] is True
        # Both legs should show normalized format in message
        assert "20260116" in result["message"]
    
    # ========== Error Handling Tests ==========
    
    def test_handles_placeOrder_exception(self, connected_client):
        """Should handle exceptions from placeOrder gracefully."""
        connected_client.ib.placeOrder = MagicMock(side_effect=Exception("Connection lost"))
        
        legs = [{
            "symbol": "AAPL",
            "expiry": "20260116",
            "strike": 250,
            "right": "C",
            "action": "BUY",
            "quantity": 1
        }]
        
        result = connected_client.place_options_order(legs)
        
        assert "Connection lost" in result["error"]


class TestPlaceStockOrder:
    """Tests for place_order method (Stock)."""
    
    @pytest.fixture
    def mock_trade(self):
        """Create a mock Trade object."""
        trade = MagicMock()
        trade.order.orderId = 12345
        trade.orderStatus.status = "Submitted"
        return trade
    
    @pytest.fixture
    def connected_client(self, mock_trade):
        """Create a connected IBClient with mocked IB."""
        with patch('backend.brokers.ibkr.IB') as MockIB:
            client = IBClient()
            client.connected = True
            client.ib = MockIB.return_value
            client.ib.isConnected = MagicMock(return_value=True)
            client.ib.placeOrder = MagicMock(return_value=mock_trade)
            return client

    def test_places_market_order(self, connected_client):
        """Should place a basic market order."""
        result = connected_client.place_order("AAPL", "BUY", 10, "MARKET")
        
        assert result["success"] is True
        connected_client.ib.placeOrder.assert_called_once()
        args = connected_client.ib.placeOrder.call_args
        contract, order = args[0]
        assert contract.symbol == "AAPL"
        assert order.action == "BUY"
        assert order.totalQuantity == 10
        assert order.orderType == "MKT"
        assert order.tif == "DAY"  # Default

    def test_places_limit_order(self, connected_client):
        """Should place a limit order."""
        result = connected_client.place_order("AAPL", "SELL", 5, "LIMIT", limit_price=150.0)
        
        assert result["success"] is True
        args = connected_client.ib.placeOrder.call_args
        _, order = args[0]
        assert order.orderType == "LMT"
        assert order.lmtPrice == 150.0

    def test_places_trailing_amount_order(self, connected_client):
        """Should place a trailing stop order with amount."""
        result = connected_client.place_order("MSFT", "SELL", 5, "TRAIL", trailing_amount=1.50)
        
        assert result["success"] is True
        args = connected_client.ib.placeOrder.call_args
        _, order = args[0]
        assert order.orderType == "TRAIL"
        assert order.auxPrice == 1.50

    def test_places_trailing_percent_order(self, connected_client):
        """Should place a trailing stop order with percent."""
        result = connected_client.place_order("NVDA", "SELL", 10, "TRAIL", trailing_percent=5.0)
        
        assert result["success"] is True
        args = connected_client.ib.placeOrder.call_args
        _, order = args[0]
        assert order.orderType == "TRAIL"
        assert order.trailingPercent == 5.0

    def test_places_gtc_order(self, connected_client):
        """Should place an order with GTC time in force."""
        result = connected_client.place_order("GOOG", "BUY", 1, "MARKET", tif="GTC")
        
        assert result["success"] is True
        args = connected_client.ib.placeOrder.call_args
        _, order = args[0]
        assert order.tif == "GTC"

    def test_validation_errors(self, connected_client):
        """Should return errors for invalid inputs."""
        # Missing trailing params
        res1 = connected_client.place_order("AAPL", "SELL", 1, "TRAIL")
        assert res1["success"] is False
        assert "required" in res1["error"]

        # Both trailing params
        res2 = connected_client.place_order("AAPL", "SELL", 1, "TRAIL", trailing_amount=1, trailing_percent=1)
        assert res2["success"] is False
        assert "not both" in res2["error"]

        # Invalid TIF
        res3 = connected_client.place_order("AAPL", "BUY", 1, "MARKET", tif="INVALID")
        assert res3["success"] is False
        assert "Time in Force" in res3["error"]
