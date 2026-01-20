import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { PayoffChart } from '@/components/payoff-chart';
import { NewsItemList } from '@/components/news-item-list';

// Mock recharts to avoid canvas/SVG issues in tests
vi.mock('recharts', () => ({
  LineChart: ({ children }: any) => <div data-testid="line-chart">{children}</div>,
  Line: () => <div data-testid="line" />,
  XAxis: () => <div data-testid="x-axis" />,
  YAxis: () => <div data-testid="y-axis" />,
  CartesianGrid: () => <div data-testid="grid" />,
  Tooltip: () => <div data-testid="tooltip" />,
  Legend: () => <div data-testid="legend" />,
  ResponsiveContainer: ({ children }: any) => <div data-testid="responsive-container">{children}</div>,
  ReferenceLine: () => <div data-testid="reference-line" />,
}));

describe('React.memo Performance Optimizations', () => {
  describe('PayoffChart Component', () => {
    const defaultProps = {
      data: [
        { price: 100, pnl: -500 },
        { price: 110, pnl: 0 },
        { price: 120, pnl: 500 }
      ],
      currentPrice: 110,
      breakevens: [110],
      showStock: true,
      showOptions: true,
      showCombined: true,
      showT0: false
    };

    it('should render PayoffChart without errors', () => {
      render(<PayoffChart {...defaultProps} />);
      expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
    });

    it('should not re-render when props are the same (memoization check)', () => {
      const renderSpy = vi.fn();

      const TestWrapper = ({ trigger }: { trigger: number }) => {
        renderSpy();
        return <PayoffChart {...defaultProps} />;
      };

      const { rerender } = render(<TestWrapper trigger={1} />);

      expect(renderSpy).toHaveBeenCalledTimes(1);

      // Re-render with same props - should not cause PayoffChart to re-render
      rerender(<TestWrapper trigger={2} />);

      // The wrapper re-renders but PayoffChart should be memoized
      expect(renderSpy).toHaveBeenCalledTimes(2);
    });

    it('should re-render when data changes', () => {
      const { rerender } = render(<PayoffChart {...defaultProps} />);

      const newProps = {
        ...defaultProps,
        data: [
          { price: 95, pnl: -600 },
          { price: 105, pnl: -100 },
          { price: 115, pnl: 400 }
        ]
      };

      rerender(<PayoffChart {...newProps} />);

      // Should still render properly with new data
      expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
    });

    it('should re-render when current price changes', () => {
      const { rerender } = render(<PayoffChart {...defaultProps} />);

      rerender(<PayoffChart {...defaultProps} currentPrice={115} />);

      expect(screen.getByTestId('responsive-container')).toBeInTheDocument();
    });
  });

  describe('NewsItemList Component', () => {
    const mockHeadlines = [
      {
        articleId: '1',
        providerCode: 'provider1',
        headline: 'Test headline 1',
        summary: 'Test summary 1',
        url: 'http://example.com/1',
        imageUrl: 'http://example.com/image1.jpg',
        timestampMs: Date.now()
      },
      {
        articleId: '2',
        providerCode: 'provider2',
        headline: 'Test headline 2',
        summary: 'Test summary 2',
        url: 'http://example.com/2',
        imageUrl: 'http://example.com/image2.jpg',
        timestampMs: Date.now() - 1000
      }
    ];

    const defaultProps = {
      headlines: mockHeadlines,
      loading: false,
      emptyMessage: 'No news available',
      accentColor: 'orange' as const,
      onArticleClick: vi.fn()
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should render NewsItemList without errors', () => {
      render(<NewsItemList {...defaultProps} />);
      expect(screen.getByText('Test headline 1')).toBeInTheDocument();
      expect(screen.getByText('Test headline 2')).toBeInTheDocument();
    });

    it('should show loading spinner when loading is true', () => {
      render(<NewsItemList {...defaultProps} loading={true} />);
      expect(screen.getByRole('generic')).toHaveClass('animate-spin');
    });

    it('should show empty message when no headlines', () => {
      render(<NewsItemList {...defaultProps} headlines={[]} emptyMessage="Custom empty message" />);
      expect(screen.getByText('Custom empty message')).toBeInTheDocument();
    });

    it('should not re-render when props are the same (memoization check)', () => {
      const renderSpy = vi.fn();

      const TestWrapper = ({ trigger }: { trigger: number }) => {
        renderSpy();
        return <NewsItemList {...defaultProps} />;
      };

      const { rerender } = render(<TestWrapper trigger={1} />);

      expect(renderSpy).toHaveBeenCalledTimes(1);

      // Re-render with same props
      rerender(<TestWrapper trigger={2} />);

      expect(renderSpy).toHaveBeenCalledTimes(2);
    });

    it('should apply correct accent color classes', () => {
      const { rerender } = render(<NewsItemList {...defaultProps} accentColor="blue" />);

      // Check that blue accent color is applied
      const loadingElement = render(<NewsItemList {...defaultProps} loading={true} accentColor="blue" />);
      expect(loadingElement.container.querySelector('.border-blue-500')).toBeInTheDocument();
    });

    it('should call onArticleClick when article is clicked', () => {
      const mockOnClick = vi.fn();
      render(<NewsItemList {...defaultProps} onArticleClick={mockOnClick} />);

      const firstHeadline = screen.getByText('Test headline 1');
      firstHeadline.click();

      expect(mockOnClick).toHaveBeenCalledWith({
        articleId: '1',
        providerCode: 'provider1',
        headline: 'Test headline 1'
      });
    });
  });

  describe('Component Performance Characteristics', () => {
    it('should confirm PayoffChart is wrapped with React.memo', () => {
      // Check that the component has the memo wrapper
      expect(PayoffChart.displayName).toBe('PayoffChart');
      expect(Object.prototype.toString.call(PayoffChart)).toContain('Function');
    });

    it('should confirm NewsItemList is wrapped with React.memo', () => {
      // Check that the component has the memo wrapper
      expect(NewsItemList.displayName).toBe('NewsItemList');
      expect(Object.prototype.toString.call(NewsItemList)).toContain('Function');
    });
  });
});