// Rasterising a PDF, and the only module in the repository that imports
// `pdfjs-dist` — the same boundary `engine.leaflet.ts` draws around Leaflet,
// for the same two reasons: swapping or deleting the viewer is one file, and
// nothing above this line has to be loadable in jsdom (a test mocks this
// module rather than trying to paint a canvas that has no 2D context).
//
// Why we rasterise at all, rather than handing the file to the browser: an
// `<iframe>`/`<embed>` pointed at a PDF renders nothing on Android Chrome (no
// PDF plugin exists there) and nothing dependable on iOS Safari, which is
// every phone this app was built for. See src/components/PdfDocument.tsx.
// The `legacy/` build, not the default one, and that is not a stylistic
// preference: pdf.js 6's modern build calls `Map.prototype.getOrInsertComputed`,
// which Chrome 141 does not have — it throws on the first page rendered, so
// shipping it would have replaced a blank preview with a broken one on every
// phone more than a version or two old. `legacy/` is the transpiled, polyfilled
// build published for exactly this. Both halves must come from it: a modern
// worker under a legacy main thread is the same crash one process over.
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
// Vite emits the worker as its own asset and hands back the URL; pdf.js fetches
// it itself, so it must not be bundled into this chunk.
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

/**
 * Pages past this are not drawn. A boarding pass is one page and a voucher a
 * handful, but nothing stops a 200-page upload, and every page held here is
 * `width × height × 4` bytes of canvas on a phone. The preview says how many
 * it left out and full screen still has all of them.
 */
export const MAX_PAGES = 10

/**
 * Cap on the pixel width of a rendered page. Retina at full width would draw
 * ~2.5× the pixels for detail no phone screen can show, and the memory is real.
 */
const MAX_PIXEL_WIDTH = 1600

export type RenderedPdf = {
  /** One canvas per drawn page, in document order. */
  canvases: HTMLCanvasElement[]
  /** Pages the document has, including any past MAX_PAGES. */
  pageCount: number
}

/**
 * Draw the first pages of `url` (an object URL for the fetched blob) onto
 * canvases sized for `cssWidth`. Rejects if the bytes are not a readable PDF,
 * which the caller turns back into the download-only card.
 */
export async function renderPdf(url: string, cssWidth: number): Promise<RenderedPdf> {
  // The loading task, not the document proxy, is what owns the worker and what
  // has a `destroy` — the proxy has none, and calling one on it throws.
  const task = getDocument({
    url,
    // Two sets of resources pdf.js fetches on demand, served from /pdfjs by
    // the plugin in vite.config.ts. Without them a document renders with
    // substituted glyphs — which is how a receipt ends up looking subtly wrong
    // rather than failing honestly:
    //  · standardFontData — the 14 standard fonts (Helvetica, Times, Courier).
    //    A machine-generated PDF names them and does not embed them.
    //  · cMaps — predefined CJK character maps. On a trip to Japan, a hotel
    //    voucher or a JR ticket is exactly the document that needs one.
    // Only the handful of files a given document actually names are fetched.
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
  })
  const doc = await task.promise
  try {
    const pageCount = doc.numPages
    const canvases: HTMLCanvasElement[] = []

    for (let n = 1; n <= Math.min(pageCount, MAX_PAGES); n += 1) {
      const page = await doc.getPage(n)
      const unscaled = page.getViewport({ scale: 1 })
      // Draw at the device's pixel density so text stays sharp, then let CSS
      // scale the canvas back down to the column width.
      const target = Math.min(cssWidth * (window.devicePixelRatio || 1), MAX_PIXEL_WIDTH)
      const viewport = page.getViewport({ scale: target / unscaled.width })

      const canvas = document.createElement('canvas')
      canvas.width = Math.floor(viewport.width)
      canvas.height = Math.floor(viewport.height)
      canvas.style.width = '100%'
      canvas.style.height = 'auto'
      canvas.setAttribute('role', 'img')
      canvas.setAttribute('aria-label', `Page ${n} of ${pageCount}`)

      await page.render({ canvas, viewport }).promise
      page.cleanup()
      canvases.push(canvas)
    }

    return { canvases, pageCount }
  } finally {
    // Frees the worker and the parsed document. Without this every preview
    // opened in a session leaks one of each.
    await task.destroy()
  }
}
