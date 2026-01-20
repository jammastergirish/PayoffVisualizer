import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDebounce } from '@/lib/utils';

describe('useDebounce Hook', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should debounce function calls', () => {
    const mockFn = vi.fn();
    const { result } = renderHook(() => useDebounce(mockFn, 500));

    // Call the debounced function multiple times
    act(() => {
      result.current('test1');
      result.current('test2');
      result.current('test3');
    });

    // Function should not be called yet
    expect(mockFn).not.toHaveBeenCalled();

    // Fast-forward time by 500ms
    act(() => {
      vi.advanceTimersByTime(500);
    });

    // Function should be called once with the last arguments
    expect(mockFn).toHaveBeenCalledTimes(1);
    expect(mockFn).toHaveBeenCalledWith('test3');
  });

  it('should cancel previous timeout when called again', () => {
    const mockFn = vi.fn();
    const { result } = renderHook(() => useDebounce(mockFn, 500));

    // First call
    act(() => {
      result.current('first');
    });

    // Fast-forward by 250ms (not enough to trigger)
    act(() => {
      vi.advanceTimersByTime(250);
    });

    // Second call should cancel the first
    act(() => {
      result.current('second');
    });

    // Fast-forward by another 250ms (only 250ms since second call)
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(mockFn).not.toHaveBeenCalled();

    // Fast-forward by another 250ms (500ms since second call)
    act(() => {
      vi.advanceTimersByTime(250);
    });

    expect(mockFn).toHaveBeenCalledTimes(1);
    expect(mockFn).toHaveBeenCalledWith('second');
  });

  it('should work with different callback functions', () => {
    const mockFn1 = vi.fn();
    const mockFn2 = vi.fn();

    const { result: result1 } = renderHook(() => useDebounce(mockFn1, 300));
    const { result: result2 } = renderHook(() => useDebounce(mockFn2, 300));

    act(() => {
      result1.current('test1');
      result2.current('test2');
    });

    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(mockFn1).toHaveBeenCalledWith('test1');
    expect(mockFn2).toHaveBeenCalledWith('test2');
  });

  it('should preserve function arguments correctly', () => {
    const mockFn = vi.fn();
    const { result } = renderHook(() => useDebounce(mockFn, 500));

    act(() => {
      result.current('arg1', 'arg2', { key: 'value' });
    });

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(mockFn).toHaveBeenCalledWith('arg1', 'arg2', { key: 'value' });
  });
});