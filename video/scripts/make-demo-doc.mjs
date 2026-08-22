// A fictional booking, so the Documents tab has something that genuinely opens
// in the video.
//
// Written as a PNG rather than a PDF: the preview renders an image inline with
// `<img>`, while a PDF goes to Chromium's built-in viewer, whose toolbar and
// zoom chrome fill a phone-sized frame and look nothing like a document.
//
// The seed's flight document is the travellers' actual Ethiopian Airlines
// e-ticket, reference and all. That belongs in their trip and nowhere near a
// video, so the capture rig points at this instead.
import { chromium } from 'playwright'
import { fileURLToPath } from 'node:url'

const OUT = fileURLToPath(new URL('../../public/placeholder-files/booking-demo42.png', import.meta.url))

const html = `<!doctype html><meta charset="utf-8">
<style>
  @import url('data:text/css,');
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", Roboto, sans-serif;
         color: #17150F; padding: 54px 58px; background: #fff; width: 820px; }
  .brand { display:flex; align-items:center; gap:12px; }
  .mark { width:34px; height:34px; border-radius:10px; background:#F1543F;
          display:flex; align-items:center; justify-content:center; }
  .ring { width:12px; height:12px; border-radius:50%; border:3px solid #FAF8F5; }
  h1 { font-size: 26px; margin: 30px 0 4px; letter-spacing:-0.02em; }
  .sub { color:#7A756B; font-size:13px; margin:0 0 30px; }
  .ref { border:1px solid #EFEAE2; border-radius:14px; padding:18px 20px; margin-bottom:26px;
         display:flex; justify-content:space-between; align-items:center; }
  .ref b { font-family: ui-monospace, Menlo, monospace; font-size:22px; letter-spacing:.12em; }
  .leg { border-top:1px solid #EFEAE2; padding:16px 0; display:flex; gap:18px; align-items:baseline; }
  .no { font-weight:700; color:#F1543F; min-width:74px; font-size:13px; }
  .route { font-weight:600; font-size:15px; }
  .time { color:#7A756B; font-size:12.5px; margin-top:3px; }
  h2 { font-size:12px; letter-spacing:.09em; text-transform:uppercase; color:#7A756B;
       margin:26px 0 2px; }
  footer { margin-top:38px; color:#9c968b; font-size:11px; border-top:1px solid #EFEAE2; padding-top:14px; }
</style>
<div class="brand"><div class="mark"><div class="ring"></div></div>
  <strong style="font-size:17px">Onward</strong></div>
<h1>Electronic ticket receipt</h1>
<p class="sub">Pacific Air · issued 12 August 2026</p>
<div class="ref"><span style="color:#7A756B;font-size:13px">Booking reference</span><b>DEMO42</b></div>
<h2>Outbound</h2>
<div class="leg"><span class="no">PA 101</span><div><div class="route">Tel Aviv (TLV) → Singapore (SIN)</div>
  <div class="time">Fri 18 Sep, 15:35 — 06:10 +1</div></div></div>
<div class="leg"><span class="no">PA 220</span><div><div class="route">Singapore (SIN) → Tokyo Narita (NRT)</div>
  <div class="time">Sat 19 Sep, 08:25 — 19:40</div></div></div>
<h2>Return</h2>
<div class="leg"><span class="no">PA 221</span><div><div class="route">Tokyo Narita (NRT) → Singapore (SIN)</div>
  <div class="time">Fri 16 Oct, 20:40 — 03:15 +1</div></div></div>
<div class="leg"><span class="no">PA 102</span><div><div class="route">Singapore (SIN) → Tel Aviv (TLV)</div>
  <div class="time">Sat 17 Oct, 06:05 — 14:35</div></div></div>
<footer>Sample document. Pacific Air, flight numbers and reference DEMO42 are fictional,
and exist so the product video has a document to open.</footer>`

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH })
const page = await browser.newPage({ viewport: { width: 820, height: 1160 }, deviceScaleFactor: 2 })
await page.setContent(html, { waitUntil: 'load' })
await page.screenshot({ path: OUT, fullPage: true })
await browser.close()
console.log(`wrote ${OUT}`)
