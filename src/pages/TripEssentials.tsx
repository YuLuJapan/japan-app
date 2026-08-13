import { useEffect, useState } from 'react'
import { CurrencyCalculator } from '../components/CurrencyCalculator'

// Curated static reference for the trip. Phrases are romaji (Latin script) +
// English meaning — a travel phrasebook, no Japanese characters in the UI.

const EMERGENCY = [
  { label: 'Police', value: '110' },
  { label: 'Fire / Ambulance', value: '119' },
  { label: 'Japan Visitor Hotline (24h, EN)', value: '050-3816-2787' },
]

// Trip tips, incl. the "tips we got" from the traveller groups. `meta` is the
// one-line summary shown collapsed; tapping a card expands it (accordion, one
// open at a time — matches the design prototype's essentials cards, which
// show no icon, just a bold title + muted meta line + chevron).
const SECTIONS: { title: string; meta: string; items: string[] }[] = [
  {
    title: 'Visit Japan Web (do before you fly)',
    meta: 'Register online before you fly',
    items: [
      'Register both travellers at vjw.digital.go.jp — fill in passport details plus the immigration and customs declarations online ahead of time.',
      'Do this a few days before departure, not at the airport. It only unlocks 6 hours before arrival, but registering the passport/personal info early means there’s just the short declaration left to finish then.',
      'One QR code now covers both immigration and customs — show it at the immigration counter, then again at the customs gate. Screenshot it or make sure you can log back in without a Japanese SIM.',
      'Each traveller needs their own entry (you can manage a companion under one account) — double check both QR codes are ready before landing.',
    ],
  },
  {
    title: 'Money',
    meta: 'Cash, ATMs, cards',
    items: [
      'Cash: hotels are prepaid, so you need less than you’d think — but keep some for small shops, shrines, markets and some restaurants.',
      'Withdraw at 7-Eleven ATMs — they accept foreign cards and are everywhere. Rough rate when the group travelled: ~¥53 ≈ ₪1 (moves — check before you go).',
      'No tipping — it can even cause confusion. Pay into the little tray at registers.',
      'Daily kit: cash + IC card + passport (for tax-free shopping).',
    ],
  },
  {
    title: 'Trains & tickets',
    meta: 'JR Pass, IC cards, seat rules',
    items: [
      'Skip the JR Pass — after the price hike it no longer pays off for most routes. Ours has a handful of long rides (Tokyo→Odawara, Kanazawa→Tsuruga→Kyoto, Shin-Osaka→Atami, Atami→Tokyo); buy those per-journey (run it through a JR fare calculator if unsure). Kyoto→Nara→Osaka is Kintetsu, not JR.',
      'Load a Suica / PASMO into Apple or Google Wallet — tap for every train, metro, bus and konbini. On iPhone no app is needed; top up with your card. You can add both our cards to one phone.',
      'For the few reserved long-distance trains, buy those seats separately (station machines, or SmartEX / the JR sites).',
      'Mountain buses (Takayama, Shirakawa-go, Kamikochi, Kanazawa — Nohi / Alpico) need advance seat reservations. Book early on their sites.',
      'The Hakone Free Pass (2–3 day loop) is a regional pass that does pay off.',
      'Avoid the crush around 7:30–9:00am and 5:30–7:00pm, especially with bags. Weekends are busier at parks and attractions.',
      'Stand left on escalators in Tokyo, right in Osaka. Trains stop around midnight — check the last train.',
    ],
  },
  {
    title: 'Taxis',
    meta: 'GO app, Apple Pay set up',
    items: [
      'Download the GO taxi app. Add a card to Apple Pay in advance — some found in-app card entry finicky, so set it up before you need it.',
    ],
  },
  {
    title: 'Luggage between cities',
    meta: 'Forward it, or roll it yourself',
    items: [
      'With many one-night stops, consider Takkyubin forwarding (Yamato “Black Cat”) — send big cases hotel-to-hotel and travel light on the alpine legs. Counters at airports (Narita basement) and konbini.',
      'Rolling them works too, but the group warned repeatedly: rush-hour trains and elevator-less stations are brutal with big cases. Forwarding a case ahead to Kyoto or the return-Tokyo hotel is worth it for the Tokyo→Hakone→Fuji→Alps stretch.',
    ],
  },
  {
    title: 'Weather (late Sept–mid Oct)',
    meta: 'Late Sept – mid Oct',
    items: [
      'A lovely window: warm-not-scorching, far drier than summer, thinner crowds. T-shirt days, cooler evenings — pack a light layer.',
      'Some rain is possible — bring a compact umbrella and it won’t cancel anything.',
      'Typhoon season is tailing off but not zero — watch forecasts for the coastal/southern legs and stay flexible.',
    ],
  },
  {
    title: 'Connectivity',
    meta: 'eSIM, Wi-Fi, offline maps',
    items: [
      'Get an eSIM before you fly (Airalo, Ubigi, Sakura Mobile…) and activate on landing.',
      'Google Maps is your transit brain — trains, platforms and exit numbers. Download offline maps per city.',
      'Free Wi-Fi at most stations, convenience stores and cafés.',
    ],
  },
  {
    title: 'Food notes',
    meta: 'Konbini, ramen, regional picks',
    items: [
      'Konbini (7-Eleven, Lawson, FamilyMart) are genuinely great for cheap, good meals and snacks — don’t skip them.',
      'Ramen: “Tokyo Engine Ramen” got a rave; look for local ticket-machine shops everywhere.',
      'Kyoto: HIRO (self-grill yakiniku), Musashi Sushi (good conveyor sushi).',
      'Osaka: a guided food tour is fun — one member recommended a young English-speaking local guide (some routes pass the red-light district).',
      'Regional: Hida beef in Takayama; seafood at Omicho (Kanazawa) & Kuromon (Osaka).',
      'Book restaurants at parks (Disney / USJ) in advance or you’ll eat at odd hours.',
    ],
  },
  {
    title: 'Shopping',
    meta: 'Donki, Uniqlo, tax-free',
    items: [
      'Don Quijote (“Donki”) for cheap souvenirs and everything under one roof.',
      'Uniqlo / GU for clothes — sizes run small, so size up (an L at home may be XL/2XL here).',
      'Konbini sell a great throat spray and every travel sundry.',
    ],
  },
  {
    title: 'Little things',
    meta: 'Trash, onsen tattoos, train manners',
    items: [
      'Carry a small bag/pouch — street bins are rare; you’ll hold your own trash.',
      'Tattoos: several onsen restrict them. A private in-room bath sidesteps it — worth confirming which of our rooms actually have one.',
      'Keep phone calls off and voices low on trains.',
      'Take shoes off where you see a step up or slippers waiting; don’t eat while walking.',
    ],
  },
  {
    title: 'Apps to download before flying',
    meta: 'Suica, Maps, Tabelog, GO',
    items: [
      'Suica in Apple Wallet — one each, Express Transit switched on.',
      'Google Maps, with the offline map of each city downloaded.',
      'Tabelog (restaurants) and GO (taxis).',
      'Airalo for the eSIM, and LINE.',
      'Payke (scan a product, read the label in English), ChargeSpot, Japan Travel by Navitime.',
      'The teamLab app — we have two of their venues booked.',
    ],
  },
  {
    title: 'Things not to forget',
    meta: 'Passport, Takkyubin, no tipping',
    items: [
      'Passport on you, always. No passport, no tax-free and no Donki coupon.',
      'Takkyubin at every city change where we don’t have the car: ~¥1,500–2,000 per suitcase, arrives next day. Arrange it at reception the night before.',
      'There are no rubbish bins. Carry a small bag in the daypack.',
      'No tipping. Ever. Anywhere.',
      'Don’t eat while walking — stand next to the stall.',
      '7-Eleven for cash withdrawals, not the airport exchange counters.',
    ],
  },
  {
    title: 'Open items — still to sort',
    meta: 'Still needs deciding',
    items: [
      'Cancel one of the two Atami hotels. Both are booked for the same nights, both with free cancellation.',
      'Hakone Yutowa: is there a private bath? Booking is offering an upgrade to a superior room with one, which suggests the current room doesn’t have it — and that was the point of Hakone.',
      'Confirm parking at Mizno (Kawaguchiko), Onyado Nono (Matsumoto) and Hotel Wood (Takayama).',
      'Verify the out-of-prefecture drop-off fee on the car rental.',
      'International Driving Permit: 1949 Geneva Convention booklet format, issued by MEMSI. Valid 1 year from issue — check the date.',
      'Visit Japan Web: register 2 weeks ahead, complete everything at least 6 hours before landing. One QR per person.',
    ],
  },
]

const PHRASES: { romaji: string; meaning: string }[] = [
  { romaji: 'Konnichiwa', meaning: 'Hello' },
  { romaji: 'Arigatou gozaimasu', meaning: 'Thank you' },
  { romaji: 'Sumimasen', meaning: 'Excuse me / sorry' },
  { romaji: 'Onegaishimasu', meaning: 'Please' },
  { romaji: 'Ikura desu ka?', meaning: 'How much is it?' },
  { romaji: 'Eigo ga hanasemasu ka?', meaning: 'Do you speak English?' },
  { romaji: 'Oishii!', meaning: 'Delicious!' },
  { romaji: 'Kanpai!', meaning: 'Cheers!' },
]

// Matches the prototype's packSeed exactly (4 groups, 15 items).
const PACKING_GROUPS: { name: string; items: string[] }[] = [
  {
    name: 'Papers & money',
    items: [
      'Passports + travel insurance',
      'Visit Japan Web QR (both of us)',
      'IC card set up in the phone wallet',
      'Cash in yen for day one',
    ],
  },
  {
    name: 'Clothes',
    items: [
      'Comfortable walking shoes',
      'Light layer for the evenings',
      'Packable rain shell',
      'Socks worth taking shoes off for',
    ],
  },
  {
    name: 'Tech',
    items: [
      'Power adapter (Type A, 100V)',
      'Portable charger + cables',
      'Headphones for the long leg',
    ],
  },
  {
    name: 'Health & small things',
    items: [
      'Copies of prescriptions',
      'Coin purse (you will need it)',
      'Small foldable bag for shopping',
      'Compact umbrella',
    ],
  },
]

const PACK_KEY = 'trip_packing_v1'
const PACK_EXTRA_KEY = 'trip_packing_extra_v1'

export default function TripEssentials() {
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [extra, setExtra] = useState<string[]>([])
  const [packInput, setPackInput] = useState('')
  const [openIdx, setOpenIdx] = useState<number | null>(null)

  useEffect(() => {
    try {
      setChecked(JSON.parse(localStorage.getItem(PACK_KEY) ?? '{}'))
    } catch {
      setChecked({})
    }
    try {
      setExtra(JSON.parse(localStorage.getItem(PACK_EXTRA_KEY) ?? '[]'))
    } catch {
      setExtra([])
    }
  }, [])

  const toggle = (item: string) => {
    setChecked((prev) => {
      const next = { ...prev, [item]: !prev[item] }
      localStorage.setItem(PACK_KEY, JSON.stringify(next))
      return next
    })
  }

  const addPackItem = () => {
    const name = packInput.trim()
    if (!name) return
    setExtra((prev) => {
      const next = [...prev, name]
      localStorage.setItem(PACK_EXTRA_KEY, JSON.stringify(next))
      return next
    })
    setPackInput('')
  }

  const removePackItem = (name: string) => {
    setExtra((prev) => {
      const next = prev.filter((i) => i !== name)
      localStorage.setItem(PACK_EXTRA_KEY, JSON.stringify(next))
      return next
    })
  }

  const groups =
    extra.length > 0 ? [...PACKING_GROUPS, { name: 'Yours', items: extra }] : PACKING_GROUPS
  const allItems = groups.flatMap((g) => g.items)
  const packedCount = allItems.filter((i) => checked[i]).length
  const packPct = allItems.length ? Math.round((packedCount / allItems.length) * 100) : 0

  return (
    <div className="space-y-8">
      <div>
        <p className="section-title text-brand">Essentials</p>
        <h1 className="mt-1 font-display text-[34px] font-extrabold leading-[1.05] tracking-tight">
          Good to know
        </h1>
      </div>

      <CurrencyCalculator />

      <section>
        <p className="section-title">Trip notes</p>
        <div className="mt-3 space-y-3">
          {SECTIONS.map((s, i) => {
            const open = openIdx === i
            const panelId = `essentials-panel-${i}`
            return (
              <div key={s.title} className="rounded-2xl border border-line bg-white shadow-card">
                {/* The whole header row is the button — title, meta line and the
                    card padding all tap — and the meta sits inside it so the
                    chevron centres against both lines instead of just the title. */}
                <button
                  type="button"
                  onClick={() => setOpenIdx(open ? null : i)}
                  className="flex w-full items-center gap-3 px-4.5 py-4 text-left"
                  aria-expanded={open}
                  aria-controls={panelId}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold leading-snug text-ink">{s.title}</span>
                    <span className="mt-1 block text-xs leading-snug text-muted">{s.meta}</span>
                  </span>
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                    className={`shrink-0 text-muted transition-transform duration-200 ${
                      open ? '-rotate-180' : ''
                    }`}
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                {open && (
                  <div id={panelId} className="border-t border-line px-4.5 pb-4 pt-3.5">
                    <ul className="space-y-2.5">
                      {s.items.map((item, j) => (
                        <li key={j} className="flex gap-2.5 text-sm leading-relaxed">
                          <span
                            className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand"
                            aria-hidden
                          />
                          <span className="min-w-0 flex-1">{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-display text-2xl font-extrabold tracking-tight">Packing</h2>
          <span className="text-xs font-semibold text-muted">
            {packedCount} / {allItems.length} packed
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-300 ease-out"
            style={{ width: `${packPct}%` }}
          />
        </div>

        <div className="mt-4 flex gap-2">
          <input
            className="field"
            placeholder="Add something to the bag"
            value={packInput}
            onChange={(e) => setPackInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addPackItem()
              }
            }}
            aria-label="Add something to the bag"
          />
          <button
            type="button"
            onClick={addPackItem}
            aria-label="Add to packing list"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-ink text-xl font-bold leading-none text-white active:scale-95"
          >
            +
          </button>
        </div>

        <div className="mt-4 space-y-3">
          {groups.map((g) => {
            const done = g.items.filter((i) => checked[i]).length
            return (
              <div key={g.name} className="rounded-2xl border border-line bg-white px-4.5 py-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-bold">{g.name}</h3>
                  <span
                    className={`text-xs font-bold ${
                      done === g.items.length ? 'text-green-700' : 'text-muted'
                    }`}
                  >
                    {done}/{g.items.length}
                  </span>
                </div>
                <ul className="mt-2 divide-y divide-line">
                  {g.items.map((item) => (
                    <li key={item} className="flex items-center gap-3 py-2.5">
                      <button
                        type="button"
                        onClick={() => toggle(item)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs text-white ${
                            checked[item] ? 'border-brand bg-brand' : 'border-line'
                          }`}
                          aria-hidden
                        >
                          {checked[item] ? '✓' : ''}
                        </span>
                        <span
                          className={`text-sm ${checked[item] ? 'text-muted line-through' : ''}`}
                        >
                          {item}
                        </span>
                      </button>
                      {g.name === 'Yours' && (
                        <button
                          type="button"
                          aria-label={`Remove ${item}`}
                          onClick={() => removePackItem(item)}
                          className="px-1 text-muted"
                        >
                          ×
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </div>
      </section>

      <section>
        <p className="section-title">Handy phrases</p>
        <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-white">
          {PHRASES.map((p) => (
            // flex-wrap, not shrink: a long pair like "Eigo ga hanasemasu ka?"
            // / "Do you speak English?" drops the meaning onto its own line
            // instead of squeezing the phrase into a three-line stack.
            <li
              key={p.romaji}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 px-4.5 py-3 leading-snug"
            >
              <span className="font-semibold">{p.romaji}</span>
              <span className="text-sm text-muted">{p.meaning}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <p className="section-title">Emergency</p>
        <ul className="mt-3 space-y-2">
          {EMERGENCY.map((e) => (
            <li key={e.value}>
              <a
                href={`tel:${e.value.replace(/[^0-9+]/g, '')}`}
                className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-white px-4.5 py-3.5"
              >
                <span className="min-w-0 text-sm font-semibold leading-snug">{e.label}</span>
                <span className="shrink-0 font-display text-lg font-bold text-brand">
                  {e.value}
                </span>
              </a>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
