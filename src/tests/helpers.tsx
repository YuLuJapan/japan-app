import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { TripRole, TripShows } from '../api/types'
import { TripRoleContext, TripShowsContext } from '../lib/session'

const ALL: TripShows = { stays: true, flight: true, documents: true }

interface Options {
  /** The caller's role on the trip being rendered. `null` = outside a trip. */
  tripRole?: TripRole | null
  /** What the trip shows them — the router feeds this from the bundle. */
  shows?: TripShows
}

/** Defaults to an owner who is shown everything; narrow either per test. */
export function renderAt(
  path: string,
  routes: { path: string; element: ReactNode }[],
  { tripRole = 'owner', shows = ALL }: Options = {}
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <TripRoleContext.Provider value={tripRole}>
        <TripShowsContext.Provider value={shows}>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              {routes.map((r) => (
                <Route key={r.path} path={r.path} element={r.element} />
              ))}
            </Routes>
          </MemoryRouter>
        </TripShowsContext.Provider>
      </TripRoleContext.Provider>
    </QueryClientProvider>
  )
}
