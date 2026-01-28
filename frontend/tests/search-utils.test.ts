/**
 * Tests for search utility functions.
 */

import { describe, it, expect, vi } from 'vitest';
import { findMatchingTicker, scrollToTicker } from '../lib/search-utils';

describe('Search Utils', () => {
  describe('findMatchingTicker', () => {
    const tickers = ['AAPL', 'AMD', 'AMZN', 'GOOG', 'META', 'MSFT', 'MU', 'NVDA', 'TSLA'];
    
    it('should return matching ticker', () => {
      expect(findMatchingTicker(tickers, 'M')).toBe('META');
      expect(findMatchingTicker(tickers, 'MU')).toBe('MU');
      expect(findMatchingTicker(tickers, 'AM')).toBe('AMD');
    });

    it('should be case insensitive', () => {
      expect(findMatchingTicker(tickers, 'm')).toBe('META');
      expect(findMatchingTicker(tickers, 'aapl')).toBe('AAPL');
    });

    it('should return null if no match', () => {
        expect(findMatchingTicker(tickers, 'Z')).toBeNull();
        expect(findMatchingTicker(tickers, 'XYZ')).toBeNull();
    });

    it('should handle empty input', () => {
        expect(findMatchingTicker(tickers, '')).toBeNull();
    });

    it('should handle empty list', () => {
        expect(findMatchingTicker([], 'A')).toBeNull();
    });
  });

  describe('scrollToTicker', () => {
    it('should scroll element into view if found', () => {
        const mockScrollIntoView = vi.fn();
        const mockElement = { scrollIntoView: mockScrollIntoView };
        
        // Mock getElementById
        document.getElementById = vi.fn().mockReturnValue(mockElement);
        
        const result = scrollToTicker('AAPL');
        
        expect(result).toBe(true);
        expect(document.getElementById).toHaveBeenCalledWith('ticker-list-item-AAPL');
        expect(mockScrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
    });

    it('should return false if element not found', () => {
        document.getElementById = vi.fn().mockReturnValue(null);
        
        const result = scrollToTicker('INVALID');
        
        expect(result).toBe(false);
    });

    it('should return false if ticker is empty', () => {
        const result = scrollToTicker('');
        expect(result).toBe(false);
    });
  });
});
