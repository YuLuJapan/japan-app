import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'

function TabIcon({ name, active }: { name: 'journey' | 'docs'; active: boolean }) {
  const stroke = active ? '#ff5a4d' : '#6b7280'
  if (name === 'journey') {
    return (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 21s-7-6.3-7-11a7 7 0 0 1 14 0c0 4.7-7 11-7 11Z" />
        <circle cx="12" cy="10" r="2.5" />
      </svg>
    )
  }
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3v4a1 1 0 0 0 1 1h4" />
      <path d="M17 21H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7l5 5v11a2 2 0 0 1-2 2Z" />
    </svg>
  )
}

export function Layout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const journeyActive = pathname === '/' || pathname.startsWith('/zones') || pathname.startsWith('/places')
  const docsActive = pathname.startsWith('/files')

  const tab = (to: string, name: 'journey' | 'docs', label: string, active: boolean) => (
    <Link
      to={to}
      className={`flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold ${
        active ? 'text-brand' : 'text-muted'
      }`}
    >
      <TabIcon name={name} active={active} />
      {label}
    </Link>
  )

  return (
    <div className="mx-auto flex min-h-dvh max-w-app flex-col bg-canvas">
      <header className="sticky top-0 z-20 flex items-center justify-between bg-canvas/85 px-5 py-4 backdrop-blur">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-brand text-lg font-extrabold text-white shadow-card">
            旅
          </span>
          <span className="font-display text-lg font-extrabold tracking-tight">Japan</span>
        </Link>
      </header>
      <main className="flex-1 px-5 pb-28 pt-1">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-app px-6">
          {tab('/', 'journey', 'Journey', journeyActive)}
          {tab('/files', 'docs', 'Documents', docsActive)}
        </div>
      </nav>
    </div>
  )
}
