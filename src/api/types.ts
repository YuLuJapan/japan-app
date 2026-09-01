// Mirrors contracts/api.md response shapes.
export const CATEGORIES = ['hotel', 'attraction', 'food', 'shopping', 'other'] as const
export type Category = (typeof CATEGORIES)[number]

/**
 * One row per place category, and **every surface reads it**.
 *
 * `color` is the tinted pill the icon sits in and `dot` the solid mark used
 * where a category has to read at a few pixels — the timeline bullet on a day
 * plan, and on the map the pin, the legend swatch, the filter chip and the
 * place card's dot. Both come from the redesign's category palette
 * (`stay`/`sight`/`table`/`market` in tailwind.config.ts) rather than stock
 * Tailwind hues, so the four of them sit together in one grid without
 * competing with the coral.
 *
 * That single table is why the map needed no colour of its own (spec 004,
 * research R12). It was built while this palette was reverted, on stock hues,
 * and its reference renders were drawn against these — so re-landing them
 * recoloured the pins, the chips, the legend and the cards in one edit, with
 * no map file touched. Keep it that way: a `MAP_PIN_COLOURS` next door would
 * be marginally simpler and would guarantee the map drifted out of step with
 * every other surface that shows a category.
 */
export const CATEGORY_META: Record<
  Category,
  { label: string; singular: string; icon: string; color: string; dot: string }
> = {
  hotel: {
    label: 'Stays',
    singular: 'Stay',
    icon: '🛏️',
    color: 'bg-stay-tint text-stay',
    dot: 'bg-stay',
  },
  attraction: {
    label: 'Things to do',
    singular: 'Attraction',
    icon: '📷',
    color: 'bg-sight-tint text-sight',
    dot: 'bg-sight',
  },
  food: {
    label: 'Food & cafés',
    singular: 'Food spot',
    icon: '🍔',
    color: 'bg-table-tint text-table',
    dot: 'bg-table',
  },
  shopping: {
    label: 'Shopping',
    singular: 'Shop',
    icon: '🛍️',
    color: 'bg-market-tint text-market',
    dot: 'bg-market',
  },
  other: {
    label: 'More',
    singular: 'Place',
    icon: '📍',
    color: 'bg-sand text-muted',
    dot: 'bg-dust',
  },
}

/** A free-text traveller on a trip — not a linked account. `email` is optional and only
 *  ever used to open a mailto: invite; there is no per-traveller login or delivered email. */
export interface Traveller {
  name: string
  email?: string
}

export interface Trip {
  id: string
  /** An override, not the title. Null means "use display_title". */
  name: string | null
  country: string | null
  /**
   * What to show. Computed server-side from the name, the travellers and the
   * country, so every client agrees — never build this in the UI.
   */
  display_title: string
  start_date: string
  end_date: string
  description: string | null
  people: Traveller[]
  /** What money is spent in there — the calculator's input side. */
  local_currency: string
  /** What to convert it into: 1–3 codes, the calculator's output cards. */
  home_currencies: string[]
  /** 'HH:MM' the trip begins, in `start_tz`; null for no particular time. */
  start_time: string | null
  /** IANA zone `start_time` is written in. */
  start_tz: string | null
}

export interface TripInput {
  name: string
  start_date: string
  end_date: string
  description?: string | null
  people?: Traveller[]
  local_currency?: string
  home_currencies?: string[]
  /** The booking, or null to clear it. Absent means "leave it alone". */
  flight?: FlightInfo | null
  start_time?: string | null
  start_tz?: string | null
}

/** What a date change would leave outside the trip (GET /trips/:id/date-impact). */
export interface TripDateImpact {
  range: { start_date: string; end_date: string }
  steps: {
    id: string
    start_date: string
    end_date: string
    zone_name: string | null
    /** Where `stranded_stops: 'move'` would put it — clipped if the trip is now too short. */
    moves_to: { start_date: string; end_date: string }
  }[]
  activities: {
    id: string
    day: string
    start_time: string | null
    name: string
    highlight: boolean
  }[]
}

/** How to resolve stranded activities when a date change would orphan them. */
export type StrandedResolution = 'move' | 'delete'

/** Stops only move — deleting one belongs to the journey editor, not a date change. */
export type StopResolution = 'move'

export interface ZoneSummary {
  id: string
  name: string
  name_ja: string | null
  summary: string | null
  image_url?: string | null
  lat?: number | null
  lng?: number | null
  /** Saved (undated) activities per category — what Explore's grid shows. */
  saved_counts: Record<Category, number>
}

export interface TripStep {
  id: string
  position: number
  start_date: string
  end_date: string
  zone: ZoneSummary | null
}

export interface JourneyStep {
  id: string
  trip_id: string
  zone_id: string
  position: number
  start_date: string
  end_date: string
}

export interface JourneyStepInput {
  zone_id?: string
  destination?: GeocodeResult
  start_date: string
  end_date: string
}

export interface FlightLeg {
  flight_no: string
  from: string
  to: string
}

export interface FlightItinerary {
  depart_at?: string // ISO instant of this direction's first departure
  depart_tz?: string // IANA zone of the departure airport
  arrive_at?: string // ISO instant of this direction's final arrival
  arrive_tz?: string // IANA zone of the arrival airport
  /** At least one. Two or more are a connection. */
  legs: FlightLeg[]
}

/** Mirrors server/src/lib/flight.ts — everything but the legs is optional. */
export interface FlightInfo {
  airline?: string
  booking_ref?: string
  outbound?: FlightItinerary | null
  return_flight?: FlightItinerary | null
}

/** What this caller may do on a trip. Drives which buttons the UI offers. */
export type TripRole = 'owner' | 'partner' | 'viewer'

/**
 * What this caller is shown on a trip. Withheld content is simply absent from
 * the payload, so this is the only way to tell "nothing saved here" apart from
 * "not shared with you".
 */
export interface TripShows {
  stays: boolean
  flight: boolean
  documents: boolean
  shopping: boolean
}

export interface TripBundle {
  trip: Trip
  steps: TripStep[]
  trip_files_count: number
  my_role?: TripRole | null
  shows?: TripShows
  /** Absent for a trip with no booking, and for a caller who may not see it. */
  flight?: FlightInfo
}

export interface TripMember {
  user_id: string
  role: TripRole
  email: string
  display_name: string | null
  avatar_url: string | null
  can_see_stays: boolean
  can_see_flight: boolean
  can_see_documents: boolean
  can_see_shopping: boolean
}

export interface TripInvite {
  id: string
  email: string | null
  role: 'partner' | 'viewer'
  can_see_stays: boolean
  can_see_flight: boolean
  can_see_documents: boolean
  can_see_shopping: boolean
  expires_at: string
  /** Set when the invitee said no. Distinct from an invite you revoked. */
  declined_at?: string | null
}

/**
 * What someone is told about an invitation before they hold it. Never any trip
 * content — an unaccepted invitation is not access.
 *
 * `id` is present on an invitation read from your own inbox and absent from a
 * link preview, which is addressed by its token instead.
 */
export interface InvitePreview {
  id?: string
  trip_name: string
  role: 'partner' | 'viewer'
  invited_by: string | null
  email: string | null
  expires_at: string
  shows: TripShows
}

export interface Tip {
  id: string
  zone_id?: string | null
  activity_id?: string | null
  body: string
}

export interface FileMeta {
  id: string
  display_name: string
  mime_type: string
  size_bytes: number
}

export type FileParent =
  { kind: 'trip' } | { kind: 'zone'; id: string } | { kind: 'activity'; id: string }

export interface TripDocument extends FileMeta {
  attached_to: { kind: 'trip' | 'zone' | 'activity'; id: string; name: string }
}

export interface FileUploadInput {
  parent: FileParent
  display_name: string
  mime_type: string
  data_base64: string
}

export interface ZoneDetail {
  zone: {
    id: string
    name: string
    name_ja: string | null
    summary: string | null
    image_url?: string | null
    lat?: number | null
    lng?: number | null
  }
  tips: Tip[]
  files: FileMeta[]
  /** Saved (undated) activities per category — what Explore's grid shows. */
  saved_counts: Record<Category, number>
}

export interface GeocodeResult {
  name: string
  address: string | null
  lat: number
  lng: number
}

export interface PlaceLink {
  label: string
  url: string
}

/**
 * One thing on a trip — somewhere to go, something to do, or a line on a day.
 *
 * Mirrors `server/src/lib/datastore.ts`. Feature 010 merged what used to be
 * `Place` and `ItineraryItem`: they described the same thing from two sides,
 * and the split meant a plan line could never hold a document or a pin.
 *
 * **The date is the only thing that decides where it shows.** With a `day` it
 * is on the day plan; without one it is in its city's Explore list, grouped by
 * category. Either way, coordinates put it on the map. Setting the date is
 * "Schedule this"; clearing it sends the row back to Explore.
 */
export interface Activity {
  id: string
  trip_id: string
  /** The city. Null only for a *scheduled* activity — Explore is per-city. */
  zone_id: string | null
  /** Null means untagged: no pill on the plan, grouped under "More" in Explore. */
  category: Category | null
  name: string
  name_ja: string | null
  description: string | null
  address: string | null
  links: PlaceLink[]
  image_url?: string | null
  lat?: number | null
  lng?: number | null
  /** `YYYY-MM-DD`, or null for saved-but-not-scheduled. */
  day: string | null
  /** `HH:MM` (24h), or null for "sometime that day". */
  start_time: string | null
  position: number
  /** Shown as a coral banner above the day's plan. Requires a `day`. */
  highlight: boolean
  /** Leading emoji for that banner. */
  icon: string | null
  /**
   * The one-line gist a list shows. Derived from the description, computed by
   * the server (`lib/activity-view.ts`) and returned on every activity — so an
   * edited row can go back into the list it came from without the client
   * inventing the same rule. See `activityRow` in mutations.
   */
  summary_line: string
  /**
   * How many documents hang off this activity. A count, not the names: a name
   * is a document, and the `documents` view withholds those. Zero when the
   * caller may not see them.
   */
  file_count: number
}

/** With a date: on the day plan. */
export const isScheduled = (a: Pick<Activity, 'day'>): a is Activity & { day: string } =>
  a.day !== null

/** Without one: in its city's Explore list. */
export const isSaved = (a: Pick<Activity, 'day'>): boolean => a.day === null

export interface ActivityDetail {
  activity: Activity
  tips: Tip[]
  files: FileMeta[]
}

export interface ActivityInput {
  zone_id?: string | null
  category?: Category | null
  name: string
  name_ja?: string | null
  description?: string | null
  address?: string | null
  links?: PlaceLink[]
  image_url?: string | null
  lat?: number | null
  lng?: number | null
  day?: string | null
  start_time?: string | null
  position?: number
  highlight?: boolean
  icon?: string | null
}

/** The categories an activity may be tagged with — every one the plan can draw. */
export const TAGGABLE_CATEGORIES = ['hotel', 'attraction', 'food', 'shopping'] as const

// Shopping list — things to buy in Japan (photo, where, how much, bought yet).
export const SHOPPING_CATEGORIES = [
  'clothes',
  'haircare',
  'skincare',
  'health',
  'snacks',
  'tech',
  'home',
  'souvenir',
  'other',
] as const
export type ShoppingCategory = (typeof SHOPPING_CATEGORIES)[number]

export const SHOPPING_CATEGORY_META: Record<ShoppingCategory, { label: string; icon: string }> = {
  clothes: { label: 'Clothes & shoes', icon: '👟' },
  haircare: { label: 'Hair care', icon: '💇' },
  skincare: { label: 'Skin care & makeup', icon: '🧴' },
  health: { label: 'Pharmacy & health', icon: '💊' },
  snacks: { label: 'Food & snacks', icon: '🍫' },
  tech: { label: 'Tech & stationery', icon: '🎧' },
  home: { label: 'Home & kitchen', icon: '🍵' },
  souvenir: { label: 'Gifts & souvenirs', icon: '🎁' },
  other: { label: 'Other', icon: '🛍️' },
}

export interface ShoppingItem {
  id: string
  trip_id: string
  name: string
  category: ShoppingCategory
  note: string | null
  shop: string | null
  zone_id: string | null
  price_yen: number | null
  url: string | null
  image_url: string | null
  bought: boolean
  position: number
}

export interface ShoppingItemInput {
  name: string
  category?: ShoppingCategory
  note?: string | null
  shop?: string | null
  zone_id?: string | null
  price_yen?: number | null
  url?: string | null
  image_url?: string | null
  bought?: boolean
  position?: number
}

// What a shop's product page told us about it (GET /api/product-preview).
export interface ProductPreview {
  url: string
  name: string | null
  image_url: string | null
  shop: string | null
  price_yen: number | null
  price_note: string | null
  /** The Japanese original, when `name` is its English translation. */
  name_ja: string | null
}

export interface Translation {
  text: string
  is_japanese: boolean
  translated: string | null
}

// A photo found on the web for an item that has none (GET /api/images).
export interface ImageResult {
  url: string
  thumb_url: string
  title: string
  source: 'wikipedia' | 'commons'
  source_url: string | null
  credit: string | null
}

export interface Rates {
  /** What amounts are quoted from — a trip's local currency. */
  base: string
  date: string
  /** 1 unit of `base` in each requested currency, keyed by ISO code. */
  rates: Record<string, number>
  /** Requested codes the provider had no rate for today. */
  missing: string[]
}

export interface Currency {
  code: string
  name: string
}

export interface CurrencyCatalogue {
  currencies: Currency[]
  /** Lowercased country → the currency it is likely spent in. A hint only. */
  by_country: Record<string, string>
}

export interface Reminder {
  id: string
  trip_id: string
  title: string
  body: string | null
  url: string | null
  remind_at: string // absolute instant (ISO, UTC)
  time_zone: string // IANA zone the time was entered in
  sent_at: string | null
  created_at: string
}

export interface ReminderInput {
  title: string
  body?: string | null
  url?: string | null
  remind_at: string
  time_zone?: string | null
}

export interface SearchResult {
  type: 'place' | 'zone' | 'tip'
  id: string
  title: string
  subtitle: string
  href: string
}

// --- the export (feature 003) ------------------------------------------------
//
// One projection, two detail levels, four writers. These mirror
// `server/src/lib/export-view.ts`, which is where a field is admitted to an
// export in the first place — nothing on this side may widen them, and nothing
// on this side decides what is in a file.

export type ExportDetail = 'share' | 'full'

export type ExportFormat = 'pdf' | 'docx' | 'xlsx' | 'json'

export interface ExportPlace {
  name: string
  /** Always present; empty when the place has no address. */
  address: string
  category: Category
  description?: string
  links?: PlaceLink[]
  tips?: string[]
  /** JSON backup only. */
  id?: string
  /** JSON backup only. */
  zone_id?: string
}

export interface ExportZone {
  name: string
  summary?: string
  places: ExportPlace[]
  tips?: string[]
}

export interface ExportStep {
  start_date: string
  end_date: string
  zone: ExportZone
}

export interface ExportDayItem {
  start_time?: string
  title: string
  note?: string
  highlight: boolean
  icon?: string
  /** Absent where the place is one this caller may not see. */
  place_name?: string
}

export interface ExportDay {
  day: string
  /** The city or cities the day touches — two of them is a moving day. */
  zones: string[]
  /** Empty on a day with nothing planned; the day is still listed. */
  items: ExportDayItem[]
}

export interface ExportTrip {
  title: string
  start_date: string
  end_date: string
  country: string
  description?: string
}

export interface ExportStats {
  place_count: number
  /** How many of them have no address — reported rather than shown as blanks. */
  places_without_address: number
  day_count: number
  /** Whether stays are in this file: a property of the export, not of a place. */
  included_stays: boolean
}

export interface ExportPayload {
  detail: ExportDetail
  generated_at: string
  trip: ExportTrip
  steps: ExportStep[]
  /** Full detail only; empty at share detail. */
  days: ExportDay[]
  stats: ExportStats
}

// --- Chat (feature 005) ------------------------------------------------------

export interface ChatMessageView {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** Null for the assistant, and null again once an author's account is gone. */
  author: { user_id: string; display_name: string } | null
  created_at: string
}

/**
 * What the server says about this month's spending.
 *
 * Computed server-side and rendered as given — the client does no arithmetic
 * over usage rows, so the notice and the enforcement cannot disagree.
 */
export interface ChatBudget {
  spent_cents: number
  cap_cents: number
  pct: number
  blocked: boolean
  /** ISO date the composer comes back, when blocked. */
  resumes_on: string | null
}

export interface ChatView {
  /** Null until somebody asks the first question — a read never creates one. */
  thread: { id: string; turn_running: boolean } | null
  messages: ChatMessageView[]
  budget: ChatBudget
}
