import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import type { Role } from '../api/client'
import { RoleContext } from '../lib/session'

/** `role` defaults to the travelers' view; pass 'guest' for the read-only one. */
export function renderAt(
  path: string,
  routes: { path: string; element: ReactNode }[],
  { role = 'owner' as Role } = {}
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <RoleContext.Provider value={role}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            {routes.map((r) => (
              <Route key={r.path} path={r.path} element={r.element} />
            ))}
          </Routes>
        </MemoryRouter>
      </RoleContext.Provider>
    </QueryClientProvider>
  )
}
