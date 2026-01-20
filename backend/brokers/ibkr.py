"""Interactive Brokers implementation of BrokerInterface."""

import asyncio
import threading
from typing import Optional, List, Literal, Dict, Any
from dataclasses import dataclass
from datetime import datetime
from ib_insync import IB, Stock, Option, MarketOrder, LimitOrder, util
import math
import nest_asyncio
import random
from .base import BrokerInterface
from ..common.models import Position, AccountSummary, TradeOrder, OptionOrder
from ..common.utils import safe_float, safe_int, format_error_response, format_success_response, validate_symbol

# Apply nest_asyncio to allow nested loops if needed, though threading should isolate it
nest_asyncio.apply()

@dataclass
class PositionModel:
    ticker: str
    position_type: Literal['stock', 'call', 'put']
    qty: float
    strike: Optional[float] = None
    expiry: Optional[str] = None
    dte: Optional[int] = None
    cost_basis: Optional[float] = 0.0
    unrealized_pnl: Optional[float] = 0.0
    # Live Data
    current_price: Optional[float] = 0.0 # Underlying price for stocks, Mark for options
    underlying_price: Optional[float] = None
    # Greeks
    delta: Optional[float] = None
    gamma: Optional[float] = None
    theta: Optional[float] = None
    vega: Optional[float] = None
    iv: Optional[float] = None

class IBClient:
    def __init__(self, host='127.0.0.1', port=7496, client_id=None):
        self.host = host
        self.port = port
        self.client_id = client_id if client_id is not None else random.randint(1000, 9999)
        self.ib = IB()
        self.connected = False
        self._thread = None
        self._loop = None
        # Cache for live market data tickers
        self.market_data = {}
        self.subscribed_contracts = set()
        self.subscribed_symbols = set()
        self.subscribed_accounts = set()
        self.account_summary_cache = {} # Cache for live account summary data
        self._account_summary_req_id = 9001
        self._account_summary_group = "All"
        # NOTE: P&L tags (DayPnL, UnrealizedPnL, RealizedPnL) are NOT valid here!
        # P&L must be fetched via reqPnL() separately.
        self._account_summary_tags = (
            "AccountType,NetLiquidation,TotalCashValue,SettledCash,AccruedCash,"
            "BuyingPower,EquityWithLoanValue,PreviousDayEquityWithLoanValue,"
            "GrossPositionValue,RegTEquity,RegTMargin,SMA,InitMarginReq,"
            "MaintMarginReq,AvailableFunds,ExcessLiquidity,Cushion,"
            "FullInitMarginReq,FullMaintMarginReq,FullAvailableFunds,"
            "FullExcessLiquidity,LookAheadNextChange,LookAheadInitMarginReq,"
            "LookAheadMaintMarginReq,LookAheadAvailableFunds,"
            "LookAheadExcessLiquidity,HighestSeverity,DayTradesRemaining,"
            "DayTradesRemainingT+1,DayTradesRemainingT+2,DayTradesRemainingT+3,"
            "DayTradesRemainingT+4,Leverage,$LEDGER:ALL"
        )
        self._account_summary_started = False
        # P&L subscriptions - reqPnL returns live-updated PnL objects
        self.pnl_subscriptions = {}  # account -> PnL object
        self.prior_close_cache = {}  # conId -> prior close price (persists between polls)

    def start_loop(self):
        """Runs the IB event loop in a separate thread."""
        asyncio.set_event_loop(asyncio.new_event_loop())
        self._loop = asyncio.get_event_loop()
        try:
            self.ib.connect(self.host, self.port, self.client_id)
            self.connected = True
            print(f"Connected to IBKR on {self.host}:{self.port}")
            self.ib.run()
        except Exception as e:
            print(f"IBKR Connection failed: {e}")
            self.connected = False

    async def connect(self):
        """Starts the background thread."""
        if not self.connected:
            self._thread = threading.Thread(target=self.start_loop, daemon=True)
            self._thread.start()
            await asyncio.sleep(1)


    def _ensure_market_data(self, contract):
        """Subscribes to market data if not already subscribed."""
        if contract.conId not in self.subscribed_contracts:
            # Generic ticks: 104=Historical Vol, 106=Implied Vol, 221=Mark Price
            # These help populate greeks and pricing data
            self.ib.reqMktData(contract, '104,106,221', False, False)
            self.subscribed_contracts.add(contract.conId)
            # Give the event loop time to receive initial data
            self.ib.sleep(0.3)

            # Also subscribe to underlying for options to ensure we have underlying_price
            if contract.secType == 'OPT':
                if contract.symbol not in self.subscribed_symbols:
                    try:
                        u_contract = Stock(contract.symbol, 'SMART', 'USD')
                        self.ib.reqMktData(u_contract, '221', False, False)
                        self.subscribed_symbols.add(contract.symbol)
                        self.ib.sleep(0.2)
                    except:
                        pass

    def _ensure_account_summary(self):
        if not self.ib.isConnected():
            return
            
        # Start request if not started
        if not self._account_summary_started:
            try:
                print("DEBUG: Requesting Account Summary...")
                self.ib.client.reqAccountSummary(
                    self._account_summary_req_id,
                    self._account_summary_group,
                    self._account_summary_tags
                )
                self._account_summary_started = True
            except Exception as e:
                print(f"Error requesting account summary: {e}")
                
        # Wait for data to populate (especially NetLiquidation)
        # Give it up to 2 seconds to arrive
        for _ in range(20): 
            if self.ib.wrapper.acctSummary:
                # Check if we have NetLiquidation for any account
                # acctSummary is a dict keyed by (account, tag)
                values = self.ib.wrapper.acctSummary.values()
                if any(v.tag == 'NetLiquidation' for v in values):
                    # Data arrived!
                    return
            self.ib.sleep(0.1)
            
        print("WARNING: Account Summary data timed out or incomplete")

    def _ensure_pnl_subscription(self, account: str):
        """Subscribe to P&L updates for an account using reqPnL.

        This is the CORRECT way to get dailyPnL, unrealizedPnL, realizedPnL.
        reqAccountSummary does NOT support these tags despite what one might expect.
        """
        if not self.ib.isConnected():
            return None
        if account in self.pnl_subscriptions:
            return self.pnl_subscriptions[account]
        try:
            # reqPnL returns a live-updated PnL object with dailyPnL, unrealizedPnL, realizedPnL
            pnl = self.ib.reqPnL(account, '')
            self.pnl_subscriptions[account] = pnl
            print(f"DEBUG: Subscribed to P&L for account {account}")

            # Wait for P&L data to arrive (with timeout)
            # The subscription is async - IBKR sends data after a brief delay
            for _ in range(10):  # Try for up to 2 seconds
                self.ib.sleep(0.2)
                if not math.isnan(pnl.dailyPnL) if pnl.dailyPnL is not None else False:
                    print(f"DEBUG: P&L data received for {account}")
                    break

            return pnl
        except Exception as e:
            print(f"Error subscribing to P&L for {account}: {e}")
            return None

    def get_positions(self) -> List[dict]:
        if not self.connected:
            return []

        try:
            self._ensure_account_summary()
            positions = self.ib.positions()
            portfolio = self.ib.portfolio()
            print(f"DEBUG: Found {len(positions)} positions from IB")
            print(f"DEBUG: Found {len(portfolio)} portfolio items from IB")

            mapped_positions = []

            for pos in positions:
                contract = pos.contract

                # Check for nulls
                if not contract: continue

                # Fix for Error 321: Ensure Exchange and Currency are set
                # IBKR positions sometimes have empty exchange for options
                if not contract.exchange:
                    contract.exchange = 'SMART'
                if not contract.currency:
                    contract.currency = 'USD'

                # Subscribe to Account Updates to ensure portfolio() is populated
                if pos.account not in self.subscribed_accounts:
                    try:
                        print(f"Subscribing to Account Updates for {pos.account}")
                        # Use low-level client method to avoid blocking wait in ib_insync's IB.reqAccountUpdates
                        self.ib.client.reqAccountUpdates(True, pos.account)
                        self.subscribed_accounts.add(pos.account)
                    except Exception as e:
                        print(f"Error subscribing to account updates for {pos.account}: {e}")

            # Now process positions and portfolio items
            for pos in positions:
                contract = pos.contract

                # Ensure we are subscribed to live data
                self._ensure_market_data(contract)

                # Get latest ticker snapshot - may be None if subscription hasn't populated yet
                ticker = self.ib.ticker(contract)

                # Initialize defaults
                current_price = 0.0
                prior_close = 0.0
                delta, gamma, theta, vega, iv, und_price = 0.0, 0.0, 0.0, 0.0, 0.0, 0.0

                if ticker is not None:
                    print(f"DEBUG: Processing {contract.symbol} | SecType: {contract.secType}")
                    current_price = safe_float(ticker.marketPrice()) or safe_float(ticker.last) or safe_float(ticker.close) or 0.0
                    prior_close = safe_float(ticker.close)
                    # Cache prior_close ONCE - don't overwrite (IBKR sometimes returns current price as "close")
                    # Also only cache if it differs from current price (valid prior close should be different)
                    if prior_close > 0 and contract.conId not in self.prior_close_cache:
                        # Only cache if prior_close differs from current (by at least 0.1%)
                        if current_price > 0 and abs(prior_close - current_price) / current_price > 0.001:
                            self.prior_close_cache[contract.conId] = prior_close

                    # Greeks extraction
                    # IBKR provides Greeks in standard format:
                    # - Delta: change in option price per $1 move in underlying (already scaled per contract)
                    # - Gamma: change in delta per $1 move in underlying
                    # - Theta: daily time decay in dollars (negative for long positions)
                    # - Vega: change in option price per 1% change in IV
                    # - IV: Implied Volatility as decimal (0.30 = 30%)
                    if ticker.modelGreeks:
                        delta = safe_float(ticker.modelGreeks.delta)
                        gamma = safe_float(ticker.modelGreeks.gamma)
                        theta = safe_float(ticker.modelGreeks.theta)
                        vega = safe_float(ticker.modelGreeks.vega)
                        iv = safe_float(ticker.modelGreeks.impliedVol)
                        und_price = safe_float(ticker.modelGreeks.undPrice)
                else:
                    print(f"DEBUG: Processing {contract.symbol} | SecType: {contract.secType} (no ticker data yet)")
                    # Try to use cached prior_close if available
                    if contract.conId in self.prior_close_cache:
                        prior_close = self.prior_close_cache[contract.conId]

                # Fallback for underlying price from live stock ticker if option
                # If it's an option, we need the underlying price for the diagram
                if contract.secType == 'OPT' and (und_price == 0 or und_price is None):
                     found_price = 0.0
                     # Search through all tickers we are connected to
                     for t in self.ib.tickers():
                         if t.contract.symbol == contract.symbol and t.contract.secType == 'STK':
                             found_price = safe_float(t.marketPrice()) or safe_float(t.last) or safe_float(t.close)
                             if found_price > 0:
                                 break

                     if found_price == 0:
                         # Automatically subscribe to the underlying Stock if not done yet
                         if contract.symbol not in self.subscribed_symbols:
                            try:
                                u_contract = Stock(contract.symbol, 'SMART', 'USD')
                                self.ib.reqMktData(u_contract, '221', False, False)
                                self.subscribed_symbols.add(contract.symbol)
                            except:
                                pass
                     else:
                         und_price = found_price

                # Calculate Daily P&L
                # For stocks: (current_price - prior_close) * qty
                # For options: (current_mark - prior_close_mark) * qty * 100
                # Note: IBKR option prices are per share, so $1.50 means the contract costs $150
                if contract.secType == 'OPT':
                    multiplier = 100.0
                else:
                    multiplier = 1.0

                pos_daily_pnl = 0.0
                if current_price > 0 and prior_close > 0:
                    pos_daily_pnl = (current_price - prior_close) * safe_float(pos.position) * multiplier

                if contract.secType == 'STK':
                    # Get data from portfolio first - unrealized P&L and marketPrice
                    stock_pnl = 0.0
                    portfolio_market_price = 0.0
                    found_in_portfolio = False
                    for item in portfolio:
                        if item.contract.conId == contract.conId and item.account == pos.account:
                            stock_pnl = item.unrealizedPNL
                            portfolio_market_price = safe_float(item.marketPrice)
                            found_in_portfolio = True
                            print(f"DEBUG STK: {contract.symbol} found in portfolio, unrealizedPNL={stock_pnl}, marketPrice={portfolio_market_price}")
                            break
                    
                    # Use portfolio marketPrice as fallback when ticker data unavailable
                    if current_price == 0 and portfolio_market_price > 0:
                        current_price = portfolio_market_price
                    
                    # Recalculate daily P&L with updated current_price and cached prior_close
                    pos_daily_pnl = 0.0
                    if current_price > 0 and prior_close > 0:
                        pos_daily_pnl = (current_price - prior_close) * safe_float(pos.position)
                    
                    # Fallback to local unrealized calculation if portfolio data not available
                    if not found_in_portfolio:
                        print(f"DEBUG STK: {contract.symbol} NOT found in portfolio, conId={contract.conId}")
                        if current_price > 0:
                            stock_pnl = (current_price - safe_float(pos.avgCost)) * safe_float(pos.position)
                            print(f"DEBUG STK: {contract.symbol} fallback calc: ({current_price} - {pos.avgCost}) * {pos.position} = {stock_pnl}")
                    
                    print(f"DEBUG STK OUTPUT: {contract.symbol} unrealized_pnl={stock_pnl}, daily_pnl={pos_daily_pnl}, current_price={current_price}, prior_close={prior_close}")
                    
                    mapped_positions.append({
                        "ticker": contract.symbol,
                        "account": pos.account,
                        "position_type": "stock",
                        "qty": safe_float(pos.position),
                        "cost_basis": safe_float(pos.avgCost),
                        "current_price": current_price,
                        "unrealized_pnl": safe_float(stock_pnl),
                        "daily_pnl": pos_daily_pnl,
                        "delta": 1.0,
                        "gamma": 0.0, "theta": 0.0, "vega": 0.0, "iv": 0.0
                    })

                elif contract.secType == 'OPT':
                    # Parse expiry date properly using datetime
                    # IBKR format is YYYYMMDD
                    try:
                        expiry_date = datetime.strptime(contract.lastTradeDateOrContractMonth[:8], '%Y%m%d')
                        expiry_formatted = expiry_date.strftime('%Y-%m-%d')
                    except (ValueError, TypeError):
                        # Fallback to string slicing if parsing fails
                        expiry_formatted = f"{contract.lastTradeDateOrContractMonth[:4]}-{contract.lastTradeDateOrContractMonth[4:6]}-{contract.lastTradeDateOrContractMonth[6:]}"

                    # PnL from portfolio is often delayed/static compared to live calc
                    # but let's prefer portfolio PnL if available as it matches account window
                    pnl = 0.0
                    portfolio_market_price = 0.0
                    found_in_portfolio = False
                    for item in portfolio:
                        # Match by conId AND Account
                        if item.contract.conId == contract.conId and item.account == pos.account:
                            pnl = item.unrealizedPNL
                            portfolio_market_price = safe_float(item.marketPrice)
                            found_in_portfolio = True
                            break

                    # Use portfolio marketPrice as fallback when ticker data unavailable
                    if current_price == 0 and portfolio_market_price > 0:
                        current_price = portfolio_market_price

                    # Recalculate daily P&L with updated current_price and cached prior_close
                    pos_daily_pnl = 0.0
                    if current_price > 0 and prior_close > 0:
                        pos_daily_pnl = (current_price - prior_close) * safe_float(pos.position) * 100.0

                    # Fallback live P&L calculation if portfolio data missing/zero but we have live prices
                    # Some portfolio items might be missing or zero if not subscribed
                    if (pnl == 0.0 or not found_in_portfolio) and current_price > 0:
                         # (Mark - AvgCost) * Qty * Multiplier
                         # Using 100 as multiplier for standard US options.
                         pnl = (current_price - safe_float(pos.avgCost)) * safe_float(pos.position) * 100.0

                    # IMPORTANT: IBKR returns avgCost as total cost per 100 shares
                    # e.g., if you paid $5 per contract, avgCost = 500
                    # Frontend expects per-contract premium, so divide by 100
                    avg_cost_per_share = safe_float(pos.avgCost)
                    cost_basis_per_contract = avg_cost_per_share / 100.0 if avg_cost_per_share else 0.0

                    print(f"DEBUG OPT: {contract.symbol} {contract.right}{contract.strike} exp={expiry_formatted} qty={pos.position} unrealized_pnl={pnl} daily_pnl={pos_daily_pnl} current_price={current_price} prior_close={prior_close}")

                    mapped_positions.append({
                        "ticker": contract.symbol,
                        "account": pos.account,
                        "position_type": "call" if contract.right == 'C' else "put",
                        "qty": safe_float(pos.position),
                        "strike": safe_float(contract.strike),
                        "expiry": expiry_formatted,
                        "cost_basis": cost_basis_per_contract,
                        "unrealized_pnl": safe_float(pnl),
                        "daily_pnl": pos_daily_pnl,
                        "current_price": current_price,
                        "underlying_price": und_price,
                        "delta": delta,
                        "gamma": gamma,
                        "theta": theta,
                        "vega": vega,
                        "iv": iv * 100 # Convert to percentage for frontend
                    })

            # Extract Account Summary per Account
            # NetLiquidation comes from accountSummary, P&L comes from reqPnL
            accounts_summary = {}
            account_summary_values = list(self.ib.wrapper.acctSummary.values())

            # First pass: extract NetLiquidation from account summary
            if account_summary_values:
                for val in account_summary_values:
                    if val.currency not in ('USD', 'BASE'):
                        continue
                    if val.account == 'All':
                        continue
                    acc_id = val.account
                    if acc_id not in accounts_summary:
                        accounts_summary[acc_id] = {
                            "net_liquidation": 0.0,
                            "unrealized_pnl": 0.0,
                            "realized_pnl": 0.0,
                            "daily_pnl": 0.0,
                            "buying_power": 0.0
                        }

                    if val.tag == 'NetLiquidation':
                        accounts_summary[acc_id]["net_liquidation"] = safe_float(val.value)
                    elif val.tag == 'BuyingPower':
                        accounts_summary[acc_id]["buying_power"] = safe_float(val.value)

            # Second pass: get P&L from reqPnL subscriptions (the CORRECT source)
            for acc_id in list(accounts_summary.keys()):
                pnl_obj = self._ensure_pnl_subscription(acc_id)
                if pnl_obj:
                    accounts_summary[acc_id]["daily_pnl"] = safe_float(pnl_obj.dailyPnL)
                    accounts_summary[acc_id]["unrealized_pnl"] = safe_float(pnl_obj.unrealizedPnL)
                    accounts_summary[acc_id]["realized_pnl"] = safe_float(pnl_obj.realizedPnL)
                    print(f"DEBUG: P&L for {acc_id}: daily={pnl_obj.dailyPnL}, unrealized={pnl_obj.unrealizedPnL}, realized={pnl_obj.realizedPnL}")

            if accounts_summary:
                self.account_summary_cache = dict(accounts_summary)
            elif self.account_summary_cache:
                accounts_summary = dict(self.account_summary_cache)

            # If a position exists for an account that had no summary (unlikely but possible), ensure it exists
            # Also get list of all accounts for the frontend dropdown
            # Filter out 'All' explicitly if it somehow sneaks in
            raw_accounts = set([p['account'] for p in mapped_positions] + list(accounts_summary.keys()))
            if 'All' in raw_accounts:
                raw_accounts.remove('All')
            all_accounts = sorted(list(raw_accounts))

            print(f"DEBUG: Returning {len(mapped_positions)} mapped positions")

            return {
                "accounts": all_accounts,
                "positions": mapped_positions,
                "summary": accounts_summary
            }
        except Exception as e:
            print(f"Error fetching positions: {e}")
            import traceback
            traceback.print_exc()
            return {
                "accounts": [],
                "positions": [],
                "summary": {}
            }

    # NOTE: Historical price data has been moved to massive_client.py
    # NOTE: News has been moved to massive_client.py (Benzinga API)
    # This module now focuses ONLY on live data from IBKR:
    # - Positions, P&L, Greeks
    # - Real-time market data subscriptions

    def place_order(self, symbol: str, action: str, quantity: int, order_type: str, limit_price: Optional[float] = None) -> dict:
        """
        Place a stock order through IBKR.

        Args:
            symbol: Stock ticker (e.g., "AAPL")
            action: "BUY" or "SELL"
            quantity: Number of shares (integer)
            order_type: "MARKET" or "LIMIT"
            limit_price: Required for LIMIT orders

        Returns:
            dict with success status, order_id, and message/error
        """
        if not self.connected or not self.ib.isConnected():
            return format_error_response("Not connected to IBKR", success=False)

        # Validate inputs
        action = action.upper()
        if action not in ("BUY", "SELL"):
            return format_error_response("Action must be BUY or SELL", success=False)

        order_type = order_type.upper()
        if order_type not in ("MARKET", "LIMIT"):
            return format_error_response("Order type must be MARKET or LIMIT", success=False)

        if order_type == "LIMIT" and (limit_price is None or limit_price <= 0):
            return format_error_response("Limit price required for LIMIT orders", success=False)

        if quantity <= 0:
            return format_error_response("Quantity must be positive", success=False)

        try:
            # Create contract - SMART exchange handles routing for US stocks
            # Don't use qualifyContracts() as it blocks waiting for IB event loop
            contract = Stock(validate_symbol(symbol), 'SMART', 'USD')

            # Create order
            if order_type == "MARKET":
                order = MarketOrder(action, quantity)
            else:
                order = LimitOrder(action, quantity, limit_price)

            # Place the order - this is non-blocking, returns Trade object immediately
            trade = self.ib.placeOrder(contract, order)

            order_id = trade.order.orderId
            status = trade.orderStatus.status if trade.orderStatus else "Submitted"

            print(f"DEBUG: Order placed - ID: {order_id}, Status: {status}, Symbol: {symbol}")

            return {
                "success": True,
                "order_id": order_id,
                "status": status,
                "message": f"{action} {quantity} {symbol} @ {order_type}" + (f" ${limit_price}" if limit_price else "")
            }

        except Exception as e:
            print(f"Error placing order: {e}")
            import traceback
            traceback.print_exc()
            return format_error_response(str(e), success=False)

    def place_options_order(self, legs: list, order_type: str = "MARKET", limit_price: float = None) -> dict:
        """
        Place an options order (single leg or multi-leg combo).

        Args:
            legs: List of leg dicts with keys:
                - symbol: Underlying symbol (e.g., "AAPL")
                - expiry: Expiration date as YYYYMMDD (e.g., "20260116")
                - strike: Strike price (e.g., 250.0)
                - right: "C" for call, "P" for put
                - action: "BUY" or "SELL"
                - quantity: Number of contracts (e.g., 1)
            order_type: "MARKET" or "LIMIT"
            limit_price: Required for LIMIT orders (net debit/credit for combos)

        Returns:
            dict with success status, order_id(s), and message/error
        """
        if not self.connected or not self.ib.isConnected():
            return {"success": False, "error": "Not connected to IBKR"}

        if not legs or len(legs) == 0:
            return {"success": False, "error": "No legs provided"}

        try:
            if len(legs) == 1:
                # Single leg order
                leg = legs[0]

                # Normalize right to single character (C or P)
                right = leg["right"].upper()
                if right == "CALL":
                    right = "C"
                elif right == "PUT":
                    right = "P"

                # Create option contract
                # Expiry format for ib_insync: YYYYMMDD
                expiry_raw = leg["expiry"]
                # Ensure expiry is in YYYYMMDD format (remove dashes if present)
                expiry = expiry_raw.replace("-", "") if "-" in expiry_raw else expiry_raw

                print(f"DEBUG: Creating option contract - Symbol: {leg['symbol'].upper()}, Expiry: {expiry}, Strike: {leg['strike']}, Right: {right}")

                # IMPORTANT: Do NOT use qualifyContracts() here - it blocks waiting for IB event loop
                # For fully specified options (symbol, expiry, strike, right, exchange, currency),
                # IBKR can resolve the contract directly when placing the order
                contract = Option(
                    symbol=validate_symbol(leg["symbol"]),
                    lastTradeDateOrContractMonth=expiry,
                    strike=safe_float(leg["strike"]),
                    right=right,
                    exchange='SMART',
                    currency='USD'
                )

                # Create order
                action = leg["action"].upper()
                quantity = safe_int(leg["quantity"], 1)

                if order_type.upper() == "MARKET":
                    order = MarketOrder(action, quantity)
                else:
                    if limit_price is None:
                        return {"success": False, "error": "Limit price required for LIMIT orders"}
                    order = LimitOrder(action, quantity, limit_price)

                print(f"DEBUG: Placing order - Action: {action}, Quantity: {quantity}, OrderType: {order_type}")

                # Place the order - this is non-blocking, returns Trade object immediately
                trade = self.ib.placeOrder(contract, order)

                order_id = trade.order.orderId
                status = trade.orderStatus.status if trade.orderStatus else "Submitted"

                print(f"DEBUG: Options order placed - ID: {order_id}, Status: {status}")

                return {
                    "success": True,
                    "order_id": order_id,
                    "status": status,
                    "message": f"{action} {quantity} {leg['symbol']} {expiry} {leg['strike']}{right} @ {order_type}"
                }

            else:
                # Multi-leg orders: Submit each leg as a separate order
                # Note: True combo orders (BAG) require conIds from qualifyContracts()
                # which blocks. This workaround submits legs individually.
                # For spreads that need atomic execution, consider using TWS directly.

                print(f"DEBUG: Multi-leg order with {len(legs)} legs - submitting as separate orders")

                order_ids = []
                messages = []

                for i, leg in enumerate(legs):
                    # Normalize right to single character (C or P)
                    right = leg["right"].upper()
                    if right == "CALL":
                        right = "C"
                    elif right == "PUT":
                        right = "P"

                    # Ensure expiry is in YYYYMMDD format
                    expiry_raw = leg["expiry"]
                    expiry = expiry_raw.replace("-", "") if "-" in expiry_raw else expiry_raw

                    print(f"DEBUG: Leg {i+1} - Symbol: {leg['symbol'].upper()}, Expiry: {expiry}, Strike: {leg['strike']}, Right: {right}, Action: {leg['action']}")

                    contract = Option(
                        symbol=validate_symbol(leg["symbol"]),
                        lastTradeDateOrContractMonth=expiry,
                        strike=safe_float(leg["strike"]),
                        right=right,
                        exchange='SMART',
                        currency='USD'
                    )

                    action = leg["action"].upper()
                    quantity = safe_int(leg["quantity"], 1)

                    if order_type.upper() == "MARKET":
                        order = MarketOrder(action, quantity)
                    else:
                        if limit_price is None:
                            return {"success": False, "error": f"Limit price required for LIMIT orders (leg {i+1})"}
                        # For multi-leg, divide limit price proportionally or use per-leg pricing
                        order = LimitOrder(action, quantity, limit_price)

                    trade = self.ib.placeOrder(contract, order)

                    order_id = trade.order.orderId
                    status = trade.orderStatus.status if trade.orderStatus else "Submitted"

                    print(f"DEBUG: Leg {i+1} order placed - ID: {order_id}, Status: {status}")

                    order_ids.append(order_id)
                    messages.append(f"{action} {quantity} {leg['symbol']} {expiry} {leg['strike']}{right}")

                return {
                    "success": True,
                    "order_id": order_ids[0] if len(order_ids) == 1 else order_ids,
                    "order_ids": order_ids,
                    "status": "Submitted",
                    "message": f"Placed {len(order_ids)} orders: " + ", ".join(messages)
                }

        except Exception as e:
            print(f"Error placing options order: {e}")
            import traceback
            traceback.print_exc()
            return format_error_response(str(e), success=False)

    def disconnect(self):
        if self.connected:
            try:
                if self._account_summary_started:
                    self.ib.client.cancelAccountSummary(self._account_summary_req_id)
                    self._account_summary_started = False
            except Exception as e:
                print(f"Error canceling account summary: {e}")
            # Cancel P&L subscriptions
            for account, pnl in list(self.pnl_subscriptions.items()):
                try:
                    self.ib.cancelPnL(account, '')
                except Exception as e:
                    print(f"Error canceling P&L for {account}: {e}")
            self.pnl_subscriptions.clear()
            self.ib.disconnect()

class IBKRBroker(BrokerInterface):
    """Interactive Brokers broker implementation."""

    def __init__(self):
        self.client = IBClient()

    async def connect(self) -> bool:
        """Connect to IBKR."""
        await self.client.connect()
        return self.client.connected

    def disconnect(self) -> None:
        """Disconnect from IBKR."""
        self.client.disconnect()

    def is_connected(self) -> bool:
        """Check if connected to IBKR."""
        return self.client.ib.isConnected()

    def get_positions(self) -> List[Position]:
        """Get all current positions from IBKR."""
        if not self.is_connected():
            return []

        ib_positions = self.client.get_positions()

        # Convert IBKR positions to common Position model
        positions = []
        for pos_dict in ib_positions.get("positions", []):
            position = Position(
                ticker=pos_dict.get("ticker"),
                position_type=pos_dict.get("position_type"),
                qty=pos_dict.get("qty"),
                strike=pos_dict.get("strike"),
                expiry=pos_dict.get("expiry"),
                dte=pos_dict.get("dte"),
                cost_basis=pos_dict.get("cost_basis"),
                unrealized_pnl=pos_dict.get("unrealized_pnl"),
                daily_pnl=pos_dict.get("daily_pnl"),
                account=pos_dict.get("account"),
                current_price=pos_dict.get("current_price"),
                underlying_price=pos_dict.get("underlying_price"),
                delta=pos_dict.get("delta"),
                gamma=pos_dict.get("gamma"),
                theta=pos_dict.get("theta"),
                vega=pos_dict.get("vega"),
                iv=pos_dict.get("iv")
            )
            positions.append(position)

        return positions

    def get_account_summary(self) -> Dict[str, AccountSummary]:
        """Get account summary from IBKR."""
        if not self.is_connected():
            return {}

        ib_result = self.client.get_positions()
        summaries = ib_result.get("summary", {})
        if isinstance(summaries, dict) and "error" in summaries:
            return {}

        # Convert to common AccountSummary model
        result = {}
        for account_id, summary_dict in summaries.items():
            summary = AccountSummary(
                account=account_id,
                net_liquidation=safe_float(summary_dict.get("net_liquidation")),
                total_cash=safe_float(summary_dict.get("total_cash")),
                buying_power=safe_float(summary_dict.get("buying_power")),
                unrealized_pnl=safe_float(summary_dict.get("unrealized_pnl")),
                realized_pnl=safe_float(summary_dict.get("realized_pnl")),
                daily_pnl=safe_float(summary_dict.get("daily_pnl"))
            )
            result[account_id] = summary

        return result

    def place_stock_order(self, order: TradeOrder) -> Dict[str, Any]:
        """Place a stock order through IBKR."""
        if not self.is_connected():
            return format_error_response("Not connected to IBKR")

        result = self.client.place_order(
            symbol=order.symbol,
            action=order.action,
            quantity=order.quantity,
            order_type=order.order_type,
            limit_price=order.limit_price
        )

        return result

    def place_option_order(self, order: OptionOrder) -> Dict[str, Any]:
        """Place an option order through IBKR."""
        if not self.is_connected():
            return format_error_response("Not connected to IBKR")

        # Convert single option order to IBKR format
        legs = [{
            "symbol": order.symbol,
            "expiry": order.expiry,
            "strike": order.strike,
            "right": order.right,
            "action": order.action,
            "quantity": order.quantity
        }]
        
        return self.client.place_options_order(
            legs=legs,
            order_type=order.order_type,
            limit_price=order.limit_price
        )

    def place_multileg_option_order(self, legs: List[Dict[str, Any]], order_type: str = "MARKET", limit_price: Optional[float] = None) -> Dict[str, Any]:
        """Place a multi-leg options order through IBKR."""
        if not self.is_connected():
            return format_error_response("Not connected to IBKR")
            
        return self.client.place_options_order(
            legs=legs,
            order_type=order_type,
            limit_price=limit_price
        )
        result = self.client.place_options_order(
            legs=legs,
            order_type=order.order_type,
            limit_price=order.limit_price
        )

        return result

    def get_option_chain(self, symbol: str, max_strikes: int = 30) -> Dict[str, Any]:
        """Get options chain from IBKR."""
        if not self.is_connected():
            return format_error_response("Not connected to IBKR")

        # This functionality doesn't exist in the merged IBClient yet
        return format_error_response("Options chain not implemented")

    def subscribe_to_market_data(self, symbol: str) -> bool:
        """Subscribe to live market data for a symbol."""
        if not self.is_connected():
            return False

        # This would need implementation in IBClient
        return True

    def get_market_price(self, symbol: str) -> Optional[float]:
        """Get current market price for a symbol."""
        if not self.is_connected():
            return None

        # This would need implementation in IBClient
        return None

# Create global instance
ib_client = IBClient()