import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock IntersectionObserver
global.IntersectionObserver = class MockIntersectionObserver {
  root = null;
  rootMargin = '';
  thresholds = [];
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
  takeRecords() { return []; }
} as any;

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  constructor() {}
  disconnect() {}
  observe() {}
  unobserve() {}
};

// Mock scrollTo
global.scrollTo = vi.fn();

// Mock document.hidden for page visibility API tests
Object.defineProperty(document, 'hidden', {
  writable: true,
  value: false,
});

// Mock visibilitychange event
const originalAddEventListener = document.addEventListener;
const originalRemoveEventListener = document.removeEventListener;

document.addEventListener = vi.fn();
document.removeEventListener = vi.fn();