// Who is holding the phone. The access code decides it: the travelers' code is
// 'owner', the code handed to friends is 'guest' — a read-only view with no
// trip documents.
//
// This only drives what the UI offers. The server independently refuses every
// write and every /api/files request from a guest code, so nothing here is
// load-bearing for safety; it exists so a guest is never shown a button that
// would just fail.
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { api, getStoredRole, setStoredRole, type Role } from '../api/client'

// Read-only is the safe default for anything rendered outside a provider.
const RoleContext = createContext<Role>('guest')

export const useRole = () => useContext(RoleContext)

/** True for the travelers: add, edit, delete and the documents tab. */
export const useCanEdit = () => useRole() === 'owner'

export { RoleContext }

/**
 * Resolves the role once per app load. The cached value renders immediately (so
 * the travelers don't flash a read-only shell), and `/auth/session` confirms it
 * — which is also how a session predating the guest view learns what it is
 * without being bounced back to the gate.
 */
export function RoleProvider({
  children,
  fallback,
}: {
  children: ReactNode
  fallback?: ReactNode
}) {
  const [role, setRole] = useState<Role | null>(getStoredRole)

  useEffect(() => {
    let cancelled = false
    api
      .get<{ role: Role }>('/auth/session')
      .then((data) => {
        if (cancelled || (data.role !== 'owner' && data.role !== 'guest')) return
        setStoredRole(data.role)
        setRole(data.role)
      })
      .catch(() => undefined) // a 401 has already sent us back to the gate
    return () => {
      cancelled = true
    }
  }, [])

  if (!role) return <>{fallback ?? null}</>
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>
}
