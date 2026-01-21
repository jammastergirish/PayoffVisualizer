import { Position, AccountSummary } from "./payoff-utils";

const envApiBase = process.env.NEXT_PUBLIC_API_BASE;
// Default to same-origin so Next can proxy /api to the backend (works with ngrok).
const API_BASE = typeof window !== 'undefined'
    ? (envApiBase || '')
    : (envApiBase || "http://127.0.0.1:8000");

// Generic API request wrapper to eliminate duplicate try-catch patterns
async function apiRequest<T>(
    endpoint: string,
    options?: RequestInit & { timeout?: number },
    fallback?: T
): Promise<T> {
    try {
        let finalOptions = { ...options };

        // Add timeout support if specified
        if (options?.timeout) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), options.timeout);
            finalOptions.signal = controller.signal;

            try {
                const res = await fetch(`${API_BASE}${endpoint}`, finalOptions);
                clearTimeout(timeoutId);
                if (!res.ok) {
                    throw new Error(`API request failed: ${res.status} ${res.statusText}`);
                }
                return await res.json();
            } catch (e) {
                clearTimeout(timeoutId);
                throw e;
            }
        } else {
            const res = await fetch(`${API_BASE}${endpoint}`, finalOptions);
            if (!res.ok) {
                throw new Error(`API request failed: ${res.status} ${res.statusText}`);
            }
            return await res.json();
        }
    } catch (error: any) {
        if (error.name === 'AbortError') {
            console.warn(`Request to ${endpoint} timed out`);
        } else {
            console.error(`API Error [${endpoint}]:`, error);
        }
        if (fallback !== undefined) {
            return fallback;
        }
        throw error;
    }
}

export async function checkBackendHealth(): Promise<{ 
    status: string; 
    broker_connected: boolean;
    ib_connected: boolean;
    data_connected: boolean;
    news_connected: boolean;
    providers: {
        data: string;
        news: string;
        brokerage: string;
    }
} | null> {
    return apiRequest('/api/health', undefined, null);
}

export async function fetchLivePortfolio(): Promise<{
    accounts: string[],
    positions: Position[],
    summary: Record<string, AccountSummary>
}> {
    const fallback = { accounts: [], positions: [], summary: {} };
    const data = await apiRequest<any>('/api/portfolio', undefined, fallback);

    if (Array.isArray(data)) {
        return { accounts: [], positions: data, summary: {} };
    } else if (data.positions) {
        // Handle legacy summary (single object) vs new summary (map)
        let summaryMap: Record<string, AccountSummary> = {};

        if (data.summary) {
            // Check if it's the new map keyed by ID or the old single object
            // Simple heuristic: check if values are objects
            const keys = Object.keys(data.summary);
            if (keys.length > 0 && typeof data.summary[keys[0]] === 'object') {
                summaryMap = data.summary;
            } else {
                // Legacy single summary, assign to "default" or try to infer
                summaryMap["default"] = data.summary;
            }
        }

        return {
            accounts: data.accounts || [],
            positions: data.positions,
            summary: summaryMap
        };
    }
    return fallback;
}

export interface HistoricalBar {
    date: string;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
}

export async function fetchHistoricalData(
    symbol: string,
    timeframe: string = "1M"
): Promise<{ symbol: string; timeframe: string; bars: HistoricalBar[] }> {
    return apiRequest(
        `/api/historical/${symbol}?timeframe=${timeframe}`,
        undefined,
        { symbol, timeframe, bars: [] }
    );
}

// =====================
// Ticker Details (Company Info, Branding)
// =====================

export interface TickerDetails {
    symbol: string;
    name?: string;
    description?: string;
    homepage_url?: string;
    market_cap?: number;
    total_employees?: number;
    list_date?: string;
    branding?: {
        logo_url?: string;
        icon_url?: string;
    };
    error?: string;
}

export async function fetchTickerDetails(symbol: string): Promise<TickerDetails> {
    try {
        const res = await fetch(`${API_BASE}/api/ticker/${symbol}`);
        if (!res.ok) throw new Error("Failed to fetch ticker details");
        return await res.json();
    } catch (e) {
        console.error(e);
        return { symbol, error: "Failed to fetch details" };
    }
}

// =====================
// News API Types & Functions
// =====================

export interface NewsHeadline {
    articleId: string;
    headline: string;
    providerCode: string;
    providerName?: string;  // Full publisher name (e.g., "Benzinga", "Investing.com")
    time: string;
    teaser?: string;   // Short summary
    body?: string;     // Full article content (from Benzinga)
    url?: string;      // Link to original article
    author?: string;
    channels?: string[];
    imageUrl?: string; // Article thumbnail image
}

export interface NewsArticle {
    articleId: string;
    providerCode: string;
    text: string;
    articleType?: string;
    error?: string;
}

export async function fetchNewsHeadlines(
    symbol: string,
    limit: number = 10
): Promise<{ symbol: string; headlines: NewsHeadline[] }> {
    return apiRequest(
        `/api/news/${symbol}?limit=${limit}`,
        { timeout: 15000 }, // 15s timeout for slow news API
        { symbol, headlines: [] }
    );
}

export async function fetchMarketNewsHeadlines(
    limit: number = 25
): Promise<{ headlines: NewsHeadline[] }> {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);
        
        const res = await fetch(`${API_BASE}/api/news/market?limit=${limit}`, {
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (!res.ok) throw new Error("Failed to fetch market news");
        return await res.json();
    } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
            console.warn('Market news request timed out');
        } else {
            console.error(e);
        }
        return { headlines: [] };
    }
}

export async function fetchNewsArticle(
    providerCode: string,
    articleId: string
): Promise<NewsArticle> {
    try {
        // New Massive.com Benzinga endpoint only needs articleId
        const res = await fetch(`${API_BASE}/api/news/article/${encodeURIComponent(articleId)}`);
        if (!res.ok) throw new Error("Failed to fetch article");
        return await res.json();
    } catch (e) {
        console.error(e);
        return { articleId, providerCode, text: "", error: "Failed to fetch article" };
    }
}


// =====================
// Daily Snapshot API
// =====================

export interface DailySnapshot {
    symbol: string;
    current_price?: number;
    previous_close?: number;
    change?: number;
    change_pct?: number;
    error?: string;
}

export async function fetchDailySnapshot(symbol: string): Promise<DailySnapshot | null> {
    try {
        const res = await fetch(`${API_BASE}/api/snapshot/${encodeURIComponent(symbol)}`);
        if (!res.ok) throw new Error("Failed to fetch snapshot");
        return await res.json();
    } catch (e) {
        console.error(e);
        return null;
    }
}


// =====================
// Trade Order API
// =====================

export interface TradeOrder {
    symbol: string;
    action: "BUY" | "SELL";
    quantity: number;
    order_type: "MARKET" | "LIMIT";
    limit_price?: number;
}

export interface TradeResult {
    success: boolean;
    order_id?: number;
    status?: string;
    message?: string;
    error?: string;
}

export async function placeTrade(order: TradeOrder): Promise<TradeResult> {
    return apiRequest(
        '/api/trade',
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(order),
        },
        { success: false, error: "Failed to place trade" }
    );
}


// =====================
// Options Chain API
// =====================

export interface OptionQuote {
    strike: number;
    expiration: string;
    bid: number;
    ask: number;
    last: number;
    mid: number;
    volume: number;
    openInterest: number;
    iv: number | null;
    delta: number | null;
    gamma: number | null;
    theta: number | null;
    vega: number | null;
}

export interface OptionsChain {
    symbol: string;
    underlying_price: number;
    expirations: string[];
    strikes: number[];
    calls: Record<string, Record<number, OptionQuote>>; // expiry -> strike -> quote
    puts: Record<string, Record<number, OptionQuote>>;
    error?: string;
}

export async function fetchOptionsChain(symbol: string, maxStrikes: number = 30): Promise<OptionsChain> {
    try {
        const res = await fetch(`${API_BASE}/api/options-chain/${symbol}?max_strikes=${maxStrikes}`);
        if (!res.ok) throw new Error("Failed to fetch options chain");
        return await res.json();
    } catch (e) {
        console.error(e);
        return { 
            symbol, 
            underlying_price: 0,
            expirations: [], 
            strikes: [], 
            calls: {}, 
            puts: {},
            error: e instanceof Error ? e.message : "Failed to fetch options chain"
        };
    }
}


// =====================
// Options Trading API
// =====================

export interface OptionLeg {
    symbol: string;
    expiry: string;  // YYYYMMDD format
    strike: number;
    right: "C" | "P";
    action: "BUY" | "SELL";
    quantity: number;
}

export interface OptionsTradeOrder {
    legs: OptionLeg[];
    order_type: "MARKET" | "LIMIT";
    limit_price?: number;
}

export async function placeOptionsOrder(order: OptionsTradeOrder): Promise<TradeResult> {
    try {
        const res = await fetch(`${API_BASE}/api/options/trade`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(order),
        });
        if (!res.ok) throw new Error("Failed to place options order");
        return await res.json();
    } catch (e) {
        console.error(e);
        return { success: false, error: e instanceof Error ? e.message : "Failed to place options order" };
    }
}

// ==================
// LLM Analysis
// ==================

export interface LLMAnalysisResponse {
    summary?: string;
    error?: string;
}

export interface ArticleForAnalysis {
    headline: string;
    body?: string;
}

export async function fetchMarketNewsAnalysis(
    articles: ArticleForAnalysis[],
    tickers: string[]
): Promise<LLMAnalysisResponse> {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout for LLM
        
        const res = await fetch(`${API_BASE}/api/llm/analyze-market-news`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ articles, tickers }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (!res.ok) throw new Error("Failed to analyze market news");
        return await res.json();
    } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
            return { error: "Analysis request timed out" };
        }
        console.error(e);
        return { error: e instanceof Error ? e.message : "Failed to analyze news" };
    }
}

export async function fetchTickerNewsAnalysis(
    articles: ArticleForAnalysis[],
    ticker: string
): Promise<LLMAnalysisResponse> {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout for LLM
        
        const res = await fetch(`${API_BASE}/api/llm/analyze-ticker-news`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ articles, ticker }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        
        if (!res.ok) throw new Error("Failed to analyze ticker news");
        return await res.json();
    } catch (e) {
        if (e instanceof Error && e.name === 'AbortError') {
            return { error: "Analysis request timed out" };
        }
        console.error(e);
        return { error: e instanceof Error ? e.message : "Failed to analyze news" };
    }
}

// ==================
// Orders API
// ==================

export interface Order {
    order_id: string;
    symbol: string;
    action: "BUY" | "SELL";
    quantity: number;
    order_type: "MARKET" | "LIMIT";
    status: "Pending" | "Filled" | "Cancelled" | "Working" | "Submitted";
    limit_price?: number;
    filled_quantity: number;
    average_fill_price?: number;
    time_placed?: string;
    account?: string;
}

export async function fetchOrders(): Promise<{ orders: Order[], provider: string }> {
    try {
        const res = await fetch(`${API_BASE}/api/orders`);
        if (!res.ok) throw new Error("Failed to fetch orders");
        return await res.json();
    } catch (e) {
        console.error(e);
        return { orders: [], provider: "unknown" };
    }
}
