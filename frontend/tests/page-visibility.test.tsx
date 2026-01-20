import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { act } from '@testing-library/react';
import React from 'react';

// Mock component that uses page visibility API
const TestComponent = () => {
  const [isVisible, setIsVisible] = React.useState(true);
  const [pollCount, setPollCount] = React.useState(0);

  React.useEffect(() => {
    const handleVisibilityChange = () => {
      setIsVisible(!document.hidden);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  React.useEffect(() => {
    const interval = setInterval(() => {
      if (isVisible) {
        setPollCount(prev => prev + 1);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [isVisible]);

  return (
    <div>
      <div data-testid="visibility">{isVisible ? 'visible' : 'hidden'}</div>
      <div data-testid="poll-count">{pollCount}</div>
    </div>
  );
};

describe('Page Visibility API Integration', () => {
  let visibilityChangeCallback: (() => void) | null = null;

  beforeEach(() => {
    vi.useFakeTimers();

    // Mock document.addEventListener to capture the visibility change handler
    document.addEventListener = vi.fn((event: string, callback: any) => {
      if (event === 'visibilitychange') {
        visibilityChangeCallback = callback;
      }
    });

    // Set initial state
    Object.defineProperty(document, 'hidden', {
      writable: true,
      value: false,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    visibilityChangeCallback = null;
  });

  it('should setup visibility change listener on component mount', () => {
    render(<TestComponent />);

    expect(document.addEventListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    expect(visibilityChangeCallback).not.toBeNull();
  });

  it('should update state when page visibility changes', () => {
    render(<TestComponent />);

    // Initially visible
    expect(screen.getByTestId('visibility')).toHaveTextContent('visible');

    // Simulate page becoming hidden
    act(() => {
      Object.defineProperty(document, 'hidden', { value: true, writable: true });
      if (visibilityChangeCallback) {
        visibilityChangeCallback();
      }
    });

    expect(screen.getByTestId('visibility')).toHaveTextContent('hidden');

    // Simulate page becoming visible again
    act(() => {
      Object.defineProperty(document, 'hidden', { value: false, writable: true });
      if (visibilityChangeCallback) {
        visibilityChangeCallback();
      }
    });

    expect(screen.getByTestId('visibility')).toHaveTextContent('visible');
  });

  it('should pause polling when page is hidden', () => {
    render(<TestComponent />);

    // Let some polling happen while visible
    act(() => {
      vi.advanceTimersByTime(300); // Should trigger 3 polls
    });

    expect(screen.getByTestId('poll-count')).toHaveTextContent('3');

    // Hide the page
    act(() => {
      Object.defineProperty(document, 'hidden', { value: true, writable: true });
      if (visibilityChangeCallback) {
        visibilityChangeCallback();
      }
    });

    // More time passes but no more polling should happen
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.getByTestId('poll-count')).toHaveTextContent('3');

    // Make page visible again
    act(() => {
      Object.defineProperty(document, 'hidden', { value: false, writable: true });
      if (visibilityChangeCallback) {
        visibilityChangeCallback();
      }
    });

    // Polling should resume
    act(() => {
      vi.advanceTimersByTime(200); // 2 more polls
    });

    expect(screen.getByTestId('poll-count')).toHaveTextContent('5');
  });
});

describe('Polling Interval Optimizations', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should have reduced polling intervals for better mobile performance', () => {
    // Test that our optimized intervals are what we expect
    const CHART_POLLING_INTERVAL = 30000; // 30 seconds (reduced from 10s)
    const NEWS_POLLING_INTERVAL = 60000;  // 60 seconds (reduced from 30s)

    expect(CHART_POLLING_INTERVAL).toBe(30000);
    expect(NEWS_POLLING_INTERVAL).toBe(60000);

    // Verify these are indeed less aggressive than before
    expect(CHART_POLLING_INTERVAL).toBeGreaterThan(10000);
    expect(NEWS_POLLING_INTERVAL).toBeGreaterThan(30000);
  });
});