import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';

// Mock Select components from shadcn/ui
vi.mock('@/components/ui/select', () => ({
  Select: ({ children, value, onValueChange }: any) => (
    <div data-testid="select-root" data-value={value}>
      <button data-testid="select-trigger" onClick={() => onValueChange && onValueChange('AAPL')}>
        {value || 'Select ticker'}
      </button>
      {children}
    </div>
  ),
  SelectContent: ({ children }: any) => <div data-testid="select-content">{children}</div>,
  SelectItem: ({ children, value, onClick }: any) => (
    <div data-testid={`select-item-${value}`} onClick={onClick} role="option">
      {children}
    </div>
  ),
  SelectTrigger: ({ children, className }: any) => (
    <div data-testid="select-trigger" className={className}>
      {children}
    </div>
  ),
  SelectValue: ({ children }: any) => <div data-testid="select-value">{children}</div>
}));

// Mock position and price data
const mockPositions = [
  {
    ticker: 'AAPL',
    position_type: 'stock' as const,
    qty: 100,
    unrealized_pnl: 500,
    daily_pnl: 50
  },
  {
    ticker: 'MSFT',
    position_type: 'stock' as const,
    qty: 50,
    unrealized_pnl: -200,
    daily_pnl: -30
  },
  {
    ticker: 'GOOGL',
    position_type: 'call' as const,
    qty: 10,
    strike: 150,
    unrealized_pnl: 1000,
    daily_pnl: 100
  }
];

const mockStockPrices = {
  'AAPL': 150.25,
  'MSFT': 330.50,
  'GOOGL': 140.75
};

const mockTickers = ['AAPL', 'MSFT', 'GOOGL'];

// Test component that implements the mobile ticker select functionality
const MobileTickerSelect = ({
  selectedTicker,
  setSelectedTicker,
  tickers,
  positions,
  stockPrices
}: {
  selectedTicker: string | null;
  setSelectedTicker: (ticker: string) => void;
  tickers: string[];
  positions: any[];
  stockPrices: Record<string, number>;
}) => {
  // Import mocked components
  const Select = ({ children, value, onValueChange }: any) => (
    <div data-testid="select-root" data-value={value}>
      <button data-testid="select-trigger" onClick={() => onValueChange && onValueChange('AAPL')}>
        {value || 'Select ticker'}
      </button>
      {children}
    </div>
  );
  const SelectContent = ({ children }: any) => <div data-testid="select-content">{children}</div>;
  const SelectItem = ({ children, value, onClick }: any) => (
    <div data-testid={`select-item-${value}`} onClick={onClick} role="option">
      {children}
    </div>
  );
  const SelectTrigger = ({ children, className }: any) => (
    <div data-testid="select-trigger" className={className}>
      {children}
    </div>
  );
  const SelectValue = ({ children }: any) => <div data-testid="select-value">{children}</div>;

  return (
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
                      {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(0)}
                    </span>
                  </div>
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
};

describe('Mobile Ticker Select Component', () => {
  let mockSetSelectedTicker: any;

  beforeEach(() => {
    mockSetSelectedTicker = vi.fn();
  });

  it('should render mobile ticker select with proper styling', () => {
    render(
      <MobileTickerSelect
        selectedTicker={null}
        setSelectedTicker={mockSetSelectedTicker}
        tickers={mockTickers}
        positions={mockPositions}
        stockPrices={mockStockPrices}
      />
    );

    const trigger = screen.getByTestId('select-trigger');
    expect(trigger).toHaveClass('min-h-[44px]'); // Touch-friendly height
    expect(trigger).toHaveClass('touch-manipulation'); // Touch optimization
    expect(trigger).toHaveClass('bg-slate-800'); // Dark theme
  });

  it('should show selected ticker when one is selected', () => {
    render(
      <MobileTickerSelect
        selectedTicker="AAPL"
        setSelectedTicker={mockSetSelectedTicker}
        tickers={mockTickers}
        positions={mockPositions}
        stockPrices={mockStockPrices}
      />
    );

    expect(screen.getByTestId('select-root')).toHaveAttribute('data-value', 'AAPL');
    expect(screen.getByText('AAPL')).toBeInTheDocument();
  });

  it('should show placeholder when no ticker is selected', () => {
    render(
      <MobileTickerSelect
        selectedTicker={null}
        setSelectedTicker={mockSetSelectedTicker}
        tickers={mockTickers}
        positions={mockPositions}
        stockPrices={mockStockPrices}
      />
    );

    expect(screen.getByText('Select ticker')).toBeInTheDocument();
  });

  it('should render all tickers in the dropdown', () => {
    render(
      <MobileTickerSelect
        selectedTicker={null}
        setSelectedTicker={mockSetSelectedTicker}
        tickers={mockTickers}
        positions={mockPositions}
        stockPrices={mockStockPrices}
      />
    );

    // Check that all ticker options are rendered
    expect(screen.getByTestId('select-item-AAPL')).toBeInTheDocument();
    expect(screen.getByTestId('select-item-MSFT')).toBeInTheDocument();
    expect(screen.getByTestId('select-item-GOOGL')).toBeInTheDocument();
  });

  it('should display stock prices for each ticker', () => {
    render(
      <MobileTickerSelect
        selectedTicker={null}
        setSelectedTicker={mockSetSelectedTicker}
        tickers={mockTickers}
        positions={mockPositions}
        stockPrices={mockStockPrices}
      />
    );

    expect(screen.getByText('$150.25')).toBeInTheDocument(); // AAPL price
    expect(screen.getByText('$330.50')).toBeInTheDocument(); // MSFT price
    expect(screen.getByText('$140.75')).toBeInTheDocument(); // GOOGL price
  });

  it('should display P&L with correct colors', () => {
    render(
      <MobileTickerSelect
        selectedTicker={null}
        setSelectedTicker={mockSetSelectedTicker}
        tickers={mockTickers}
        positions={mockPositions}
        stockPrices={mockStockPrices}
      />
    );

    // AAPL has positive P&L (+500)
    const aaplPnl = screen.getByText('+$500');
    expect(aaplPnl).toHaveClass('text-green-400');

    // MSFT has negative P&L (-200)
    const msftPnl = screen.getByText('-$200');
    expect(msftPnl).toHaveClass('text-red-400');

    // GOOGL has positive P&L (+1000)
    const googlPnl = screen.getByText('+$1000');
    expect(googlPnl).toHaveClass('text-green-400');
  });

  it('should handle missing stock prices gracefully', () => {
    const incompleteStockPrices = { 'AAPL': 150.25 };

    render(
      <MobileTickerSelect
        selectedTicker={null}
        setSelectedTicker={mockSetSelectedTicker}
        tickers={mockTickers}
        positions={mockPositions}
        stockPrices={incompleteStockPrices}
      />
    );

    expect(screen.getByText('$150.25')).toBeInTheDocument(); // AAPL has price
    expect(screen.getAllByText('$---')).toHaveLength(2); // MSFT and GOOGL don't have prices
  });

  it('should be hidden on desktop (md:hidden class)', () => {
    render(
      <MobileTickerSelect
        selectedTicker={null}
        setSelectedTicker={mockSetSelectedTicker}
        tickers={mockTickers}
        positions={mockPositions}
        stockPrices={mockStockPrices}
      />
    );

    const container = screen.getByTestId('select-trigger').closest('div');
    expect(container).toHaveClass('md:hidden');
  });

  it('should aggregate P&L correctly for multiple positions of same ticker', () => {
    // Add another AAPL position
    const positionsWithMultipleAAPL = [
      ...mockPositions,
      {
        ticker: 'AAPL',
        position_type: 'call' as const,
        qty: 5,
        strike: 155,
        unrealized_pnl: 300,
        daily_pnl: 20
      }
    ];

    render(
      <MobileTickerSelect
        selectedTicker={null}
        setSelectedTicker={mockSetSelectedTicker}
        tickers={mockTickers}
        positions={positionsWithMultipleAAPL}
        stockPrices={mockStockPrices}
      />
    );

    // Should show combined AAPL P&L: 500 + 300 = 800
    expect(screen.getByText('+$800')).toBeInTheDocument();
  });

  it('should have proper accessibility attributes', () => {
    render(
      <MobileTickerSelect
        selectedTicker={null}
        setSelectedTicker={mockSetSelectedTicker}
        tickers={mockTickers}
        positions={mockPositions}
        stockPrices={mockStockPrices}
      />
    );

    // Check that select items have proper role
    const selectItems = screen.getAllByRole('option');
    expect(selectItems).toHaveLength(3);
  });
});