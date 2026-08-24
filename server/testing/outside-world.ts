// The internet, as the API sees it during the web suite.
//
// Server tests start their own fixture server per file and steer it case by
// case (`useExternalWeb`). The web suite cannot: its API runs in the
// globalSetup process, so a worker setting env vars would be talking to
// itself. What it needs is weaker anyway — the components under test are not
// about the provider, they are about what the screen does with an answer — so
// this serves one fixed set of answers for the whole run.
//
// Fixed, and exported: a test asserting "€2.60" is reading the same table the
// server answered from.
import { OUTBOUND_REPORT, takeOutboundAttempts } from './no-outbound.js'
import { startFixtureServer, type FixtureServer } from './fixture-server.js'

/**
 * One unit of the base currency, in each quoted currency.
 *
 * THB deliberately has no JPY and JPY no THB: "the provider has no rate for
 * this one" is a real state the calculator has to explain, and it needs a
 * gap to explain.
 */
export const RATES: Record<string, Record<string, number>> = {
  JPY: { USD: 0.0067, ILS: 0.025, EUR: 0.0058 },
  THB: { USD: 0.028, ILS: 0.1, EUR: 0.026 },
  EUR: { USD: 1.16, ILS: 4.3 },
  USD: { ILS: 3.7, EUR: 0.86 },
}

/** The date the quotes carry, so a screen showing it has something stable. */
export const RATES_DATE = 'Sat, 01 Aug 2026 00:00:00 +0000'

/** Neither photo source finds anything: an item saved without one keeps none. */
const NOTHING_FOUND = { query: { pages: {} } }

export interface OutsideWorld {
  url: string
  close(): Promise<void>
}

/** Starts the server and returns the env that points the services at it. */
export async function startOutsideWorld(): Promise<OutsideWorld & { env: Record<string, string> }> {
  const server: FixtureServer = await startFixtureServer()

  // Registered as defaults rather than once, so a worker that steered this
  // server for one case gets the baseline back on the next reset.
  server.setDefaults((world) => {
    for (const [base, rates] of Object.entries(RATES)) {
      world.json(`/rates/${base}`, {
        result: 'success',
        time_last_update_utc: RATES_DATE,
        rates,
      })
    }
    world.json('/wikipedia', NOTHING_FOUND)
    world.json('/commons', NOTHING_FOUND)
    // No translation available, which is the state that keeps a Japanese name
    // as it was rather than inventing an English one.
    world.json('/translate', { responseStatus: 403, responseData: { translatedText: '' } })
    world.json('/geocode', [])
    // Not a fixture: what the API tried to send to the real internet, for the
    // web suite to read. Registered as a default so a reset keeps it.
    world.on(OUTBOUND_REPORT, () => ({ json: takeOutboundAttempts() }))
  })

  return {
    url: server.url,
    close: () => server.close(),
    env: {
      EXCHANGE_RATES_URL: server.urlFor('/rates'),
      WIKIPEDIA_API_URL: server.urlFor('/wikipedia'),
      COMMONS_API_URL: server.urlFor('/commons'),
      TRANSLATE_API_URL: server.urlFor('/translate'),
      GEOCODE_API_URL: server.urlFor('/geocode'),
      // Product pages are served from here too, and services/producturl.ts
      // refuses loopback — this one host:port is allowed, and nothing else.
      PRODUCT_PREVIEW_ALLOWED_HOSTS: new URL(server.url).host,
    },
  }
}
