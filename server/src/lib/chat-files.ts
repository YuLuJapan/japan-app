// The trip, as files the model can open.
//
// The other half of `lib/ai/vfs.ts`: that one is the mechanism — the listing,
// the grep engine, the tool — and this one is the only place that knows what a
// trip is. Nothing here is generic and nothing there is about travel.
//
// EVERY FILE IS LOADED ON DEMAND, AND THAT IS THE POINT
// ----------------------------------------------------
// `chat-context.ts` runs seven datastore reads to write the prompt, before the
// model has been asked anything. Here the prompt is a fixed listing, so a turn
// starts on **no content queries at all** and a file is read only if the
// question turns out to need it. The loaders memoise, so a file the model reads
// twice is fetched once, and two files that both need the city names share one
// read of the cities.
//
// WHY JSON
// --------
// The eager prefix is prose because prose is what a model reads best in one
// pass. A file is read by *searching* it, and search wants structure: one record
// per line-group, the same keys every time, so `grep "ramen"` lands on a line
// whose neighbours say which city it is in and what it costs. Pretty-printed
// two-space JSON gives that for free, and `offset`/`limit` paging over it lands
// on record boundaries often enough to be readable.
//
// WHAT IS IN THEM
// ---------------
// Everything a writer can see, exactly as before. Chat is owners-and-partners
// only and writers always get the full view, so there is nothing here that
// either of them is being kept from — the flight and the shopping list included,
// because refusing to answer "what time is our flight?" would be a feature that
// looks broken (FR-011). Document *names* only; what is inside one is 007's job,
// behind its own approval gate.
//
// FIELDS ARE NAMED, NOT SPREAD
// ----------------------------
// Every projection below lists its keys one by one rather than spreading a row.
// A new column on `Place` therefore reaches the model only when somebody adds it
// here — the same instinct as `lib/export-view.ts`, if not its compile-time
// teeth. Ids are deliberately absent: they are noise to read, they are the
// bulkiest thing in a row, and nothing the model can do with one exists yet.
// When the write tool lands, that is the decision to revisit first.

import type {
  DataStore,
  FileAttachment,
  ItineraryItem,
  Place,
  ShoppingItem,
  Tip,
  Trip,
  Zone,
} from './datastore.js'
import type { FlightItinerary } from './flight.js'
import { createFileSystem, type VirtualFile, type VirtualFileSystem } from './ai/vfs.js'

/** The prefix every trip file sits under. One namespace, so a path is recognisable on sight. */
const PREFIX = '/trip'

/**
 * The file system for one trip.
 *
 * The table's order is the listing's order and the order a pattern-only search
 * sweeps in, so it runs roughly from "most questions" to "fewest": where are we
 * and when, then the flight, then the places, then the plan.
 */
export function tripFileSystem(store: DataStore, trip: Trip): VirtualFileSystem {
  const load = loaders(store, trip)

  const files: VirtualFile[] = [
    file('cities.json', 'the cities of the trip in journey order, and the dates in each', () =>
      citiesFile(load)
    ),
    file('flight.json', 'airline, booking reference, legs, departure and arrival times', () =>
      Promise.resolve(flightFile(trip))
    ),
    file(
      'places.json',
      'every saved place — stays, sights, food and shops — with addresses and notes',
      () => placesFile(load)
    ),
    file('itinerary.json', 'the day plan: what happens on which day, in which city', () =>
      itineraryFile(load)
    ),
    file('tips.json', 'notes saved against a place, a city, or the trip as a whole', () =>
      tipsFile(load)
    ),
    file('shopping.json', 'the shopping list: what to buy, where, and what is bought already', () =>
      shoppingFile(load)
    ),
    file('documents.json', 'the names of documents saved on the trip (contents not readable)', () =>
      documentsFile(load)
    ),
  ]

  return createFileSystem(files)
}

/** Every path this trip offers, in listing order. Used by tests and the prompt's prose. */
export function tripFilePaths(): string[] {
  return [
    'cities.json',
    'flight.json',
    'places.json',
    'itinerary.json',
    'tips.json',
    'shopping.json',
    'documents.json',
  ].map((name) => `${PREFIX}/${name}`)
}

const file = (name: string, description: string, build: () => Promise<string>): VirtualFile => ({
  path: `${PREFIX}/${name}`,
  description,
  build,
})

// --- loading -----------------------------------------------------------------

/**
 * The datastore, read at most once per list per turn.
 *
 * Three files need the city names and two need the place names, so without this
 * a turn that read the plan and the tips would fetch the same two lists four
 * times. Memoising the *promise* rather than the result is what makes two
 * concurrent reads share one query — `grep` with no path builds every file at
 * once, so that is the normal case rather than a corner.
 */
function loaders(store: DataStore, trip: Trip) {
  return {
    steps: once(() => store.listSteps(trip.id)),
    zones: once(() => store.listZones(trip.id)),
    places: once(() => store.listAllPlaces(trip.id)),
    tips: once(() => store.listAllTips(trip.id)),
    itinerary: once(() => store.listItinerary(trip.id)),
    shopping: once(() => store.listShoppingItems(trip.id)),
    files: once(() => store.listAllFiles(trip.id)),
  }
}

type Loaders = ReturnType<typeof loaders>

function once<T>(fn: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null
  return () => (pending ??= fn())
}

// --- the files ---------------------------------------------------------------

/**
 * The journey: one entry per stay, in order, then any city the journey never
 * reaches.
 *
 * A city with two stays appears twice, which is right — "we're back in Tokyo on
 * the 12th" is a fact about the journey, and collapsing the two would lose it.
 */
async function citiesFile(load: Loaders): Promise<string> {
  const [steps, zones, places] = await Promise.all([load.steps(), load.zones(), load.places()])
  const byId = new Map(zones.map((z) => [z.id, z]))
  const counts = new Map<string, number>()
  for (const place of places) counts.set(place.zone_id, (counts.get(place.zone_id) ?? 0) + 1)

  const visited = steps.map((step) => ({
    ...cityFields(byId.get(step.zone_id)),
    arrive: step.start_date,
    depart: step.end_date,
    saved_places: counts.get(step.zone_id) ?? 0,
  }))

  const seen = new Set(steps.map((s) => s.zone_id))
  const unvisited = zones
    .filter((zone) => !seen.has(zone.id))
    .map((zone) => ({
      ...cityFields(zone),
      arrive: null,
      depart: null,
      saved_places: counts.get(zone.id) ?? 0,
    }))

  return json([...visited, ...unvisited])
}

function cityFields(zone: Zone | undefined) {
  return {
    city: zone?.name ?? 'Unknown city',
    japanese: zone?.name_ja ?? null,
    about: zone?.summary ?? null,
  }
}

/**
 * The flight, or `null`.
 *
 * Times keep their zone, always as a pair. An instant without one renders in
 * whichever zone the reader happens to be in, and a model reading "departs
 * 09:00" with no zone will tell somebody the wrong hour after they land.
 *
 * Nothing is loaded: the flight lives on the trip row the caller already holds,
 * so this file costs no query at all.
 */
function flightFile(trip: Trip): string {
  const flight = trip.flight
  if (!flight) return json(null)
  return json({
    airline: flight.airline ?? null,
    booking_ref: flight.booking_ref ?? null,
    outbound: itineraryFields(flight.outbound),
    return: itineraryFields(flight.return_flight),
  })
}

function itineraryFields(itinerary: FlightItinerary | null | undefined) {
  if (!itinerary) return null
  return {
    departs: itinerary.depart_at ?? null,
    departs_timezone: itinerary.depart_tz ?? null,
    arrives: itinerary.arrive_at ?? null,
    arrives_timezone: itinerary.arrive_tz ?? null,
    // Two or more legs *are* a connection — nothing models one separately, so
    // the count of these is how "do we connect?" gets answered.
    legs: itinerary.legs.map((l) => ({ flight_no: l.flight_no, from: l.from, to: l.to })),
  }
}

async function placesFile(load: Loaders): Promise<string> {
  const [zones, places] = await Promise.all([load.zones(), load.places()])
  const cityName = names(zones)
  return json(places.map((place) => placeFields(place, cityName)))
}

function placeFields(place: Place, cityName: Map<string, string>) {
  return {
    city: cityName.get(place.zone_id) ?? 'Unknown city',
    category: place.category,
    name: place.name,
    japanese: place.name_ja ?? null,
    address: place.address ?? null,
    notes: place.description ?? null,
    // A stay's reservation lives in the links and the notes, and a writer sees
    // both everywhere else in the app — so they are here too rather than being
    // the one thing chat cannot answer about.
    links: place.links.map((link) => ({ label: link.label, url: link.url })),
  }
}

async function itineraryFile(load: Loaders): Promise<string> {
  const [zones, places, itinerary] = await Promise.all([
    load.zones(),
    load.places(),
    load.itinerary(),
  ])
  const cityName = names(zones)
  const placeName = new Map(places.map((p) => [p.id, p.name]))
  return json(itinerary.map((item) => itineraryItemFields(item, cityName, placeName)))
}

function itineraryItemFields(
  item: ItineraryItem,
  cityName: Map<string, string>,
  placeName: Map<string, string>
) {
  return {
    day: item.day,
    time: item.start_time,
    title: item.title,
    // A day two cities share belongs to both of them, and the activity says
    // which half of it this is — so the city is a fact worth carrying, not a
    // derivation from the date.
    city: item.zone_id ? (cityName.get(item.zone_id) ?? 'Unknown city') : null,
    place: item.place_id ? (placeName.get(item.place_id) ?? null) : null,
    category: item.category,
    highlight: item.highlight,
    note: item.note,
  }
}

async function tipsFile(load: Loaders): Promise<string> {
  const [zones, places, tips] = await Promise.all([load.zones(), load.places(), load.tips()])
  const cityName = names(zones)
  const placeName = new Map(places.map((p) => [p.id, p.name]))
  return json(tips.map((tip) => tipFields(tip, cityName, placeName)))
}

function tipFields(tip: Tip, cityName: Map<string, string>, placeName: Map<string, string>) {
  return {
    about: tip.place_id
      ? (placeName.get(tip.place_id) ?? 'a saved place')
      : tip.zone_id
        ? (cityName.get(tip.zone_id) ?? 'a city')
        : 'the trip',
    note: tip.body,
  }
}

async function shoppingFile(load: Loaders): Promise<string> {
  const [zones, shopping] = await Promise.all([load.zones(), load.shopping()])
  const cityName = names(zones)
  return json(shopping.map((item) => shoppingFields(item, cityName)))
}

function shoppingFields(item: ShoppingItem, cityName: Map<string, string>) {
  return {
    item: item.name,
    category: item.category,
    shop: item.shop,
    city: item.zone_id ? (cityName.get(item.zone_id) ?? 'Unknown city') : null,
    price_yen: item.price_yen,
    bought: item.bought,
    note: item.note,
  }
}

async function documentsFile(load: Loaders): Promise<string> {
  const files = await load.files()
  return json(files.map(documentFields))
}

/**
 * Names only.
 *
 * What is *inside* a document never leaves the app in 005 — ingesting one is
 * 007's problem, behind its own approval gate. Saying a document exists and what
 * it is called is enough to point somebody at it, and `attached_to` is what
 * makes that pointing useful.
 */
function documentFields(attachment: FileAttachment) {
  return {
    name: attachment.display_name,
    attached_to: attachment.place_id ? 'a place' : attachment.zone_id ? 'a city' : 'the trip',
  }
}

// --- rendering ---------------------------------------------------------------

const names = (zones: Zone[]): Map<string, string> => new Map(zones.map((z) => [z.id, z.name]))

/**
 * Two-space JSON, and never anything else.
 *
 * Indentation is not cosmetic here: the grep engine works in lines, so a record
 * squashed onto one line would return the whole file for every match, and a
 * record spread over many gives context lines something to be about.
 */
const json = (value: unknown): string => JSON.stringify(value, null, 2)
