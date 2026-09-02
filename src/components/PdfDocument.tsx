// A PDF, drawn page by page into the page itself.
//
// This used to be `<iframe src={objectUrl}>`, which is why every non-image
// document previewed as a blank rectangle while "Open full screen" — a
// top-level tab, where the browser's own viewer takes over — showed the file
// perfectly. Android Chrome has no embedded PDF plugin at all, and iOS Safari
// does not render a PDF in a frame either, so on the phones this app is for
// there was nothing to see. Rasterising with pdf.js removes the dependency on
// the browser having a viewer it will use inside a frame.
//
// The renderer is dynamically imported: pdf.js is ~1.7 MB and only this screen
// ever wants it, so it must not sit in the entry chunk.
import { useEffect, useRef, useState } from 'react'
import { Loading } from './Loading'

type State =
  | { status: 'rendering' }
  | { status: 'done'; pageCount: number; shown: number }
  | { status: 'failed' }

/** Rendered when the bytes cannot be drawn — a damaged PDF, or pdf.js failing
 *  to load on a phone with no signal that has never opened one before. */
function Unrenderable() {
  return (
    <div className="rounded-3xl bg-white p-6 text-center shadow-card">
      <p className="text-sm text-muted">
        This document can’t be shown here. Open it full screen or download it below.
      </p>
    </div>
  )
}

export function PdfDocument({ url, title }: { url: string; title: string }) {
  const host = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<State>({ status: 'rendering' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'rendering' })

    // The column is measured rather than assumed: the same document is a
    // 360px phone and a 640px capped container, and rendering to the wrong
    // one is either a blurry page or wasted memory.
    const width = host.current?.clientWidth || 640

    import('../pdf/engine.pdfjs')
      .then(({ renderPdf, MAX_PAGES }) =>
        renderPdf(url, width).then(({ canvases, pageCount }) => {
          if (cancelled) return
          const node = host.current
          if (!node) return
          node.replaceChildren(...canvases)
          setState({ status: 'done', pageCount, shown: Math.min(pageCount, MAX_PAGES) })
        })
      )
      .catch(() => {
        if (!cancelled) setState({ status: 'failed' })
      })

    return () => {
      cancelled = true
      // Drop the bitmaps rather than waiting for the next render to replace
      // them: several megabytes per document, on a phone.
      host.current?.replaceChildren()
    }
  }, [url])

  if (state.status === 'failed') return <Unrenderable />

  return (
    <div>
      {state.status === 'rendering' && <Loading />}
      <div
        ref={host}
        aria-label={title}
        className="flex flex-col gap-3 overflow-hidden rounded-3xl bg-white p-2 shadow-card empty:hidden"
      />
      {state.status === 'done' && state.pageCount > state.shown && (
        <p className="mt-2 text-center text-xs text-muted">
          Showing the first {state.shown} of {state.pageCount} pages — open full screen for the
          rest.
        </p>
      )}
    </div>
  )
}
