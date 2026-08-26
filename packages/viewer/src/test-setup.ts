import '@testing-library/jest-dom/vitest';

// jsdom lacks IntersectionObserver (used by ChatPanel)
class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof globalThis.IntersectionObserver === 'undefined') {
  globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver;
}
