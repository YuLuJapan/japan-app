// Currencies a trip's local currency can be set to, and the fixed home
// currencies the money calculator always converts into (USD, ILS) unless
// the trip's own currency already is one of them.
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

export function isCurrencyCode(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && (CURRENCIES as readonly string[]).includes(value)
}

export const HOME_CURRENCIES = ['USD', 'ILS'] as const satisfies readonly CurrencyCode[]
