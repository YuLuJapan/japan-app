// Currencies selectable as a trip's "local currency" (Add/Edit trip form),
// and the fixed home currencies the exchange calculator converts into. Mirrors
// server/src/lib/currency.ts — kept in sync by hand, same as CATEGORIES.
export const CURRENCIES = [
  'JPY',
  'USD',
  'EUR',
  'GBP',
  'ILS',
  'AUD',
  'CAD',
  'CHF',
  'THB',
  'KRW',
  'CNY',
  'HKD',
  'SGD',
  'MXN',
  'INR',
  'NZD',
  'TRY',
  'AED',
  'VND',
  'IDR',
] as const

export type CurrencyCode = (typeof CURRENCIES)[number]

export const CURRENCY_NAMES: Record<CurrencyCode, string> = {
  JPY: 'Japanese yen',
  USD: 'US dollar',
  EUR: 'Euro',
  GBP: 'British pound',
  ILS: 'Israeli shekel',
  AUD: 'Australian dollar',
  CAD: 'Canadian dollar',
  CHF: 'Swiss franc',
  THB: 'Thai baht',
  KRW: 'South Korean won',
  CNY: 'Chinese yuan',
  HKD: 'Hong Kong dollar',
  SGD: 'Singapore dollar',
  MXN: 'Mexican peso',
  INR: 'Indian rupee',
  NZD: 'New Zealand dollar',
  TRY: 'Turkish lira',
  AED: 'UAE dirham',
  VND: 'Vietnamese dong',
  IDR: 'Indonesian rupiah',
}

/** The calculator's fixed conversion targets — everything converts into these. */
export const HOME_CURRENCIES = ['USD', 'ILS'] as const satisfies readonly CurrencyCode[]

const symbolCache = new Map<string, string>()

/** Best-effort currency symbol via Intl (falls back to the code itself). */
export function currencySymbol(code: string): string {
  const cached = symbolCache.get(code)
  if (cached) return cached
  let symbol = code
  try {
    const parts = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: code,
      currencyDisplay: 'narrowSymbol',
    }).formatToParts(0)
    symbol = parts.find((p) => p.type === 'currency')?.value ?? code
  } catch {
    /* unknown code to Intl — fall back to the code itself */
  }
  symbolCache.set(code, symbol)
  return symbol
}
