import { useEffect, useState } from 'react'
import { CurrencyCalculator } from '../components/CurrencyCalculator'

// Curated static reference for the trip. Phrases are romaji (Latin script) +
// English meaning — a travel phrasebook, no Japanese characters in the UI.

const EMERGENCY = [
  { label: 'Police', value: '110' },
  { label: 'Fire / Ambulance', value: '119' },
  { label: 'Japan Visitor Hotline (24h, EN)', value: '050-3816-2787' },
]

// Trip tips, incl. the "tips we got" from the traveller groups.
const SECTIONS: { title: string; icon: string; items: string[] }[] = [
  {
    title: 'Visit Japan Web (do before you fly)',
    icon: '🛂',
    items: [
      'Register both travellers at vjw.digital.go.jp — fill in passport details plus the immigration and customs declarations online ahead of time.',
      'Do this a few days before departure, not at the airport. It only unlocks 6 hours before arrival, but registering the passport/personal info early means there’s just the short declaration left to finish then.',
      'One QR code now covers both immigration and customs — show it at the immigration counter, then again at the customs gate. Screenshot it or make sure you can log back in without a Japanese SIM.',
      'Each traveller needs their own entry (you can manage a companion under one account) — double check both QR codes are ready before landing.',
    ],
  },
  {
    title: 'Money',
    icon: '💴',
    items: [
      'Cash: hotels are prepaid, so you need less than you’d think — but keep some for small shops, shrines, markets and some restaurants.',
      'Withdraw at 7-Eleven ATMs — they accept foreign cards and are everywhere. Rough rate when the group travelled: ~¥53 ≈ ₪1 (moves — check before you go).',
      'No tipping — it can even cause confusion. Pay into the little tray at registers.',
      'Daily kit: cash + IC card + passport (for tax-free shopping).',
    ],
  },
  {
    title: 'Trains & tickets',
    icon: '🚆',
    items: [
      'Skip the JR Pass — after the price hike it no longer pays off for most routes. Ours has only two long JR rides (Kanazawa→Kyoto Thunderbird, Osaka→Tokyo Shinkansen); buy those per-journey (run it through a JR fare calculator if unsure).',
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
    icon: '🚕',
    items: [
      'Download the GO taxi app. Add a card to Apple Pay in advance — some found in-app card entry finicky, so set it up before you need it.',
    ],
  },
  {
    title: 'Luggage between cities',
    icon: '🧳',
    items: [
      'With many one-night stops, consider Takkyubin forwarding (Yamato “Black Cat”) — send big cases hotel-to-hotel and travel light on the alpine legs. Counters at airports (Narita basement) and konbini.',
      'Rolling them works too, but the group warned repeatedly: rush-hour trains and elevator-less stations are brutal with big cases. Forwarding a case ahead to Kyoto or the return-Tokyo hotel is worth it for the Tokyo→Hakone→Fuji→Alps stretch.',
    ],
  },
  {
    title: 'Weather (late Sept–mid Oct)',
    icon: '🌤️',
    items: [
      'A lovely window: warm-not-scorching, far drier than summer, thinner crowds. T-shirt days, cooler evenings — pack a light layer.',
      'Some rain is possible — bring a compact umbrella and it won’t cancel anything.',
      'Typhoon season is tailing off but not zero — watch forecasts for the coastal/southern legs and stay flexible.',
    ],
  },
  {
    title: 'Connectivity',
    icon: '📶',
    items: [
      'Get an eSIM before you fly (Airalo, Ubigi, Sakura Mobile…) and activate on landing.',
      'Google Maps is your transit brain — trains, platforms and exit numbers. Download offline maps per city.',
      'Free Wi-Fi at most stations, convenience stores and cafés.',
    ],
  },
  {
    title: 'Food notes',
    icon: '🍜',
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
    icon: '🛍️',
    items: [
      'Don Quijote (“Donki”) for cheap souvenirs and everything under one roof.',
      'Uniqlo / GU for clothes — sizes run small, so size up (an L at home may be XL/2XL here).',
      'Konbini sell a great throat spray and every travel sundry.',
    ],
  },
  {
    title: 'Little things',
    icon: '✨',
    items: [
      'Carry a small bag/pouch — street bins are rare; you’ll hold your own trash.',
      'Tattoos: several onsen restrict them. Our private in-room baths (Hakone ryokan, hotel onsen) sidestep this.',
      'Keep phone calls off and voices low on trains.',
      'Take shoes off where you see a step up or slippers waiting; don’t eat while walking.',
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

const PACKING = [
  'Passports + travel insurance',
  'Visit Japan Web done — immigration + customs QR ready for both of us',
  'IC card set up in phone wallet',
  'Power adapter (Type A, 100V) + portable charger',
  'Comfortable walking shoes',
  'Some cash (yen) for day one',
  'Any medications + copies of prescriptions',
  'Coin purse (you will collect coins)',
  'Small foldable bag for shopping / trash',
  'Compact umbrella',
]

const PACK_KEY = 'trip_packing_v1'

export default function TripEssentials() {
  const [checked, setChecked] = useState<Record<string, boolean>>({})

  useEffect(() => {
    try {
      setChecked(JSON.parse(localStorage.getItem(PACK_KEY) ?? '{}'))
    } catch {
      setChecked({})
    }
  }, [])

  const toggle = (item: string) => {
    setChecked((prev) => {
      const next = { ...prev, [item]: !prev[item] }
      localStorage.setItem(PACK_KEY, JSON.stringify(next))
      return next
    })
  }

  const packedCount = PACKING.filter((i) => checked[i]).length

  return (
    <div className="space-y-8">
      <div>
        <p className="section-title text-brand">Essentials</p>
        <h1 className="mt-1 font-display text-2xl font-extrabold">Good to know</h1>
      </div>

      {SECTIONS.map((s) => (
        <section key={s.title}>
          <h2 className="mb-2 font-display text-lg font-extrabold">
            {s.icon} {s.title}
          </h2>
          {s.title === 'Money' && (
            <div className="mb-3">
              <CurrencyCalculator />
            </div>
          )}
          <ul className="space-y-2">
            {s.items.map((item, i) => (
              <li key={i} className="flex gap-2 text-sm leading-relaxed">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section>
        <h2 className="mb-2 font-display text-lg font-extrabold">🗣️ Handy phrases</h2>
        <ul className="divide-y divide-line rounded-2xl border border-line bg-white">
          {PHRASES.map((p) => (
            <li key={p.romaji} className="flex items-center justify-between px-4 py-2.5">
              <span className="font-semibold">{p.romaji}</span>
              <span className="text-sm text-muted">{p.meaning}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 font-display text-lg font-extrabold">🆘 Emergency</h2>
        <ul className="space-y-2">
          {EMERGENCY.map((e) => (
            <li key={e.value}>
              <a
                href={`tel:${e.value.replace(/[^0-9+]/g, '')}`}
                className="flex items-center justify-between rounded-2xl border border-line bg-white px-4 py-3"
              >
                <span className="text-sm font-semibold">{e.label}</span>
                <span className="font-display text-lg font-bold text-brand">{e.value}</span>
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-display text-lg font-extrabold">🎒 Packing checklist</h2>
          <span className="text-xs text-muted">
            {packedCount}/{PACKING.length}
          </span>
        </div>
        <ul className="space-y-2">
          {PACKING.map((item) => (
            <li key={item}>
              <button
                type="button"
                onClick={() => toggle(item)}
                className="flex w-full items-center gap-3 rounded-2xl border border-line bg-white px-4 py-3 text-left active:scale-[0.99]"
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs text-white ${
                    checked[item] ? 'border-brand bg-brand' : 'border-line'
                  }`}
                  aria-hidden
                >
                  {checked[item] ? '✓' : ''}
                </span>
                <span className={`text-sm ${checked[item] ? 'text-muted line-through' : ''}`}>
                  {item}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
