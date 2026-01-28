
import { blackScholes } from "@/lib/black-scholes";

export interface Position {
  ticker: string;
  position_type: 'stock' | 'call' | 'put';
  qty: number;
  strike?: number;
  cost_basis?: number;
  expiry?: string;
  dte?: number;
  unrealized_pnl?: number;
  daily_pnl?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  iv?: number;
  pop?: number;
  current_price?: number;
  underlying_price?: number;
  account?: string;
}

export interface AccountSummary {
    net_liquidation: number;
    unrealized_pnl: number;
    realized_pnl: number;
    daily_pnl: number;
    buying_power?: number;
}

export function cleanNumber(value: unknown): number {
  if (value === null || value === undefined) return 0.0;
  if (typeof value === 'number') return value;
  
  let cleaned = String(value).trim();
  if (cleaned === '') return 0.0;
  
  // Handle negatives like (123.45)
  const isParenNegative = cleaned.startsWith('(') && cleaned.endsWith(')');
  if (isParenNegative) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  // Remove commas, quotes, currency symbols
  cleaned = cleaned.replace(/,/g, '').replace(/'/g, '').replace(/"/g, '').replace(/^\$/, '');
  
  // Remove option side prefixes often found in IBKR like C5.16 or P0.26
  cleaned = cleaned.replace(/^[CP](?=\d|\.)/i, '');

  if (isParenNegative && !cleaned.startsWith('-')) {
    cleaned = '-' + cleaned;
  }
  
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0.0 : num;
}

export function parseFinancialInstrument(instrument: string): { ticker: string; type: 'stock' | 'call' | 'put'; strike?: number; expiry?: string } {
    if (!instrument) return { ticker: '', type: 'stock' };

    instrument = String(instrument).trim();

    // Check if it's just a ticker (stock) - no CALL/PUT keywords
    if (!instrument.includes(' CALL') && !instrument.includes(' PUT')) {
        return { ticker: instrument.toUpperCase(), type: 'stock' };
    }

    // Parse option format: "IREN Jan30'26 40 CALL" or "NVDA Jun18'26 200 CALL"
    // Pattern: TICKER MonthDD'YY Strike CALL/PUT
    const pattern = /^([A-Z0-9.-]+)\s+([A-Za-z]{3})(\d{1,2})'(\d{2})\s+(\d+(?:\.\d+)?)\s+(CALL|PUT)$/i;
    const match = instrument.match(pattern);

    if (match) {
        const ticker = match[1].toUpperCase();
        const monthStr = match[2]; // e.g., 'Jan'
        const day = match[3];
        const yearShort = match[4];
        const strike = parseFloat(match[5]);
        const optType = match[6].toLowerCase() as 'call' | 'put';

        // Convert month abbreviation to number
        const monthMap: Record<string, string> = {
            'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
            'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
            'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
        };
        
        // Handle title case months just in case
        const monthTitle = monthStr.charAt(0).toUpperCase() + monthStr.slice(1).toLowerCase();
        const month = monthMap[monthTitle] || '01';
        const year = `20${yearShort}`;
        const expiry = `${year}-${month}-${day.padStart(2, '0')}`;

        return {
            ticker,
            type: optType,
            strike,
            expiry
        };
    }

    return { ticker: instrument.toUpperCase(), type: 'stock' };
}

export function parsePositionsFromRows(rows: Record<string, unknown>[]): {
    positions: Position[];
    prices: Record<string, number>;
} {
    const parsedPositions: Position[] = [];
    const prices: Record<string, number> = {};

    rows.forEach((row) => {
        if (!row || typeof row !== 'object') return;

        const getValue = (key: string) => {
            const col = findColumn(row, key);
            return col ? row[col] : undefined;
        };

        const instrument = getValue('Financial Instrument') as string;
        if (!instrument) return;

        const parsed = parseFinancialInstrument(instrument);
        const qty = cleanNumber(getValue('Position'));
        if (qty === 0) return;

        const lastPrice = cleanNumber(getValue('Last'));
        const costBasisTotal = cleanNumber(getValue('Cost Basis'));
        const unrealizedPnl = cleanNumber(getValue('Unrealized P&L'));

        if (parsed.type === 'stock') {
            const costBasisPerShare = qty !== 0 ? Math.abs(costBasisTotal) / Math.abs(qty) : 0;

            prices[parsed.ticker] = lastPrice;

            parsedPositions.push({
                ticker: parsed.ticker,
                position_type: 'stock',
                qty: qty,
                cost_basis: costBasisPerShare,
                unrealized_pnl: unrealizedPnl,
                delta: 1.0,
                gamma: 0,
                theta: 0,
                vega: 0
            });
        } else {
            const underlyingPrice = cleanNumber(getValue('Underlying Price'));
            if (underlyingPrice > 0) {
                prices[parsed.ticker] = underlyingPrice;
            }

            const costBasisPerContract = qty !== 0 ? Math.abs(costBasisTotal) / Math.abs(qty) : 0;
            const costBasisPerShare = costBasisPerContract / 100.0;

            const delta = cleanNumber(getValue('Delta'));
            const gamma = cleanNumber(getValue('Gamma'));
            const theta = cleanNumber(getValue('Theta'));
            const vega = cleanNumber(getValue('Vega'));

            const iv = cleanNumber(getValue('Implied Vol.') || getValue('IV'));
            const pop = cleanNumber(getValue('Prob. of Profit') || getValue('POP'));

            parsedPositions.push({
                ticker: parsed.ticker,
                position_type: parsed.type,
                qty: qty,
                strike: parsed.strike,
                expiry: parsed.expiry,
                dte: parsed.expiry ? calculateDte(parsed.expiry) : undefined,
                cost_basis: costBasisPerShare,
                unrealized_pnl: unrealizedPnl,
                delta, gamma, theta, vega,
                iv, pop
            });
        }
    });

    return { positions: parsedPositions, prices };
}

export function calculatePnl(positions: Position[], prices: number[]): number[] {
    // Returns array of P&L values corresponding to the prices array
    const totalPnl = new Array(prices.length).fill(0);

    for (const pos of positions) {
        const qty = pos.qty;
        const costBasis = pos.cost_basis || 0;

        if (pos.position_type === 'stock') {
            for (let i = 0; i < prices.length; i++) {
                totalPnl[i] += (prices[i] - costBasis) * qty;
            }
        } else if (pos.position_type === 'call') {
            const strike = pos.strike || 0;
            for (let i = 0; i < prices.length; i++) {
                const intrinsic = Math.max(0, prices[i] - strike);
                // Universal formula: P&L = (Exit - Entry) * Qty
                // Entry is always positive cost basis
                totalPnl[i] += (intrinsic - costBasis) * qty * 100;
            }
        } else if (pos.position_type === 'put') {
            const strike = pos.strike || 0;
            for (let i = 0; i < prices.length; i++) {
                const intrinsic = Math.max(0, strike - prices[i]);
                totalPnl[i] += (intrinsic - costBasis) * qty * 100;
            }
        }
    }
    return totalPnl;
}

export function calculateTheoreticalPnl(
    positions: Position[], 
    prices: number[], 
    targetDate: Date, 
    ivAdjustment: number = 0, // e.g. 0.1 for +10% IV
    riskFreeRate: number = 0.05
): number[] {
    const totalPnl = new Array(prices.length).fill(0);
    const today = new Date();
    today.setHours(0,0,0,0);
    // targetDate is already set to midnight by the caller usually

    for (const pos of positions) {
        const qty = pos.qty;
        const costBasis = pos.cost_basis || 0;

        if (pos.position_type === 'stock') {
            for (let i = 0; i < prices.length; i++) {
                totalPnl[i] += (prices[i] - costBasis) * qty;
            }
        } else {
            // Option
            const strike = pos.strike || 0;
            const expiryStr = pos.expiry; 
            if (!expiryStr) continue;

            const expiryDate = new Date(expiryStr);
            // Calculate time to expiry from TARGET date
            const diffTime = expiryDate.getTime() - targetDate.getTime();
            const yearsToExpiry = Math.max(0, diffTime / (1000 * 60 * 60 * 24 * 365));

            // If simulated date is past expiry, fallback to intrinsic
            if (yearsToExpiry <= 0) {
                 for (let i = 0; i < prices.length; i++) {
                    let intrinsic = 0;
                    if (pos.position_type === 'call') intrinsic = Math.max(0, prices[i] - strike);
                    else intrinsic = Math.max(0, strike - prices[i]);
                    
                    totalPnl[i] += (intrinsic - costBasis) * qty * 100;
                }
                continue;
            }

            // IV: Use position's IV if available, else default 50%. Apply adjustment.
            // pos.iv is usually in percentage e.g. 45.5
            const baseIv = (pos.iv ? pos.iv / 100 : 0.50);
            const adjustedIv = Math.max(0.001, baseIv * (1 + ivAdjustment));

            for (let i = 0; i < prices.length; i++) {
                const price = prices[i];
                const theoreticalPrice = blackScholes(
                    pos.position_type, 
                    price, 
                    strike, 
                    yearsToExpiry, 
                    riskFreeRate, 
                    adjustedIv
                );
                
                // Profit = (Exit Price - Entry Price) * Qty * 100
                totalPnl[i] += (theoreticalPrice - costBasis) * qty * 100;
            }
        }
    }
    return totalPnl;
}



export function analyzeRiskReward(pnl: number[]) {
    // Warning: this assumes the pnl array covers a sufficient range
    if(pnl.length === 0) return { maxProfit: 0, maxLoss: 0 };
    
    let maxProfit = -Infinity;
    let maxLoss = Infinity;
    
    for (const val of pnl) {
        if (val > maxProfit) maxProfit = val;
        if (val < maxLoss) maxLoss = val;
    }
    
    return { maxProfit, maxLoss };
}

export function calculateMaxRiskReward(positions: Position[]): { maxProfit: number; maxLoss: number } {
    if (positions.length === 0) return { maxProfit: 0, maxLoss: 0 };

    // 1. Identify critical points: 0 and all strikes
    const points = new Set<number>();
    points.add(0);
    
    positions.forEach(p => {
        if (p.strike !== undefined) {
             points.add(p.strike);
        }
    });

    const sortedPoints = Array.from(points).sort((a, b) => a - b);
    
    // 2. Evaluate P&L at critical points
    let currentMax = -Infinity;
    let currentMin = Infinity;

    // Helper to calculate P&L at a specific price
    const getPnlAt = (price: number) => {
        let total = 0;
        for (const p of positions) {
             const qty = p.qty;
             const costBasis = p.cost_basis || 0;
             
             if (p.position_type === 'stock') {
                 total += (price - costBasis) * qty;
             } else if (p.position_type === 'call') {
                 const strike = p.strike || 0;
                 const intrinsic = Math.max(0, price - strike);
                 total += (intrinsic - costBasis) * qty * 100;
             } else if (p.position_type === 'put') {
                 const strike = p.strike || 0;
                 const intrinsic = Math.max(0, strike - price);
                 total += (intrinsic - costBasis) * qty * 100;
             }
        }
        return total;
    };

    for (const price of sortedPoints) {
        const pnl = getPnlAt(price);
        if (pnl > currentMax) currentMax = pnl;
        if (pnl < currentMin) currentMin = pnl;
    }

    // 3. Check behavior at Infinity
    // Net Slope = Sum(Stock Qty) + Sum(Call Qty)
    // Puts have 0 slope at infinity
    let slopeInfinity = 0;
    for (const p of positions) {
        if (p.position_type === 'stock') {
            slopeInfinity += p.qty;
        } else if (p.position_type === 'call') {
            slopeInfinity += p.qty * 100; // Options are x100
        }
    }

    // If slope > 0, Profit -> Inf
    if (slopeInfinity > 1e-9) { // epsilon for float safety
        currentMax = Infinity;
    }
    // If slope < 0, Loss -> Inf
    if (slopeInfinity < -1e-9) {
        currentMin = -Infinity;
    }

    return { maxProfit: currentMax, maxLoss: currentMin };
}

export function getPriceRange(positions: Position[], currentPrice: number): number[] {
    let minStrike = Infinity;
    let maxStrike = -Infinity;
    let hasOptions = false;

    positions.forEach(p => {
        if (p.strike) {
            hasOptions = true;
            if (p.strike < minStrike) minStrike = p.strike;
            if (p.strike > maxStrike) maxStrike = p.strike;
        }
    });

    let low, high;
    if (hasOptions && minStrike !== Infinity) {
        low = Math.min(minStrike * 0.8, currentPrice * 0.7);
        high = Math.max(maxStrike * 1.2, currentPrice * 1.3);
    } else {
        low = currentPrice * 0.7;
        high = currentPrice * 1.3;
    }

    // Generate 200 points
    const points = 200;
    const step = (high - low) / (points - 1);
    const range = [];
    for (let i = 0; i < points; i++) {
        range.push(low + i * step);
    }
    return range;
}

export function calculateDte(expiryDate: string): number {
    const [year, month, day] = expiryDate.split('-').map(Number);
    if (!year || !month || !day) return 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const expiry = new Date(year, month - 1, day);
    const diffTime = expiry.getTime() - today.getTime();
    return Math.max(0, Math.ceil(diffTime / (1000 * 60 * 60 * 24)));
}

export function findColumn(row: Record<string, unknown>, keyPart: string): string | undefined {
    const keys = Object.keys(row);
    // 1. Exact match
    if (keys.includes(keyPart)) return keyPart;
    
    // 2. Case insensitive match or Trimmed match
    const lowerKey = keyPart.toLowerCase();
    const match = keys.find(k => k.trim().toLowerCase() === lowerKey || k.toLowerCase().includes(lowerKey));
    return match;
}
