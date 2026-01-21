"""Alpaca broker implementation using alpaca-py SDK.

This broker uses Alpaca Markets Trading API for:
- Account positions and P&L
- Stock and options order placement
- Paper trading support

Requirements:
- ALPACA_API_KEY and ALPACA_API_SECRET in .env
- ALPACA_PAPER=true for paper trading (default)
- alpaca-py package installed

Benefits:
- No desktop app required (pure API)
- Free paper trading
- Commission-free trading
"""

import os
from datetime import datetime
from typing import List, Dict, Any, Optional

from .base import BrokerInterface
from ..common.models import Position, AccountSummary, TradeOrder, OptionOrder, Order
from ..common.utils import safe_float, safe_int

# Lazy client initialization
_trading_client = None


def _get_trading_client():
    """Get or create TradingClient."""
    global _trading_client
    if _trading_client is None:
        try:
            from alpaca.trading.client import TradingClient
            api_key = os.getenv("ALPACA_API_KEY")
            api_secret = os.getenv("ALPACA_API_SECRET")
            paper = os.getenv("ALPACA_PAPER", "true").lower() == "true"
            if api_key and api_secret:
                _trading_client = TradingClient(api_key, api_secret, paper=paper)
                print(f"INFO [Alpaca]: Trading client initialized (paper={paper})")
        except ImportError:
            print("WARNING [Alpaca]: alpaca-py not installed")
    return _trading_client


class AlpacaBroker(BrokerInterface):
    """Alpaca broker implementation.

    Provides trading functionality via Alpaca Markets API.
    Supports both paper and live trading.
    """

    def __init__(self):
        self._connected = False
        self._paper = os.getenv("ALPACA_PAPER", "true").lower() == "true"

    async def connect(self) -> bool:
        """Connect to Alpaca API (verify credentials)."""
        client = _get_trading_client()
        if client:
            try:
                # Verify connection by getting account
                account = client.get_account()
                self._connected = account is not None
                print(f"INFO [Alpaca]: Connected to account {account.account_number}")
                return self._connected
            except Exception as e:
                print(f"ERROR [Alpaca]: Connection failed: {e}")
                self._connected = False
        return False

    def disconnect(self) -> None:
        """Disconnect from Alpaca (no-op for REST API)."""
        self._connected = False

    def is_connected(self) -> bool:
        """Check if connected to Alpaca."""
        client = _get_trading_client()
        if client:
            try:
                client.get_account()
                return True
            except Exception:
                return False
        return False

    def get_positions(self) -> List[Position]:
        """Get all current positions from Alpaca."""
        client = _get_trading_client()
        if not client:
            return []

        try:
            positions = client.get_all_positions()
            result = []

            for pos in positions:
                # Determine position type
                if hasattr(pos, 'asset_class') and pos.asset_class:
                    asset_class = pos.asset_class.value if hasattr(pos.asset_class, 'value') else str(pos.asset_class)
                else:
                    asset_class = 'us_equity'

                if 'option' in asset_class.lower():
                    # Parse option symbol to get details
                    # Alpaca option symbol format: AAPL240315C00150000
                    symbol = pos.symbol
                    position_type = 'call' if 'C' in symbol else 'put'
                    # Extract strike from symbol (last 8 chars / 1000)
                    try:
                        strike = float(symbol[-8:]) / 1000
                    except ValueError:
                        strike = 0.0
                    ticker = symbol[:4].rstrip('0123456789')  # Get underlying ticker
                else:
                    position_type = 'stock'
                    ticker = pos.symbol
                    strike = None

                position = Position(
                    ticker=ticker,
                    position_type=position_type,
                    qty=safe_float(pos.qty),
                    strike=strike,
                    expiry=None,  # Would need to parse from option symbol
                    cost_basis=safe_float(pos.cost_basis),
                    unrealized_pnl=safe_float(pos.unrealized_pl),
                    daily_pnl=safe_float(pos.unrealized_intraday_pl),
                    current_price=safe_float(pos.current_price),
                )
                result.append(position)

            print(f"DEBUG [Alpaca]: Retrieved {len(result)} positions")
            return result

        except Exception as e:
            print(f"ERROR [Alpaca]: Failed to get positions: {e}")
            return []

    def get_account_summary(self) -> Dict[str, AccountSummary]:
        """Get account summary from Alpaca."""
        client = _get_trading_client()
        if not client:
            return {}

        try:
            account = client.get_account()

            summary = AccountSummary(
                account=account.account_number,
                net_liquidation=safe_float(account.equity),
                total_cash=safe_float(account.cash),
                buying_power=safe_float(account.buying_power),
                unrealized_pnl=safe_float(account.unrealized_pl) if hasattr(account, 'unrealized_pl') else 0.0,
                realized_pnl=0.0,  # Not directly available
                daily_pnl=safe_float(account.equity) - safe_float(account.last_equity) if hasattr(account, 'last_equity') else 0.0,
            )

            return {account.account_number: summary}

        except Exception as e:
            print(f"ERROR [Alpaca]: Failed to get account summary: {e}")
            return {}

    def get_orders(self) -> List[Order]:
        """Get all orders from Alpaca."""
        client = _get_trading_client()
        if not client:
            return []

        try:
            from alpaca.trading.requests import GetOrdersRequest
            from alpaca.trading.enums import QueryOrderStatus

            request_params = GetOrdersRequest(
                status=QueryOrderStatus.ALL,
                limit=100, # Adjust as needed
                nested=True # Return nested multi-leg orders?
            )

            alpaca_orders = client.get_orders(filter=request_params)
            
            result = []
            for ao in alpaca_orders:
                # Map status
                status_map = {
                    'new': 'Submitted',
                    'partially_filled': 'Working',
                    'filled': 'Filled',
                    'done_for_day': 'Working',
                    'canceled': 'Cancelled',
                    'expired': 'Cancelled',
                    'replaced': 'Cancelled', # Or Submitted?
                    'pending_cancel': 'Pending',
                    'pending_replace': 'Pending',
                    'accepted': 'Submitted',
                    'pending_new': 'Pending',
                    'accepted_for_bidding': 'Submitted',
                    'stopped': 'Cancelled',
                    'rejected': 'Cancelled',
                    'suspended': 'Cancelled',
                    'calculated': 'Working'
                }
                
                common_status = status_map.get(ao.status.value if hasattr(ao.status, 'value') else str(ao.status), 'Submitted') # type: ignore

                result.append(Order(
                    order_id=str(ao.id),
                    symbol=ao.symbol,
                    action=ao.side.value.upper() if hasattr(ao.side, 'value') else str(ao.side).upper(), # type: ignore
                    quantity=safe_float(ao.qty), # type: ignore
                    order_type=ao.type.value.upper() if hasattr(ao.type, 'value') else str(ao.type).upper(), # type: ignore
                    status=common_status, # type: ignore
                    limit_price=safe_float(ao.limit_price),
                    filled_quantity=safe_float(ao.filled_qty),
                    average_fill_price=safe_float(ao.filled_avg_price),
                    time_placed=ao.created_at.isoformat() if ao.created_at else None,
                    account=None # Alpaca usually single account per key
                ))
            
            print(f"DEBUG [Alpaca]: Retrieved {len(result)} orders")
            return result

        except Exception as e:
            print(f"ERROR [Alpaca]: Failed to get orders: {e}")
            return []

    def place_stock_order(self, order: TradeOrder) -> Dict[str, Any]:
        """Place a stock order through Alpaca."""
        client = _get_trading_client()
        if not client:
            return {"success": False, "error": "Alpaca client not available"}

        try:
            from alpaca.trading.requests import MarketOrderRequest, LimitOrderRequest
            from alpaca.trading.enums import OrderSide, TimeInForce

            side = OrderSide.BUY if order.action.upper() == "BUY" else OrderSide.SELL

            if order.order_type.upper() == "MARKET":
                request = MarketOrderRequest(
                    symbol=order.symbol.upper(),
                    qty=order.quantity,
                    side=side,
                    time_in_force=TimeInForce.DAY
                )
            else:
                if order.limit_price is None:
                    return {"success": False, "error": "Limit price required for LIMIT orders"}
                request = LimitOrderRequest(
                    symbol=order.symbol.upper(),
                    qty=order.quantity,
                    side=side,
                    time_in_force=TimeInForce.DAY,
                    limit_price=order.limit_price
                )

            result = client.submit_order(request)

            return {
                "success": True,
                "order_id": result.id,
                "message": f"Order placed: {order.action} {order.quantity} {order.symbol}",
                "status": result.status.value if result.status else "submitted"
            }

        except Exception as e:
            print(f"ERROR [Alpaca]: Failed to place stock order: {e}")
            return {"success": False, "error": str(e)}

    def place_option_order(self, order: OptionOrder) -> Dict[str, Any]:
        """Place an option order through Alpaca."""
        client = _get_trading_client()
        if not client:
            return {"success": False, "error": "Alpaca client not available"}

        try:
            from alpaca.trading.requests import MarketOrderRequest, LimitOrderRequest
            from alpaca.trading.enums import OrderSide, TimeInForce

            # Build option symbol
            # Format: SYMBOL + YYMMDD + C/P + strike (8 digits, strike * 1000)
            expiry = order.expiry.replace("-", "")  # YYYYMMDD
            if len(expiry) == 8:
                expiry = expiry[2:]  # YYMMDD
            right = 'C' if order.right.upper() in ['C', 'CALL'] else 'P'
            strike_str = f"{int(order.strike * 1000):08d}"
            option_symbol = f"{order.symbol.upper()}{expiry}{right}{strike_str}"

            side = OrderSide.BUY if order.action.upper() == "BUY" else OrderSide.SELL

            if order.order_type.upper() == "MARKET":
                request = MarketOrderRequest(
                    symbol=option_symbol,
                    qty=order.quantity,
                    side=side,
                    time_in_force=TimeInForce.DAY
                )
            else:
                if order.limit_price is None:
                    return {"success": False, "error": "Limit price required for LIMIT orders"}
                request = LimitOrderRequest(
                    symbol=option_symbol,
                    qty=order.quantity,
                    side=side,
                    time_in_force=TimeInForce.DAY,
                    limit_price=order.limit_price
                )

            result = client.submit_order(request)

            return {
                "success": True,
                "order_id": result.id,
                "message": f"Option order placed: {order.action} {order.quantity} {option_symbol}",
                "status": result.status.value if result.status else "submitted"
            }

        except Exception as e:
            print(f"ERROR [Alpaca]: Failed to place option order: {e}")
            return {"success": False, "error": str(e)}

    def get_option_chain(self, symbol: str, max_strikes: int = 30) -> Dict[str, Any]:
        """Get options chain for a symbol."""
        # Delegate to provider's get_options_chain
        from ..providers.alpaca import get_options_chain
        return get_options_chain(symbol, max_strikes)

    def place_multileg_option_order(self, legs: List[Dict[str, Any]], order_type: str = "MARKET", limit_price: Optional[float] = None) -> Dict[str, Any]:
        """Place a multi-leg options order through Alpaca."""
        # Alpaca API supports multi-leg orders using the submit_order endpoint with `legs` parameter
        # However, the SDK might not expose this cleanly or it might be a newer feature
        # For now, we'll try to submit legs individually if possible, or fail if atomic execution is required
        
        # NOTE: Alpaca options API is relatively new. Multi-leg support might vary.
        # Check if we can just loop through legs for now as a naive implementation
        
        results = []
        errors = []
        
        for leg in legs:
             # Convert dict leg to simple object for our helper or call helper directly?
             # helper place_option_order takes OptionOrder object.
             # Let's verify what place_option_order needs.
             
             try:
                 # Construct OptionOrder from leg dict
                 # leg dict keys: symbol, expiry, strike, right, action, quantity
                 from ..common.models import OptionOrder
                 
                 order = OptionOrder(
                     symbol=leg["symbol"],
                     expiry=leg["expiry"],
                     strike=leg["strike"],
                     right=leg["right"],
                     action=leg["action"],
                     quantity=leg["quantity"],
                     order_type=order_type,
                     limit_price=limit_price # Note: limit price for combo is usually net price, here we applying to leg? 
                     # If limit_price is Net Debit/Credit, we can't apply it to individual legs easily without calculation.
                     # For now, let's return error if it's a multi-leg limit order without advanced handling
                 )
                 
                 if len(legs) > 1 and order_type == "LIMIT":
                     return {"success": False, "error": "Multi-leg LIMIT orders not yet supported for Alpaca broker adapter"}
                 
                 res = self.place_option_order(order)
                 if res.get("success"):
                     results.append(res)
                 else:
                     errors.append(res.get("error"))
             except Exception as e:
                 errors.append(str(e))
        
        if errors:
             return {"success": False, "error": f"Errors placing legs: {', '.join(errors)}", "partial_results": results}
             
        return {"success": True, "message": f"Placed {len(results)} legs", "legs": results}
    
    def subscribe_to_market_data(self, symbol: str) -> bool:
        """Subscribe to live market data (not implemented for REST API)."""
        # Alpaca streaming would require WebSocket implementation
        return False

    def get_market_price(self, symbol: str) -> Optional[float]:
        """Get current market price for a symbol."""
        from ..providers.alpaca import get_daily_snapshot
        snapshot = get_daily_snapshot(symbol)
        return snapshot.get("current_price")
