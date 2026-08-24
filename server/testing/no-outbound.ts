// A test run does not touch the internet.
//
// Two rules, and this enforces the boundary between them: the database, Auth
// and Storage are the real thing in containers, and the *third parties* the
// app fetches from are answered by a local fixture server. Neither is allowed
// to quietly become a real request — a suite that reaches Wikipedia or
// PostHog for real is slow, flaky, offline-hostile, and no longer describes
// what it claims to describe.
//
// The check is a wrapper around `fetch` rather than a replacement for it:
// anything on loopback goes through to the real implementation untouched
// (supabase-js and the API client both live there). Only a non-local host is
// refused — and recorded, because several services treat a failed fetch as
// "nothing found" and would otherwise swallow the evidence.
import http from 'node:http'
import https from 'node:https'
import { isLocalHost } from './stack-config.js'

const violations: string[] = []

function targetOf(input: unknown): URL | null {
  try {
    if (typeof input === 'string') return new URL(input, 'http://127.0.0.1')
    if (input instanceof URL) return input
    if (typeof input === 'object' && input && 'url' in input)
      return new URL(String((input as { url: string }).url), 'http://127.0.0.1')
  } catch {
    return null
  }
  return null
}

/**
 * Refuses outbound `fetch` in this process. Returns the restore function.
 *
 * `label` names the process in the failure, because the API runs in the
 * globalSetup process and a web test would otherwise be told off for a
 * request it did not make.
 */
export function blockOutboundFetch(label: string): () => void {
  const target = globalThis as { fetch: typeof fetch }
  const real = target.fetch.bind(globalThis)
  const guarded = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = targetOf(input)
    if (url && !isLocalHost(url.hostname)) {
      const attempt = `${label}: ${url.origin}${url.pathname}`
      violations.push(attempt)
      return Promise.reject(
        new Error(
          `a test tried to reach ${url.host}. Third parties are answered by the local ` +
            `fixture server — point the service at it (see server/testing/external-web.ts ` +
            `and outside-world.ts) instead of letting the request out.`
        )
      )
    }
    return real(input, init)
  }) as typeof fetch
  target.fetch = guarded
  return () => {
    target.fetch = real
  }
}

/**
 * Same, for jsdom's XMLHttpRequest.
 *
 * posthog-js sends over XHR where it can, so guarding only `fetch` would let
 * the one third party the browser half talks to slip out.
 */
export function blockOutboundXhr(label: string): () => void {
  const proto = XMLHttpRequest.prototype
  const real = proto.open
  proto.open = function open(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ) {
    const target = targetOf(url)
    if (target && !isLocalHost(target.hostname)) {
      violations.push(`${label}: ${target.origin}${target.pathname}`)
      throw new Error(`a test tried to reach ${target.host} over XMLHttpRequest.`)
    }
    return (real as (...args: unknown[]) => void).call(this, method, url, ...rest)
  } as typeof proto.open
  return () => {
    proto.open = real
  }
}

/**
 * Same, for `node:http` / `node:https`.
 *
 * `fetch` is not the only way out: web-push talks to a device's push service
 * over `https.request`, and any library reaching for the internet directly
 * would slip past a fetch-only guard. Requests over a unix socket (a docker
 * client, say) name no host and are left alone.
 */
export function blockOutboundNodeHttp(label: string): () => void {
  const restores: (() => void)[] = []
  for (const mod of [http, https]) {
    const real = mod.request
    const guarded = ((...args: Parameters<typeof http.request>) => {
      const [first] = args
      const options = typeof first === 'object' && !(first instanceof URL) ? first : undefined
      const hostname = options
        ? ((options.hostname ?? options.host) as string | undefined)
        : targetOf(first)?.hostname
      if (hostname && !isLocalHost(hostname.replace(/:\d+$/, ''))) {
        violations.push(`${label}: ${hostname}`)
        throw new Error(
          `a test tried to reach ${hostname} over ${mod === https ? 'https' : 'http'}.`
        )
      }
      return (real as (...a: unknown[]) => ReturnType<typeof http.request>)(...args)
    }) as typeof http.request
    mod.request = guarded
    restores.push(() => {
      mod.request = real
    })
  }
  return () => restores.forEach((restore) => restore())
}

/** Where the API's own report is served, for the suite that runs elsewhere. */
export const OUTBOUND_REPORT = '/__outbound__'

/** Everything refused since the last call, and clears the list. */
export function takeOutboundAttempts(): string[] {
  return violations.splice(0, violations.length)
}

/** Fails with what was attempted, if anything was. */
export function assertNoOutboundAttempts(attempts = takeOutboundAttempts()): void {
  if (!attempts.length) return
  throw new Error(
    `a test reached for the internet:\n  ${attempts.join('\n  ')}\n` +
      `Answer it from the local fixture server instead.`
  )
}
