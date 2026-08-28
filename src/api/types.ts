// Mirrors contracts/api.md response shapes.
export const CATEGORIES = ['hotel', 'attraction', 'food', 'shopping', 'other'] as const
export type Category = (typeof CATEGORIES)[number]

/**
 * One table per category, and every surface reads it.
 *
 * `color` is the tint pair a chip or a badge wears; `dot` is the solid fill a
 * map pin, a legend swatch and a place card's dot need. Both are **stock
 * Tailwind classes on purpose** — no `tailwind.config.ts` token (research
 * R12). The reference renders for the map were drawn against the redesign
 * palette that arrived with PR #93 and left with its revert in #94, so the
 * map's hues will not match its render until spec 009 re-lands. Because no map
 * file names a colour, re-landing that palette is one edit here and recolours
 * the pins, the chips, the legend and the cards together.
 */
export const CATEGORY_META: Record<
  Category,
  { label: string; singular: string; icon: string; color: string; dot: string }
> = {
  hotel: {
    label: 'Stays',
    singular: 'Stay',
    icon: '🛏️',
    color: 'bg-violet-100 text-violet-700',
    dot: 'bg-violet-500',
  },
  attraction: {
    label: 'Things to do',
    singular: 'Attraction',
    icon: '📸',
    color: 'bg-sky-100 text-sky-700',
    dot: 'bg-sky-500',
  },
  food: {
    label: 'Food & Cafés',
    singular: 'Food spot',
    icon: '🍜',
    color: 'bg-amber-100 text-amber-700',
    dot: 'bg-amber-500',
  },
  shopping: {
    label: 'Shopping',
    singular: 'Shop',
    icon: '🛍️',
    color: 'bg-pink-100 text-pink-700',
    dot: 'bg-pink-500',
  },
  other: {
    label: 'More',
    singular: 'Place',
    icon: '📍',
    color: 'bg-emerald-100 text-emerald-700',
    dot: 'bg-emerald-500',
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
  items: {
    id: string
    day: string
    start_time: string | null
    title: string
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
  place_counts: Record<Category, number>
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
  place_id?: string | null
  body: string
}

export interface FileMeta {
  id: string
  display_name: string
  mime_type: string
  size_bytes: number
}

export type FileParent =
  { kind: 'trip' } | { kind: 'zone'; id: string } | { kind: 'place'; id: string }

export interface TripDocument extends FileMeta {
  attached_to: { kind: 'trip' | 'zone' | 'place'; id: string; name: string }
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
  place_counts: Record<Category, number>
}

export interface PlaceListItem {
  id: string
  name: string
  name_ja: string | null
  category: Category
  summary_line: string
  image_url?: string | null
  address?: string | null
  lat?: number | null
  lng?: number | null
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

export interface Place {
  id: string
  zone_id: string
  category: Category
  name: string
  name_ja: string | null
  description: string | null
  address: string | null
  links: PlaceLink[]
  image_url?: string | null
  lat?: number | null
  lng?: number | null
  /**
   * The one-line gist the zone's category lists show. Derived from the
   * description, computed by the server (`lib/place-view.ts`) and returned on
   * every place — so an edited place can go back into the list it came from
   * without the client inventing the same rule. See `placeRow` in mutations.
   */
  summary_line: string
}

export interface PlaceDetail {
  place: Place
  tips: Tip[]
  files: FileMeta[]
}

export interface PlaceInput {
  zone_id: string
  category: Category
  name: string
  name_ja?: string | null
  description?: string | null
  address?: string | null
  links?: PlaceLink[]
  image_url?: string | null
  lat?: number | null
  lng?: number | null
}

export interface ItineraryItem {
  id: string
  trip_id: string
  zone_id: string | null
  place_id: string | null
  day: string // YYYY-MM-DD
  start_time: string | null // HH:MM (24h) or null
  title: string
  note: string | null
  position: number
  highlight: boolean // shown as a "featured" banner above the day's plan
  icon: string | null // leading emoji for the banner
}

export interface ItineraryItemInput {
  zone_id?: string | null
  place_id?: string | null
  day: string
  start_time?: string | null
  title: string
  note?: string | null
  position?: number
  highlight?: boolean
  icon?: string | null
}

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
