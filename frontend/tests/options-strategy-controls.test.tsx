import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { OptionsStrategyControls } from '../components/options-strategy-controls';
import { OptionsChain } from '@/lib/api-client';
import { Position } from '@/lib/payoff-utils';

// Mock UI components
vi.mock('@/components/ui/slider', () => ({
  Slider: ({ value, onValueChange, min, max, step, className }: any) => (
    <input
      type="range"
      data-testid="slider"
      value={value[0]}
      onChange={(e) => onValueChange([parseFloat(e.target.value)])}
      min={min}
      max={max}
      step={step}
      className={className}
    />
  ),
}));

// Mock Tooltip components to avoid Radix UI issues in tests
vi.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <div data-testid="tooltip-content">{children}</div>,
  TooltipProvider: ({ children }: any) => <>{children}</>,
}));

// Mock Data
function createMockOptionsChain(): OptionsChain {
  const expirations = ['2026-06-19', '2026-07-17', '2026-08-21'];
  const strikes = [90, 95, 100, 105, 110, 115, 120];
  
  // Helper to create quotes for a strike
  const createQuote = (strike: number, right: 'C' | 'P', expiry: string) => ({
    symbol: `TEST${right}${strike}`,
    strike,
    expiry,
    right,
    bid: 5.0,
    ask: 5.2,
    last: 5.1,
    volume: 100,
    open_interest: 500,
    implied_volatility: 0.2,
    delta: right === 'C' ? 0.5 + (100 - strike)/100 : -0.5 + (100 - strike)/100, // Rough delta proxy
    gamma: 0.05,
    theta: -0.05,
    vega: 0.1,
    rho: 0.01,
  
    // Add missing required fields from OptionQuote interface
    multiplier: 100,
    currency: 'USD',
    contract_id: 12345,
    exchange: 'SMART',
    min_tick: 0.01,
    underlying_price: 100
  });

  const calls: Record<string, Record<number, any>> = {};
  const puts: Record<string, Record<number, any>> = {};

  expirations.forEach(exp => {
    calls[exp] = {};
    puts[exp] = {};
    strikes.forEach(s => {
      calls[exp][s] = createQuote(s, 'C', exp);
      puts[exp][s] = createQuote(s, 'P', exp);
    });
  });

  return {
    symbol: 'TEST',
    underlying_price: 100,
    expirations,
    strikes,
    calls,
    puts,
  };
}

describe('OptionsStrategyControls', () => {
  const mockChain = createMockOptionsChain();
  const mockOnUpdateLegs = vi.fn();
  const defaultProps = {
    ticker: 'TEST',
    currentPrice: 100,
    positions: [] as Position[],
    optionsChain: mockChain,
    onUpdateLegs: mockOnUpdateLegs,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders strategy tabs correctly', () => {
    render(<OptionsStrategyControls {...defaultProps} />);
    
    expect(screen.getByText('Strategy Presets')).toBeInTheDocument();
    expect(screen.getByText('Custom')).toBeInTheDocument();
    expect(screen.getByText('Protective Put')).toBeInTheDocument();
    expect(screen.getByText('Covered Call')).toBeInTheDocument();
    expect(screen.getByText('Iron Condor')).toBeInTheDocument();
  });

  it('hides Expiration slider when "Custom" (none) strategy is selected', () => {
    render(<OptionsStrategyControls {...defaultProps} />);
    
    // Default is "none" / Custom
    expect(screen.queryByText('Expiration')).not.toBeInTheDocument();
    const sliders = screen.queryAllByTestId('slider');
    expect(sliders.length).toBe(0);
  });

  it('shows Expiration slider for preset strategies', async () => {
    const user = userEvent.setup();
    render(<OptionsStrategyControls {...defaultProps} />);
    
    // Click 'Protective Put'
    await user.click(screen.getByText('Protective Put'));
    
    await waitFor(() => {
      expect(screen.getByText('Expiration')).toBeInTheDocument();
      expect(screen.getAllByTestId('slider').length).toBeGreaterThan(0);
    });
  });

  it('generates Protective Put legs correctly', async () => {
    const user = userEvent.setup();
    render(<OptionsStrategyControls {...defaultProps} />);
    
    // Select strategy
    await user.click(screen.getByText('Protective Put'));
    
    await waitFor(() => {
        expect(mockOnUpdateLegs).toHaveBeenCalled();
    });
    
    const lastCall = mockOnUpdateLegs.mock.calls[mockOnUpdateLegs.mock.calls.length - 1][0];
    
    expect(lastCall).toHaveLength(1);
    expect(lastCall[0]).toMatchObject({
      symbol: 'TEST',
      right: 'P',
      action: 'BUY',
      quantity: 1, // Default when no stock position
      strike: 100
    });
  });

  it('generates Covered Call legs correctly', async () => {
    const user = userEvent.setup();
    render(<OptionsStrategyControls {...defaultProps} />);
    
    await user.click(screen.getByText('Covered Call'));
    
    await waitFor(() => {
        expect(mockOnUpdateLegs).toHaveBeenCalled();
    });

    const lastCall = mockOnUpdateLegs.mock.calls[mockOnUpdateLegs.mock.calls.length - 1][0];
    
    expect(lastCall).toHaveLength(1);
    expect(lastCall[0]).toMatchObject({
      symbol: 'TEST',
      right: 'C',
      action: 'SELL',
      quantity: 1
    });
  });

  it('generates Iron Condor legs correctly', async () => {
    const user = userEvent.setup();
    render(<OptionsStrategyControls {...defaultProps} />);
    
    await user.click(screen.getByText('Iron Condor'));
    
    await waitFor(() => {
         expect(mockOnUpdateLegs).toHaveBeenCalled();
    });

    const lastCall = mockOnUpdateLegs.mock.calls[mockOnUpdateLegs.mock.calls.length - 1][0];
    
    expect(lastCall).toHaveLength(4);
    
    const rights = lastCall.map((leg: any) => leg.right);
    const actions = lastCall.map((leg: any) => leg.action);
    
    expect(rights.filter((r: string) => r === 'C').length).toBe(2);
    expect(rights.filter((r: string) => r === 'P').length).toBe(2);
    expect(actions.filter((a: string) => a === 'BUY').length).toBe(2);
    expect(actions.filter((a: string) => a === 'SELL').length).toBe(2);
  });

  it('updates expiration when slider moves', async () => {
    const user = userEvent.setup();
    render(<OptionsStrategyControls {...defaultProps} />);
    
    await user.click(screen.getByText('Protective Put'));
    
    // Wait for sliders to appear
    await waitFor(() => {
      expect(screen.getAllByTestId('slider').length).toBeGreaterThan(0);
    });

    const expirySlider = screen.getAllByTestId('slider')[0]; // First slider is expiration
    
    // Change expiration index from 0 to 1
    fireEvent.change(expirySlider, { target: { value: '1' } });
    
    await waitFor(() => {
        // We expect mockOnUpdateLegs to be called (possibly multiple times, we want the one with updated expiry)
        const calls = mockOnUpdateLegs.mock.calls;
        const lastCallArgs = calls[calls.length - 1][0];
        expect(lastCallArgs[0].expiry).toBe('2026-07-17');
    });
  });

  it('updates quantity based on stock position for hedging strategies', async () => {
    const user = userEvent.setup();
    const propsWithStock = {
      ...defaultProps,
      positions: [
        {
          ticker: 'TEST',
          qty: 500, // 500 shares -> 5 contracts
          cost_basis: 90,
          current_price: 100,
          unrealized_pnl: 5000,
          position_type: 'stock'
        } as Position
      ]
    };
    
    render(<OptionsStrategyControls {...propsWithStock} />);
    
    await user.click(screen.getByText('Protective Put')); // Hedging strategy
    
    await waitFor(() => {
        expect(mockOnUpdateLegs).toHaveBeenCalled();
    });
    
    const lastCall = mockOnUpdateLegs.mock.calls[mockOnUpdateLegs.mock.calls.length - 1][0];
    expect(lastCall[0].quantity).toBe(5);
  });
  
  it('Bear Put Spread logic check', async () => {
       const user = userEvent.setup();
       render(<OptionsStrategyControls {...defaultProps} />);
       
       await user.click(screen.getByText('Bear Put Spread'));
       
       await waitFor(() => {
            expect(mockOnUpdateLegs).toHaveBeenCalled();
       });
       
       const lastCall = mockOnUpdateLegs.mock.calls[mockOnUpdateLegs.mock.calls.length - 1][0];
       expect(lastCall).toHaveLength(2);
       expect(lastCall[0].right).toBe('P');
       expect(lastCall[1].right).toBe('P');
       
        expect(lastCall.find((l:any) => l.action === 'BUY')).toBeDefined();
        expect(lastCall.find((l:any) => l.action === 'SELL')).toBeDefined();
  });

  it('generates Bull Put Spread legs correctly', async () => {
    const user = userEvent.setup();
    render(<OptionsStrategyControls {...defaultProps} />);
    
    await user.click(screen.getByText('Bull Put Spread'));
    
    await waitFor(() => {
        expect(mockOnUpdateLegs).toHaveBeenCalled();
    });
    
    const lastCall = mockOnUpdateLegs.mock.calls[mockOnUpdateLegs.mock.calls.length - 1][0];
    expect(lastCall).toHaveLength(2);
    // Both Puts
    expect(lastCall[0].right).toBe('P');
    expect(lastCall[1].right).toBe('P');
    // Credit Spread: Sell Higher (Short Delta approx), Buy Lower
    expect(lastCall.find((l:any) => l.action === 'BUY')).toBeDefined();
    expect(lastCall.find((l:any) => l.action === 'SELL')).toBeDefined();
  });

  it('generates Bear Call Spread legs correctly', async () => {
    const user = userEvent.setup();
    render(<OptionsStrategyControls {...defaultProps} />);
    
    await user.click(screen.getByText('Bear Call Spread'));
    
    await waitFor(() => {
        expect(mockOnUpdateLegs).toHaveBeenCalled();
    });
    
    const lastCall = mockOnUpdateLegs.mock.calls[mockOnUpdateLegs.mock.calls.length - 1][0];
    expect(lastCall).toHaveLength(2);
    // Both Calls
    expect(lastCall[0].right).toBe('C');
    expect(lastCall[1].right).toBe('C');
    // Credit Spread: Sell Lower, Buy Higher
    expect(lastCall.find((l:any) => l.action === 'BUY')).toBeDefined();
    expect(lastCall.find((l:any) => l.action === 'SELL')).toBeDefined();
  });

  it('generates Iron Butterfly legs correctly', async () => {
    const user = userEvent.setup();
    render(<OptionsStrategyControls {...defaultProps} />);
    
    await user.click(screen.getByText('Iron Butterfly'));
    
    await waitFor(() => {
        expect(mockOnUpdateLegs).toHaveBeenCalled();
    });
    
    const lastCall = mockOnUpdateLegs.mock.calls[mockOnUpdateLegs.mock.calls.length - 1][0];
    expect(lastCall).toHaveLength(4);
    
    // Straddle (Sell Call + Put) + Wings (Buy Call + Put)
    const rights = lastCall.map((leg: any) => leg.right);
    const actions = lastCall.map((leg: any) => leg.action);
    
    expect(rights.filter((r: string) => r === 'C').length).toBe(2);
    expect(rights.filter((r: string) => r === 'P').length).toBe(2);
    expect(actions.filter((a: string) => a === 'BUY').length).toBe(2);
    expect(actions.filter((a: string) => a === 'SELL').length).toBe(2);
  });

  it('generates Calendar Call Spread legs correctly', async () => {
    const user = userEvent.setup();
    render(<OptionsStrategyControls {...defaultProps} />);
    
    // Select Calendar Call
    await user.click(screen.getByText("Calendar Call"));
    
    await waitFor(() => {
        expect(mockOnUpdateLegs).toHaveBeenCalled();
    });
    
    const calls = mockOnUpdateLegs.mock.calls;
    const legs = calls[calls.length - 1][0];
    
    expect(legs).toHaveLength(2);
    
    // Sell Near (2026-06-19 - default expiry [0])
    expect(legs[0].expiry).toBe("2026-06-19");
    expect(legs[0].action).toBe("SELL");
    expect(legs[0].right).toBe("C");
    
    // Buy Far (2026-07-17 - default expiry [1])
    expect(legs[1].expiry).toBe("2026-07-17");
    expect(legs[1].action).toBe("BUY");
    expect(legs[1].right).toBe("C");
    
    // Same strike (ATM)
    expect(legs[0].strike).toBe(legs[1].strike);
  });

  it('generates Calendar Put Spread legs correctly', async () => {
    const user = userEvent.setup();
    render(<OptionsStrategyControls {...defaultProps} />);
    
    // Select Calendar Put
    await user.click(screen.getByText("Calendar Put"));
    
    await waitFor(() => {
        expect(mockOnUpdateLegs).toHaveBeenCalled();
    });
    
    const calls = mockOnUpdateLegs.mock.calls;
    const legs = calls[calls.length - 1][0];
    
    expect(legs).toHaveLength(2);
    
    // Sell Near (2026-06-19 - default expiry [0])
    expect(legs[0].expiry).toBe("2026-06-19");
    expect(legs[0].action).toBe("SELL");
    expect(legs[0].right).toBe("P");
    
    // Buy Far (2026-07-17 - default expiry [1])
    expect(legs[1].expiry).toBe("2026-07-17");
    expect(legs[1].action).toBe("BUY");
    expect(legs[1].right).toBe("P");
    
    // Same strike
    expect(legs[0].strike).toBe(legs[1].strike);
  });
});
