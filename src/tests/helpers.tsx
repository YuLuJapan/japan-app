import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { TripRole, TripShows } from '../api/types'
import { TripRoleContext, TripShowsContext } from '../lib/session'
import type { Activity } from '../api/types'

const ALL: TripShows = { stays: true, flight: true, documents: true, shopping: true }

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

/**
 * An activity, with every field defaulted so a test names only what it is
 * about. 010 merged two entities into one with seventeen columns; spelling all
 * of them out at each call site made the tests about the shape rather than the
 * behaviour.
 *
 * The default is **saved** — no date — because that is the state with the
 * stricter rule (a saved activity needs a city, FR-004). Pass `day` to schedule
 * it.
 */
export function activity(over: Partial<Activity> & { id: string; name: string }): Activity {
  return {
    trip_id: 'trip-1',
    zone_id: 'zone-tokyo',
    category: null,
    name_ja: null,
    description: null,
    address: null,
    links: [],
    image_url: null,
    lat: null,
    lng: null,
    day: null,
    start_time: null,
    position: 0,
    highlight: false,
    icon: null,
    summary_line: '',
    file_count: 0,
    ...over,
  }
}
