// Typed API client: bearer access code on every call, error-envelope
// normalization, 401 → back to the gate.
export const ACCESS_CODE_KEY = 'trip_access_code'
export const ROLE_KEY = 'trip_role'

/** 'owner' can change things; 'guest' is a read-only view with no documents. */
export type Role = 'owner' | 'guest'

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: string[]
  ) {
    super(message)
  }
}

export const getAccessCode = () => localStorage.getItem(ACCESS_CODE_KEY)
export const setAccessCode = (code: string) => localStorage.setItem(ACCESS_CODE_KEY, code)
export const clearAccessCode = () => {
  localStorage.removeItem(ACCESS_CODE_KEY)
  localStorage.removeItem(ROLE_KEY)
}

// Cached so the app doesn't flash a read-only shell at the travelers on every
// cold start. It is a UI hint only — a guest who edits this by hand still gets
// a 403 from the API on anything that writes.
export const getStoredRole = (): Role | null => {
  const role = localStorage.getItem(ROLE_KEY)
  return role === 'owner' || role === 'guest' ? role : null
}
export const setStoredRole = (role: Role) => localStorage.setItem(ROLE_KEY, role)

async function send(path: string, init: RequestInit = {}): Promise<Response> {
  const code = getAccessCode()
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(code ? { Authorization: `Bearer ${code}` } : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new ApiError(0, 'NETWORK', 'No connection — check your internet and retry')
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => null))?.error ?? {}
    if (res.status === 401 && !path.startsWith('/auth/')) {
      clearAccessCode()
      window.location.assign('/gate')
    }
    throw new ApiError(
      res.status,
      err.code ?? 'INTERNAL',
      err.message ?? 'Request failed',
      err.details
    )
  }
  return res
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await send(path, init)
  if (res.status === 204) return undefined as T
  return (await res.json().catch(() => null)) as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  /** Raw response body — used by the document preview, which needs the bytes, not JSON. */
  blob: (path: string) => send(path).then((res) => res.blob()),
  post: <T>(path: string, data: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(data) }),
  patch: <T>(path: string, data: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}
