import '@testing-library/jest-dom/vitest'

// jsdom has no layout engine and leaves Element.scrollTo undefined; the day strip
// calls it on mount to keep the selected chip in view.
Element.prototype.scrollTo ??= () => {}

// jsdom ships no media-query engine, so window.matchMedia is simply absent.
// isStandalone() (src/lib/push.ts) asks it whether the app is running from the
// Home Screen — which, in a test, it never is. A test that needs the other
// answer stubs this per-case.
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => false,
})) as typeof window.matchMedia
