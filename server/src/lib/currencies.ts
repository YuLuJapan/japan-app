// The currencies a trip can be priced in, and the guess we make from a country.
//
// One list, server-side, served to the client by `GET /api/currencies` — the
// trip sheet's pickers are filled from it rather than from a second copy that
// would drift from the one validating what gets saved.
//
// Every code here is one open.er-api.com quotes (the provider behind
// services/rates.ts). Codes it doesn't know would save fine and then produce a
// calculator with no rate to show, so the list is the guard.

export interface Currency {
  code: string
  name: string
}

/** Ordered as offered: the travellers' own currencies first, then by name. */
export const CURRENCIES: Currency[] = [
  { code: 'USD', name: 'US Dollar' },
  { code: 'EUR', name: 'Euro' },
  { code: 'ILS', name: 'Israeli Shekel' },
  { code: 'GBP', name: 'British Pound' },
  { code: 'JPY', name: 'Japanese Yen' },
  { code: 'AED', name: 'UAE Dirham' },
  { code: 'ARS', name: 'Argentine Peso' },
  { code: 'AUD', name: 'Australian Dollar' },
  { code: 'BGN', name: 'Bulgarian Lev' },
  { code: 'BRL', name: 'Brazilian Real' },
  { code: 'CAD', name: 'Canadian Dollar' },
  { code: 'CHF', name: 'Swiss Franc' },
  { code: 'CLP', name: 'Chilean Peso' },
  { code: 'CNY', name: 'Chinese Yuan' },
  { code: 'COP', name: 'Colombian Peso' },
  { code: 'CZK', name: 'Czech Koruna' },
  { code: 'DKK', name: 'Danish Krone' },
  { code: 'EGP', name: 'Egyptian Pound' },
  { code: 'GEL', name: 'Georgian Lari' },
  { code: 'HKD', name: 'Hong Kong Dollar' },
  { code: 'HUF', name: 'Hungarian Forint' },
  { code: 'IDR', name: 'Indonesian Rupiah' },
  { code: 'INR', name: 'Indian Rupee' },
  { code: 'ISK', name: 'Icelandic Króna' },
  { code: 'JOD', name: 'Jordanian Dinar' },
  { code: 'KES', name: 'Kenyan Shilling' },
  { code: 'KHR', name: 'Cambodian Riel' },
  { code: 'KRW', name: 'South Korean Won' },
  { code: 'LKR', name: 'Sri Lankan Rupee' },
  { code: 'MAD', name: 'Moroccan Dirham' },
  { code: 'MXN', name: 'Mexican Peso' },
  { code: 'MYR', name: 'Malaysian Ringgit' },
  { code: 'NOK', name: 'Norwegian Krone' },
  { code: 'NPR', name: 'Nepalese Rupee' },
  { code: 'NZD', name: 'New Zealand Dollar' },
  { code: 'PEN', name: 'Peruvian Sol' },
  { code: 'PHP', name: 'Philippine Peso' },
  { code: 'PLN', name: 'Polish Złoty' },
  { code: 'QAR', name: 'Qatari Riyal' },
  { code: 'RON', name: 'Romanian Leu' },
  { code: 'RSD', name: 'Serbian Dinar' },
  { code: 'SAR', name: 'Saudi Riyal' },
  { code: 'SEK', name: 'Swedish Krona' },
  { code: 'SGD', name: 'Singapore Dollar' },
  { code: 'THB', name: 'Thai Baht' },
  { code: 'TRY', name: 'Turkish Lira' },
  { code: 'TWD', name: 'Taiwan Dollar' },
  { code: 'TZS', name: 'Tanzanian Shilling' },
  { code: 'UAH', name: 'Ukrainian Hryvnia' },
  { code: 'UYU', name: 'Uruguayan Peso' },
  { code: 'VND', name: 'Vietnamese Dong' },
  { code: 'ZAR', name: 'South African Rand' },
]

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]))

/**
 * Which currency a destination is likely spent in, keyed by lowercased
 * country. Only a hint for the trip sheet — the traveller always picks, and a
 * country that isn't here simply doesn't pre-fill anything.
 */
export const CURRENCY_BY_COUNTRY: Record<string, string> = {
  argentina: 'ARS',
  australia: 'AUD',
  austria: 'EUR',
  belgium: 'EUR',
  brazil: 'BRL',
  bulgaria: 'BGN',
  cambodia: 'KHR',
  canada: 'CAD',
  chile: 'CLP',
  china: 'CNY',
  colombia: 'COP',
  croatia: 'EUR',
  cyprus: 'EUR',
  czechia: 'CZK',
  'czech republic': 'CZK',
  denmark: 'DKK',
  egypt: 'EGP',
  estonia: 'EUR',
  finland: 'EUR',
  france: 'EUR',
  georgia: 'GEL',
  germany: 'EUR',
  greece: 'EUR',
  'hong kong': 'HKD',
  hungary: 'HUF',
  iceland: 'ISK',
  india: 'INR',
  indonesia: 'IDR',
  ireland: 'EUR',
  israel: 'ILS',
  italy: 'EUR',
  japan: 'JPY',
  jordan: 'JOD',
  kenya: 'KES',
  latvia: 'EUR',
  lithuania: 'EUR',
  malaysia: 'MYR',
  mexico: 'MXN',
  morocco: 'MAD',
  nepal: 'NPR',
  netherlands: 'EUR',
  'new zealand': 'NZD',
  norway: 'NOK',
  peru: 'PEN',
  philippines: 'PHP',
  poland: 'PLN',
  portugal: 'EUR',
  qatar: 'QAR',
  romania: 'RON',
  'saudi arabia': 'SAR',
  serbia: 'RSD',
  singapore: 'SGD',
  slovakia: 'EUR',
  slovenia: 'EUR',
  'south africa': 'ZAR',
  'south korea': 'KRW',
  korea: 'KRW',
  spain: 'EUR',
  'sri lanka': 'LKR',
  sweden: 'SEK',
  switzerland: 'CHF',
  taiwan: 'TWD',
  tanzania: 'TZS',
  thailand: 'THB',
  turkey: 'TRY',
  türkiye: 'TRY',
  uae: 'AED',
  'united arab emirates': 'AED',
  uk: 'GBP',
  'united kingdom': 'GBP',
  england: 'GBP',
  scotland: 'GBP',
  ukraine: 'UAH',
  uruguay: 'UYU',
  usa: 'USD',
  'united states': 'USD',
  vietnam: 'VND',
}

/** A code we can quote, uppercased — or null when it isn't one we support. */
export function normalizeCurrency(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toUpperCase()
  return BY_CODE.has(code) ? code : null
}

export function isSupportedCurrency(value: unknown): boolean {
  return normalizeCurrency(value) !== null
}

/** The currency a country is spent in, or null when we have no guess. */
export function currencyForCountry(country: string | null | undefined): string | null {
  if (!country) return null
  return CURRENCY_BY_COUNTRY[country.trim().toLowerCase()] ?? null
}

/** What a trip is priced in when nobody said. */
export const DEFAULT_LOCAL_CURRENCY = 'JPY'
/** What it converts to when nobody said — the pair the calculator always had. */
export const DEFAULT_HOME_CURRENCIES = ['USD', 'ILS']
/** More than a few conversion cards stops being a glance on a phone. */
export const MAX_HOME_CURRENCIES = 3
