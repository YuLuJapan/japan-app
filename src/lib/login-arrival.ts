// What the URL says about how this visit to the gate began.
//
// Google and every emailed link — a magic link, a sign-up confirmation, an
// invitation — leave the app and come back to /gate carrying the answer in the
// URL. This client runs Supabase's *implicit* flow (supabase-js's default, and
// nothing here passes `flowType`), so the answer is a fragment: `#access_token=…`
// with a `type` naming the link that produced it, or `#error=…&error_code=…`
// when the provider refused it — an expired link, a used one.
//
// supabase-js reads that fragment once, at client creation, and then strips it
// from the address bar, so anything else that wants it has to read it *first* —
// at mount, before `getSupabaseClient()`. Pure and separate from the screen so
// that reading it is a function of a string rather than of a render.
import { parseParametersFromUrl } from './url-params'

/** Which emailed link produced this arrival. `unknown` = one, but it didn't say which. */
export type LoginLink = 'magic_link' | 'signup' | 'recovery' | 'invite' | 'unknown'

export interface LoginArrival {
  /** True when this load is the return leg of a sign-in attempt, however it ended. */
  redirect: boolean
  /** The emailed link behind it, or null — Google, or an ordinary visit. */
  link: LoginLink | null
  /** How the provider refused it: 'otp_expired', 'access_denied'. Null when it didn't. */
  errorCode: string | null
}

/** GoTrue's `type` values, in the words this app reports them by. */
const LINK_TYPES: Record<string, LoginLink> = {
  magiclink: 'magic_link',
  signup: 'signup',
  recovery: 'recovery',
  invite: 'invite',
}

/**
 * Refusals that only ever belong to an emailed one-time link.
 *
 * The error redirect carries no `type`, so this is the only thing that says a
 * *link* was tapped rather than an OAuth prompt cancelled — and a tapped link
 * that failed is the whole reason to look. It cannot say which kind of link,
 * hence 'unknown' rather than a guess at 'magic_link'.
 */
const LINK_ERRORS = new Set(['otp_expired', 'otp_disabled'])

export function readLoginArrival(href: string = window.location.href): LoginArrival {
  const params = parseParametersFromUrl(href)
  const errorCode = params.error_code ?? params.error ?? null
  const type = params.type
  const link = type
    ? (LINK_TYPES[type] ?? 'unknown')
    : errorCode && LINK_ERRORS.has(errorCode)
      ? 'unknown'
      : null
  return {
    // `code` is the PKCE flow's half of this. Nothing sets `flowType: 'pkce'`
    // today, but a redirect that arrives in that shape is still a redirect, and
    // a gate that called it an ordinary visit would offer the buttons again.
    redirect: Boolean(params.access_token || params.refresh_token || params.code || errorCode),
    link,
    errorCode,
  }
}
