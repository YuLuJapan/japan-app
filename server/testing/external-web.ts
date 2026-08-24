// The outside world, served locally.
//
// `useExternalWeb()` starts a real HTTP server for the file that calls it and
// points the services' endpoints at it for the duration. Nothing is stubbed:
// services/rates.ts still builds a URL and fetches it, services/images.ts
// still sends its User-Agent and reads a real JSON body, and a "the provider
// is down" case is a real 500 off a real socket.
//
// Routes are cleared between tests, so a case that never registers one gets a
// 404 rather than the previous test's answer.
import { afterAll, beforeAll, beforeEach } from 'vitest'
import {
  startFixtureServer,
  type FixtureHandler,
  type FixtureRequest,
  type FixtureServer,
} from './fixture-server.js'

/** A payload to answer with, or a handler for cases that need the request. */
type Reply = unknown | FixtureHandler

const asHandler = (reply: Reply): FixtureHandler =>
  typeof reply === 'function' ? (reply as FixtureHandler) : () => ({ json: reply })

export interface ExternalWeb {
  /** Answer Wikipedia's image search. */
  wikipedia(reply: Reply): void
  /** Answer Wikimedia Commons' image search. */
  commons(reply: Reply): void
  /** Both photo sources finding nothing — what most tests want from the lookup. */
  noPhotos(): void
  /** Answer the exchange-rate provider for one base currency. */
  rates(base: string, reply: Reply): void
  /** Answer the translation provider. */
  translate(reply: Reply): void
  /** Answer the geocoder. */
  geocode(reply: Reply): void
  /** Serve a page (a shop's product page, say) and return its absolute URL. */
  page(path: string, html: string, opts?: { contentType?: string }): string
  /** Serve something that is not a page — a PDF, an image — at `path`. */
  serve(path: string, handler: FixtureHandler): string
  /** A link that redirects, the way a shop's short link does. */
  redirect(path: string, location: string, status?: number): string
  /** An absolute URL on this server for a path nothing has registered. */
  urlFor(path: string): string
  /** Everything the services asked for, in order. */
  readonly requests: FixtureRequest[]
}

const EMPTY_SEARCH = { query: { pages: {} } }

/**
 * Call once at the top level of a test file. Registers its own lifecycle
 * hooks, so a test body only ever says what the outside world should answer.
 */
export function useExternalWeb(): ExternalWeb {
  let server: FixtureServer

  beforeAll(async () => {
    server = await startFixtureServer()
    process.env.WIKIPEDIA_API_URL = server.urlFor('/wikipedia')
    process.env.COMMONS_API_URL = server.urlFor('/commons')
    process.env.EXCHANGE_RATES_URL = server.urlFor('/rates')
    process.env.TRANSLATE_API_URL = server.urlFor('/translate')
    process.env.GEOCODE_API_URL = server.urlFor('/geocode')
    // services/producturl.ts refuses to fetch loopback addresses, which is
    // correct and which is also exactly where this server lives. The allowance
    // names this one host:port and nothing else, so the guard's own cases
    // (localhost, 127.0.0.1:80, the metadata service) still fail as they must.
    process.env.PRODUCT_PREVIEW_ALLOWED_HOSTS = new URL(server.url).host
  })

  beforeEach(() => server.reset())

  afterAll(async () => {
    for (const key of [
      'WIKIPEDIA_API_URL',
      'COMMONS_API_URL',
      'EXCHANGE_RATES_URL',
      'TRANSLATE_API_URL',
      'GEOCODE_API_URL',
      'PRODUCT_PREVIEW_ALLOWED_HOSTS',
    ]) {
      delete process.env[key]
    }
    await server.close()
  })

  return {
    wikipedia: (reply) => void server.on('/wikipedia', asHandler(reply)),
    commons: (reply) => void server.on('/commons', asHandler(reply)),
    noPhotos: () => {
      server.json('/wikipedia', EMPTY_SEARCH)
      server.json('/commons', EMPTY_SEARCH)
    },
    rates: (base, reply) => void server.on(`/rates/${base}`, asHandler(reply)),
    translate: (reply) => void server.on('/translate', asHandler(reply)),
    geocode: (reply) => void server.on('/geocode', asHandler(reply)),
    page: (path, html, opts) => server.html(path, html, opts),
    serve: (path, handler) => server.on(path, handler),
    redirect: (path, location, status) => server.redirect(path, location, status),
    urlFor: (path) => server.urlFor(path),
    get requests() {
      return server.requests
    },
  }
}
