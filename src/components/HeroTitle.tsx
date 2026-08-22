import { useLayoutEffect, useRef } from 'react'

/** Splits "Yuval & Luciana in Japan" into its lead and its destination so the
 *  destination can carry the accent colour. The trip name is stored separately
 *  from the travellers (see Journey's heroTitle), so it is matched as the tail
 *  of the title rather than guessed — a title that doesn't end in the
 *  destination simply gets no accent. */
export function splitDestination(title: string, destination?: string): [string, string] {
  if (!destination) return [title, '']
  const at = title.toLowerCase().lastIndexOf(destination.toLowerCase())
  if (at < 0) return [title, '']
  return [title.slice(0, at), title.slice(at)]
}

/** Keeps the heading on a single line: measures the text at `max` px and scales
 *  the font size down — never past `min` — until it fits its column. Done
 *  imperatively on the node rather than through state, because the size feeds
 *  back into the measurement it comes from. */
function useFitOneLine(text: string, max: number, min: number) {
  const ref = useRef<HTMLHeadingElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    const fit = () => {
      el.style.fontSize = `${max}px`
      const avail = el.clientWidth
      const width = el.scrollWidth
      // jsdom lays nothing out and reports 0 for both — there the heading just
      // stays at its base size.
      if (!avail || !width || width <= avail) return
      // A hair under the full column so the line never kisses the right edge
      // (and survives the odd rounding difference between measure and paint).
      el.style.fontSize = `${Math.max(min, ((avail * 0.98) / width) * max)}px`
    }

    fit()
    window.addEventListener('resize', fit)
    // The display face arrives after first paint and changes the measurement.
    document.fonts?.ready.then(fit).catch(() => {})
    return () => window.removeEventListener('resize', fit)
  }, [text, max, min])

  return ref
}

export function HeroTitle({
  title,
  destination,
  max = 40,
  min = 22,
  className = '',
}: {
  title: string
  destination?: string
  max?: number
  min?: number
  className?: string
}) {
  const [lead, accent] = splitDestination(title, destination)
  const ref = useFitOneLine(title, max, min)

  return (
    <h1
      ref={ref}
      style={{ fontSize: max }}
      className={`whitespace-nowrap font-display font-bold leading-[1.06] tracking-tight ${className}`}
    >
      {lead}
      {accent && <span className="text-brand">{accent}</span>}
    </h1>
  )
}
