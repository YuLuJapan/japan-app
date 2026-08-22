// The trail back up.
//
// The app is five tabs, each with drill-downs under it, and the tab strip only
// ever gets you back to the top of a tab. Most screens grew their own one-line
// "‹ Somewhere" link; the roster grew none at all and could only be left
// through the browser's own back button — a dead end on a phone. This is that
// link, generalised: one component, so a screen three levels down can show the
// whole path rather than a single hop.
import { Link } from 'react-router-dom'

export type Crumb = { label: string; to: string }

/**
 * The ancestors of the current screen, nearest last. The page's own heading
 * already says where you are, so the current page is deliberately not repeated
 * as a dead crumb — every crumb here is somewhere you can go.
 */
export function Breadcrumbs({ trail }: { trail: Crumb[] }) {
  if (trail.length === 0) return null
  return (
    // A long trail ("Journey › Kyoto & around › Food") outruns a 360px phone,
    // so it scrolls sideways on its own rather than wrapping into two lines or
    // pushing the page wider.
    <nav aria-label="Breadcrumb" className="-mx-1 overflow-x-auto">
      <ol className="flex items-center gap-1.5 whitespace-nowrap px-1 text-sm font-semibold text-muted">
        {trail.map((crumb, i) => (
          <li key={`${crumb.to}-${i}`} className="flex items-center gap-1.5">
            {i === 0 ? (
              <span aria-hidden>‹</span>
            ) : (
              <span aria-hidden className="text-line">
                ›
              </span>
            )}
            <Link to={crumb.to} className="max-w-[11rem] truncate active:text-ink">
              {crumb.label}
            </Link>
          </li>
        ))}
      </ol>
    </nav>
  )
}
