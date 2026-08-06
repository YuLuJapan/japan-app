import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { setDataStore } from '../src/lib/datastore.js'
import { createMemoryStore } from '../src/lib/datastore.memory.js'
import { __resetRatesCache } from '../src/services/rates.js'
import { __resetTranslateCache } from '../src/services/translate.js'
import { TEST_CODE, fixture } from './fixture.js'

process.env.TRIP_ACCESS_CODE = TEST_CODE
const app = createApp()
const auth = (r: request.Test) => r.set('Authorization', `Bearer ${TEST_CODE}`)

/** Stub a page response; `pages` maps URL → html (or a redirect/failure marker). */
function mockPages(pages: Record<string, { html?: string; redirectTo?: string; type?: string }>) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const url = String(input)
      // the rates provider is called only for non-JPY prices
      if (url.includes('open.er-api.com'))
        return {
          ok: true,
          json: async () => ({
            result: 'success',
            time_last_update_utc: 'Sat, 01 Aug 2026 00:00:00 +0000',
            rates: { USD: 0.0067, ILS: 0.025 },
          }),
        } as Response
      const page = pages[url]
      if (!page) return { ok: false, status: 404, headers: new Headers() } as Response
      if (page.redirectTo)
        return {
          ok: false,
          status: 302,
          headers: new Headers({ location: page.redirectTo }),
        } as Response
      return {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': page.type ?? 'text/html; charset=utf-8' }),
        body: null,
        text: async () => page.html ?? '',
      } as unknown as Response
    })
  )
}

const productHtml = `
<!doctype html><html><head>
<title>HEATTECH Crew Neck T-Shirt | UNIQLO Online Store</title>
<meta property="og:title" content="HEATTECH Crew Neck T-Shirt &amp; Leggings">
<meta property="og:image" content="/img/heattech.jpg">
<meta property="og:site_name" content="UNIQLO">
<meta property="product:price:amount" content="1500">
<meta property="product:price:currency" content="JPY">
</head><body>…</body></html>`

beforeEach(() => {
  setDataStore(createMemoryStore(fixture()))
  __resetRatesCache()
  // both caches are module-level: without this, one test's "couldn't translate"
  // answers the next test's lookup of the same string
  __resetTranslateCache()
})
afterEach(() => vi.unstubAllGlobals())

describe('GET /api/product-preview', () => {
  it('reads the name, photo, shop and yen price out of a product page', async () => {
    mockPages({ 'https://www.uniqlo.com/jp/en/products/E123': { html: productHtml } })

    const res = await auth(
      request(app).get('/api/product-preview?url=https://www.uniqlo.com/jp/en/products/E123')
    )
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      name: 'HEATTECH Crew Neck T-Shirt & Leggings', // entity decoded, "| UNIQLO…" trimmed
      image_url: 'https://www.uniqlo.com/img/heattech.jpg', // relative → absolute
      shop: 'UNIQLO',
      price_yen: 1500,
      price_note: null,
    })
  })

  it('falls back to <title> and the hostname when there are no OG tags', async () => {
    mockPages({
      'https://shop.example.jp/p/1': {
        html: '<html><head><title>Fancy Kettle – Example Shop</title></head></html>',
      },
    })

    const res = await auth(request(app).get('/api/product-preview?url=https://shop.example.jp/p/1'))
    expect(res.body).toMatchObject({ name: 'Fancy Kettle', shop: 'Shop', image_url: null })
  })

  it('picks the price out of schema.org JSON-LD', async () => {
    mockPages({
      'https://shop.example.jp/p/2': {
        html: `<html><head><script type="application/ld+json">
          {"@type":"Product","name":"Knife","offers":{"@type":"Offer","price":"15800","priceCurrency":"JPY"}}
        </script></head></html>`,
      },
    })

    const res = await auth(request(app).get('/api/product-preview?url=https://shop.example.jp/p/2'))
    expect(res.body.price_yen).toBe(15800)
  })

  it('converts a dollar price into yen using todays rate', async () => {
    mockPages({
      'https://shop.example.com/p/3': {
        html: `<html><head><meta property="og:price:amount" content="67">
               <meta property="og:price:currency" content="USD"></head></html>`,
      },
    })

    const res = await auth(request(app).get('/api/product-preview?url=https://shop.example.com/p/3'))
    expect(res.body.price_yen).toBe(10000) // 67 USD ÷ 0.0067 USD-per-yen
  })

  it('explains a price it cannot convert instead of guessing', async () => {
    mockPages({
      'https://shop.example.de/p/4': {
        html: `<html><head><meta property="product:price:amount" content="49">
               <meta property="product:price:currency" content="EUR"></head></html>`,
      },
    })

    const res = await auth(request(app).get('/api/product-preview?url=https://shop.example.de/p/4'))
    expect(res.body.price_yen).toBeNull()
    expect(res.body.price_note).toMatch(/49 EUR/)
  })

  it('follows a redirect to the real product page', async () => {
    mockPages({
      'https://short.example/x': { redirectTo: 'https://www.uniqlo.com/jp/en/products/E123' },
      'https://www.uniqlo.com/jp/en/products/E123': { html: productHtml },
    })

    const res = await auth(request(app).get('/api/product-preview?url=https://short.example/x'))
    expect(res.body).toMatchObject({
      shop: 'UNIQLO',
      url: 'https://www.uniqlo.com/jp/en/products/E123', // reports where it landed
    })
  })

  it('returns just the link when the shop cannot be read', async () => {
    mockPages({}) // every fetch 404s

    const res = await auth(request(app).get('/api/product-preview?url=https://shop.example.jp/gone'))
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      url: 'https://shop.example.jp/gone',
      name: null,
      image_url: null,
      price_yen: null,
    })
  })

  it('reads a real streamed body, and stops after the capped number of bytes', async () => {
    // Real responses arrive as a stream; the mocks above shortcut to text().
    const head = productHtml
    const filler = `<p>${'x'.repeat(1024)}</p>`
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        let sent = 0
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'text/html' }),
          body: {
            getReader: () => ({
              read: async () => {
                if (sent === 0) {
                  sent++
                  return { done: false, value: new TextEncoder().encode(head) }
                }
                // keep offering data forever — the cap has to end this
                sent++
                if (sent > 2000) throw new Error('read past the byte cap')
                return { done: false, value: new TextEncoder().encode(filler) }
              },
              cancel: async () => undefined,
            }),
          },
        } as unknown as Response
      })
    )

    const res = await auth(
      request(app).get('/api/product-preview?url=https://shop.example.jp/streamed')
    )
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ shop: 'UNIQLO', price_yen: 1500 })
  })

  it('ignores a response that is not a web page', async () => {
    mockPages({
      'https://shop.example.jp/file.pdf': { html: '%PDF-1.4', type: 'application/pdf' },
    })

    const res = await auth(
      request(app).get('/api/product-preview?url=https://shop.example.jp/file.pdf')
    )
    expect(res.body.name).toBeNull()
  })
})

describe('GET /api/product-preview on a Japanese shop page', () => {
  // The real failure: uniqlo.com/jp/ja titles its pages "brand | product", so
  // taking the first segment imported an item called "ユニクロ公式".
  const japaneseHtml = `<html><head>
    <title>ユニクロ公式 | クルーネックT（半袖）| 商品詳細</title>
    <meta property="og:title" content="ユニクロ公式 | クルーネックT（半袖）">
    <meta property="og:site_name" content="ユニクロ公式">
    </head><body><span>¥1,500</span></body></html>`

  it('keeps the product half of the title, not the brand half', async () => {
    mockPages({ 'https://www.uniqlo.com/jp/ja/products/E1': { html: japaneseHtml } })
    // no English page, no translation service
    const res = await auth(
      request(app).get('/api/product-preview?url=https://www.uniqlo.com/jp/ja/products/E1')
    )
    expect(res.body.name).not.toBe('ユニクロ公式')
    expect(res.body.name).toContain('クルーネックT')
  })

  it('prefers the shop own English page over translating', async () => {
    mockPages({
      'https://www.uniqlo.com/jp/ja/products/E1': { html: japaneseHtml },
      'https://www.uniqlo.com/jp/en/products/E1': {
        html: `<html><head><meta property="og:title" content="Crew Neck T-Shirt | UNIQLO">
               <meta property="og:site_name" content="UNIQLO"></head></html>`,
      },
    })

    const res = await auth(
      request(app).get('/api/product-preview?url=https://www.uniqlo.com/jp/ja/products/E1')
    )
    expect(res.body.name).toBe('Crew Neck T-Shirt')
    expect(res.body.name_ja).toContain('クルーネックT') // kept for showing staff
  })

  it('translates when the shop has no English page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const url = String(input)
        if (url.includes('mymemory'))
          return {
            ok: true,
            json: async () => ({
              responseStatus: 200,
              responseData: { translatedText: 'Crew Neck T-Shirt (Short Sleeve)' },
            }),
          } as Response
        if (url.includes('/jp/ja/'))
          return {
            ok: true,
            status: 200,
            headers: new Headers({ 'content-type': 'text/html' }),
            body: null,
            text: async () => japaneseHtml,
          } as unknown as Response
        return { ok: false, status: 404, headers: new Headers() } as Response // no /en/ page
      })
    )

    const res = await auth(
      request(app).get('/api/product-preview?url=https://www.uniqlo.com/jp/ja/products/E2')
    )
    expect(res.body.name).toBe('Crew Neck T-Shirt (Short Sleeve)')
    expect(res.body.name_ja).toContain('クルーネックT')
  })

  it('keeps the Japanese name when translation is unavailable', async () => {
    mockPages({ 'https://shop.example.jp/p/9': { html: japaneseHtml } })

    const res = await auth(request(app).get('/api/product-preview?url=https://shop.example.jp/p/9'))
    expect(res.body.name).toContain('クルーネックT')
    expect(res.body.name_ja).toBeNull() // nothing was translated, so nothing to keep twice
  })

  it('reads a price the page only shows as yen text', async () => {
    mockPages({ 'https://www.uniqlo.com/jp/ja/products/E3': { html: japaneseHtml } })

    const res = await auth(
      request(app).get('/api/product-preview?url=https://www.uniqlo.com/jp/ja/products/E3')
    )
    expect(res.body.price_yen).toBe(1500)
  })

  it('reads a price out of an embedded JSON blob', async () => {
    mockPages({
      'https://shop.example.jp/p/10': {
        html: `<html><head></head><body><script>
          window.__DATA__ = {"product":{"name":"x","prices":{"base":{"value":1500},"promo":{"value":1500}}}}
        </script></body></html>`,
      },
    })

    const res = await auth(request(app).get('/api/product-preview?url=https://shop.example.jp/p/10'))
    expect(res.body.price_yen).toBe(1500)
  })

  it('ignores a free-shipping threshold masquerading as the price', async () => {
    mockPages({
      'https://shop.example.jp/p/11': {
        html: `<html><head></head><body><p>¥5,000以上で送料無料</p><p>¥1,500</p></body></html>`,
      },
    })

    const res = await auth(request(app).get('/api/product-preview?url=https://shop.example.jp/p/11'))
    expect(res.body.price_yen).toBe(1500)
  })
})

describe('GET /api/translate', () => {
  it('translates Japanese to English', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          responseStatus: 200,
          responseData: { translatedText: 'Hair mask' },
        }),
      }))
    )

    const res = await auth(request(app).get('/api/translate?q=ヘアマスク'))
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ is_japanese: true, translated: 'Hair mask' })
  })

  it('leaves English text alone without calling out', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const res = await auth(request(app).get('/api/translate?q=Hair%20mask'))
    expect(res.body).toMatchObject({ is_japanese: false, translated: null })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('returns null rather than failing when the translator is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline')
      })
    )

    const res = await auth(request(app).get('/api/translate?q=ヘアマスク'))
    expect(res.status).toBe(200)
    expect(res.body.translated).toBeNull()
  })

  it('400 without a query', async () => {
    const res = await auth(request(app).get('/api/translate?q='))
    expect(res.status).toBe(400)
  })
})

describe('GET /api/product-preview guards', () => {
  it.each([
    ['http://localhost:3001/api/trip', 'loopback name'],
    ['http://127.0.0.1/', 'loopback address'],
    ['http://169.254.169.254/latest/meta-data/', 'cloud metadata'],
    ['http://192.168.1.1/', 'private network'],
    ['http://10.0.0.5/admin', 'private network'],
  ])('refuses to fetch %s (%s)', async (url) => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const res = await auth(
      request(app).get(`/api/product-preview?url=${encodeURIComponent(url)}`)
    )
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('refuses a hostname that resolves into our own network', async () => {
    // localtest.me is a public name whose A record is 127.0.0.1 — the literal
    // check can't catch it, so the DNS check has to.
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const res = await auth(
      request(app).get(`/api/product-preview?url=${encodeURIComponent('http://localtest.me/admin')}`)
    )
    expect(res.status).toBe(400)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('refuses a non-http scheme', async () => {
    const res = await auth(
      request(app).get(`/api/product-preview?url=${encodeURIComponent('file:///etc/passwd')}`)
    )
    expect(res.status).toBe(400)
  })

  it('400 for a url that is not a url at all', async () => {
    const res = await auth(request(app).get('/api/product-preview?url=not%20a%20url'))
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
  })

  it('stops a redirect that points back into our own network', async () => {
    mockPages({
      'https://shop.example.jp/p/5': { redirectTo: 'http://169.254.169.254/latest/meta-data/' },
    })

    const res = await auth(request(app).get('/api/product-preview?url=https://shop.example.jp/p/5'))
    expect(res.status).toBe(200)
    expect(res.body.name).toBeNull() // gave up rather than following it
  })

  it('401 without a bearer token', async () => {
    const res = await request(app).get('/api/product-preview?url=https://shop.example.jp/p/1')
    expect(res.status).toBe(401)
  })
})
