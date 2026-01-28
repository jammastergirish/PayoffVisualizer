/**
 * Tests for API client functions.
 * 
 * Tests cover:
 * - fetchDailySnapshot: Get price and daily change
 * - placeTrade: Placing various types of orders
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import after mocking
import { fetchDailySnapshot, placeTrade, type TradeOrder } from '../lib/api-client';

describe('API Client', () => {
  beforeEach(() => {
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('fetchDailySnapshot', () => {
    it('should return price and change data', async () => {
      const mockSnapshot = {
        symbol: 'AAPL',
        current_price: 175.50,
        previous_close: 173.00,
        change: 2.50,
        change_pct: 1.45,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockSnapshot,
      });

      const result = await fetchDailySnapshot('AAPL');

      expect(result).toEqual(mockSnapshot);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/snapshot/AAPL')
      );
    });

    it('should return null on error', async () => {
      mockFetch.mockResolvedValueOnce({ ok: false });

      const result = await fetchDailySnapshot('INVALID');

      expect(result).toBeNull();
    });

    it('should handle negative change', async () => {
      const mockSnapshot = {
        symbol: 'TSLA',
        current_price: 195.00,
        previous_close: 200.00,
        change: -5.00,
        change_pct: -2.50,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockSnapshot,
      });

      const result = await fetchDailySnapshot('TSLA');

      expect(result?.change).toBe(-5.00);
      expect(result?.change_pct).toBe(-2.50);
    });
  });

  describe('placeTrade', () => {
    it('should place a market order', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ success: true, order_id: 123 }),
        });

        const order: TradeOrder = {
            symbol: 'AAPL',
            action: 'BUY',
            quantity: 10,
            order_type: 'MARKET',
            tif: 'DAY'
        };

        const result = await placeTrade(order);

        expect(result.success).toBe(true);
        expect(mockFetch).toHaveBeenCalledWith('/api/trade', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify(order)
        }));
    });

    it('should place a trailing stop order', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ success: true, order_id: 456 }),
        });

        const order: TradeOrder = {
            symbol: 'TSLA',
            action: 'SELL',
            quantity: 5,
            order_type: 'TRAIL',
            trailing_amount: 2.50,
            tif: 'GTC'
        };

        const result = await placeTrade(order);

        expect(result.success).toBe(true);
        expect(mockFetch).toHaveBeenCalledWith('/api/trade', expect.objectContaining({
            method: 'POST',
            body: JSON.stringify(order)
        }));
    });

    it('should handle API logic errors', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ success: false, error: 'Insufficient funds' }),
        });

        const order: TradeOrder = {
            symbol: 'AAPL',
            action: 'BUY',
            quantity: 1000,
            order_type: 'MARKET'
        };

        const result = await placeTrade(order);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Insufficient funds');
    });
  });
});
