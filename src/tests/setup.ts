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

// jsdom's Blob has no `text()` or `arrayBuffer()`. The export writers hand
// back Blobs — that is what goes to a share sheet — so the tests that read one
// back need these. Implemented over FileReader, which jsdom does have.
Blob.prototype.arrayBuffer ??= function (this: Blob) {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(this)
  })
}
Blob.prototype.text ??= function (this: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsText(this)
  })
}

// jsdom implements no media playback at all: HTMLMediaElement's play/pause/load
// exist but report "not implemented" to the virtual console, and play() returns
// undefined rather than a promise. The gate's video backdrop drives all three
// (src/components/GateBackdrop.tsx), so they are stubbed into no-ops here —
// what those tests assert is which clip is on screen, which is an attribute
// and a style, not playback.
HTMLMediaElement.prototype.play = () => Promise.resolve()
HTMLMediaElement.prototype.pause = () => {}
HTMLMediaElement.prototype.load = () => {}
