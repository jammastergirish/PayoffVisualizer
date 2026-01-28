/**
 * @vitest-environment jsdom
 * Tests for CandlestickChart component utility functions and component rendering.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CandlestickChart, CandlestickBar } from '../components/candlestick-chart';
import { Order } from '@/lib/api-client';
import { Position } from '@/lib/payoff-utils';

import React from 'react';

// Mock ResizeObserver for Recharts ResponsiveContainer
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock ResponsiveContainer to render children with fixed dimensions
vi.mock('recharts', async (importOriginal) => {
  const original = await importOriginal<typeof import('recharts')>();
  return {
    ...original,
    ResponsiveContainer: ({ children }: { children: any }) => (
      <div style={{ width: 800, height: 600 }}>
        {React.isValidElement(children) 
          ? React.cloneElement(children, { width: 800, height: 600 } as any) 
          : children}
      </div>
    ),
  };
});

// Test data helpers
function createMockBar(date: string, open: number, high: number, low: number, close: number, volume: number = 1000000): CandlestickBar {
  return { date, open, high, low, close, volume };
}

describe('Candlestick Chart', () => {
    
  describe('Data Transformations', () => {
      // (Keeping existing logic tests)
      describe('Candle Body Calculation', () => {
        it('should identify green candle (close >= open)', () => {
          const bar = createMockBar('2026-01-11', 100, 105, 99, 103);
          const isGreen = bar.close >= bar.open;
          expect(isGreen).toBe(true);
        });

        it('should identify red candle (close < open)', () => {
          const bar = createMockBar('2026-01-11', 105, 106, 99, 100);
          const isGreen = bar.close >= bar.open;
          expect(isGreen).toBe(false);
        });
      });
  });

  describe('Component Rendering', () => {
    const mockData = [
      createMockBar('2026-01-01', 100, 110, 90, 105),
      createMockBar('2026-01-02', 105, 115, 95, 110),
    ];

    it('renders the legend correctly', () => {
      render(<CandlestickChart data={mockData} timeframe="1D" />);
      
      expect(screen.getByText('Current Price')).toBeInTheDocument();
      expect(screen.getByText('Avg Price')).toBeInTheDocument();
      expect(screen.getByText('Stop / Sell')).toBeInTheDocument();
      expect(screen.getByText('Call Strike')).toBeInTheDocument();
      expect(screen.getByText('Put Strike')).toBeInTheDocument();
    });

    it('renders live price label', async () => {
      render(<CandlestickChart data={mockData} timeframe="1D" livePrice={105} />);
      // Recharts renders labels as SVGs. We specifically look for the text content.
      expect(await screen.findByText('$105.00')).toBeInTheDocument();
    });

    it('renders sell order labels', async () => {
      const orders: Order[] = [{
        order_id: '1',
        symbol: 'AAPL',
        action: 'SELL',
        quantity: 10,
        order_type: 'LIMIT',
        status: 'Submitted',
        limit_price: 105, // Within range 90-115
        filled_quantity: 0
      }];

      render(<CandlestickChart data={mockData} timeframe="1D" orders={orders} />);
      expect(await screen.findByText('LIMIT 10')).toBeInTheDocument();
    });

    it('renders position cost basis labels', async () => {
      const positions: Position[] = [{
        ticker: 'AAPL',
        qty: 100,
        cost_basis: 102.50, // Within range
        current_price: 105,
        unrealized_pnl: 250,
        position_type: 'stock',
      }];

      render(<CandlestickChart data={mockData} timeframe="1D" positions={positions} />);
      expect(await screen.findByText('Avg: $102.50')).toBeInTheDocument();
    });

    it('renders option strike labels', async () => {
      const positions: Position[] = [{
        ticker: 'AAPL',
        qty: 5,
        cost_basis: 2.5,
        current_price: 3.0,
        unrealized_pnl: 250,
        position_type: 'call',
        strike: 108, // Within range
        expiry: '2026-06-19'
      }];

      render(<CandlestickChart data={mockData} timeframe="1D" positions={positions} />);
      // e.g. "5x CALL Exp: 2026-06-19"
      expect(await screen.findByText('5x CALL Exp: 2026-06-19')).toBeInTheDocument();
    });

    it('renders line styles correctly (solid vs dashed)', async () => {
      const orders: Order[] = [{
        order_id: '1',
        symbol: 'AAPL',
        action: 'SELL',
        quantity: 10,
        order_type: 'LIMIT',
        status: 'Submitted',
        limit_price: 105,
        filled_quantity: 0
      }];
      
      const positions: Position[] = [{
        ticker: 'AAPL',
        qty: 100,
        cost_basis: 102.50,
        current_price: 105,
        unrealized_pnl: 250,
        position_type: 'stock',
      }];

      const { container } = render(
        <CandlestickChart 
          data={mockData} 
          timeframe="1D" 
          livePrice={105}
          orders={orders}
          positions={positions}
        />
      );

      // 1. Verify Legend Styles
      const currentPriceLegend = screen.getByText('Current Price').previousSibling as HTMLElement;
      expect(currentPriceLegend).not.toHaveClass('border-dashed'); // Should be solid

      const avgPriceLegend = screen.getByText('Avg Price').previousSibling as HTMLElement;
      expect(avgPriceLegend).not.toHaveClass('border-dashed'); // Should be solid

      const stopSellLegend = screen.getByText('Stop / Sell').previousSibling as HTMLElement;
      expect(stopSellLegend).toHaveClass('border-dashed'); // Should be dashed

      // 2. Verify Chart Line Styles (via SVG attributes)
      // Wait for chart to render (async due to Recharts)
      await screen.findByText('$105.00');
      
      // Helper to find line by stroke color
      const findLineByStroke = (color: string) => {
         const refLines = container.querySelectorAll('.recharts-reference-line-line');
         return Array.from(refLines).find(p => p.getAttribute('stroke') === color);
      };

      // Current Price Line (Orange #f97316) - Should be SOLID (no stroke-dasharray)
      const currentPriceLine = findLineByStroke('#f97316');
      expect(currentPriceLine).toBeDefined();
      expect(currentPriceLine).not.toHaveAttribute('stroke-dasharray');

      // Avg Price Line (Blue #3b82f6) - Should be SOLID
      const avgPriceLine = findLineByStroke('#3b82f6');
      expect(avgPriceLine).toBeDefined();
      expect(avgPriceLine).not.toHaveAttribute('stroke-dasharray');

      // Stop Line (Red #ef4444) - Should be DASHED
      const stopLine = findLineByStroke('#ef4444');
      expect(stopLine).toBeDefined();
      expect(stopLine).toHaveAttribute('stroke-dasharray', '5 5');
    });
  });
});
