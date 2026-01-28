/**
 * Search utility functions for the application.
 */

/**
 * Finds the first ticker that starts with the given query (case-insensitive).
 * 
 * @param tickers List of available tickers
 * @param query Search query
 * @returns The matching ticker or null if not found
 */
export function findMatchingTicker(tickers: string[], query: string): string | null {
  if (!query || !tickers.length) return null;
  
  const normalizedQuery = query.toUpperCase();
  const match = tickers.find(t => t.toUpperCase().startsWith(normalizedQuery));
  
  return match || null;
}

/**
 * Scrolls the element for the given ticker into view.
 * Expects elements to have ID format `ticker-list-item-{ticker}`.
 * 
 * @param ticker Ticker symbol to scroll to
 * @returns True if element found and scrolled, false otherwise
 */
export function scrollToTicker(ticker: string): boolean {
  if (!ticker) return false;
  
  const element = document.getElementById(`ticker-list-item-${ticker}`);
  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
  }
  
  return false;
}
