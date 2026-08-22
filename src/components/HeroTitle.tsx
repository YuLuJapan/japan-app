import { useLayoutEffect, useRef } from 'react'

/** Splits "Yuval and Luciana in Japan" into its lead and its destination so the
 *  destination can carry the accent colour. The title itself is composed by the
 *  server (display_title), so the country is matched as the tail of it rather
 *  than guessed — a title that doesn't end in the country, like the name
 *  override "Honeymoon", simply gets no accent. */
export function splitDestination(title: string, destination?: string): [string, string] {
  if (!destination) return [title, '']
  const at = title.toLowerCase().lastIndexOf(destination.toLowerCase())
  if (at < 0) return [title, '']
  return [title.slice(0, at), title.slice(at)]
}

export interface TitleLines {
  /** Who is going — the first line. */
  names: string
  /** "in", "to" … — opens the second line, empty when there is only one. */
  connector: string
  /** The country, accented at the end of the second line. */
  accent: string
}

/**
 * Breaks the title after the travellers, so the destination gets a line of its
 * own: "Yuval and Luciana" / "in Japan".
 *
 * Only worth doing when the first line reads as a list of people. "Yuval in
 * Japan" and "Trip to Japan" have a single word ahead of the connector and stay
 * on one line, where a break would look like a mistake rather than a layout.
 */
export function splitTitleLines(title: string, destination?: string): TitleLines {
  const [lead, accent] = splitDestination(title, destination)
  if (!accent) return { names: title, connector: '', accent: '' }

  const connectorAt = lead.trimEnd().match(/^(.*\S)\s+(\S+)$/)
  if (!connectorAt || !/\s/.test(connectorAt[1])) return { names: lead, connector: '', accent }
  return { names: connectorAt[1], connector: connectorAt[2], accent }
}

/** Fits the heading to its column: measures at `max` px and scales the font
 *  size down — never past `min` — until the widest line fits. Done imperatively
 *  on the node rather than through state, because the size feeds back into the
 *  measurement it comes from. */
function useFitLines(text: string, max: number, min: number) {
  const ref = useRef<HTMLHeadingElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    const fit = () => {
      el.style.fontSize = `${max}px`
      const avail = el.clientWidth
      // Each line is its own nowrap block, so this is the widest of them.
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
  // The size the title renders at when it fits, which for two short lines it
  // normally does — the fit only ever scales down from here.
  max = 34,
  min = 22,
  className = '',
}: {
  title: string
  destination?: string
  max?: number
  min?: number
  className?: string
}) {
  const { names, connector, accent } = splitTitleLines(title, destination)
  const ref = useFitLines(title, max, min)

  return (
    <h1
      ref={ref}
      style={{ fontSize: max }}
      className={`font-display font-bold leading-[1.04] tracking-tight ${className}`}
    >
      <span className="block whitespace-nowrap">
        {names}
        {!connector && accent && <span className="text-brand">{accent}</span>}
      </span>
      {connector && (
        <span className="block whitespace-nowrap">
          {connector} <span className="text-brand">{accent}</span>
        </span>
      )}
    </h1>
  )
}
