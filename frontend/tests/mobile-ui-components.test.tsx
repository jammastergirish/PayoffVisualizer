import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';

describe('Mobile UI Component Tests', () => {
  describe('Connection Status Component', () => {
    const MockConnectionStatus = ({
      ibConnected = true,
      dataConnected = true,
      newsConnected = true,
      providers = { brokerage: 'IBKR', data: 'MASSIVE', news: 'MASSIVE' }
    }) => {
      return (
        <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg text-sm border bg-slate-900/50 border-white/10">
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
        </div>
      );
    };

    it('should display all three service connection statuses', () => {
      render(<MockConnectionStatus />);

      expect(screen.getByText('Broker:')).toBeInTheDocument();
      expect(screen.getByText('Data:')).toBeInTheDocument();
      expect(screen.getByText('News:')).toBeInTheDocument();
      expect(screen.getByText('IBKR')).toBeInTheDocument();
      expect(screen.getAllByText('MASSIVE')).toHaveLength(2);
    });

    it('should show green indicators when all connected', () => {
      render(<MockConnectionStatus ibConnected={true} dataConnected={true} newsConnected={true} />);

      const statusDots = document.querySelectorAll('.bg-green-500');
      expect(statusDots).toHaveLength(3);
    });

    it('should show red indicators when disconnected', () => {
      render(<MockConnectionStatus ibConnected={false} dataConnected={false} newsConnected={false} />);

      const statusDots = document.querySelectorAll('.bg-red-500');
      expect(statusDots).toHaveLength(3);
    });

    it('should use compact single-row layout', () => {
      const { container } = render(<MockConnectionStatus />);

      const statusContainer = container.querySelector('.flex.flex-wrap.items-center');
      expect(statusContainer).toBeInTheDocument();
      expect(statusContainer).toHaveClass('gap-3');
    });
  });

  describe('Responsive Metrics Grid', () => {
    const MockMetricsGrid = () => {
      return (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3">
          <div className="bg-slate-900/80 border border-white/10 rounded-lg px-3 py-2 min-w-[110px]">
            <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Total Net Liq</div>
            <div className="text-lg font-bold text-white">$240,097</div>
          </div>
          <div className="bg-slate-900/80 border border-white/10 rounded-lg px-3 py-2 min-w-[110px]">
            <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Today</div>
            <div className="text-lg font-bold text-red-400">-$17,438</div>
          </div>
          <div className="bg-slate-900/80 border border-white/10 rounded-lg px-3 py-2 min-w-[110px]">
            <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Realized</div>
            <div className="text-lg font-bold text-red-400">-$3,824</div>
          </div>
          <div className="bg-slate-900/80 border border-white/10 rounded-lg px-3 py-2 min-w-[110px]">
            <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Unrealized</div>
            <div className="text-lg font-bold text-green-400">+$3,804</div>
          </div>
          <div className="bg-slate-900/80 border border-white/10 rounded-lg px-3 py-2 min-w-[110px]">
            <div className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Buying Power</div>
            <div className="text-lg font-bold text-cyan-400">$514,414</div>
          </div>
        </div>
      );
    };

    it('should display all five metric boxes', () => {
      render(<MockMetricsGrid />);

      expect(screen.getByText('Total Net Liq')).toBeInTheDocument();
      expect(screen.getByText('Today')).toBeInTheDocument();
      expect(screen.getByText('Realized')).toBeInTheDocument();
      expect(screen.getByText('Unrealized')).toBeInTheDocument();
      expect(screen.getByText('Buying Power')).toBeInTheDocument();
    });

    it('should use responsive grid layout classes', () => {
      const { container } = render(<MockMetricsGrid />);

      const gridContainer = container.querySelector('.grid');
      expect(gridContainer).toHaveClass('grid-cols-2', 'sm:grid-cols-3', 'lg:grid-cols-5');
      expect(gridContainer).toHaveClass('gap-2', 'sm:gap-3');
    });

    it('should show financial values with proper formatting', () => {
      render(<MockMetricsGrid />);

      expect(screen.getByText('$240,097')).toBeInTheDocument();
      expect(screen.getByText('-$17,438')).toBeInTheDocument();
      expect(screen.getByText('-$3,824')).toBeInTheDocument();
      expect(screen.getByText('+$3,804')).toBeInTheDocument();
      expect(screen.getByText('$514,414')).toBeInTheDocument();
    });
  });

  describe('Mobile Table Headers', () => {
    const MockTableHeaders = () => {
      return (
        <table className="w-full text-xs sm:text-sm">
          <thead>
            <tr className="border-b border-white/10 text-gray-500 text-xs uppercase tracking-wider">
              <th className="text-left py-2 px-1 sm:px-2 cursor-pointer touch-manipulation hover:text-white transition-colors">
                Ticker
              </th>
              <th className="text-right py-2 px-1 sm:px-2 cursor-pointer touch-manipulation hover:text-white transition-colors border-l border-r border-white/10">
                Price
              </th>
              <th className="text-right py-2 px-1 sm:px-2 cursor-pointer touch-manipulation hover:text-white transition-colors border-l border-white/10">
                <span className="hidden sm:inline">Unrealized $</span><span className="sm:hidden">Un $</span>
              </th>
              <th className="text-right py-2 px-1 sm:px-2 cursor-pointer touch-manipulation hover:text-white transition-colors border-r border-white/10">
                <span className="hidden sm:inline">Unrealized %</span><span className="sm:hidden">Un %</span>
              </th>
              <th className="text-right py-2 px-1 sm:px-2 cursor-pointer touch-manipulation hover:text-white transition-colors border-l border-white/10">
                <span className="hidden sm:inline">Today $</span><span className="sm:hidden">T $</span>
              </th>
              <th className="text-right py-2 px-1 sm:px-2 cursor-pointer touch-manipulation hover:text-white transition-colors border-r border-white/10">
                <span className="hidden sm:inline">Today %</span><span className="sm:hidden">T %</span>
              </th>
              <th className="text-right py-2 px-1 sm:px-2 cursor-pointer touch-manipulation hover:text-white transition-colors border-l border-r border-white/10">
                <span className="hidden sm:inline">Market Value</span><span className="sm:hidden">Mkt Val</span>
              </th>
              <th className="text-right py-2 px-1 sm:px-2 cursor-pointer touch-manipulation hover:text-white transition-colors">
                <span className="hidden sm:inline">Max Loss</span><span className="sm:hidden">Max L</span>
              </th>
              <th className="text-right py-2 px-1 sm:px-2 cursor-pointer touch-manipulation hover:text-white transition-colors">
                <span className="hidden sm:inline">Max Profit</span><span className="sm:hidden">Max P</span>
              </th>
            </tr>
          </thead>
        </table>
      );
    };

    it('should display all nine table columns', () => {
      render(<MockTableHeaders />);

      expect(screen.getByText('Ticker')).toBeInTheDocument();
      expect(screen.getByText('Price')).toBeInTheDocument();

      // Check abbreviated headers (mobile)
      expect(screen.getByText('Un $')).toBeInTheDocument();
      expect(screen.getByText('Un %')).toBeInTheDocument();
      expect(screen.getByText('T $')).toBeInTheDocument();
      expect(screen.getByText('T %')).toBeInTheDocument();
      expect(screen.getByText('Mkt Val')).toBeInTheDocument();
      expect(screen.getByText('Max L')).toBeInTheDocument();
      expect(screen.getByText('Max P')).toBeInTheDocument();
    });

    it('should display full headers for larger screens', () => {
      render(<MockTableHeaders />);

      // Check full headers (desktop) - these have hidden sm:inline classes
      expect(screen.getByText('Unrealized $')).toBeInTheDocument();
      expect(screen.getByText('Unrealized %')).toBeInTheDocument();
      expect(screen.getByText('Today $')).toBeInTheDocument();
      expect(screen.getByText('Today %')).toBeInTheDocument();
      expect(screen.getByText('Market Value')).toBeInTheDocument();
      expect(screen.getByText('Max Loss')).toBeInTheDocument();
      expect(screen.getByText('Max Profit')).toBeInTheDocument();
    });

    it('should have proper touch targets and responsive padding', () => {
      const { container } = render(<MockTableHeaders />);

      const headers = container.querySelectorAll('th');
      headers.forEach(header => {
        expect(header).toHaveClass('cursor-pointer', 'touch-manipulation');
        expect(header).toHaveClass('px-1', 'sm:px-2'); // Responsive padding
      });
    });

    it('should use responsive table text sizing', () => {
      const { container } = render(<MockTableHeaders />);

      const table = container.querySelector('table');
      expect(table).toHaveClass('text-xs', 'sm:text-sm');
    });
  });

  describe('Table Cell Responsive Behavior', () => {
    const MockTableRow = () => {
      return (
        <table className="w-full text-xs sm:text-sm">
          <tbody>
            <tr className="border-b border-white/5 hover:bg-white/5 active:bg-white/10 cursor-pointer touch-manipulation min-h-[44px]">
              <td className="py-2 px-1 sm:px-2">TSM</td>
              <td className="text-right py-2 px-1 sm:px-2 font-mono text-gray-300 border-l border-r border-white/10">
                $328.98
              </td>
              <td className="text-right py-2 px-1 sm:px-2 font-mono font-medium border-l border-white/10 text-green-400">
                +$3,216
              </td>
              <td className="text-right py-2 px-1 sm:px-2 font-mono text-xs border-r border-white/10 text-green-400">
                +2.1%
              </td>
              <td className="text-right py-2 px-1 sm:px-2 font-mono font-medium border-l border-white/10 text-red-400">
                -$125
              </td>
              <td className="text-right py-2 px-1 sm:px-2 font-mono text-xs border-r border-white/10 text-red-400">
                -0.4%
              </td>
              <td className="text-right py-2 px-1 sm:px-2 font-mono text-gray-300 border-l border-r border-white/10">
                $32,898
              </td>
              <td className="text-right py-2 px-1 sm:px-2 font-mono text-red-400">
                ∞
              </td>
              <td className="text-right py-2 px-1 sm:px-2 font-mono text-green-400">
                ∞
              </td>
            </tr>
          </tbody>
        </table>
      );
    };

    it('should display table data with proper formatting', () => {
      render(<MockTableRow />);

      expect(screen.getByText('TSM')).toBeInTheDocument();
      expect(screen.getByText('$328.98')).toBeInTheDocument();
      expect(screen.getByText('+$3,216')).toBeInTheDocument();
      expect(screen.getByText('+2.1%')).toBeInTheDocument();
      expect(screen.getByText('-$125')).toBeInTheDocument();
      expect(screen.getByText('-0.4%')).toBeInTheDocument();
      expect(screen.getByText('$32,898')).toBeInTheDocument();
    });

    it('should apply responsive padding to table cells', () => {
      const { container } = render(<MockTableRow />);

      const tableCells = container.querySelectorAll('td');
      tableCells.forEach(cell => {
        expect(cell).toHaveClass('px-1', 'sm:px-2');
      });
    });

    it('should have touch-friendly row height', () => {
      const { container } = render(<MockTableRow />);

      const tableRow = container.querySelector('tr');
      expect(tableRow).toHaveClass('min-h-[44px]');
      expect(tableRow).toHaveClass('cursor-pointer', 'touch-manipulation');
    });

    it('should show proper hover and active states', () => {
      const { container } = render(<MockTableRow />);

      const tableRow = container.querySelector('tr');
      expect(tableRow).toHaveClass('hover:bg-white/5', 'active:bg-white/10');
    });
  });

  describe('Overflow and Scroll Behavior', () => {
    const MockScrollableTable = () => {
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-xs sm:text-sm">
            <thead>
              <tr>
                <th>Col 1</th>
                <th>Col 2</th>
                <th>Col 3</th>
                <th>Col 4</th>
                <th>Col 5</th>
                <th>Col 6</th>
                <th>Col 7</th>
                <th>Col 8</th>
                <th>Col 9</th>
              </tr>
            </thead>
          </table>
        </div>
      );
    };

    it('should provide horizontal scroll for table overflow', () => {
      const { container } = render(<MockScrollableTable />);

      const scrollContainer = container.querySelector('.overflow-x-auto');
      expect(scrollContainer).toBeInTheDocument();

      const table = scrollContainer?.querySelector('table.w-full');
      expect(table).toBeInTheDocument();
    });
  });
});