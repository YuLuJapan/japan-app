// The full-bleed photo header the redesign opens both the trip and a city
// with (options 1e/1f and 1g). One component for the two because they differ
// only in height and in what the chip above the title says — and because the
// scrim is the fiddly part: white text over someone's holiday snap is only
// legible if the gradient is tuned once and reused.
//
// The scrim is two darkenings, not one. The top 28% carries the floating back
// button and whatever the app header is showing over it; the bottom 45% ramps
// to 68% black so the title and its meta line hold up over a bright sky. The
// middle is left clear on purpose — that is the part of the photo anyone
// actually chose.
//
// It renders full-bleed by cancelling <main>'s horizontal padding (`-mx-5`),
// so it has to be the first thing on the page; nothing else in the app breaks
// out of that container.
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ZoneImage } from './ZoneImage'

interface Props {
  src?: string | null
  alt: string
  /** Small-caps pill above the title — "Trip overview", or a city's dates. */
  eyebrow?: ReactNode
  title: string
  /** One quiet line under the title. Absent on a city, which puts it in the pill. */
  meta?: string
  height: string
  /** Where the floating back circle goes. No link, no circle. */
  backTo?: string
  backLabel?: string
  /** Sits opposite the back button — the city page hangs "Photo" here. */
  action?: ReactNode
  /**
   * How far the card in `children` rides up over the photo, in px. The title
   * block is lifted clear of it by 12px, which is the design's own spacing:
   * it draws the card at `margin-top:-64px` and the title block at
   * `bottom:76px`. Without this the title sits at the photo's foot and the
   * card lands straight on top of it.
   */
  overlap?: number
  children?: ReactNode
}

export function PhotoHero({
  src,
  alt,
  eyebrow,
  title,
  meta,
  height,
  backTo,
  backLabel = 'Back',
  action,
  overlap = 0,
  children,
}: Props) {
  return (
    <div className="-mx-5 -mt-1">
      <div className={`relative ${height}`}>
        <ZoneImage src={src} alt={alt} className="h-full w-full" />
        {/* pointer-events-none so the photo edit button underneath stays tappable. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'linear-gradient(180deg,rgba(0,0,0,.32) 0%,rgba(0,0,0,0) 28%,rgba(0,0,0,0) 55%,rgba(0,0,0,.68) 100%)',
          }}
        />

        {backTo && (
          <Link
            to={backTo}
            aria-label={backLabel}
            className="absolute left-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-ink shadow-card backdrop-blur active:scale-95"
          >
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </Link>
        )}
        {action && <div className="absolute right-4 top-4">{action}</div>}

        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 px-[18px]"
          style={{ paddingBottom: Math.max(24, overlap + 12) }}
        >
          {eyebrow && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/30 px-2.5 py-1.5 text-xs font-extrabold uppercase tracking-[0.16em] text-white backdrop-blur">
              {eyebrow}
            </span>
          )}
          <h1
            className="mt-1.5 font-display text-[44px] font-extrabold leading-[1.05] tracking-[-0.03em] text-white"
            style={{ textShadow: '0 2px 12px rgba(0,0,0,.55)' }}
          >
            {title}
          </h1>
          {meta && (
            <p
              className="mt-1 text-sm font-semibold text-white"
              style={{ textShadow: '0 1px 6px rgba(0,0,0,.6)' }}
            >
              {meta}
            </p>
          )}
        </div>
      </div>
      {children}
    </div>
  )
}
