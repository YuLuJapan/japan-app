import { beforeEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'
import { __resetRatesCache } from '../src/services/rates.js'
import { __resetTranslateCache } from '../src/services/translate.js'
import { useExternalWeb } from '../testing/external-web.js'
import { asOwner as auth } from './auth.js'

const app = createApp()
// Product pages are served over HTTP by a real server here, so the parser gets
// a real streamed body, real content-type headers and real redirects. The
// server lives on 127.0.0.1, which services/producturl.ts refuses to fetch —
// useExternalWeb allows that one host:port and nothing else, so the guard
// cases at the bottom of this file still fail the way they must.
const web = useExternalWeb()

/** The hostname the fixture server answers on, as the shop-name fallback sees it. */
const FIXTURE_SHOP = '127'

const ratesPayload = {
  result: 'success',
  time_last_update_utc: 'Sat, 01 Aug 2026 00:00:00 +0000',
  rates: { USD: 0.0067, ILS: 0.025 },
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

const preview = (url: string) =>
  auth(request(app).get(`/api/product-preview?url=${encodeURIComponent(url)}`))

beforeEach(() => {
  __resetRatesCache()
  // both caches are module-level: without this, one test's "couldn't translate"
  // answers the next test's lookup of the same string
  __resetTranslateCache()
  // Only reached for a price that isn't already in yen.
  web.rates('JPY', ratesPayload)
})

describe('GET /api/product-preview', () => {
  it('reads the name, photo, shop and yen price out of a product page', async () => {
    const url = web.page('/jp/en/products/E123', productHtml)

    const res = await preview(url)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      name: 'HEATTECH Crew Neck T-Shirt & Leggings', // entity decoded, "| UNIQLO…" trimmed
      image_url: web.urlFor('/img/heattech.jpg'), // relative → absolute
      shop: 'UNIQLO',
      price_yen: 1500,
      price_note: null,
    })
  })

  it('falls back to <title> and the hostname when there are no OG tags', async () => {
    const url = web.page(
      '/p/1',
      '<html><head><title>Fancy Kettle – Example Shop</title></head></html>'
    )

    const res = await preview(url)
    // No og:site_name, so the shop is read off the hostname — which for the
    // fixture server is 127.0.0.1.
    expect(res.body).toMatchObject({ name: 'Fancy Kettle', shop: FIXTURE_SHOP, image_url: null })
  })

  it('picks the price out of schema.org JSON-LD', async () => {
    const url = web.page(
      '/p/2',
      `<html><head><script type="application/ld+json">
        {"@type":"Product","name":"Knife","offers":{"@type":"Offer","price":"15800","priceCurrency":"JPY"}}
      </script></head></html>`
    )

    const res = await preview(url)
    expect(res.body.price_yen).toBe(15800)
  })

  it('converts a dollar price into yen using todays rate', async () => {
    const url = web.page(
      '/p/3',
      `<html><head><meta property="og:price:amount" content="67">
             <meta property="og:price:currency" content="USD"></head></html>`
    )

    const res = await preview(url)
    expect(res.body.price_yen).toBe(10000) // 67 USD ÷ 0.0067 USD-per-yen
  })

  it('explains a price it cannot convert instead of guessing', async () => {
    const url = web.page(
      '/p/4',
      `<html><head><meta property="product:price:amount" content="49">
             <meta property="product:price:currency" content="EUR"></head></html>`
    )

    const res = await preview(url)
    expect(res.body.price_yen).toBeNull()
    expect(res.body.price_note).toMatch(/49 EUR/)
  })

  it('follows a redirect to the real product page', async () => {
    const destination = web.page('/jp/en/products/E123', productHtml)
    const short = web.redirect('/x', destination)

    const res = await preview(short)
    expect(res.body).toMatchObject({
      shop: 'UNIQLO',
      url: destination, // reports where it landed
    })
  })

  it('returns just the link when the shop cannot be read', async () => {
    // Nothing registered at this path, so the server really answers 404.
    const url = web.urlFor('/gone')

    const res = await preview(url)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      url,
      name: null,
      image_url: null,
      price_yen: null,
    })
  })

  it('reads a real streamed body, and stops after the capped number of bytes', async () => {
    // Two megabytes against a 512KB cap. The metadata is in the head, so the
    // read has to stop early *and* still have everything it needs — if the cap
    // were not honoured this would simply take much longer and still pass,
    // which is why the page is far larger than the limit rather than just over.
    const filler = `<p>${'x'.repeat(1024)}</p>`.repeat(2048)
    const url = web.page('/streamed', `${productHtml}${filler}`)

    const res = await preview(url)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ shop: 'UNIQLO', price_yen: 1500 })
  })

  it('ignores a response that is not a web page', async () => {
    const url = web.page('/file.pdf', '%PDF-1.4', { contentType: 'application/pdf' })

    const res = await preview(url)
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
    // No /jp/en/ page registered and no translation route, so neither escape
    // from Japanese is available and the title handling is on its own.
    const url = web.page('/jp/ja/products/E1', japaneseHtml)

    const res = await preview(url)
    expect(res.body.name).not.toBe('ユニクロ公式')
    expect(res.body.name).toContain('クルーネックT')
  })

  it('prefers the shop own English page over translating', async () => {
    const url = web.page('/jp/ja/products/E1', japaneseHtml)
    web.page(
      '/jp/en/products/E1',
      `<html><head><meta property="og:title" content="Crew Neck T-Shirt | UNIQLO">
             <meta property="og:site_name" content="UNIQLO"></head></html>`
    )

    const res = await preview(url)
    expect(res.body.name).toBe('Crew Neck T-Shirt')
    expect(res.body.name_ja).toContain('クルーネックT') // kept for showing staff
  })

  it('translates when the shop has no English page', async () => {
    // /jp/en/products/E2 is deliberately absent: the 404 is what sends this
    // down the translation path.
    const url = web.page('/jp/ja/products/E2', japaneseHtml)
    web.translate({
      responseStatus: 200,
      responseData: { translatedText: 'Crew Neck T-Shirt (Short Sleeve)' },
    })

    const res = await preview(url)
    expect(res.body.name).toBe('Crew Neck T-Shirt (Short Sleeve)')
    expect(res.body.name_ja).toContain('クルーネックT')
  })

  it('keeps the Japanese name when translation is unavailable', async () => {
    const url = web.page('/p/9', japaneseHtml)

    const res = await preview(url)
    expect(res.body.name).toContain('クルーネックT')
    expect(res.body.name_ja).toBeNull() // nothing was translated, so nothing to keep twice
  })

  it('reads a price the page only shows as yen text', async () => {
    const url = web.page('/jp/ja/products/E3', japaneseHtml)

    const res = await preview(url)
    expect(res.body.price_yen).toBe(1500)
  })

  it('reads a price out of an embedded JSON blob', async () => {
    const url = web.page(
      '/p/10',
      `<html><head></head><body><script>
        window.__DATA__ = {"product":{"name":"x","prices":{"base":{"value":1500},"promo":{"value":1500}}}}
      </script></body></html>`
    )

    const res = await preview(url)
    expect(res.body.price_yen).toBe(1500)
  })

  it('ignores a free-shipping threshold masquerading as the price', async () => {
    const url = web.page(
      '/p/11',
      `<html><head></head><body><p>¥5,000以上で送料無料</p><p>¥1,500</p></body></html>`
    )

    const res = await preview(url)
    expect(res.body.price_yen).toBe(1500)
  })
})

describe('GET /api/translate', () => {
  it('translates Japanese to English', async () => {
    web.translate({ responseStatus: 200, responseData: { translatedText: 'Hair mask' } })

    const res = await auth(request(app).get('/api/translate?q=ヘアマスク'))
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ is_japanese: true, translated: 'Hair mask' })
  })

  it('leaves English text alone without calling out', async () => {
    const res = await auth(request(app).get('/api/translate?q=Hair%20mask'))
    expect(res.body).toMatchObject({ is_japanese: false, translated: null })
    // Nothing reached the translator — which the request log can say and a
    // spy on global fetch could not, since the datastore uses it too.
    expect(web.requests).toEqual([])
  })

  it('returns null rather than failing when the translator is down', async () => {
    web.translate(() => ({ hangUp: true }))

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
    ['http://localhost:3001/api/trips/trip-1', 'loopback name'],
    ['http://127.0.0.1/', 'loopback address'],
    ['http://169.254.169.254/latest/meta-data/', 'cloud metadata'],
    ['http://192.168.1.1/', 'private network'],
    ['http://10.0.0.5/admin', 'private network'],
  ])('refuses to fetch %s (%s)', async (url) => {
    const res = await preview(url)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
    expect(web.requests).toEqual([])
  })

  it('refuses a hostname that resolves into our own network', async () => {
    // localtest.me is a public name whose A record is 127.0.0.1 — the literal
    // check can't catch it, so the DNS check has to.
    const res = await preview('http://localtest.me/admin')
    expect(res.status).toBe(400)
    expect(web.requests).toEqual([])
  })

  it('refuses a non-http scheme', async () => {
    const res = await preview('file:///etc/passwd')
    expect(res.status).toBe(400)
  })

  it('400 for a url that is not a url at all', async () => {
    const res = await auth(request(app).get('/api/product-preview?url=not%20a%20url'))
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION')
  })

  it('stops a redirect that points back into our own network', async () => {
    const url = web.redirect('/p/5', 'http://169.254.169.254/latest/meta-data/')

    const res = await preview(url)
    expect(res.status).toBe(200)
    expect(res.body.name).toBeNull() // gave up rather than following it
  })

  it('401 without a bearer token', async () => {
    const res = await request(app).get(`/api/product-preview?url=${web.urlFor('/p/1')}`)
    expect(res.status).toBe(401)
  })
})
