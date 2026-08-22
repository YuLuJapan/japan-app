// Typed API client: the signed-in session's bearer token on every call,
// error-envelope normalization, 401 → back to the gate.
//
// The key is still named for the access code it used to hold; what it holds
// now is a Supabase Auth JWT, which session.tsx keeps fresh as supabase-js
// rotates it.
export const ACCESS_CODE_KEY = 'trip_access_code'

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
  // The role this app used to cache alongside the token. Removed here so a
  // browser that signed in before accounts doesn't keep a stale key forever.
  localStorage.removeItem('trip_role')
}

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
    // `/me` is what the gate calls to check a token it has just been handed.
    // Bouncing to the gate from the gate is a reload loop, so that one 401
    // goes back to the caller to handle.
    if (res.status === 401 && path !== '/me') {
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
