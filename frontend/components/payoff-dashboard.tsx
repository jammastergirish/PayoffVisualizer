
"use client";

import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import {
  Position,
  calculatePnl,

  calculateMaxRiskReward,
  getPriceRange,
  calculateTheoreticalPnl
} from "@/lib/payoff-utils";
import { PayoffChart } from "@/components/payoff-chart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { checkBackendHealth, fetchLivePortfolio, fetchHistoricalData, HistoricalBar, fetchNewsHeadlines, fetchMarketNewsHeadlines, NewsHeadline, fetchTickerDetails, TickerDetails, fetchDailySnapshot, DailySnapshot, placeTrade, TradeOrder, TradeResult, fetchOptionsChain, OptionsChain, OptionQuote, placeOptionsOrder, OptionLeg, fetchMarketNewsAnalysis, fetchTickerNewsAnalysis, LLMAnalysisResponse, fetchOrders, Order } from "@/lib/api-client";
import { Input } from "@/components/ui/input";
import { NewsModal } from "@/components/news-modal";
import { AnalystInsights } from "@/components/analyst-insights";
import { InsiderTrades } from "@/components/insider-trades";
import { FilingsEightK } from "@/components/filings-8k";
import { FilingsTenK } from "@/components/filings-10k";
import { BigInvestors } from "@/components/big-investors";
import { MarkdownDisplay } from "@/components/markdown-display";
import { NewsItemList } from "@/components/news-item-list";
import { OrdersTable } from "@/components/orders-table";
import { TickerDisplay } from "@/components/ticker-display";
import { CandlestickChart } from "@/components/candlestick-chart";
import { useToast } from "@/components/ui/toast";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, ReferenceLine } from "recharts";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AccountSummary } from "@/lib/payoff-utils";

import { formatCurrency, formatCurrencyOrInfinity, formatPercent, formatPrivateCurrency } from "@/lib/format-utils";
import { formatDate, formatDateTime } from "@/lib/date-utils";
import { decodeHtmlEntities, stripHtmlTags } from "@/lib/text-utils";
import { getStrikeQuote, formatExpiry, expiryWithoutDashes } from "@/lib/options-utils";
import { OptionsStrategyControls } from "@/components/options-strategy-controls";
import { findMatchingTicker, scrollToTicker } from "@/lib/search-utils";

async function runWithConcurrency<T>(
  items: T[],
  limit: number,
  handler: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item === undefined) return;
      await handler(item);
    }
  });
  await Promise.all(workers);
}

export function PayoffDashboard() {
  const [positions, setPositions] = useState<Position[]>([]);
  const [stockPrices, setStockPrices] = useState<Record<string, number>>({});
  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);

  const [loadTasks, setLoadTasks] = useState<Record<string, "pending" | "done">>({});
  const newsCacheRef = useRef<Record<string, NewsHeadline[]>>({});
  const isMountedRef = useRef(true);
  
  // Account State
  const [accounts, setAccounts] = useState<string[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>("All");
  const [accountSummaries, setAccountSummaries] = useState<Record<string, AccountSummary>>({});

  const selectedAccountRef = useRef(selectedAccount);
  const selectedTickerRef = useRef<string | null>(selectedTicker);

  // Track page visibility to reduce polling when app is backgrounded
  const [isPageVisible, setIsPageVisible] = useState(true);

  useEffect(() => {
    isMountedRef.current = true;

    const handleVisibilityChange = () => {
      setIsPageVisible(!document.hidden);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isMountedRef.current = false;
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    selectedAccountRef.current = selectedAccount;
  }, [selectedAccount]);

  useEffect(() => {
    selectedTickerRef.current = selectedTicker;
  }, [selectedTicker]);
  
  // Computed summary based on selection
  const activeSummary = useMemo(() => {
      if (selectedAccount !== "All" && accountSummaries[selectedAccount]) {
          return accountSummaries[selectedAccount];
      }
      return null;
  }, [selectedAccount, accountSummaries]);

  // Live Mode State
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [backendStatus, setBackendStatus] = useState<'checking' | 'connected' | 'offline'>('checking');
  const [ibConnected, setIbConnected] = useState(false); // Broker connection
  const [dataConnected, setDataConnected] = useState(false);
  const [newsConnected, setNewsConnected] = useState(false);
  const [providers, setProviders] = useState<{data: string; news: string; brokerage: string} | null>(null);
  
  // Toggles
  const [showStock, setShowStock] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [showCombined, setShowCombined] = useState(true);
  const [showT0, setShowT0] = useState(false);


  // Simulation State
  const [ivAdjustment, setIvAdjustment] = useState(0); // 0 = 0% change
  const [daysOffset, setDaysOffset] = useState(0); // 0 to 90 days

  // Stock Chart State
  const [chartTimeframe, setChartTimeframe] = useState<string>("1M");
  const [priceChartData, setPriceChartData] = useState<HistoricalBar[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [priceChartCache, setPriceChartCache] = useState<Record<string, Record<string, HistoricalBar[]>>>({}); // Cache for preloaded data

  // News State
  const [newsHeadlines, setNewsHeadlines] = useState<NewsHeadline[]>([]);
  const [newsHeadlinesTicker, setNewsHeadlinesTicker] = useState<string>(""); // Track which ticker headlines belong to
  const [newsLoading, setNewsLoading] = useState(false);
  const [selectedArticle, setSelectedArticle] = useState<{ articleId: string; providerCode: string; headline: string; body?: string; url?: string; imageUrl?: string } | null>(null);
  const [isNewsModalOpen, setIsNewsModalOpen] = useState(false);

  // Ticker Details State (company name, logo)
  const [tickerDetailsCache, setTickerDetailsCache] = useState<Record<string, TickerDetails>>({});

  // Snapshot cache for daily price data
  const [snapshotCache, setSnapshotCache] = useState<Record<string, DailySnapshot>>({});

  // Trade Form State
  const [tradeAction, setTradeAction] = useState<"BUY" | "SELL">("BUY");
  const [tradeQuantity, setTradeQuantity] = useState<number>(1);
  const [tradeOrderType, setTradeOrderType] = useState<"MARKET" | "LIMIT" | "TRAIL">("MARKET");
  const [tradeLimitPrice, setTradeLimitPrice] = useState<string>("");
  const [tradeTrailType, setTradeTrailType] = useState<"AMOUNT" | "PERCENT">("AMOUNT");
  const [tradeTrailValue, setTradeTrailValue] = useState<string>("");
  const [tradeTif, setTradeTif] = useState<"DAY" | "GTC">("DAY");
  const [tradeSubmitting, setTradeSubmitting] = useState(false);
  const [tickerSearch, setTickerSearch] = useState("");
  const { showToast } = useToast();

  // Options Chain State
  const [optionsChain, setOptionsChain] = useState<OptionsChain | null>(null);
  const [optionsChainLoading, setOptionsChainLoading] = useState(false);
  const [selectedExpiry, setSelectedExpiry] = useState<string>("");
  const [activeTab, setActiveTab] = useState<string>("payoff");
  const optionsChainCacheRef = useRef<Record<string, OptionsChain>>({});
  
  // Top-level portfolio view tabs
  const [portfolioView, setPortfolioView] = useState<"news" | "summary" | "detail" | "orders">("detail");
  
  // Market News State (separate from per-ticker news)
  const [marketNewsHeadlines, setMarketNewsHeadlines] = useState<NewsHeadline[]>([]);
  const [marketNewsLoading, setMarketNewsLoading] = useState(false);
  
  // AI News Analysis State
  const [marketNewsAnalysis, setMarketNewsAnalysis] = useState<string>("");
  const [marketNewsAnalysisLoading, setMarketNewsAnalysisLoading] = useState(false);
  const [marketNewsPrompt, setMarketNewsPrompt] = useState<string>("");
  const [tickerNewsAnalysis, setTickerNewsAnalysis] = useState<string>("");
  const [tickerNewsAnalysisLoading, setTickerNewsAnalysisLoading] = useState(false);
  const [tickerNewsPrompt, setTickerNewsPrompt] = useState<string>("");
  const [viewingPrompt, setViewingPrompt] = useState<string | null>(null); // Modal content
  
  // Orders State
  const [orders, setOrders] = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);



  // Portfolio Summary sort state
  type SortColumn = "ticker" | "underlyingPrice" | "unrealizedPnl" | "unrealizedPnlPct" | "dailyPnl" | "dailyPnlPct" | "marketValue" | "maxLoss" | "maxProfit";
  const [sortColumn, setSortColumn] = useState<SortColumn>("unrealizedPnl");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  
  // Consolidated vs Unconsolidated toggle
  const [isConsolidated, setIsConsolidated] = useState(true);
  
  // Privacy Mode - hide absolute dollar values
  const [privacyMode, setPrivacyMode] = useState(false);
  
  // Helper to refresh portfolio data (called after trades to get updated positions/P&L)
  const refreshPortfolio = async () => {
    try {
      const data = await fetchLivePortfolio();
      setPositions(data.positions);
      if (data.accounts) setAccounts(data.accounts);
      if (data.summary) setAccountSummaries(data.summary);
      // Apply live prices from refreshed positions
      const livePrices: Record<string, number> = {};
      data.positions.forEach(p => {
        if (!p.ticker) return;
        let price = 0;
        if (p.position_type === "stock" && p.current_price) {
          price = p.current_price;
        } else if (p.position_type !== "stock" && p.underlying_price) {
          price = p.underlying_price;
        }
        if (price > 0) livePrices[p.ticker] = price;
      });
      setStockPrices(prev => ({ ...prev, ...livePrices }));
    } catch (e) {
      console.error("Failed to refresh portfolio:", e);
    }
  };
  
  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("desc");
    }
  };

  // Strategy Builder State
  const [selectedLegs, setSelectedLegs] = useState<OptionLeg[]>([]);
  const [optionsOrderType, setOptionsOrderType] = useState<"MARKET" | "LIMIT">("MARKET");
  const [optionsLimitPrice, setOptionsLimitPrice] = useState<string>("");
  const [optionsOrderSubmitting, setOptionsOrderSubmitting] = useState(false);

  // Helper to handle ticker search and scroll
  const handleTickerSearch = (value: string) => {
    setTickerSearch(value);
    
    const match = findMatchingTicker(tickers, value);
    if (match) {
      scrollToTicker(match);
    }
  };

  // Helper to toggle a leg in the strategy
  const toggleLegInStrategy = (expiry: string, strike: number, right: "C" | "P", action: "BUY" | "SELL", mid: number) => {
    if (!selectedTicker) return;

    const expiryNoDashes = expiryWithoutDashes(expiry);

    // Check if this exact leg exists (same expiry, strike, right, AND action)
    const existingIndex = selectedLegs.findIndex(
      l => (l.expiry === expiry || l.expiry === expiryNoDashes) &&
           l.strike === strike &&
           l.right === right &&
           l.action === action
    );

    if (existingIndex >= 0) {
      // Leg exists - remove it (toggle off)
      setSelectedLegs(selectedLegs.filter((_, i) => i !== existingIndex));
    } else {
      // Leg doesn't exist - add it (toggle on)
      const newLeg: OptionLeg = {
        symbol: selectedTicker,
        expiry: expiryNoDashes, // Convert YYYY-MM-DD to YYYYMMDD
        strike,
        right,
        action,
        quantity: 1,
      };
      setSelectedLegs([...selectedLegs, newLeg]);
    }
  };

  // Helper to remove a leg from strategy
  const removeLeg = (index: number) => {
    setSelectedLegs(selectedLegs.filter((_, i) => i !== index));
  };

  // Helper to update a leg's action or quantity
  const updateLeg = (index: number, field: "action" | "quantity", value: "BUY" | "SELL" | number) => {
    const updated = [...selectedLegs];
    if (field === "action") {
      updated[index].action = value as "BUY" | "SELL";
    } else {
      updated[index].quantity = value as number;
    }
    setSelectedLegs(updated);
  };

  // Calculate estimated cost/credit for a leg
  const getLegPrice = (leg: OptionLeg): number => {
    if (!optionsChain) return 0;
    // Convert expiry from YYYYMMDD to the format used in optionsChain
    // The chain might use YYYY-MM-DD or YYYYMMDD, try both formats
    const expiryWithDashes = formatExpiry(leg.expiry);
    
    const quote = leg.right === "C" 
      ? (getStrikeQuote(optionsChain.calls, leg.expiry, leg.strike) || getStrikeQuote(optionsChain.calls, expiryWithDashes, leg.strike)) as OptionQuote | undefined
      : (getStrikeQuote(optionsChain.puts, leg.expiry, leg.strike) || getStrikeQuote(optionsChain.puts, expiryWithDashes, leg.strike)) as OptionQuote | undefined;
    if (!quote) return 0;
    const mid = quote.mid || quote.last || 0;
    // BUY = pay (positive), SELL = receive (negative)
    return (leg.action === "BUY" ? mid : -mid) * leg.quantity * 100;
  };

  // Check if a specific cell (bid/ask) is selected in the strategy builder
  // action: "SELL" = bid column, "BUY" = ask column
  const isLegSelected = (expiry: string, strike: number, right: "C" | "P", action: "BUY" | "SELL"): boolean => {
    const expiryNoDashes = expiryWithoutDashes(expiry);
    return selectedLegs.some(
      l => (l.expiry === expiry || l.expiry === expiryNoDashes) && l.strike === strike && l.right === right && l.action === action
    );
  };

  // Calculate net debit/credit
  const netCost = useMemo(() => {
    return selectedLegs.reduce((sum, leg) => sum + getLegPrice(leg), 0);
  }, [selectedLegs, optionsChain]); // eslint-disable-line react-hooks/exhaustive-deps

  // Toggle for showing existing positions in payoff chart
  const [showExistingPositions, setShowExistingPositions] = useState(false);

  // Convert OptionLeg[] to Position[] for payoff calculation
  const legsToPositions = useCallback((legs: OptionLeg[]): Position[] => {
    if (!optionsChain) return [];
    
    return legs.map(leg => {
      // Get the quote for pricing
      const expiryWithDashes = formatExpiry(leg.expiry);
      const quote = leg.right === "C"
        ? (getStrikeQuote(optionsChain.calls, leg.expiry, leg.strike) || getStrikeQuote(optionsChain.calls, expiryWithDashes, leg.strike)) as OptionQuote | undefined
        : (getStrikeQuote(optionsChain.puts, leg.expiry, leg.strike) || getStrikeQuote(optionsChain.puts, expiryWithDashes, leg.strike)) as OptionQuote | undefined;
      
      const mid = quote?.mid || quote?.last || 0;
      // BUY = positive qty, SELL = negative qty
      const qty = leg.action === "BUY" ? leg.quantity : -leg.quantity;
      
      return {
        ticker: leg.symbol,
        position_type: leg.right === "C" ? "call" : "put",
        qty,
        strike: leg.strike,
        cost_basis: mid,
        expiry: expiryWithDashes,
        underlying_price: optionsChain.underlying_price,
      } as Position;
    });
  }, [optionsChain]);

  const startLoadTask = useCallback((key: string) => {
    setLoadTasks(prev => {
      if (prev[key] === "pending") return prev;
      return { ...prev, [key]: "pending" };
    });
  }, []);

  const completeLoadTask = useCallback((key: string) => {
    setLoadTasks(prev => {
      if (!prev[key] || prev[key] === "done") return prev;
      return { ...prev, [key]: "done" };
    });
  }, []);

  // Auto-load options chain when switching to options tab or changing ticker
  const loadOptionsChain = useCallback(async (ticker: string, forceRefresh = false) => {
    if (!ticker || (optionsChainLoading && !forceRefresh)) return;

    const taskKey = `options:${ticker}`;

    // Show cached data immediately if available
    if (!forceRefresh && optionsChainCacheRef.current[ticker]) {
      const cached = optionsChainCacheRef.current[ticker];
      setOptionsChain(cached);
      if (cached.expirations.length > 0 && !selectedExpiry) {
        setSelectedExpiry(cached.expirations[0]);
      }
    }

    setOptionsChainLoading(true);
    startLoadTask(taskKey);

    try {
      const chain = await fetchOptionsChain(ticker);

      // Update cache
      if (chain && !chain.error) {
        optionsChainCacheRef.current[ticker] = chain;
      }

      setOptionsChain(chain);
      if (chain.expirations.length > 0) {
        // Preserve selected expiry if it still exists, otherwise select first
        if (!chain.expirations.includes(selectedExpiry)) {
          setSelectedExpiry(chain.expirations[0]);
        }
      }
    } finally {
      setOptionsChainLoading(false);
      completeLoadTask(taskKey);
    }
  }, [optionsChainLoading, selectedExpiry, startLoadTask, completeLoadTask]);

  // Handle ticker changes
  useEffect(() => {
    // Check if we have cached data for this ticker
    const cached = selectedTicker ? optionsChainCacheRef.current[selectedTicker] : null;

    if (cached) {
      // Use cached data immediately
      setOptionsChain(cached);
      if (cached.expirations.length > 0 && !selectedExpiry) {
        setSelectedExpiry(cached.expirations[0]);
      }
    } else {
      setOptionsChain(null);
      setSelectedExpiry("");
    }

    setSelectedLegs([]); // Clear strategy when ticker changes

    // Auto-reload if on options tab (will update in background if cached)
    if (activeTab === "options" && selectedTicker) {
      loadOptionsChain(selectedTicker);
    }
  }, [selectedTicker]); // eslint-disable-line react-hooks/exhaustive-deps

  const registerLoadTasks = useCallback((keys: string[]) => {
    if (keys.length === 0) return;
    setLoadTasks(prev => {
      let changed = false;
      const next = { ...prev };
      keys.forEach(key => {
        if (!next[key]) {
          next[key] = "pending";
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, []);

  const { totalLoadTasks, completedLoadTasks, pendingLoadTasks, loadProgress, currentLoadingItem } = useMemo(() => {
    const entries = Object.entries(loadTasks);
    const total = entries.length;
    const completed = entries.filter(([, status]) => status === "done").length;
    const pending = total - completed;
    
    // Find the first pending task and parse its key to show what's loading
    const pendingTasks = entries.filter(([, status]) => status === "pending").map(([key]) => key);
    let currentItem = "";
    if (pendingTasks.length > 0) {
      const key = pendingTasks[0];
      // Parse keys like "chart:AAPL:1M" or "news:GOOG"
      const parts = key.split(":");
      if (parts[0] === "chart") {
        currentItem = `chart for ${parts[1]}`;
      } else if (parts[0] === "news") {
        currentItem = `news for ${parts[1]}`;
      } else {
        currentItem = parts.slice(1).join(" ") || key;
      }
    }
    
    return {
      totalLoadTasks: total,
      completedLoadTasks: completed,
      pendingLoadTasks: pending,
      loadProgress: total === 0 ? 0 : completed / total,
      currentLoadingItem: currentItem,
    };
  }, [loadTasks]);

  // Poll orders on connect and every 5 seconds
  useEffect(() => {
    if (!isLiveMode || !ibConnected) return;

    if (orders.length === 0) {
      registerLoadTasks(["orders:all"]);
      startLoadTask("orders:all");
    }

    const loadOrders = async (showLoading: boolean) => {
        try {
            const data = await fetchOrders();
            setOrders(data.orders);
        } catch (e) {
            console.error("Failed to load orders:", e);
        } finally {
            if (showLoading) {
                completeLoadTask("orders:all");
            }
        }
    };

    loadOrders(true);

    const interval = setInterval(() => {
        if (isPageVisible) loadOrders(false);
    }, 5000); 

    return () => clearInterval(interval);
  }, [isLiveMode, ibConnected, isPageVisible, registerLoadTasks, startLoadTask, completeLoadTask]);

  const targetDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + daysOffset);
    return d;
  }, [daysOffset]);

  const cachedChartBars = selectedTicker ? priceChartCache[selectedTicker]?.[chartTimeframe] : undefined;

  // Fetch historical data when ticker or timeframe changes
  // Poll every 60 seconds for intraday timeframes (1H, 1D)
  useEffect(() => {
    let isCurrent = true;
    let pollInterval: NodeJS.Timeout | null = null;

    if (!selectedTicker || !isLiveMode || !ibConnected) {
      setPriceChartData([]);
      setChartLoading(false);
      return () => {
        isCurrent = false;
        if (pollInterval) clearInterval(pollInterval);
      };
    }
    
    // Use cache for initial display
    if (cachedChartBars && cachedChartBars.length > 0) {
      setPriceChartData(cachedChartBars);
      setChartLoading(false);
    }
    
    const fetchChartData = (showLoading: boolean = true) => {
      const taskKey = `chart:${selectedTicker}:${chartTimeframe}`;
      if (showLoading) {
        startLoadTask(taskKey);
        setChartLoading(true);
      }
      fetchHistoricalData(selectedTicker, chartTimeframe)
        .then(data => {
          if (!isMountedRef.current || !isCurrent) return;
          const bars = data.bars || [];
          setPriceChartData(bars);
          if (bars.length > 0) {
            setPriceChartCache(prev => ({
              ...prev,
              [selectedTicker]: {
                ...(prev[selectedTicker] || {}),
                [chartTimeframe]: bars,
              },
            }));
          }
        })
        .finally(() => {
          if (!isMountedRef.current) return;
          completeLoadTask(taskKey);
          if (isCurrent) {
            setChartLoading(false);
          }
        });
    };
    
    // Initial fetch
    fetchChartData(true);
    
    // Poll every 60 seconds for intraday timeframes
    const isIntraday = chartTimeframe === '1H' || chartTimeframe === '1D';
    if (isIntraday) {
      pollInterval = setInterval(() => {
        if (isCurrent && isPageVisible) {
          fetchChartData(false); // Don't show loading spinner for background refreshes
        }
      }, 30000); // 30 seconds (reduced from 10s for better mobile performance)
    }
    
    return () => {
      isCurrent = false;
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [selectedTicker, chartTimeframe, isLiveMode, ibConnected, isPageVisible, startLoadTask, completeLoadTask]);

  // Fetch news when ticker changes and poll every 30 seconds
  useEffect(() => {
    if (!selectedTicker || !isLiveMode || !ibConnected) {
      setNewsHeadlines([]);
      setNewsHeadlinesTicker("");
      setNewsLoading(false);
      return;
    }
    
    let isCurrent = true;
    const ticker = selectedTicker;
    const cached = newsCacheRef.current[ticker];
    const hasCached = Array.isArray(cached);

    if (hasCached) {
      setNewsHeadlines(cached);
      setNewsHeadlinesTicker(ticker);
      setNewsLoading(false);
    } else {
      setNewsHeadlines([]);
      setNewsHeadlinesTicker(""); // Clear until new headlines load
      setNewsLoading(true);
    }

    const fetchNews = (trackLoad: boolean) => {
      const taskKey = `news:${ticker}`;
      if (trackLoad) {
        startLoadTask(taskKey);
      }

      fetchNewsHeadlines(ticker, 25)
        .then(data => {
          if (!isMountedRef.current || !isCurrent) return;
          const headlines = data.headlines || [];
          const existing = newsCacheRef.current[ticker];
          const hasExistingData = Array.isArray(existing) && existing.length > 0;
          if (headlines.length > 0 || !hasExistingData) {
            newsCacheRef.current[ticker] = headlines;
            setNewsHeadlines(headlines);
            setNewsHeadlinesTicker(ticker);
          }
        })
        .catch(err => {
          console.error("Error fetching news:", err);
          const hasCacheNow = Array.isArray(newsCacheRef.current[ticker]);
          if (isMountedRef.current && isCurrent && !hasCacheNow) {
            setNewsHeadlines([]);
          }
        })
        .finally(() => {
          if (trackLoad) {
            completeLoadTask(taskKey);
          }
          if (isMountedRef.current && isCurrent) {
            setNewsLoading(false);
          }
        });
    };
    
    // Initial fetch
    fetchNews(!hasCached);
    
    // Poll every 60 seconds (reduced frequency for better mobile performance)
    const interval = setInterval(() => {
      if (isPageVisible) fetchNews(false);
    }, 60000);
    
    return () => {
      isCurrent = false;
      clearInterval(interval);
    };
  }, [selectedTicker, isLiveMode, ibConnected, isPageVisible, startLoadTask, completeLoadTask]);

  // Fetch market news when Market News tab is selected - uses preloaded cache if available
  useEffect(() => {
    if (!isLiveMode || !ibConnected) return;
    if (portfolioView !== "news") return;
    
    // If we have cached data (from bootstrap preload), don't show spinner
    const hasCached = marketNewsHeadlines.length > 0;
    
    const fetchMarketNews = (showSpinner: boolean) => {
      if (showSpinner) setMarketNewsLoading(true);
      fetchMarketNewsHeadlines(25)
        .then(data => {
          if (isMountedRef.current) {
            setMarketNewsHeadlines(data.headlines || []);
          }
        })
        .catch(err => {
          console.error("Error fetching market news:", err);
        })
        .finally(() => {
          if (isMountedRef.current) {
            setMarketNewsLoading(false);
          }
        });
    };
    
    // Only show spinner if no cached data yet
    if (!hasCached) {
      fetchMarketNews(true);
    }
    
    // Poll every 60 seconds (reduced frequency for better mobile performance)
    const interval = setInterval(() => {
      if (isPageVisible) fetchMarketNews(false);
    }, 60000);
    
    return () => clearInterval(interval);
  }, [portfolioView, isLiveMode, ibConnected, isPageVisible, marketNewsHeadlines.length]);

  // Auto-analyze market news when headlines change
  const lastMarketAnalysisRef = useRef<string>("");
  const marketAnalysisInProgressRef = useRef(false);
  useEffect(() => {
    if (marketNewsHeadlines.length === 0) return;
    if (marketAnalysisInProgressRef.current) return; // Prevent concurrent analyses
    
    // Capture current values to avoid closure issues
    const currentHeadlines = marketNewsHeadlines.slice(0, 10);
    
    // Create a fingerprint of current headlines to detect changes (include headline text for content changes)
    const headlinesFingerprint = currentHeadlines.map(h => `${h.articleId}:${h.headline}`).join("|");
    if (headlinesFingerprint === lastMarketAnalysisRef.current) return;
    lastMarketAnalysisRef.current = headlinesFingerprint;
    
    // Start analysis with progress bar
    const analyze = async () => {
      marketAnalysisInProgressRef.current = true;
      registerLoadTasks(["analysis:market"]);
      startLoadTask("analysis:market");
      setMarketNewsAnalysisLoading(true);
      
      try {
        // Prepare articles with full content for deeper analysis (strip HTML tags)
        const articles = currentHeadlines.map(h => ({
          headline: h.headline,
          body: stripHtmlTags(h.body)
        }));
        // Get tickers at analysis time (not from dependency)
        const tickers = [...new Set(positions.map(p => p.ticker))];
        
        // Store the prompt for "View Prompt" feature (show full articles)
        const articlesStr = articles.map((a, i) => {
          return a.body ? `${i + 1}. ${a.headline}\n${a.body}` : `${i + 1}. ${a.headline}`;
        }).join("\n\n");
        const tickersStr = tickers.join(", ") || "general market";
        const prompt = `Based on these news articles, what are the key market-moving insights for my investments (${tickersStr})? Give a summary in 150 words.\n\nArticles:\n${articlesStr}`;
        setMarketNewsPrompt(prompt);
        
        const result = await fetchMarketNewsAnalysis(articles, tickers);
        if (result.summary) {
          setMarketNewsAnalysis(result.summary);
        } else if (result.error) {
          setMarketNewsAnalysis("");
        }
      } catch (err) {
        console.error("Error analyzing market news:", err);
      } finally {
        setMarketNewsAnalysisLoading(false);
        completeLoadTask("analysis:market");
        marketAnalysisInProgressRef.current = false;
      }
    };
    
    analyze();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marketNewsHeadlines]);

  // Auto-analyze ticker news when headlines change
  const lastTickerAnalysisRef = useRef<string>("");
  const tickerAnalysisInProgressRef = useRef(false);
  useEffect(() => {
    if (!selectedTicker || newsHeadlines.length === 0) return;
    // Only analyze if headlines belong to the selected ticker
    if (newsHeadlinesTicker !== selectedTicker) return;
    if (tickerAnalysisInProgressRef.current) return; // Prevent concurrent analyses
    
    // Capture current values to avoid closure issues
    const currentTicker = selectedTicker;
    const currentHeadlines = newsHeadlines.slice(0, 10);
    
    // Create a fingerprint of current ticker + headlines to detect changes (include headline text)
    const fingerprint = `${currentTicker}:${currentHeadlines.map(h => `${h.articleId}:${h.headline}`).join("|")}`;
    if (fingerprint === lastTickerAnalysisRef.current) return;
    lastTickerAnalysisRef.current = fingerprint;
    
    // Clear previous analysis when switching tickers
    setTickerNewsAnalysis("");
    
    // Start analysis with progress bar
    const analyze = async () => {
      tickerAnalysisInProgressRef.current = true;
      registerLoadTasks(["analysis:ticker"]);
      startLoadTask("analysis:ticker");
      setTickerNewsAnalysisLoading(true);
      
      try {
        // Prepare articles with full content for deeper analysis (strip HTML tags)
        const articles = currentHeadlines.map(h => ({
          headline: h.headline,
          body: stripHtmlTags(h.body)
        }));
        
        // Store the prompt for "View Prompt" feature (show full articles)
        const articlesStr = articles.map((a, i) => {
          return a.body ? `${i + 1}. ${a.headline}\n${a.body}` : `${i + 1}. ${a.headline}`;
        }).join("\n\n");
        const prompt = `Based on these news articles about ${currentTicker.toUpperCase()}, what is the likely price impact? Give a summary in 150 words.\n\nArticles:\n${articlesStr}`;
        setTickerNewsPrompt(prompt);
        
        const result = await fetchTickerNewsAnalysis(articles, currentTicker);
        if (result.summary) {
          setTickerNewsAnalysis(result.summary);
        } else if (result.error) {
          setTickerNewsAnalysis("");
        }
      } catch (err) {
        console.error("Error analyzing ticker news:", err);
      } finally {
        setTickerNewsAnalysisLoading(false);
        completeLoadTask("analysis:ticker");
        tickerAnalysisInProgressRef.current = false;
      }
    };
    
    analyze();
  }, [selectedTicker, newsHeadlines, newsHeadlinesTicker]);

  // Fetch ticker details (company name, logo) when ticker changes
  useEffect(() => {
    if (!selectedTicker || !isLiveMode || !ibConnected) return;
    
    // Skip if already cached
    if (tickerDetailsCache[selectedTicker]) return;
    
    fetchTickerDetails(selectedTicker)
      .then(details => {
        if (details && !details.error) {
          setTickerDetailsCache(prev => ({
            ...prev,
            [selectedTicker]: details
          }));
        }
      })
      .catch(err => console.error("Failed to fetch ticker details:", err));
  }, [selectedTicker, isLiveMode, ibConnected, tickerDetailsCache]);

  // Get current ticker's details
  const currentTickerDetails = selectedTicker ? tickerDetailsCache[selectedTicker] : null;

  // Initial Backend Check
  useEffect(() => {
    let isMounted = true;
    let portfolioInterval: ReturnType<typeof setInterval> | null = null;

    const applyLivePrices = (pos: Position[]) => {
      const livePrices: Record<string, number> = {};
      pos.forEach(p => {
        if (!p.ticker) return;
        let price = 0;
        if (p.position_type === "stock" && p.current_price) {
          price = p.current_price;
        } else if (p.position_type !== "stock" && p.underlying_price) {
          price = p.underlying_price;
        }
        // Only update if we found a valid price AND (no existing price OR this one is better)
        if (price > 0 && (!livePrices[p.ticker] || price > 0)) {
          livePrices[p.ticker] = price;
        }
      });
      setStockPrices(prev => ({ ...prev, ...livePrices }));
    };

    const bootstrap = async () => {
      startLoadTask("health");
      let health: Awaited<ReturnType<typeof checkBackendHealth>> | null = null;
      try {
        health = await checkBackendHealth();
      } finally {
        if (isMounted) completeLoadTask("health");
      }

      if (!isMounted) return;

      if (health && health.status === "ok") {
        setIsLiveMode(true);
        setBackendStatus("connected");
        setIbConnected(health.broker_connected);
        setDataConnected(health.data_connected);
        setNewsConnected(health.news_connected);
        setProviders(health.providers);

        if (health.broker_connected) {
          startLoadTask("portfolio");
          let data: Awaited<ReturnType<typeof fetchLivePortfolio>>;
          try {
            data = await fetchLivePortfolio();
          } finally {
            if (isMounted) completeLoadTask("portfolio");
          }

          if (!isMounted) return;

          const pos = data.positions;
          setPositions(pos);

          if (data.accounts && data.accounts.length > 0) {
            setAccounts(data.accounts);
            if (selectedAccountRef.current !== "All" && !data.accounts.includes(selectedAccountRef.current)) {
              setSelectedAccount("All");
            }
          }

          if (data.summary) {
            setAccountSummaries(data.summary);
          }

          applyLivePrices(pos);

          const tickerList = Array.from(new Set(pos.map(p => p.ticker).filter(Boolean))) as string[];
          tickerList.sort();

          let primaryTicker = selectedTickerRef.current;
          if (!primaryTicker && tickerList.length > 0) {
            primaryTicker = tickerList[0];
            setSelectedTicker(primaryTicker);
          }

          portfolioInterval = setInterval(async () => {
            const updatedData = await fetchLivePortfolio();
            if (!isMounted) return;
            const updated = updatedData.positions;
            setPositions(updated);
            if (updatedData.accounts) setAccounts(updatedData.accounts);
            if (updatedData.summary) setAccountSummaries(updatedData.summary);
            applyLivePrices(updated);
          }, 100);

          const chartPrefetchTickers = tickerList.filter(t => t !== primaryTicker);
          registerLoadTasks(chartPrefetchTickers.map(t => `chart:${t}:1M`));
          void runWithConcurrency(chartPrefetchTickers, 3, async ticker => {
            const taskKey = `chart:${ticker}:1M`;
            startLoadTask(taskKey);
            try {
              const chartData = await fetchHistoricalData(ticker, "1M");
              if (isMounted && chartData.bars?.length) {
                setPriceChartCache(prev => ({
                  ...prev,
                  [ticker]: {
                    ...(prev[ticker] || {}),
                    ["1M"]: chartData.bars,
                  },
                }));
              }
            } finally {
              if (isMounted) completeLoadTask(taskKey);
            }
          });

          const newsPrefetchTickers = tickerList.filter(t => t !== primaryTicker);
          registerLoadTasks(newsPrefetchTickers.map(t => `news:${t}`));
          void runWithConcurrency(newsPrefetchTickers, 2, async ticker => {
            const taskKey = `news:${ticker}`;
            startLoadTask(taskKey);
            try {
              const newsData = await fetchNewsHeadlines(ticker, 25);
              if (isMounted) {
                newsCacheRef.current[ticker] = newsData.headlines || [];
              }
            } finally {
              if (isMounted) completeLoadTask(taskKey);
            }
          });

          // Preload market news in background
          registerLoadTasks(["news:market"]);
          startLoadTask("news:market");
          fetchMarketNewsHeadlines(25)
            .then(data => {
              if (isMounted) {
                setMarketNewsHeadlines(data.headlines || []);
              }
            })
            .catch(err => {
              console.error("Error preloading market news:", err);
            })
            .finally(() => {
              if (isMounted) completeLoadTask("news:market");
            });

          // Preload ticker details (company logos) for all tickers
          void runWithConcurrency(tickerList, 5, async ticker => {
            try {
              const details = await fetchTickerDetails(ticker);
              if (isMounted && details && !details.error) {
                setTickerDetailsCache(prev => ({
                  ...prev,
                  [ticker]: details
                }));
              }
            } catch (err) {
              // Ignore errors for ticker details
            }
          });
        }
      } else {
        setBackendStatus("offline");
      }
    };

    void bootstrap();

    return () => {
      isMounted = false;
      if (portfolioInterval) clearInterval(portfolioInterval);
    };
  }, [startLoadTask, completeLoadTask, registerLoadTasks]);

  const tickers = useMemo(() => {
    // Filter positions first by Account
    let visible = positions;
    if (selectedAccount !== 'All') {
        visible = positions.filter(p => p.account === selectedAccount);
    }
    const positionTickers = visible.map(p => p.ticker);
    return [...new Set(positionTickers)].sort();
  }, [positions, selectedAccount]);

  // Per-ticker P&L summary (aggregates stock + options)
  const perTickerPnl = useMemo(() => {
    let visible = positions;
    if (selectedAccount !== 'All') {
      visible = positions.filter(p => p.account === selectedAccount);
    }
    
    const summary: Record<string, { unrealized: number; daily: number; stockQty: number; optionCount: number }> = {};
    
    for (const p of visible) {
      if (!summary[p.ticker]) {
        summary[p.ticker] = { unrealized: 0, daily: 0, stockQty: 0, optionCount: 0 };
      }
      summary[p.ticker].unrealized += p.unrealized_pnl || 0;
      summary[p.ticker].daily += p.daily_pnl || 0;
      
      if (p.position_type === 'stock') {
        summary[p.ticker].stockQty += p.qty;
      } else {
        summary[p.ticker].optionCount += 1;
      }
    }
    
    return summary;
  }, [positions, selectedAccount]);

  // Comprehensive ticker summaries for Portfolio Summary view
  const tickerSummaries = useMemo(() => {
    let visible = positions;
    if (selectedAccount !== 'All') {
      visible = positions.filter(p => p.account === selectedAccount);
    }
    
    interface TickerSummary {
      ticker: string;
      underlyingPrice: number;
      unrealizedPnl: number;
      unrealizedPnlPct: number;
      dailyPnl: number;
      dailyPnlPct: number;
      marketValue: number;
      costBasis: number;
      maxLoss: number;
      maxProfit: number;
      positionCount: number;
      hasOptions: boolean;
    }
    
    const grouped: Record<string, { positions: Position[]; costBasis: number; marketValue: number }> = {};
    
    for (const p of visible) {
      if (!grouped[p.ticker]) {
        grouped[p.ticker] = { positions: [], costBasis: 0, marketValue: 0 };
      }
      grouped[p.ticker].positions.push(p);
      
      // Calculate cost basis and market value
      const costBasisValue = (p.cost_basis || 0) * Math.abs(p.qty) * (p.position_type === 'stock' ? 1 : 100);
      grouped[p.ticker].costBasis += costBasisValue;
      
      // Market value estimate
      const currentPrice = p.current_price || p.cost_basis || 0;
      const marketVal = currentPrice * Math.abs(p.qty) * (p.position_type === 'stock' ? 1 : 100);
      grouped[p.ticker].marketValue += p.qty > 0 ? marketVal : -marketVal;
    }
    
    const summaries: TickerSummary[] = [];
    
    for (const ticker of Object.keys(grouped)) {
      const { positions: tickerPositions, costBasis, marketValue } = grouped[ticker];
      
      const unrealizedPnl = tickerPositions.reduce((sum, p) => sum + (p.unrealized_pnl || 0), 0);
      const dailyPnl = tickerPositions.reduce((sum, p) => sum + (p.daily_pnl || 0), 0);
      const underlyingPrice = stockPrices[ticker] || tickerPositions[0]?.underlying_price || 0;
      const hasOptions = tickerPositions.some(p => p.position_type !== 'stock');
      
      // Calculate max risk/reward
      const stats = calculateMaxRiskReward(tickerPositions);
      
      summaries.push({
        ticker,
        underlyingPrice,
        unrealizedPnl,
        unrealizedPnlPct: costBasis > 0 ? (unrealizedPnl / costBasis) * 100 : 0,
        dailyPnl,
        dailyPnlPct: marketValue !== 0 ? (dailyPnl / Math.abs(marketValue)) * 100 : 0,
        marketValue,
        costBasis,
        maxLoss: stats.maxLoss,
        maxProfit: stats.maxProfit,
        positionCount: tickerPositions.length,
        hasOptions,
      });
    }
    
    // Sort by selected column
    summaries.sort((a, b) => {
      let aVal: number | string = a[sortColumn];
      let bVal: number | string = b[sortColumn];
      
      // Handle string comparison for ticker
      if (sortColumn === "ticker") {
        return sortDirection === "asc" 
          ? (aVal as string).localeCompare(bVal as string)
          : (bVal as string).localeCompare(aVal as string);
      }
      
      // Handle infinity values for maxLoss/maxProfit
      if (!Number.isFinite(aVal)) aVal = sortDirection === "asc" ? Infinity : -Infinity;
      if (!Number.isFinite(bVal)) bVal = sortDirection === "asc" ? Infinity : -Infinity;
      
      return sortDirection === "asc" 
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });
    
    return summaries;
  }, [positions, selectedAccount, stockPrices, sortColumn, sortDirection]);

  const activePositions = useMemo(() => {
    // If no ticker selected, return empty
    if (!selectedTicker) return [];
    
    // Base filter by Ticker
    let filtered = positions.filter(p => p.ticker === selectedTicker);
    
    // Filter by Account
    if (selectedAccount !== 'All') {
        filtered = filtered.filter(p => p.account === selectedAccount);
    }
    return filtered;
  }, [positions, selectedTicker, selectedAccount]);

  // Calculate payoff data for strategy builder chart
  const strategyPayoffData = useMemo(() => {
    if (selectedLegs.length === 0 || !optionsChain) {
      return { data: [], maxProfit: 0, maxLoss: 0 };
    }

    const strategyPositions = legsToPositions(selectedLegs);
    const currentPrice = optionsChain.underlying_price || stockPrices[selectedTicker || ""] || 100;

    // Determine price range - include existing positions if superimpose is on
    // This ensures consistent X-axis scale
    let allPositionsForRange = strategyPositions;
    let tickerPositions: Position[] = [];
    if (showExistingPositions && activePositions.length > 0) {
      tickerPositions = activePositions.filter(p => p.ticker === selectedTicker);
      if (tickerPositions.length > 0) {
        // Use combined positions for price range calculation
        allPositionsForRange = [...strategyPositions, ...tickerPositions];
      }
    }

    const prices = getPriceRange(allPositionsForRange, currentPrice);

    // Calculate just the strategy P&L (this should never change)
    const strategyPnl = calculatePnl(strategyPositions, prices);

    // Calculate combined P&L (strategy + existing positions) if toggled
    let combinedPnl: number[] | undefined;
    if (showExistingPositions && tickerPositions.length > 0) {
      const existingPnl = calculatePnl(tickerPositions, prices);
      combinedPnl = strategyPnl.map((v, i) => v + existingPnl[i]);
    }

    // Calculate max profit/loss from strategy alone
    const stats = calculateMaxRiskReward(strategyPositions);

    const data = prices.map((price, idx) => ({
      price,
      strategy: strategyPnl[idx],
      combined: combinedPnl ? combinedPnl[idx] : undefined,
    }));

    return {
      data,
      maxProfit: stats.maxProfit,
      maxLoss: stats.maxLoss,
      currentPrice
    };
  }, [selectedLegs, optionsChain, showExistingPositions, activePositions, selectedTicker, stockPrices, legsToPositions]);

  const chartData = useMemo(() => {
    if (!selectedTicker || activePositions.length === 0) return { data: [], stats: null };

    const currentPrice = stockPrices[selectedTicker] || 100;
    const prices = getPriceRange(activePositions, currentPrice);
    
    // Combined
    const pnl = calculatePnl(activePositions, prices);
    
    // Components
    const stockPos = activePositions.filter(p => p.position_type === 'stock');
    const optionPos = activePositions.filter(p => p.position_type !== 'stock');
    
    // Calculate component P&Ls only if they exist
    const stockPnlArr = stockPos.length > 0 ? calculatePnl(stockPos, prices) : undefined;
    const optionsPnlArr = optionPos.length > 0 ? calculatePnl(optionPos, prices) : undefined;

    const stats = calculateMaxRiskReward(activePositions);

    // Calculate T+0 P&L if enabled
    let t0Pnl: number[] | undefined;
    if (showT0) {
        t0Pnl = calculateTheoreticalPnl(activePositions, prices, targetDate, ivAdjustment);
    }

    const data = prices.map((price, idx) => ({
        price,
        pnl: pnl[idx],
        stockPnl: stockPnlArr ? stockPnlArr[idx] : undefined,
        optionsPnl: optionsPnlArr ? optionsPnlArr[idx] : undefined,
        t0Pnl: t0Pnl ? t0Pnl[idx] : undefined,
    }));

    return { data, stats };
  }, [selectedTicker, activePositions, stockPrices, showT0, ivAdjustment, targetDate]);

  const currentPrice = selectedTicker ? (stockPrices[selectedTicker] || 0) : 0;
  const totalUnrealizedPnl = activePositions.reduce((sum, p) => sum + (p.unrealized_pnl || 0), 0);

  // Calculate Net Greeks
  const netRisk = useMemo(() => {
    let delta = 0, gamma = 0, theta = 0, vega = 0;
    activePositions.forEach(p => {
        const multiplier = p.position_type === 'stock' ? 1 : 100;
        delta += (p.delta || 0) * p.qty * multiplier;
        gamma += (p.gamma || 0) * p.qty * multiplier;
        theta += (p.theta || 0) * p.qty * multiplier;
        vega += (p.vega || 0) * p.qty * multiplier;
    });
    return { delta, gamma, theta, vega };
  }, [activePositions]);

  const formatBound = (value: number) => formatCurrencyOrInfinity(value);

  const summaryUnrealizedPnl = useMemo(() => {
    if (!accountSummaries || Object.keys(accountSummaries).length === 0) return null;
    if (selectedAccount !== "All" && accountSummaries[selectedAccount]) {
      return accountSummaries[selectedAccount].unrealized_pnl;
    }
    if (selectedAccount === "All") {
      return Object.values(accountSummaries).reduce((sum, s) => sum + s.unrealized_pnl, 0);
    }
    return null;
  }, [accountSummaries, selectedAccount]);

  const portfolioUnrealizedPnl = useMemo(() => {
    if (summaryUnrealizedPnl !== null) return summaryUnrealizedPnl;
    return positions.reduce((sum, p) => sum + (p.unrealized_pnl || 0), 0);
  }, [positions, summaryUnrealizedPnl]);

  const positionCount = useMemo(() => {
    if (selectedAccount === "All") return positions.length;
    return positions.filter(p => p.account === selectedAccount).length;
  }, [positions, selectedAccount]);

  return (
    <div className="flex flex-col gap-6">
      {/* Progress bar - pinned to bottom */}
      {pendingLoadTasks > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-80 rounded-full border border-white/5 bg-black/80 backdrop-blur-sm px-4 py-2">
          <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-orange-500 via-amber-400 to-emerald-400 transition-all duration-300 ease-out"
              style={{ width: `${Math.max(loadProgress, 0.05) * 100}%` }}
            />
          </div>
          <div className="mt-1 text-[10px] uppercase tracking-wider text-gray-500 text-center">
            Loading {currentLoadingItem || ""} {completedLoadTasks}/{totalLoadTasks}
          </div>
        </div>
      )}


       {isLiveMode && (
           <div className={`flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg text-sm border bg-slate-900/50 border-white/10`}>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-1">
                    <span className="text-gray-400 text-xs uppercase tracking-wider">Broker:</span>
                    <span className="font-medium text-white uppercase text-xs">{providers?.brokerage || 'IBKR'}</span>
                    <div className={`w-1.5 h-1.5 rounded-full ${ibConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-gray-400 text-xs uppercase tracking-wider">Data:</span>
                    <span className="font-medium text-white uppercase text-xs">{providers?.data || 'MASSIVE'}</span>
                    <div className={`w-1.5 h-1.5 rounded-full ${dataConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-gray-400 text-xs uppercase tracking-wider">News:</span>
                    <span className="font-medium text-white uppercase text-xs">{providers?.news || 'MASSIVE'}</span>
                    <div className={`w-1.5 h-1.5 rounded-full ${newsConnected ? 'bg-green-500' : 'bg-red-500'}`} />
                  </div>
                </div>

                <div className="flex items-center gap-2 sm:gap-4 sm:ml-auto flex-wrap">
                   {/* Account Selector */}
                   {accounts.length > 0 && (
                       <div className="flex items-center gap-2">
                           <span className="text-gray-400 text-xs uppercase tracking-wider hidden sm:inline">Account:</span>
                           <Select value={selectedAccount} onValueChange={setSelectedAccount}>
                             <SelectTrigger className="w-[140px] sm:w-[180px] bg-slate-900 border-white/10 text-white h-8 text-xs">
                               <SelectValue placeholder="Select Account" />
                             </SelectTrigger>
                             <SelectContent className="bg-slate-900 border-white/10 text-white">
                               <SelectItem value="All">All Accounts</SelectItem>
                               {accounts.map(acc => (
                                   <SelectItem key={acc} value={acc}>{acc}</SelectItem>
                               ))}
                             </SelectContent>
                           </Select>
                       </div>
                   )}
                   <span className="text-xs font-mono opacity-70 hidden sm:inline border-l border-white/10 pl-4">
                       {ibConnected ? "CONNECTED" : "DISCONNECTED"}
                   </span>
                </div>
           </div>
       )}

       {positions.length === 0 && (
           <div className="flex flex-col items-center justify-center p-12 text-center border-t border-white/5">
                <div className="text-gray-500 mb-2 text-lg">No positions found</div>
                <div className="text-gray-600 text-sm max-w-md">
                    Check your TWS connection and ensure you have open positions in the selected account. 
                    If you are using a paper trading account, make sure it is active.
                </div>
           </div>
       )}

       {positions.length > 0 && (
          <div className="flex flex-col gap-6">
            {/* Header with TradeShape + Key Metrics inline */}
      <div className="flex items-center justify-between border-b border-white/10 pb-4 gap-2 sm:gap-4 flex-wrap">
        <div className="flex items-center gap-2 sm:gap-3">
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
            Trade<span className="text-orange-500">Shape</span>
          </h1>
          {/* Privacy Mode Toggle */}
          <button
            onClick={() => setPrivacyMode(!privacyMode)}
            className={`p-2 rounded-lg transition-colors ${
              privacyMode 
                ? 'bg-orange-500/20 text-orange-400 hover:bg-orange-500/30' 
                : 'bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white'
            }`}
            title={privacyMode ? 'Show values' : 'Hide values'}
          >
            {privacyMode ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            )}
          </button>
        </div>
        
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
          {/* YTD % Return - calculated first for positioning */}
          {accountSummaries && (() => {
            const totalNetLiq = selectedAccount !== 'All' && accountSummaries[selectedAccount]
              ? accountSummaries[selectedAccount].net_liquidation
              : Object.values(accountSummaries).reduce((sum, s) => sum + s.net_liquidation, 0);
            const totalRealizedPnl = selectedAccount !== 'All' && accountSummaries[selectedAccount]
              ? accountSummaries[selectedAccount].realized_pnl
              : Object.values(accountSummaries).reduce((sum, s) => sum + s.realized_pnl, 0);
            
            return (
              <>
                {/* Net Liq - first */}
                {selectedAccount !== 'All' && accountSummaries[selectedAccount] ? (
                  <div className="bg-slate-900/80 border border-white/10 rounded-lg px-3 py-2 min-w-[110px]">
                    <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Net Liq</div>
                    <div className="text-lg font-bold text-white">
                      {formatPrivateCurrency(accountSummaries[selectedAccount].net_liquidation, privacyMode)}
                    </div>
                  </div>
                ) : (
                  <div className="bg-slate-900/80 border border-white/10 rounded-lg px-3 py-2 min-w-[110px]">
                    <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Total Net Liq</div>
                    <div className="text-lg font-bold text-white">
                      {formatPrivateCurrency(totalNetLiq, privacyMode)}
                    </div>
                  </div>
                )}
                
                {/* Today - third */}
                {selectedAccount !== 'All' && accountSummaries[selectedAccount] ? (
                  <div className="bg-slate-900/80 border border-white/10 rounded-lg px-3 py-2 min-w-[110px]">
                    <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Today</div>
                    <div className={`text-lg font-bold ${accountSummaries[selectedAccount].daily_pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {accountSummaries[selectedAccount].daily_pnl >= 0 ? '+' : ''}{formatPrivateCurrency(accountSummaries[selectedAccount].daily_pnl, privacyMode)}
                    </div>
                  </div>
                ) : (
                  <div className="bg-slate-900/80 border border-white/10 rounded-lg px-3 py-2 min-w-[110px]">
                    <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Today</div>
                    <div className={`text-lg font-bold ${Object.values(accountSummaries).reduce((sum, s) => sum + s.daily_pnl, 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {Object.values(accountSummaries).reduce((sum, s) => sum + s.daily_pnl, 0) >= 0 ? '+' : ''}{formatPrivateCurrency(Object.values(accountSummaries).reduce((sum, s) => sum + s.daily_pnl, 0), privacyMode)}
                    </div>
                  </div>
                )}
                
                {/* Realized - fourth */}
                {selectedAccount !== 'All' && accountSummaries[selectedAccount] ? (
                  <div className="bg-slate-900/80 border border-white/10 rounded-lg px-3 py-2 min-w-[110px]">
                    <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Realized</div>
                    <div className={`text-lg font-bold ${accountSummaries[selectedAccount].realized_pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {accountSummaries[selectedAccount].realized_pnl >= 0 ? '+' : ''}{formatPrivateCurrency(accountSummaries[selectedAccount].realized_pnl, privacyMode)}
                    </div>
                  </div>
                ) : (
                  <div className="bg-slate-900/80 border border-white/10 rounded-lg px-3 py-2 min-w-[110px]">
                    <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Realized</div>
                    <div className={`text-lg font-bold ${totalRealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {totalRealizedPnl >= 0 ? '+' : ''}{formatPrivateCurrency(totalRealizedPnl, privacyMode)}
                    </div>
                  </div>
                )}
                

              </>
            );
          })()}
          
          {/* Unrealized - fifth */}
          <div className="bg-slate-900/80 border border-white/10 rounded-lg px-3 py-2 min-w-[110px]">
            <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Unrealized</div>
            <div className={`text-lg font-bold ${portfolioUnrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
              {portfolioUnrealizedPnl >= 0 ? '+' : ''}{formatPrivateCurrency(portfolioUnrealizedPnl, privacyMode)}
            </div>
          </div>
          
          {/* Buying Power - sixth */}
          {accountSummaries && (() => {
            const totalBuyingPower = selectedAccount !== 'All' && accountSummaries[selectedAccount]
              ? accountSummaries[selectedAccount].buying_power || 0
              : Object.values(accountSummaries).reduce((sum, s) => sum + (s.buying_power || 0), 0);
            return totalBuyingPower > 0 ? (
              <div className="bg-slate-900/80 border border-white/10 rounded-lg px-3 py-2 min-w-[110px]">
                <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Buying Power</div>
                <div className="text-lg font-bold text-cyan-400">
                  {formatPrivateCurrency(totalBuyingPower, privacyMode)}
                </div>
              </div>
            ) : null;
          })()}
        </div>
      </div>

      {/* Portfolio Summary / Detail Tabs */}
      <Tabs value={portfolioView} onValueChange={(v) => setPortfolioView(v as "news" | "summary" | "detail")} className="w-full">
        <TabsList className="bg-slate-900 border border-white/10">
          <TabsTrigger value="news" className="data-[state=active]:bg-blue-500/20 data-[state=active]:text-blue-400">Market News</TabsTrigger>
          <TabsTrigger value="summary" className="data-[state=active]:bg-white/10 data-[state=active]:text-white">Portfolio Summary</TabsTrigger>
          <TabsTrigger value="detail" className="data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-400">Portfolio Detail</TabsTrigger>
          <TabsTrigger value="orders" className="data-[state=active]:bg-indigo-500/20 data-[state=active]:text-indigo-400">Orders</TabsTrigger>
        </TabsList>
        
        {/* Market News Tab */}
        <TabsContent value="news" className="mt-4">
          <Card className="bg-slate-950 border-white/10 text-white">
            <CardHeader className="pb-2 border-b border-white/5">
              <CardTitle className="text-gray-400 font-normal uppercase tracking-wider text-xs">Market News</CardTitle>
            </CardHeader>
            <CardContent className="pt-2">
              {/* AI Analysis - Auto-loaded */}
              {(marketNewsAnalysisLoading || marketNewsAnalysis) && (
                <div className="mb-4 p-4 bg-gradient-to-r from-blue-900/30 to-purple-900/30 rounded-lg border border-blue-500/20">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-blue-400 text-lg">✨</span>
                      <span className="text-sm font-medium text-blue-300">Analysis</span>
                    </div>
                    {marketNewsPrompt && !marketNewsAnalysisLoading && (
                      <button
                        onClick={() => setViewingPrompt(marketNewsPrompt)}
                        className="text-xs text-blue-400/70 hover:text-blue-300 underline"
                      >
                        View prompt
                      </button>
                    )}
                  </div>
                  {marketNewsAnalysisLoading ? (
                    <p className="text-sm text-gray-400 italic flex items-center gap-2">
                      <span className="animate-spin">⏳</span> Analyzing headlines for your portfolio...
                    </p>
                  ) : (
                    <MarkdownDisplay 
                      content={marketNewsAnalysis} 
                      className="text-sm text-gray-300"
                    />
                  )}
                </div>
              )}
              
              <NewsItemList
                headlines={marketNewsHeadlines}
                loading={marketNewsLoading}
                emptyMessage="No market news available"
                accentColor="blue"
                onArticleClick={(article) => {
                  setSelectedArticle(article);
                  setIsNewsModalOpen(true);
                }}
              />
            </CardContent>
          </Card>
        </TabsContent>
        
        {/* Portfolio Summary Tab */}
        <TabsContent value="summary" className="mt-4">
          <Card className="bg-slate-950 border-white/10 text-white">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-gray-400 font-normal uppercase tracking-wider text-xs">
                {isConsolidated ? "Positions by Ticker" : "All Positions"}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Label className="text-xs text-gray-500">Consolidated</Label>
                <Switch
                  checked={isConsolidated}
                  onCheckedChange={setIsConsolidated}
                  className="data-[state=checked]:bg-orange-600"
                />
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-xs sm:text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-gray-500 text-xs uppercase tracking-wider">
                      <th
                        className="text-left py-2 px-1 sm:px-2 cursor-pointer touch-manipulation hover:text-white transition-colors"
                        onClick={() => handleSort("ticker")}
                      >
                        Ticker {sortColumn === "ticker" && (sortDirection === "asc" ? "↑" : "↓")}
                      </th>
                      <th
                        className="text-right py-2 px-1 sm:px-2 cursor-pointer touch-manipulation hover:text-white transition-colors border-l border-r border-white/10"
                        onClick={() => handleSort("underlyingPrice")}
                      >
                        Price {sortColumn === "underlyingPrice" && (sortDirection === "asc" ? "↑" : "↓")}
                      </th>
                      <th
                        className="text-right py-2 px-1 sm:px-2 cursor-pointer touch-manipulation hover:text-white transition-colors border-l border-white/10"
                        onClick={() => handleSort("unrealizedPnl")}
                      >
                        <span className="hidden sm:inline">Unrealized $</span><span className="sm:hidden">Un $</span> {sortColumn === "unrealizedPnl" && (sortDirection === "asc" ? "↑" : "↓")}
                      </th>
                      <th
                        className="text-right py-2 px-1 sm:px-2 cursor-pointer touch-manipulation hover:text-white transition-colors border-r border-white/10"
                        onClick={() => handleSort("unrealizedPnlPct")}
                      >
                        <span className="hidden sm:inline">Unrealized %</span><span className="sm:hidden">Un %</span> {sortColumn === "unrealizedPnlPct" && (sortDirection === "asc" ? "↑" : "↓")}
                      </th>
                      <th
                        className="text-right py-2 px-1 sm:px-2 cursor-pointer touch-manipulation hover:text-white transition-colors border-l border-white/10"
                        onClick={() => handleSort("dailyPnl")}
                      >
                        <span className="hidden sm:inline">Today $</span><span className="sm:hidden">T $</span> {sortColumn === "dailyPnl" && (sortDirection === "asc" ? "↑" : "↓")}
                      </th>
                      <th
                        className="text-right py-2 px-1 sm:px-2 cursor-pointer touch-manipulation hover:text-white transition-colors border-r border-white/10"
                        onClick={() => handleSort("dailyPnlPct")}
                      >
                        <span className="hidden sm:inline">Today %</span><span className="sm:hidden">T %</span> {sortColumn === "dailyPnlPct" && (sortDirection === "asc" ? "↑" : "↓")}
                      </th>
                      <th
                        className="text-right py-2 px-1 sm:px-2 cursor-pointer touch-manipulation hover:text-white transition-colors border-l border-r border-white/10"
                        onClick={() => handleSort("marketValue")}
                      >
                        <span className="hidden sm:inline">Market Value</span><span className="sm:hidden">Mkt Val</span> {sortColumn === "marketValue" && (sortDirection === "asc" ? "↑" : "↓")}
                      </th>
                      <th
                        className="text-right py-2 px-1 sm:px-2 cursor-pointer touch-manipulation hover:text-white transition-colors"
                        onClick={() => handleSort("maxLoss")}
                      >
                        <span className="hidden sm:inline">Max Loss</span><span className="sm:hidden">Max L</span> {sortColumn === "maxLoss" && (sortDirection === "asc" ? "↑" : "↓")}
                      </th>
                      <th
                        className="text-right py-2 px-1 sm:px-2 cursor-pointer touch-manipulation hover:text-white transition-colors"
                        onClick={() => handleSort("maxProfit")}
                      >
                        <span className="hidden sm:inline">Max Profit</span><span className="sm:hidden">Max P</span> {sortColumn === "maxProfit" && (sortDirection === "asc" ? "↑" : "↓")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {isConsolidated ? (
                      // Consolidated view - by ticker
                      tickerSummaries.map((s) => (
                        <tr 
                          key={s.ticker} 
                          className="border-b border-white/5 hover:bg-white/5 active:bg-white/10 cursor-pointer touch-manipulation touch-manipulation min-h-[44px]"
                          onClick={() => {
                            setSelectedTicker(s.ticker);
                            setPortfolioView("detail");
                          }}
                        >
                          <td className="py-2 px-2">
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 flex-shrink-0 rounded bg-white/10 overflow-hidden">
                                {tickerDetailsCache[s.ticker]?.branding?.icon_url ? (
                                  <img 
                                    src={tickerDetailsCache[s.ticker].branding!.icon_url!}
                                    alt={s.ticker}
                                    className="w-full h-full object-contain"
                                  />
                                ) : (
                                  <div className="w-full h-full flex items-center justify-center text-gray-600 text-[10px] font-bold">
                                    {s.ticker.slice(0, 2)}
                                  </div>
                                )}
                              </div>
                              <span className="font-medium text-white">{s.ticker}</span>
                              {s.hasOptions && <span className="text-[10px] text-purple-400 border border-purple-500/30 px-1 rounded">OPT</span>}
                            </div>
                          </td>
                          <td className="text-right py-2 px-2 font-mono text-gray-300 border-l border-r border-white/10">
                            ${s.underlyingPrice.toFixed(2)}
                          </td>
                          <td className={`text-right py-2 px-2 font-mono font-medium border-l border-white/10 ${s.unrealizedPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {s.unrealizedPnl >= 0 ? '+' : ''}{formatPrivateCurrency(s.unrealizedPnl, privacyMode)}
                          </td>
                          <td className={`text-right py-2 px-1 sm:px-2 font-mono text-xs border-r border-white/10 ${s.unrealizedPnlPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {s.unrealizedPnlPct >= 0 ? '+' : ''}{s.unrealizedPnlPct.toFixed(1)}%
                          </td>
                          <td className={`text-right py-2 px-2 font-mono font-medium border-l border-white/10 ${s.dailyPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {s.dailyPnl >= 0 ? '+' : ''}{formatPrivateCurrency(s.dailyPnl, privacyMode)}
                          </td>
                          <td className={`text-right py-2 px-1 sm:px-2 font-mono text-xs border-r border-white/10 ${s.dailyPnlPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                            {s.dailyPnlPct >= 0 ? '+' : ''}{s.dailyPnlPct.toFixed(1)}%
                          </td>
                          <td className="text-right py-2 px-1 sm:px-2 font-mono text-gray-300 border-l border-r border-white/10">
                            {formatPrivateCurrency(Math.abs(s.marketValue), privacyMode)}
                          </td>
                          <td className="text-right py-2 px-1 sm:px-2 font-mono text-red-400">
                            {Number.isFinite(s.maxLoss) ? formatPrivateCurrency(Math.abs(s.maxLoss), privacyMode) : '∞'}
                          </td>
                          <td className="text-right py-2 px-1 sm:px-2 font-mono text-green-400">
                            {Number.isFinite(s.maxProfit) ? formatPrivateCurrency(s.maxProfit, privacyMode) : '∞'}
                          </td>
                        </tr>
                      ))
                    ) : (
                      // Unconsolidated view - individual positions
                      positions
                        .filter(p => selectedAccount === "All" || p.account === selectedAccount)
                        .sort((a, b) => {
                          const aVal = a.unrealized_pnl || 0;
                          const bVal = b.unrealized_pnl || 0;
                          return sortDirection === "asc" ? aVal - bVal : bVal - aVal;
                        })
                        .map((p, idx) => {
                          const costBasis = (p.cost_basis || 0) * Math.abs(p.qty) * (p.position_type === 'stock' ? 1 : 100);
                          const unrealizedPct = costBasis > 0 ? ((p.unrealized_pnl || 0) / costBasis) * 100 : 0;
                          const currentPrice = p.current_price || p.cost_basis || 0;
                          const marketValue = currentPrice * Math.abs(p.qty) * (p.position_type === 'stock' ? 1 : 100);
                          const dailyPct = marketValue > 0 ? ((p.daily_pnl || 0) / marketValue) * 100 : 0;
                          
                          return (
                            <tr 
                              key={`${p.ticker}-${p.position_type}-${p.strike || 0}-${p.expiry || ''}-${idx}`}
                              className="border-b border-white/5 hover:bg-white/5 active:bg-white/10 cursor-pointer touch-manipulation touch-manipulation min-h-[44px]"
                              onClick={() => {
                                setSelectedTicker(p.ticker);
                                setPortfolioView("detail");
                              }}
                            >
                              <td className="py-2 px-2">
                                <div className="flex items-center gap-2">
                                    <TickerDisplay 
                                      symbol={p.ticker} 
                                      iconUrl={tickerDetailsCache[p.ticker]?.branding?.icon_url} 
                                      showSymbol={false} 
                                    />
                                  <div className="flex flex-col">
                                    <span className="font-medium text-white">{p.ticker}</span>
                                    <span className="text-[10px] text-gray-500">
                                      {p.position_type === 'stock' 
                                        ? `${p.qty > 0 ? 'Long' : 'Short'} ${Math.abs(p.qty)} shares`
                                        : `${p.qty > 0 ? 'Long' : 'Short'} ${Math.abs(p.qty)} ${p.position_type.toUpperCase()} $${p.strike} ${p.expiry}`
                                      }
                                    </span>
                                  </div>
                                </div>
                              </td>
                              <td className="text-right py-2 px-2 font-mono text-gray-300 border-l border-r border-white/10">
                                ${(stockPrices[p.ticker] || p.underlying_price || 0).toFixed(2)}
                              </td>
                              <td className={`text-right py-2 px-2 font-mono font-medium border-l border-white/10 ${(p.unrealized_pnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {(p.unrealized_pnl || 0) >= 0 ? '+' : ''}{formatCurrency(p.unrealized_pnl || 0)}
                              </td>
                              <td className={`text-right py-2 px-1 sm:px-2 font-mono text-xs border-r border-white/10 ${unrealizedPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {unrealizedPct >= 0 ? '+' : ''}{unrealizedPct.toFixed(1)}%
                              </td>
                              <td className={`text-right py-2 px-2 font-mono font-medium border-l border-white/10 ${(p.daily_pnl || 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {(p.daily_pnl || 0) >= 0 ? '+' : ''}{formatCurrency(p.daily_pnl || 0)}
                              </td>
                              <td className={`text-right py-2 px-1 sm:px-2 font-mono text-xs border-r border-white/10 ${dailyPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {dailyPct >= 0 ? '+' : ''}{dailyPct.toFixed(1)}%
                              </td>
                              <td className="text-right py-2 px-1 sm:px-2 font-mono text-gray-300 border-l border-r border-white/10">
                                {formatCurrency(marketValue)}
                              </td>
                              <td className="text-right py-2 px-1 sm:px-2 font-mono text-gray-500">
                                -
                              </td>
                              <td className="text-right py-2 px-1 sm:px-2 font-mono text-gray-500">
                                -
                              </td>
                            </tr>
                          );
                        })
                    )}
                  </tbody>
                </table>
              </div>
              
              {tickerSummaries.length === 0 && (
                <div className="text-center py-8 text-gray-500">No positions found</div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        
        {/* Portfolio Detail Tab */}
        {/* Orders Tab */}
        <TabsContent value="orders" className="mt-4">
          <Card className="bg-slate-950 border-white/10 text-white">
            <CardHeader className="flex flex-row items-center justify-between pb-2 border-b border-white/5">
              <CardTitle className="text-gray-400 font-normal uppercase tracking-wider text-xs">Today&apos;s Orders</CardTitle>
              <Button variant="outline" size="sm" onClick={() => fetchOrders().then(d => setOrders(d.orders))} className="h-7 text-xs bg-white/5 hover:bg-white/10 border-white/10 text-gray-300">
                Refresh
              </Button>
            </CardHeader>
            <CardContent className="pt-4">
               <OrdersTable 
                 orders={orders} 
                 isLoading={ordersLoading} 
                 onNavigate={(symbol) => {
                   setSelectedTicker(symbol);
                   setPortfolioView("detail");
                 }}
                 tickerIcons={Object.fromEntries(Object.entries(tickerDetailsCache).map(([k, v]) => [k, v?.branding?.icon_url]))}
               />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Portfolio Detail Tab */}
        <TabsContent value="detail" className="mt-4">
            {/* Mobile ticker selector - replaces sidebar on mobile */}
            <div className="md:hidden mb-4">
              <Select value={selectedTicker || ""} onValueChange={setSelectedTicker}>
                <SelectTrigger className="w-full min-h-[44px] bg-slate-800 border-slate-700 text-white touch-manipulation">
                  <SelectValue placeholder="Select a ticker to view details" className="text-orange-400 font-bold">
                    {selectedTicker || "Select ticker"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700">
                  {tickers.map((ticker) => {
                    const tickerPositions = positions.filter(p => p.ticker === ticker);
                    const totalPnl = tickerPositions.reduce((sum, p) => sum + (p.unrealized_pnl || 0), 0);

                    return (
                      <SelectItem key={ticker} value={ticker} className="cursor-pointer touch-manipulation hover:bg-slate-800">
                        <div className="flex items-center justify-between w-full">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-white">{ticker}</span>
                            <span className="text-xs text-gray-400">
                              ${stockPrices[ticker]?.toFixed(2) || '---'}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 ml-4">
                            <span className={`text-xs font-medium ${totalPnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {totalPnl >= 0 ? '+' : ''}{formatCurrency(totalPnl)}
                            </span>
                          </div>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-6 flex-1 min-h-0">
            {/* Sidebar - hidden on mobile, normal on desktop */}
            <Card className="hidden md:flex md:col-span-1 bg-slate-950 border-white/10 text-white flex-col max-h-[calc(100vh-180px)]">
               <CardHeader className="flex-shrink-0 pb-2">
                 <div className="flex items-center justify-between mb-2">
                   <CardTitle className="text-gray-400 font-normal uppercase tracking-wider text-xs">Tickers</CardTitle>
                 </div>
                 <Input 
                   placeholder="Find ticker..." 
                   value={tickerSearch}
                   onChange={(e) => handleTickerSearch(e.target.value)}
                   className="bg-white/5 border-white/10 text-white h-8 text-xs"
                 />
               </CardHeader>
               <CardContent className="flex flex-col gap-2 overflow-y-auto flex-1 pt-0">
                  {tickers.map(t => {
                    const pnl = perTickerPnl[t] || { unrealized: 0, daily: 0, stockQty: 0, optionCount: 0 };
                    const hasStock = pnl.stockQty !== 0;
                    const hasOptions = pnl.optionCount > 0;
                    
                    return (
                      <div 
                        key={t}
                        id={`ticker-list-item-${t}`} 
                        className={`p-3 rounded-lg cursor-pointer touch-manipulation transition-colors ${
                          selectedTicker === t 
                            ? "bg-orange-500/20 border border-orange-500/50" 
                            : "bg-white/5 border border-transparent hover:bg-white/10"
                        }`}
                        onClick={() => setSelectedTicker(t)}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {/* Ticker Logo with placeholder spacer */}
                            <div className="w-6 h-6 flex-shrink-0 rounded bg-white/10 overflow-hidden">
                              {tickerDetailsCache[t]?.branding?.icon_url ? (
                                <img 
                                  src={tickerDetailsCache[t].branding!.icon_url!}
                                  alt={t}
                                  className="w-full h-full object-contain"
                                  onError={(e) => { (e.target as HTMLImageElement).style.opacity = '0'; }}
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center text-gray-600 text-[10px] font-bold">
                                  {t.slice(0, 2)}
                                </div>
                              )}
                            </div>
                            <span className={`font-medium ${selectedTicker === t ? "text-orange-500" : "text-white"}`}>
                              {t}
                            </span>
                            {stockPrices[t] && (
                              <span className="text-xs text-gray-400 font-mono">
                                ${stockPrices[t].toFixed(2)}
                              </span>
                            )}
                          </div>
                          <div className="flex gap-1 text-[10px] items-center">
                            {hasStock && <span className="px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">{pnl.stockQty > 0 ? '+' : ''}{pnl.stockQty}</span>}
                            {hasOptions && <span className="px-1.5 py-0.5 rounded bg-purple-900/50 text-purple-300">{pnl.optionCount} opt</span>}
                          </div>
                        </div>
                        <div className="flex justify-between mt-2 text-xs">
                          <div>
                            <div className="text-gray-500">Unrealized</div>
                            <div className={pnl.unrealized >= 0 ? "text-green-400" : "text-red-400"}>
                              {pnl.unrealized >= 0 ? '+' : ''}{formatPrivateCurrency(pnl.unrealized, privacyMode)}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-gray-500">Today</div>
                            <div className={pnl.daily >= 0 ? "text-green-400" : "text-red-400"}>
                              {pnl.daily >= 0 ? '+' : ''}{formatPrivateCurrency(pnl.daily, privacyMode)}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
               </CardContent>
            </Card>

            {/* Main Content */}
            <div className="md:col-span-3 flex flex-col gap-6 overflow-y-auto">
              {/* Ticker Header - visible across all tabs */}
              <div className="flex items-center gap-4 px-2">
                {/* Company Logo */}
                {currentTickerDetails?.branding?.icon_url && (
                  <img 
                    src={currentTickerDetails.branding.icon_url}
                    alt={currentTickerDetails.name || selectedTicker || ''}
                    className="w-12 h-12 rounded-lg bg-white/10 object-contain p-1"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                )}
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <h2 className="text-2xl font-bold tracking-wide text-white">{selectedTicker || "Select a Ticker"}</h2>
                    {currentTickerDetails?.name && (
                      <span className="text-lg text-gray-400 font-light">{currentTickerDetails.name}</span>
                    )}
                  </div>
                  {selectedTicker && currentPrice > 0 && (
                    <div className="flex items-center gap-3">
                      <span className="text-3xl font-bold text-white">${currentPrice.toFixed(2)}</span>
                      {perTickerPnl[selectedTicker] && (
                        <div className={`flex items-center gap-1 text-sm font-medium ${perTickerPnl[selectedTicker].daily >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          <span className="text-xl">{perTickerPnl[selectedTicker].daily >= 0 ? '▲' : '▼'}</span>
                          <span>{perTickerPnl[selectedTicker].daily >= 0 ? '+' : ''}{formatPrivateCurrency(perTickerPnl[selectedTicker].daily, privacyMode)}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <Tabs value={activeTab} onValueChange={(val) => {
                setActiveTab(val);
                // Auto-load options when switching to Options tab
                if (val === "options" && selectedTicker && !optionsChain) {
                  loadOptionsChain(selectedTicker);
                }
              }} className="w-full">
                <TabsList className="bg-slate-900 border border-white/10 flex flex-wrap h-auto justify-start">
                  <TabsTrigger value="chart" className="data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-400">Price Chart</TabsTrigger>
                  <TabsTrigger value="news" className="data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-400">News</TabsTrigger>
                  <TabsTrigger value="insights" className="data-[state=active]:bg-blue-500/20 data-[state=active]:text-blue-400">Insights</TabsTrigger>
                  <TabsTrigger value="insiderTrades" className="data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-400">Insider Trades</TabsTrigger>
                  <TabsTrigger value="filings8k" className="data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-400">8-Ks</TabsTrigger>
                  <TabsTrigger value="filings10k" className="data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-400">10-K</TabsTrigger>
                  <TabsTrigger value="bigInvestors" className="data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-400">Big Investors</TabsTrigger>
                  <TabsTrigger value="risk" className="data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-400">Positions & Profile</TabsTrigger>
                  <TabsTrigger value="payoff" className="data-[state=active]:bg-orange-500/20 data-[state=active]:text-orange-400">Payoff Diagram</TabsTrigger>

                  <TabsTrigger value="trade" className="data-[state=active]:bg-green-500/20 data-[state=active]:text-green-400">Trade Stock</TabsTrigger>
                  <TabsTrigger value="options" className="data-[state=active]:bg-purple-500/20 data-[state=active]:text-purple-400">Options Chain</TabsTrigger>
                </TabsList>
                <TabsContent value="chart" className="mt-4">
                  <Card className="bg-slate-950 border-white/10 text-white">
                    <CardHeader className="flex flex-row items-center justify-end pb-4 border-b border-white/5">
                      <div className="flex gap-1">
                        {([
                          { tf: "1H", label: "1H", barSize: "1min" },
                          { tf: "1D", label: "1D", barSize: "5min" },
                          { tf: "1W", label: "1W", barSize: "Hourly" },
                          { tf: "1M", label: "1M", barSize: "Hourly" },
                          { tf: "1Y", label: "1Y", barSize: "Daily" },
                        ]).map(({ tf, label, barSize }) => (
                          <Button
                            key={tf}
                            variant={chartTimeframe === tf ? "default" : "ghost"}
                            size="sm"
                            onClick={() => setChartTimeframe(tf)}
                            className={chartTimeframe === tf 
                              ? "bg-orange-500 hover:bg-orange-600 text-white" 
                              : "text-gray-400 hover:text-white hover:bg-white/10"}
                            title={`${label} (${barSize} bars)`}
                          >
                            <span>{label}</span>
                            <span className="ml-1 text-[10px] opacity-60">{barSize}</span>
                          </Button>
                        ))}
                      </div>
                    </CardHeader>
                    <CardContent className="pt-6">
                      {chartLoading && (
                        <div className="flex items-center justify-center h-[400px] text-gray-500">
                          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-500" />
                        </div>
                      )}
                      {!chartLoading && priceChartData.length === 0 && (
                        <div className="flex items-center justify-center h-[400px] text-gray-500">
                          {selectedTicker ? "No chart data available" : "Select a ticker to view chart"}
                        </div>
                      )}
                      {!chartLoading && priceChartData.length > 0 && (
                        <CandlestickChart 
                          data={priceChartData} 
                          livePrice={currentPrice}
                          timeframe={chartTimeframe}
                          orders={selectedTicker ? orders.filter(o => o.symbol === selectedTicker) : []}
                          positions={selectedTicker ? positions.filter(p => p.ticker === selectedTicker) : []}
                        />
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* News Tab */}
                <TabsContent value="news" className="mt-4">
                  <Card className="bg-slate-950 border-white/10 text-white">
                    <CardHeader className="pb-2 border-b border-white/5">
                      <CardTitle className="text-gray-400 font-normal uppercase tracking-wider text-xs">Latest News for {selectedTicker}</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-2">
                      {/* AI Analysis - Auto-loaded */}
                      {selectedTicker && (tickerNewsAnalysisLoading || tickerNewsAnalysis) && (
                        <div className="mb-4 p-4 bg-gradient-to-r from-orange-900/30 to-amber-900/30 rounded-lg border border-orange-500/20">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-orange-400 text-lg">✨</span>
                              <span className="text-sm font-medium text-orange-300">Analysis</span>
                            </div>
                            {tickerNewsPrompt && !tickerNewsAnalysisLoading && (
                              <button
                                onClick={() => setViewingPrompt(tickerNewsPrompt)}
                                className="text-xs text-orange-400/70 hover:text-orange-300 underline"
                              >
                                View prompt
                              </button>
                            )}
                          </div>
                          {tickerNewsAnalysisLoading ? (
                            <p className="text-sm text-gray-400 italic flex items-center gap-2">
                              <span className="animate-spin">⏳</span> Analyzing headlines for {selectedTicker}...
                            </p>
                          ) : (
                            <MarkdownDisplay 
                              content={tickerNewsAnalysis} 
                              className="text-sm text-gray-300"
                            />
                          )}
                        </div>
                      )}
                      
                      <NewsItemList
                        headlines={newsHeadlines}
                        loading={newsLoading}
                        emptyMessage={selectedTicker ? "No news available for this ticker" : "Select a ticker to view news"}
                        accentColor="orange"
                        onArticleClick={(article) => {
                          setSelectedArticle(article);
                          setIsNewsModalOpen(true);
                        }}
                      />
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="insights" className="mt-4">
                     <Card className="bg-slate-950 border-white/10">
                        <CardHeader>
                           <CardTitle className="text-blue-400">Analyst Insights for {selectedTicker}</CardTitle>
                        </CardHeader>
                        <CardContent>
                           <AnalystInsights ticker={selectedTicker || ""} />
                        </CardContent>
                     </Card>
                </TabsContent>

                <TabsContent value="insiderTrades" className="mt-4">
                     <Card className="bg-slate-950 border-white/10">
                        <CardHeader>
                           <CardTitle className="text-purple-400">Insider Trades for {selectedTicker}</CardTitle>
                        </CardHeader>
                        <CardContent>
                           <InsiderTrades ticker={selectedTicker || ""} />
                        </CardContent>
                     </Card>
                </TabsContent>

                <TabsContent value="filings8k" className="mt-4">
                     <Card className="bg-slate-950 border-white/10">
                        <CardHeader>
                           <CardTitle className="text-orange-400">8-K Filings for {selectedTicker}</CardTitle>
                        </CardHeader>
                        <CardContent>
                           <FilingsEightK ticker={selectedTicker || ""} />
                        </CardContent>
                     </Card>
                </TabsContent>

                <TabsContent value="filings10k" className="mt-4">
                     <Card className="bg-slate-950 border-white/10">
                        <CardHeader>
                           <CardTitle className="text-orange-400">Latest 10-K for {selectedTicker}</CardTitle>
                        </CardHeader>
                        <CardContent>
                           <FilingsTenK ticker={selectedTicker || ""} />
                        </CardContent>
                     </Card>
                </TabsContent>

                <TabsContent value="bigInvestors" className="mt-4">
                     <Card className="bg-slate-950 border-white/10">
                        <CardHeader>
                           <CardTitle className="text-purple-400">Big Investors holding {selectedTicker}</CardTitle>
                        </CardHeader>
                        <CardContent>
                           <BigInvestors ticker={selectedTicker || ""} />
                        </CardContent>
                     </Card>
                </TabsContent>

                <TabsContent value="payoff" className="mt-4 space-y-6">
               <Card className="bg-slate-950 border-white/10 text-white overflow-hidden">
                 <CardHeader className="flex flex-row items-center justify-between pb-6 border-b border-white/5 bg-white/5">
                    <CardTitle className="text-xl font-light tracking-wide">{selectedTicker}</CardTitle>
                    <div className="flex items-center gap-6 text-sm">
                       <div className="flex items-center gap-2">
                          <Switch 
                            checked={showStock} 
                            onCheckedChange={setShowStock} 
                            id="show-stock" 
                            className="data-[state=checked]:bg-slate-700"
                          />
                          <Label htmlFor="show-stock" className="text-slate-400 cursor-pointer touch-manipulation">Stock</Label>
                       </div>
                       <div className="flex items-center gap-2">
                          <Switch 
                            checked={showOptions} 
                            onCheckedChange={setShowOptions} 
                            id="show-options" 
                            className="data-[state=checked]:bg-purple-600"
                          />
                          <Label htmlFor="show-options" className="text-purple-400 cursor-pointer touch-manipulation">Options</Label>
                       </div>
                       <div className="flex items-center gap-2">
                          <Switch 
                            checked={showCombined} 
                            onCheckedChange={setShowCombined} 
                            id="show-combined" 
                            className="data-[state=checked]:bg-orange-600"
                          />
                          <Label htmlFor="show-combined" className="font-bold text-orange-500 cursor-pointer touch-manipulation">Combined</Label>
                       </div>
                       <div className="pl-4 border-l border-white/10 flex items-center gap-2">
                          <Switch 
                            checked={showT0} 
                            onCheckedChange={setShowT0} 
                            id="show-t0" 
                            className="data-[state=checked]:bg-cyan-500"
                          />
                          <Label htmlFor="show-t0" className="text-cyan-400 cursor-pointer touch-manipulation">Show T+0 Prediction</Label>
                       </div>
                    </div>
                 </CardHeader>
                 <CardContent className="pt-6">
                    {/* Simulation Controls */}
                    {showT0 && (
                        <div className="mb-8 p-4 bg-cyan-950/20 border border-cyan-500/20 rounded-lg grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div>
                                <div className="flex justify-between mb-2">
                                    <Label className="text-cyan-100">Implied Volatility (IV) Adjustment</Label>
                                    <span className={`text-sm font-mono ${ivAdjustment > 0 ? 'text-green-400' : ivAdjustment < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                                        {ivAdjustment > 0 ? '+' : ''}{(ivAdjustment * 100).toFixed(0)}%
                                    </span>
                                </div>
                                <Slider 
                                    min={-0.5} 
                                    max={0.5} 
                                    step={0.01} 
                                    value={[ivAdjustment]} 
                                    onValueChange={(vals) => setIvAdjustment(vals[0])}
                                    className="py-2"
                                />
                                <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                                    <span>-50%</span>
                                    <span>0%</span>
                                    <span>+50%</span>
                                </div>
                            </div>
                            <div>
                                <div className="flex justify-between mb-2">
                                    <Label className="text-cyan-100">Date Simulation</Label>
                                    <span className="text-sm font-mono text-cyan-200">
                                        {formatDate(targetDate)} <span className="text-xs text-gray-500">({daysOffset === 0 ? 'Today' : `+${daysOffset}d`})</span>
                                    </span>
                                </div>
                                <Slider 
                                    min={0} 
                                    max={180} 
                                    step={1} 
                                    value={[daysOffset]} 
                                    onValueChange={(vals) => setDaysOffset(vals[0])}
                                    className="py-2"
                                />
                                <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                                    <span>Today</span>
                                    <span>+6 Months</span>
                                </div>
                            </div>
                        </div>
                    )}

                    <PayoffChart 
                       data={chartData.data} 
                       currentPrice={currentPrice}
                       privacyMode={privacyMode}
                       showStock={showStock}
                       showOptions={showOptions}
                       showCombined={showCombined}
                       showT0={showT0}
                    />
                 </CardContent>
               </Card>
                </TabsContent>

                <TabsContent value="payoff" className="mt-4 space-y-6">
               <Card className="bg-slate-950 border-white/10 text-white overflow-hidden">
                 <CardHeader className="flex flex-row items-center justify-between pb-6 border-b border-white/5 bg-white/5">
                    <CardTitle className="text-xl font-light tracking-wide">{selectedTicker}</CardTitle>
                    <div className="flex items-center gap-6 text-sm">
                       <div className="flex items-center gap-2">
                          <Switch 
                            checked={showStock} 
                            onCheckedChange={setShowStock} 
                            id="show-stock" 
                            className="data-[state=checked]:bg-slate-700"
                          />
                          <Label htmlFor="show-stock" className="text-slate-400 cursor-pointer touch-manipulation">Stock</Label>
                       </div>
                       <div className="flex items-center gap-2">
                          <Switch 
                            checked={showOptions} 
                            onCheckedChange={setShowOptions} 
                            id="show-options" 
                            className="data-[state=checked]:bg-purple-600"
                          />
                          <Label htmlFor="show-options" className="text-purple-400 cursor-pointer touch-manipulation">Options</Label>
                       </div>
                       <div className="flex items-center gap-2">
                          <Switch 
                            checked={showCombined} 
                            onCheckedChange={setShowCombined} 
                            id="show-combined" 
                            className="data-[state=checked]:bg-orange-600"
                          />
                          <Label htmlFor="show-combined" className="font-bold text-orange-500 cursor-pointer touch-manipulation">Combined</Label>
                       </div>
                       <div className="pl-4 border-l border-white/10 flex items-center gap-2">
                          <Switch 
                            checked={showT0} 
                            onCheckedChange={setShowT0} 
                            id="show-t0" 
                            className="data-[state=checked]:bg-cyan-500"
                          />
                          <Label htmlFor="show-t0" className="text-cyan-400 cursor-pointer touch-manipulation">Show T+0 Prediction</Label>
                       </div>
                    </div>
                 </CardHeader>
                 <CardContent className="pt-6">
                    {/* Simulation Controls */}
                    {showT0 && (
                        <div className="mb-8 p-4 bg-cyan-950/20 border border-cyan-500/20 rounded-lg grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div>
                                <div className="flex justify-between mb-2">
                                    <Label className="text-cyan-100">Implied Volatility (IV) Adjustment</Label>
                                    <span className={`text-sm font-mono ${ivAdjustment > 0 ? 'text-green-400' : ivAdjustment < 0 ? 'text-red-400' : 'text-gray-400'}`}>
                                        {ivAdjustment > 0 ? '+' : ''}{(ivAdjustment * 100).toFixed(0)}%
                                    </span>
                                </div>
                                <Slider 
                                    min={-0.5} 
                                    max={0.5} 
                                    step={0.01} 
                                    value={[ivAdjustment]} 
                                    onValueChange={(vals) => setIvAdjustment(vals[0])}
                                    className="py-2"
                                />
                                <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                                    <span>-50%</span>
                                    <span>0%</span>
                                    <span>+50%</span>
                                </div>
                            </div>
                            <div>
                                <div className="flex justify-between mb-2">
                                    <Label className="text-cyan-100">Date Simulation</Label>
                                    <span className="text-sm font-mono text-cyan-200">
                                        {formatDate(targetDate)} <span className="text-xs text-gray-500">({daysOffset === 0 ? 'Today' : `+${daysOffset}d`})</span>
                                    </span>
                                </div>
                                <Slider 
                                    min={0} 
                                    max={180} 
                                    step={1} 
                                    value={[daysOffset]} 
                                    onValueChange={(vals) => setDaysOffset(vals[0])}
                                    className="py-2"
                                />
                                <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                                    <span>Today</span>
                                    <span>+6 Months</span>
                                </div>
                            </div>
                        </div>
                    )}

                    <PayoffChart 
                       data={chartData.data} 
                       currentPrice={currentPrice}
                       privacyMode={privacyMode}
                       showStock={showStock}
                       showOptions={showOptions}
                       showCombined={showCombined}
                       showT0={showT0}
                    />
                 </CardContent>
               </Card>
                </TabsContent>

                {/* Position & Risk Profile Tab */}
                <TabsContent value="risk" className="mt-4 space-y-6">
                  {/* Positions Table */}
                  <Card className="bg-slate-950 border-white/10 text-white">
                    <CardHeader><CardTitle className="text-gray-400 font-normal uppercase tracking-wider text-xs">Positions for {selectedTicker}</CardTitle></CardHeader>
                    <CardContent>
                        <div className="space-y-2">
                            {activePositions.map((pos, i) => (
                                <div key={i} className="flex justify-between items-center p-4 bg-white/5 rounded-lg border border-white/5 hover:bg-white/10 transition-colors">
                                    <div>
                                        <span className={`font-medium ${pos.position_type === 'call' ? 'text-green-400' : pos.position_type === 'put' ? 'text-red-400' : 'text-blue-400'}`}>
                                            {pos.qty > 0 ? '+' : ''}{pos.qty} {pos.position_type.toUpperCase()}
                                        </span>
                                        {pos.strike && <span className="ml-2 text-gray-300">@ {pos.strike}</span>}
                                        {pos.expiry && <span className="ml-2 text-xs text-gray-500 border border-white/10 px-2 py-0.5 rounded-full">
                                            {pos.expiry} <span className="text-gray-400">({pos.dte}d)</span>
                                        </span>}
                                        {pos.iv !== undefined && pos.iv > 0 && <span className="ml-2 text-xs text-orange-400 border border-orange-500/20 bg-orange-500/10 px-2 py-0.5 rounded-full">IV {pos.iv.toFixed(1)}%</span>}
                                    </div>
                                    <div className="text-right">
                                        <div className="text-sm font-mono text-gray-400">
                                            ${pos.cost_basis?.toFixed(2)}
                                        </div>
                                        {pos.unrealized_pnl !== undefined && (
                                            <div className={`text-xs font-mono font-bold ${pos.unrealized_pnl >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
                                                {pos.unrealized_pnl >= 0 ? "+" : ""}{formatCurrency(pos.unrealized_pnl)}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                  </Card>

                  {/* Max Profit/Loss Cards */}
                  {chartData.stats && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="p-4 rounded-lg bg-green-500/10 border border-green-500/30">
                            <p className="text-xs text-green-400 font-medium uppercase tracking-wider">Max Profit</p>
                            <p className="text-2xl font-light text-green-300 mt-1">
                                {formatBound(chartData.stats.maxProfit)}
                            </p>
                        </div>
                        <div className={`p-4 rounded-lg border ${chartData.stats.maxLoss > 0 ? "bg-green-500/10 border-green-500/30" : "bg-red-500/10 border-red-500/30"}`}>
                            <p className={`text-xs font-medium uppercase tracking-wider ${chartData.stats.maxLoss > 0 ? "text-green-400" : "text-red-400"}`}>
                                {chartData.stats.maxLoss > 0 ? "Guaranteed Profit" : "Max Loss"}
                            </p>
                            <p className={`text-2xl font-light mt-1 ${chartData.stats.maxLoss > 0 ? "text-green-300" : "text-red-300"}`}>
                                {chartData.stats.maxLoss > 0 
                                    ? formatBound(chartData.stats.maxLoss)
                                    : formatBound(-1 * chartData.stats.maxLoss)
                                }
                            </p>
                        </div>

                        <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/30">
                            <p className="text-xs text-blue-400 font-medium uppercase tracking-wider">Unrealized P&L</p>
                            <p className={`text-2xl font-light mt-1 ${totalUnrealizedPnl >= 0 ? "text-blue-300" : "text-red-300"}`}>
                                {totalUnrealizedPnl >= 0 ? "+" : ""}{formatCurrency(totalUnrealizedPnl)}
                            </p>
                        </div>
                    </div>
                  )}

                  {/* Risk Dashboard (Greeks) */}
                  <Card className="bg-slate-950 border-white/10 text-white">
                    <CardHeader><CardTitle className="text-gray-400 font-normal uppercase tracking-wider text-xs">Risk Profile (Greeks)</CardTitle></CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="p-4 rounded-lg bg-orange-500/5 border border-orange-500/20">
                            <p className="text-xs text-orange-400 font-medium uppercase tracking-wider">Net Delta</p>
                            <p className="text-xl font-mono text-orange-200 mt-1">{netRisk.delta.toFixed(0)}</p>
                            <p className="text-[10px] text-gray-500 mt-1">Eq. Shares exposure</p>
                            </div>
                            <div className="p-4 rounded-lg bg-purple-500/5 border border-purple-500/20">
                            <p className="text-xs text-purple-400 font-medium uppercase tracking-wider">Net Gamma</p>
                            <p className="text-xl font-mono text-purple-200 mt-1">{netRisk.gamma.toFixed(2)}</p>
                            <p className="text-[10px] text-gray-500 mt-1">Delta acceleration</p>
                            </div>
                            <div className="p-4 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                            <p className="text-xs text-emerald-400 font-medium uppercase tracking-wider">Net Theta</p>
                            <p className="text-xl font-mono text-emerald-200 mt-1">${netRisk.theta.toFixed(0)}</p>
                            <p className="text-[10px] text-gray-500 mt-1">Daily time decay</p>
                            </div>
                            <div className="p-4 rounded-lg bg-cyan-500/5 border border-cyan-500/20">
                            <p className="text-xs text-cyan-400 font-medium uppercase tracking-wider">Net Vega</p>
                            <p className="text-xl font-mono text-cyan-200 mt-1">${netRisk.vega.toFixed(0)}</p>
                            <p className="text-[10px] text-gray-500 mt-1">Vol sensitivity</p>
                            </div>
                        </div>
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Trade Stock Tab */}
                <TabsContent value="trade" className="mt-4">
                  <Card className="bg-slate-950 border-white/10 text-white">
                    <CardHeader className="pb-4 border-b border-white/5">
                      <CardTitle className="text-gray-400 font-normal uppercase tracking-wider text-xs">Place Stock Order</CardTitle>
                    </CardHeader>
                    <CardContent className="pt-6">
                      {!ibConnected ? (
                        <div className="text-center py-12">
                          <div className="text-yellow-400 text-lg mb-2">⚠️ IBKR Not Connected</div>
                          <p className="text-gray-500">Connect to TWS to place trades</p>
                        </div>
                      ) : (
                        <div className="max-w-md mx-auto space-y-6">
                          {/* Quick Trade Buttons */}
                          {selectedTicker && currentPrice > 0 && (
                            <div className="space-y-3">
                              <div className="text-sm text-gray-500 uppercase tracking-wider">Quick Trade (Market Order)</div>
                              <div className="grid grid-cols-3 gap-2">
                                {[10000, 50000, 100000].map((amount) => {
                                  const qty = Math.floor(amount / currentPrice);
                                  return qty > 0 ? (
                                    <div key={amount} className="space-y-1">
                                      <button
                                        onClick={async () => {
                                          setTradeSubmitting(true);
                                          const result = await placeTrade({
                                            symbol: selectedTicker,
                                            action: "BUY",
                                            quantity: qty,
                                            order_type: "MARKET",
                                          });
                                          if (result.success) {
                                            showToast(`✓ BUY ${qty} ${selectedTicker} - Order #${result.order_id}`, "success");
                                          } else {
                                            showToast(`✗ Order failed: ${result.error}`, "error");
                                          }
                                          setTradeSubmitting(false);
                                        }}
                                        disabled={tradeSubmitting}
                                        className="w-full py-2 px-2 rounded-lg font-bold text-sm bg-green-500/20 text-green-400 hover:bg-green-500/30 border border-green-500/30 transition-all disabled:opacity-50"
                                      >
                                        BUY ~${(amount/1000).toFixed(0)}k
                                      </button>
                                      <button
                                        onClick={async () => {
                                          setTradeSubmitting(true);
                                          const result = await placeTrade({
                                            symbol: selectedTicker,
                                            action: "SELL",
                                            quantity: qty,
                                            order_type: "MARKET",
                                          });
                                          if (result.success) {
                                            showToast(`✓ SELL ${qty} ${selectedTicker} - Order #${result.order_id}`, "success");
                                          } else {
                                            showToast(`✗ Order failed: ${result.error}`, "error");
                                          }
                                          setTradeSubmitting(false);
                                        }}
                                        disabled={tradeSubmitting}
                                        className="w-full py-2 px-2 rounded-lg font-bold text-sm bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30 transition-all disabled:opacity-50"
                                      >
                                        SELL ~${(amount/1000).toFixed(0)}k
                                      </button>
                                      <div className="text-[10px] text-gray-500 text-center">
                                        {qty} shares
                                      </div>
                                    </div>
                                  ) : null;
                                })}
                              </div>
                            </div>
                          )}

                          <div className="border-t border-white/10 pt-6">
                            <div className="text-sm text-gray-500 uppercase tracking-wider mb-4">Custom Order</div>
                          </div>

                          {/* Action Toggle */}
                          <div>
                            <div className="text-sm text-gray-500 uppercase tracking-wider mb-2">Action</div>
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                onClick={() => setTradeAction("BUY")}
                                className={`py-3 px-4 rounded-lg font-bold text-lg transition-all ${
                                  tradeAction === "BUY"
                                    ? "bg-green-500 text-white shadow-lg shadow-green-500/30"
                                    : "bg-white/5 text-gray-400 hover:bg-white/10"
                                }`}
                              >
                                BUY
                              </button>
                              <button
                                onClick={() => setTradeAction("SELL")}
                                className={`py-3 px-4 rounded-lg font-bold text-lg transition-all ${
                                  tradeAction === "SELL"
                                    ? "bg-red-500 text-white shadow-lg shadow-red-500/30"
                                    : "bg-white/5 text-gray-400 hover:bg-white/10"
                                }`}
                              >
                                SELL
                              </button>
                            </div>
                          </div>

                          {/* Quantity */}
                          <div>
                            <div className="text-sm text-gray-500 uppercase tracking-wider mb-2">Quantity (Shares)</div>
                            <Input
                              type="number"
                              min={1}
                              value={tradeQuantity}
                              onChange={(e) => setTradeQuantity(Math.max(1, parseInt(e.target.value) || 1))}
                              className="bg-white/5 border-white/10 text-white text-center text-2xl font-mono h-14"
                            />
                          </div>

                          {/* Order Type Toggle */}
                          <div>
                            <div className="text-sm text-gray-500 uppercase tracking-wider mb-2">Order Type</div>
                            <div className="grid grid-cols-3 gap-2">
                              <button
                                onClick={() => setTradeOrderType("MARKET")}
                                className={`py-2 px-2 text-sm rounded-lg font-medium transition-all ${
                                  tradeOrderType === "MARKET"
                                    ? "bg-orange-500 text-white"
                                    : "bg-white/5 text-gray-400 hover:bg-white/10"
                                }`}
                              >
                                Market
                              </button>
                              <button
                                onClick={() => setTradeOrderType("LIMIT")}
                                className={`py-2 px-2 text-sm rounded-lg font-medium transition-all ${
                                  tradeOrderType === "LIMIT"
                                    ? "bg-orange-500 text-white"
                                    : "bg-white/5 text-gray-400 hover:bg-white/10"
                                }`}
                              >
                                Limit
                              </button>
                              <button
                                onClick={() => setTradeOrderType("TRAIL")}
                                className={`py-2 px-2 text-sm rounded-lg font-medium transition-all ${
                                  tradeOrderType === "TRAIL"
                                    ? "bg-orange-500 text-white"
                                    : "bg-white/5 text-gray-400 hover:bg-white/10"
                                }`}
                              >
                                Trailing
                              </button>
                            </div>
                          </div>

                          {/* Time in Force Toggle */}
                          <div>
                            <div className="text-sm text-gray-500 uppercase tracking-wider mb-2">Duration</div>
                            <div className="grid grid-cols-2 gap-2">
                              <button
                                onClick={() => setTradeTif("DAY")}
                                className={`py-2 px-4 rounded-lg font-medium transition-all ${
                                  tradeTif === "DAY"
                                    ? "bg-blue-500 text-white"
                                    : "bg-white/5 text-gray-400 hover:bg-white/10"
                                }`}
                              >
                                Day
                              </button>
                              <button
                                onClick={() => setTradeTif("GTC")}
                                className={`py-2 px-4 rounded-lg font-medium transition-all ${
                                  tradeTif === "GTC"
                                    ? "bg-blue-500 text-white"
                                    : "bg-white/5 text-gray-400 hover:bg-white/10"
                                }`}
                              >
                                GTC
                              </button>
                            </div>
                          </div>

                          {/* Limit Price (only for LIMIT orders) */}
                          {tradeOrderType === "LIMIT" && (
                            <div>
                              <div className="text-sm text-gray-500 uppercase tracking-wider mb-2">Limit Price</div>
                              <div className="relative">
                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xl">$</span>
                                <Input
                                  type="number"
                                  step="0.01"
                                  min={0.01}
                                  value={tradeLimitPrice}
                                  onChange={(e) => setTradeLimitPrice(e.target.value)}
                                  placeholder={currentPrice > 0 ? currentPrice.toFixed(2) : "0.00"}
                                  className="bg-white/5 border-white/10 text-white text-center text-2xl font-mono h-14 pl-10"
                                />
                              </div>
                            </div>
                          )}

                          {/* Trailing Stop Inputs */}
                          {tradeOrderType === "TRAIL" && (
                            <div>
                              <div className="flex items-center justify-between mb-2">
                                <div className="text-sm text-gray-500 uppercase tracking-wider">Trailing Amount</div>
                                <div className="flex bg-white/5 rounded p-0.5">
                                  <button 
                                    className={`px-2 py-0.5 text-xs rounded ${tradeTrailType === "AMOUNT" ? "bg-orange-500 text-white" : "text-gray-400"}`}
                                    onClick={() => setTradeTrailType("AMOUNT")}
                                  >
                                    $
                                  </button>
                                  <button 
                                    className={`px-2 py-0.5 text-xs rounded ${tradeTrailType === "PERCENT" ? "bg-orange-500 text-white" : "text-gray-400"}`}
                                    onClick={() => setTradeTrailType("PERCENT")}
                                  >
                                    %
                                  </button>
                                </div>
                              </div>
                              <div className="relative">
                                {tradeTrailType === "AMOUNT" && (
                                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 text-xl">$</span>
                                )}
                                {tradeTrailType === "PERCENT" && (
                                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 text-xl">%</span>
                                )}
                                <Input
                                  type="number"
                                  step={tradeTrailType === "AMOUNT" ? "0.01" : "0.1"}
                                  min={0.01}
                                  value={tradeTrailValue}
                                  onChange={(e) => setTradeTrailValue(e.target.value)}
                                  placeholder={tradeTrailType === "AMOUNT" ? "1.00" : "5.0"}
                                  className={`bg-white/5 border-white/10 text-white text-center text-2xl font-mono h-14 ${tradeTrailType === "AMOUNT" ? "pl-10" : "pr-10"}`}
                                />
                              </div>
                            </div>
                          )}

                          {/* Order Summary */}
                          <div className="p-4 bg-white/5 rounded-lg border border-white/10">
                            <div className="text-sm text-gray-500 uppercase tracking-wider mb-2">Order Summary</div>
                            <div className={`text-lg font-medium ${
                              tradeAction === "BUY" ? "text-green-400" : "text-red-400"
                            }`}>
                              {tradeAction} {tradeQuantity} {selectedTicker || "---"} @ {tradeOrderType} ({tradeTif})
                              {tradeOrderType === "LIMIT" && tradeLimitPrice && ` $${parseFloat(tradeLimitPrice).toFixed(2)}`}
                            </div>
                            {tradeOrderType === "MARKET" && currentPrice > 0 && (
                              <div className="text-sm text-gray-500 mt-1">
                                Est. Value: {formatCurrency(tradeQuantity * currentPrice, true)}
                              </div>
                            )}
                            {tradeOrderType === "LIMIT" && tradeLimitPrice && parseFloat(tradeLimitPrice) > 0 && (
                              <div className="text-sm text-gray-500 mt-1">
                                Est. Value: {formatCurrency(tradeQuantity * parseFloat(tradeLimitPrice), true)}
                              </div>
                            )}
                          </div>

                          {/* Submit Button */}
                          <Button
                            onClick={async () => {
                              if (!selectedTicker) return;
                              setTradeSubmitting(true);
                              
                              const order: TradeOrder = {
                                symbol: selectedTicker,
                                action: tradeAction,
                                quantity: tradeQuantity,
                                order_type: tradeOrderType,
                                limit_price: tradeOrderType === "LIMIT" ? parseFloat(tradeLimitPrice) : undefined,
                                trailing_amount: tradeOrderType === "TRAIL" && tradeTrailType === "AMOUNT" ? parseFloat(tradeTrailValue) : undefined,
                                trailing_percent: tradeOrderType === "TRAIL" && tradeTrailType === "PERCENT" ? parseFloat(tradeTrailValue) : undefined,
                                tif: tradeTif,
                              };
                              
                              const result = await placeTrade(order);
                              if (result.success) {
                                showToast(`✓ ${tradeAction} ${tradeQuantity} ${selectedTicker} - Order #${result.order_id}`, "success");
                                // Wait for IBKR to settle, then refresh portfolio
                                setTimeout(() => refreshPortfolio(), 2500);
                              } else {
                                showToast(`✗ Order failed: ${result.error}`, "error");
                              }
                              setTradeSubmitting(false);
                            }}
                            disabled={!selectedTicker || tradeSubmitting || (tradeOrderType === "LIMIT" && (!tradeLimitPrice || parseFloat(tradeLimitPrice) <= 0))}
                            className={`w-full py-4 text-lg font-bold transition-all ${
                              tradeAction === "BUY"
                                ? "bg-green-500 hover:bg-green-600 disabled:bg-green-500/30"
                                : "bg-red-500 hover:bg-red-600 disabled:bg-red-500/30"
                            } text-white disabled:text-gray-400`}
                          >
                            {tradeSubmitting ? (
                              <span className="flex items-center justify-center gap-2">
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white" />
                                Placing Order...
                              </span>
                            ) : (
                              `${tradeAction} ${selectedTicker || "---"}`
                            )}
                          </Button>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>

                {/* Options Chain Tab */}
                <TabsContent value="options" className="mt-4">
                  <Card className="bg-slate-950 border-white/10 text-white">
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-lg text-purple-400">Options Chain</CardTitle>
                        <div className="flex items-center gap-2">
                          {optionsChain && (optionsChain as any).cached && !optionsChainLoading && (
                            <span className="text-xs text-yellow-400">
                              Cached ({Math.floor((optionsChain as any).cache_age_seconds || 0)}s ago)
                            </span>
                          )}
                          <Button
                            size="sm"
                            onClick={() => loadOptionsChain(selectedTicker || "", true)}
                            disabled={!selectedTicker || optionsChainLoading}
                            className="bg-purple-500 hover:bg-purple-600 disabled:bg-purple-400 disabled:cursor-not-allowed"
                          >
                            Refresh
                          </Button>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {!selectedTicker && (
                        <div className="text-center text-gray-500 py-12">Select a ticker to view options chain</div>
                      )}
                      
                      {selectedTicker && !optionsChain && !optionsChainLoading && (
                        <div className="text-center py-12">
                          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500 mx-auto mb-4" />
                          <div className="text-gray-500">Loading options chain...</div>
                        </div>
                      )}

                      {optionsChain && (
                        <OptionsStrategyControls
                          ticker={selectedTicker || ""}
                          currentPrice={currentPrice}
                          positions={positions}
                          optionsChain={optionsChain}
                          onUpdateLegs={(legs) => {
                             // Only update if legs changed meaningfully to avoid loops?
                             // JSON.stringify comparison is cheap enough for this size
                             const currentJson = JSON.stringify(selectedLegs.map(l => ({s: l.strike, r: l.right, a: l.action, quantity: l.quantity, e: l.expiry})));
                             const newJson = JSON.stringify(legs.map(l => ({s: l.strike, r: l.right, a: l.action, quantity: l.quantity, e: l.expiry})));
                             if (currentJson !== newJson) {
                               setSelectedLegs(legs);
                               // Also sync the expiry tab to the one selected by strategy?
                               if (legs.length > 0 && legs[0].expiry !== selectedExpiry) {
                                 setSelectedExpiry(legs[0].expiry);
                               }
                             }
                          }}
                        />
                      )}
                      
                      {optionsChain && optionsChain.expirations.length > 0 && (
                        <div className="space-y-4">
                          {/* Expiration Tabs */}
                          <div className="flex gap-1 overflow-x-auto pb-2">
                            {optionsChain.expirations.map(exp => {
                              const formatted = exp.length === 8 
                                ? `${exp.slice(4,6)}/${exp.slice(6,8)}`
                                : exp;
                              return (
                                <button
                                  key={exp}
                                  onClick={() => setSelectedExpiry(exp)}
                                  className={`px-3 py-1.5 text-xs rounded-md whitespace-nowrap transition-all ${
                                    selectedExpiry === exp
                                      ? "bg-purple-500 text-white"
                                      : "bg-white/5 text-gray-400 hover:bg-white/10"
                                  }`}
                                >
                                  {formatted}
                                </button>
                              );
                            })}
                          </div>
                          
                          {/* Options Table */}
                          {selectedExpiry && (optionsChain.calls[selectedExpiry] || optionsChain.puts[selectedExpiry]) && (
                            <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                              <table className="w-full text-xs">
                                <thead className="sticky top-0 bg-slate-950">
                                    <tr className="border-b border-white/10">
                                    <th colSpan={9} className="text-center text-green-400 py-2 border-r border-white/10">CALLS</th>
                                    <th className="text-center text-white py-2 px-2">Strike</th>
                                    <th colSpan={9} className="text-center text-red-400 py-2 border-l border-white/10">PUTS</th>
                                  </tr>
                                  <tr className="border-b border-white/10 text-gray-500">
                                    <th className="text-right py-1 px-1">Bid</th>
                                    <th className="text-right py-1 px-1">Ask</th>
                                    <th className="text-right py-1 px-1">Last</th>
                                    <th className="text-right py-1 px-1">Vol</th>
                                    <th className="text-right py-1 px-1">IV%</th>
                                    <th className="text-right py-1 px-1 text-xs">Δ</th>
                                    <th className="text-right py-1 px-1 text-xs">Γ</th>
                                    <th className="text-right py-1 px-1 text-xs">Θ</th>
                                    <th className="text-right py-1 px-1 text-xs border-r border-white/10">ν</th>
                                    <th className="text-center py-1 px-2"></th>
                                    <th className="text-right py-1 px-1 border-l border-white/10">Bid</th>
                                    <th className="text-right py-1 px-1">Ask</th>
                                    <th className="text-right py-1 px-1">Last</th>
                                    <th className="text-right py-1 px-1">Vol</th>
                                    <th className="text-right py-1 px-1">IV%</th>
                                    <th className="text-right py-1 px-1 text-xs">Δ</th>
                                    <th className="text-right py-1 px-1 text-xs">Γ</th>
                                    <th className="text-right py-1 px-1 text-xs">Θ</th>
                                    <th className="text-right py-1 px-1 text-xs">ν</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {optionsChain.strikes.map(strike => {
                                    const call = getStrikeQuote(optionsChain.calls, selectedExpiry, strike) as OptionQuote | undefined;
                                    const put = getStrikeQuote(optionsChain.puts, selectedExpiry, strike) as OptionQuote | undefined;
                                    const isAtm = Math.abs(strike - optionsChain.underlying_price) < (optionsChain.underlying_price * 0.02);
                                    const callItm = strike < optionsChain.underlying_price;
                                    const putItm = strike > optionsChain.underlying_price;
                                    
                                    return (
                                      <tr 
                                        key={strike} 
                                        className={`border-b border-white/5 ${isAtm ? "bg-purple-500/10" : ""}`}
                                      >
                                        {/* Call Side - clickable bid (sell) and ask (buy) */}
                                        {(() => {
                                          const callSellSelected = isLegSelected(selectedExpiry, strike, "C", "SELL");
                                          const callBuySelected = isLegSelected(selectedExpiry, strike, "C", "BUY");
                                          return (
                                            <>
                                              <td 
                                                className={`text-right py-1 px-1 cursor-pointer touch-manipulation transition-colors ${
                                                  callSellSelected ? "bg-red-500/40 ring-1 ring-red-400" : "hover:bg-red-500/30"
                                                } ${callItm && !callSellSelected ? "bg-green-500/10" : ""}`}
                                                onClick={() => call && toggleLegInStrategy(selectedExpiry, strike, "C", "SELL", call.mid)}
                                                title="Sell Call"
                                              >
                                                {call?.bid?.toFixed(2) || "-"}
                                              </td>
                                              <td 
                                                className={`text-right py-1 px-1 cursor-pointer touch-manipulation transition-colors ${
                                                  callBuySelected ? "bg-green-500/40 ring-1 ring-green-400" : "hover:bg-green-500/30"
                                                } ${callItm && !callBuySelected ? "bg-green-500/10" : ""}`}
                                                onClick={() => call && toggleLegInStrategy(selectedExpiry, strike, "C", "BUY", call.mid)}
                                                title="Buy Call"
                                              >
                                                {call?.ask?.toFixed(2) || "-"}
                                              </td>
                                            </>
                                          );
                                        })()}
                                        <td className={`text-right py-1 px-1 ${callItm ? "bg-green-500/10" : ""}`}>
                                          {call?.last?.toFixed(2) || "-"}
                                        </td>
                                        <td className={`text-right py-1 px-1 text-gray-500 ${callItm ? "bg-green-500/10" : ""}`}>
                                          {call?.volume || "-"}
                                        </td>
                                        <td className={`text-right py-1 px-1 text-gray-500 ${callItm ? "bg-green-500/10" : ""}`}>
                                          {call?.iv?.toFixed(1) || "-"}
                                        </td>
                                        <td className={`text-right py-1 px-1 text-gray-400 font-mono text-[10px] ${callItm ? "bg-green-500/10" : ""}`}>
                                          {call?.delta?.toFixed(3) || "-"}
                                        </td>
                                        <td className={`text-right py-1 px-1 text-gray-400 font-mono text-[10px] ${callItm ? "bg-green-500/10" : ""}`}>
                                          {call?.gamma?.toFixed(3) || "-"}
                                        </td>
                                        <td className={`text-right py-1 px-1 text-gray-400 font-mono text-[10px] ${callItm ? "bg-green-500/10" : ""}`}>
                                          {call?.theta?.toFixed(3) || "-"}
                                        </td>
                                        <td className={`text-right py-1 px-1 text-gray-400 font-mono text-[10px] border-r border-white/10 ${callItm ? "bg-green-500/10" : ""}`}>
                                          {call?.vega?.toFixed(3) || "-"}
                                        </td>
                                        
                                        {/* Strike */}
                                        <td className={`text-center py-1 px-2 font-medium ${isAtm ? "text-purple-400" : "text-white"}`}>
                                          {strike.toFixed(2)}
                                        </td>
                                        
                                        {/* Put Side - clickable bid (sell) and ask (buy) */}
                                        {(() => {
                                          const putSellSelected = isLegSelected(selectedExpiry, strike, "P", "SELL");
                                          const putBuySelected = isLegSelected(selectedExpiry, strike, "P", "BUY");
                                          return (
                                            <>
                                              <td 
                                                className={`text-right py-1 px-1 border-l border-white/10 cursor-pointer touch-manipulation transition-colors ${
                                                  putSellSelected ? "bg-red-500/40 ring-1 ring-red-400" : "hover:bg-red-500/30"
                                                } ${putItm && !putSellSelected ? "bg-red-500/10" : ""}`}
                                                onClick={() => put && toggleLegInStrategy(selectedExpiry, strike, "P", "SELL", put.mid)}
                                                title="Sell Put"
                                              >
                                                {put?.bid?.toFixed(2) || "-"}
                                              </td>
                                              <td 
                                                className={`text-right py-1 px-1 cursor-pointer touch-manipulation transition-colors ${
                                                  putBuySelected ? "bg-green-500/40 ring-1 ring-green-400" : "hover:bg-green-500/30"
                                                } ${putItm && !putBuySelected ? "bg-red-500/10" : ""}`}
                                                onClick={() => put && toggleLegInStrategy(selectedExpiry, strike, "P", "BUY", put.mid)}
                                                title="Buy Put"
                                              >
                                                {put?.ask?.toFixed(2) || "-"}
                                              </td>
                                            </>
                                          );
                                        })()}
                                        <td className={`text-right py-1 px-1 ${putItm ? "bg-red-500/10" : ""}`}>
                                          {put?.last?.toFixed(2) || "-"}
                                        </td>
                                        <td className={`text-right py-1 px-1 text-gray-500 ${putItm ? "bg-red-500/10" : ""}`}>
                                          {put?.volume || "-"}
                                        </td>
                                        <td className={`text-right py-1 px-1 text-gray-500 ${putItm ? "bg-red-500/10" : ""}`}>
                                          {put?.iv?.toFixed(1) || "-"}
                                        </td>
                                        <td className={`text-right py-1 px-1 text-gray-400 font-mono text-[10px] ${putItm ? "bg-red-500/10" : ""}`}>
                                          {put?.delta?.toFixed(3) || "-"}
                                        </td>
                                        <td className={`text-right py-1 px-1 text-gray-400 font-mono text-[10px] ${putItm ? "bg-red-500/10" : ""}`}>
                                          {put?.gamma?.toFixed(3) || "-"}
                                        </td>
                                        <td className={`text-right py-1 px-1 text-gray-400 font-mono text-[10px] ${putItm ? "bg-red-500/10" : ""}`}>
                                          {put?.theta?.toFixed(3) || "-"}
                                        </td>
                                        <td className={`text-right py-1 px-1 text-gray-400 font-mono text-[10px] ${putItm ? "bg-red-500/10" : ""}`}>
                                          {put?.vega?.toFixed(3) || "-"}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          )}
                          
                          {selectedExpiry && !optionsChain.calls[selectedExpiry] && !optionsChain.puts[selectedExpiry] && (
                            <div className="text-center text-gray-500 py-8">
                              No data for this expiration.
                            </div>
                          )}
                        </div>
                      )}
                      
                      {optionsChain && optionsChain.error && (
                        <div className="text-center text-red-400 py-8">{optionsChain.error}</div>
                      )}
                    </CardContent>
                  </Card>
                  
                  {/* Strategy Builder Panel */}
                  {selectedLegs.length > 0 && (
                    <Card className="bg-slate-950 border-purple-500/30 text-white mt-4">
                      <CardHeader className="pb-2 border-b border-white/10">
                        <CardTitle className="text-lg text-purple-400 flex items-center justify-between">
                          <span>Strategy Builder</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setSelectedLegs([])}
                            className="text-gray-400 hover:text-white"
                          >
                            Clear All
                          </Button>
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pt-4">
                        <div className="space-y-2">
                          {selectedLegs.map((leg, i) => {
                            const legCost = getLegPrice(leg);
                            const expDisplay = `${leg.expiry.slice(4,6)}/${leg.expiry.slice(6,8)}`;
                            return (
                              <div key={i} className="flex items-center gap-2 bg-white/5 rounded-lg p-2">
                                {/* Action Toggle */}
                                <select
                                  value={leg.action}
                                  onChange={(e) => updateLeg(i, "action", e.target.value as "BUY" | "SELL")}
                                  className={`px-2 py-1 rounded text-xs font-medium ${
                                    leg.action === "BUY" 
                                      ? "bg-green-500/20 text-green-400 border border-green-500/50" 
                                      : "bg-red-500/20 text-red-400 border border-red-500/50"
                                  }`}
                                >
                                  <option value="BUY">BUY</option>
                                  <option value="SELL">SELL</option>
                                </select>
                                
                                {/* Quantity */}
                                <input
                                  type="number"
                                  min="1"
                                  max="100"
                                  value={leg.quantity}
                                  onChange={(e) => updateLeg(i, "quantity", parseInt(e.target.value) || 1)}
                                  className="w-12 px-2 py-1 rounded bg-white/10 border border-white/20 text-white text-xs text-center"
                                />
                                
                                {/* Contract Description */}
                                <span className="flex-1 text-sm">
                                  <span className="text-white font-medium">{leg.symbol}</span>
                                  <span className="text-gray-400 ml-2">{expDisplay}</span>
                                  <span className="text-white ml-2">${leg.strike}</span>
                                  <span className={`ml-1 ${leg.right === "C" ? "text-green-400" : "text-red-400"}`}>
                                    {leg.right === "C" ? "Call" : "Put"}
                                  </span>
                                </span>
                                
                                {/* Cost */}
                                <span className={`text-sm font-medium w-24 text-right ${legCost >= 0 ? "text-red-400" : "text-green-400"}`}>
                                  {legCost >= 0 ? "-" : "+"}${Math.abs(legCost).toFixed(2)}
                                </span>
                                
                                {/* Remove */}
                                <button
                                  onClick={() => removeLeg(i)}
                                  className="text-gray-500 hover:text-red-400 transition-colors"
                                >
                                  ✕
                                </button>
                              </div>
                            );
                          })}
                        </div>
                        
                        {/* Payoff Chart */}
                        {strategyPayoffData.data.length > 0 && (
                          <div className="mt-4 pt-4 border-t border-white/10">
                            {/* Toggle for existing positions */}
                            {activePositions.filter(p => p.ticker === selectedTicker).length > 0 && (
                              <div className="flex items-center gap-2 mb-3">
                                <Switch
                                  checked={showExistingPositions}
                                  onCheckedChange={setShowExistingPositions}
                                  className="data-[state=checked]:bg-orange-600"
                                />
                                <Label className="text-xs text-gray-400 cursor-pointer touch-manipulation">
                                  Superimpose on existing {selectedTicker} positions
                                </Label>
                              </div>
                            )}
                            
                            {/* Chart */}
                            <div className="h-48 w-full">
                              <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={strategyPayoffData.data} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
                                  <XAxis 
                                    dataKey="price" 
                                    stroke="#6b7280" 
                                    tick={{ fontSize: 10 }}
                                    tickFormatter={(v) => `$${v.toFixed(0)}`}
                                  />
                                  <YAxis 
                                    stroke="#6b7280" 
                                    tick={{ fontSize: 10 }}
                                    tickFormatter={(v) => `$${v >= 0 ? '' : '-'}${Math.abs(v / 1000).toFixed(1)}k`}
                                  />
                                  <ReferenceLine y={0} stroke="#4b5563" strokeDasharray="3 3" />
                                  <ReferenceLine 
                                    x={strategyPayoffData.currentPrice} 
                                    stroke="#a855f7" 
                                    strokeDasharray="3 3" 
                                    label={{ value: "Now", position: "top", fill: "#a855f7", fontSize: 10 }}
                                  />
                                  <Tooltip 
                                    contentStyle={{ background: "#1e293b", border: "1px solid #334155", borderRadius: "8px" }}
                                    labelFormatter={(v) => `Price: $${Number(v).toFixed(2)}`}
                                    formatter={(value, name) => [
                                      `$${(value as number)?.toFixed(0) ?? 0}`,
                                      name === "strategy" ? "Strategy P&L" : "Combined P&L"
                                    ]}
                                  />
                                  {!showExistingPositions && (
                                    <Line
                                      type="monotone"
                                      dataKey="strategy"
                                      stroke="#a855f7"
                                      strokeWidth={2}
                                      dot={false}
                                      name="Strategy"
                                      isAnimationActive={false}
                                    />
                                  )}
                                  {showExistingPositions && (
                                    <Line
                                      type="monotone"
                                      dataKey="combined"
                                      stroke="#f97316"
                                      strokeWidth={2}
                                      dot={false}
                                      name="Combined"
                                      isAnimationActive={false}
                                    />
                                  )}
                                </LineChart>
                              </ResponsiveContainer>
                            </div>
                            
                            {/* Max Profit / Max Loss / Breakevens */}
                            <div className="grid grid-cols-3 gap-2 mt-3">
                              <div className="p-2 rounded bg-green-500/10 border border-green-500/30 text-center">
                                <p className="text-[10px] text-green-400 uppercase tracking-wider">Max Profit</p>
                                <p className="text-sm font-medium text-green-300">
                                  {Number.isFinite(strategyPayoffData.maxProfit) 
                                    ? formatCurrency(strategyPayoffData.maxProfit)
                                    : "∞"}
                                </p>
                              </div>
                              <div className="p-2 rounded bg-red-500/10 border border-red-500/30 text-center">
                                <p className="text-[10px] text-red-400 uppercase tracking-wider">Max Loss</p>
                                <p className="text-sm font-medium text-red-300">
                                  {Number.isFinite(strategyPayoffData.maxLoss)
                                    ? formatCurrency(Math.abs(strategyPayoffData.maxLoss))
                                    : "∞"}
                                </p>
                              </div>

                            </div>
                          </div>
                        )}
                        
                        {/* Net Cost and Submit */}
                        <div className="mt-4 pt-4 border-t border-white/10 flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div className="text-sm">
                              <span className="text-gray-400">Net:</span>
                              <span className={`ml-2 font-bold text-lg ${netCost >= 0 ? "text-red-400" : "text-green-400"}`}>
                                {netCost >= 0 ? "Debit " : "Credit "}${Math.abs(netCost).toFixed(2)}
                              </span>
                            </div>
                            
                            {/* Order Type */}
                            <select
                              value={optionsOrderType}
                              onChange={(e) => setOptionsOrderType(e.target.value as "MARKET" | "LIMIT")}
                              className="px-2 py-1 rounded bg-white/10 border border-white/20 text-white text-xs"
                            >
                              <option value="MARKET">Market</option>
                              <option value="LIMIT">Limit</option>
                            </select>
                            
                            {optionsOrderType === "LIMIT" && (
                              <input
                                type="number"
                                step="0.01"
                                placeholder="Limit $"
                                value={optionsLimitPrice}
                                onChange={(e) => setOptionsLimitPrice(e.target.value)}
                                className="w-20 px-2 py-1 rounded bg-white/10 border border-white/20 text-white text-xs"
                              />
                            )}
                          </div>
                          
                          <Button
                            onClick={async () => {
                              if (selectedLegs.length === 0) return;
                              setOptionsOrderSubmitting(true);
                              const result = await placeOptionsOrder({
                                legs: selectedLegs,
                                order_type: optionsOrderType,
                                limit_price: optionsOrderType === "LIMIT" ? parseFloat(optionsLimitPrice) : undefined,
                              });
                              setOptionsOrderSubmitting(false);
                              if (result.success) {
                                showToast(`Order placed! ${result.message}`, "success");
                                setSelectedLegs([]);
                                // Wait for IBKR to settle, then refresh portfolio
                                setTimeout(() => refreshPortfolio(), 2500);
                              } else {
                                showToast(`Order failed: ${result.error}`, "error");
                              }
                            }}
                            disabled={optionsOrderSubmitting || selectedLegs.length === 0}
                            className="bg-purple-500 hover:bg-purple-600 px-6"
                          >
                            {optionsOrderSubmitting ? "Submitting..." : "Place Order"}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          </div>
        </TabsContent>
      </Tabs>
        </div>
       )}

      {/* Global News Article Modal - accessible from both Market News and per-ticker News tabs */}
      {selectedArticle && (
        <NewsModal
          isOpen={isNewsModalOpen}
          onClose={() => {
            setIsNewsModalOpen(false);
            setSelectedArticle(null);
          }}
          providerCode={selectedArticle.providerCode}
          articleId={selectedArticle.articleId}
          headline={selectedArticle.headline}
          articleBody={selectedArticle.body}
          articleUrl={selectedArticle.url}
          articleImageUrl={selectedArticle.imageUrl}
        />
      )}

      {/* Prompt Viewing Modal */}
      {viewingPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-slate-900 border border-white/10 rounded-xl shadow-2xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-white/10">
              <h3 className="text-lg font-medium text-white">Prompt Sent to OpenAI's GPT4o</h3>
              <button
                onClick={() => setViewingPrompt(null)}
                className="text-gray-400 hover:text-white text-2xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="p-4 overflow-y-auto max-h-[60vh]">
              <pre className="text-sm text-gray-300 whitespace-pre-wrap font-mono bg-slate-950 p-4 rounded-lg">
                {viewingPrompt}
              </pre>
            </div>
            <div className="p-4 border-t border-white/10 flex justify-end">
              <button
                onClick={() => setViewingPrompt(null)}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
