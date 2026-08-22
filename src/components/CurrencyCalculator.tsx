// Money helper: type an amount in the trip's local currency, see it in the
// currencies you think in. Both sides come from the trip (`local_currency` /
// `home_currencies`, chosen on the trip sheet) — the pair this was fixed to,
// yen in and USD/ILS out, is now just what a trip gets when nobody picked.
// Rates come from /api/rates (refreshed daily, cached for offline).
import { useMemo, useState } from 'react'
import { useRates } from '../api/hooks'

/**
 * A currency's own formatting, from the browser rather than a table: Intl
 * knows the symbol, where it goes, and how many decimals a currency has (yen
 * has none, dinars have three).
 */
const money = (code: string) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: code,
    currencyDisplay: 'narrowSymbol',
  })

const plain = new Intl.NumberFormat('en-US')

/** The bare symbol, for the input's prefix. */
function symbolOf(code: string): string {
  const part = money(code)
    .formatToParts(0)
    .find((p) => p.type === 'currency')
  return part?.value ?? code
}

/**
 * Quick amounts worth a tap, scaled to what the currency's notes look like.
 * ¥1,000 and €10 are the same kind of number to a traveller; a fixed 1,000
 * would be a rounding error in yen and a fortune in dinars.
 */
function quickAmounts(local: string, perUnit: number | undefined): number[] {
  // `perUnit` is one unit of the local currency in the first home currency — a
  // rough sense of scale is all this needs, so any of them will do.
  if (perUnit && Number.isFinite(perUnit)) {
    if (perUnit < 0.02) return [1000, 5000, 10000, 50000]
    if (perUnit < 0.2) return [100, 500, 1000, 5000]
    if (perUnit < 2) return [10, 50, 100, 500]
    return [1, 5, 10, 50]
  }
  // Before the rate lands, guess from the currency itself: the ones without
  // minor units (yen, won, dong) are the ones you carry thousands of. Keeps
  // the buttons from jumping once the rate arrives.
  const digits = money(local).resolvedOptions().maximumFractionDigits
  return digits === 0 ? [1000, 5000, 10000, 50000] : [10, 50, 100, 500]
}

/** One card per home currency, up to the three the trip may pick. */
const CARD_COLS: Record<number, string> = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3' }

interface Props {
  /** What money is spent in there. */
  local: string
  /** What to convert it into — 1 to 3 codes. */
  home: string[]
}

export function CurrencyCalculator({ local, home }: Props) {
  const { data, isPending, isError, refetch } = useRates(local, home)
  const [amountStr, setAmountStr] = useState('')

  const localFmt = useMemo(() => money(local), [local])
  const symbol = useMemo(() => symbolOf(local), [local])
  // Codes we actually have a rate for, in the order the trip listed them.
  const shown = home.filter((code) => typeof data?.rates[code] === 'number')
  const quick = quickAmounts(local, shown.length ? data?.rates[shown[0]] : undefined)
  const amount = Number(amountStr.replace(/[^0-9.]/g, '')) || quick[0]

  return (
    <div className="rounded-3xl border border-line bg-white p-5 shadow-card">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base font-bold">Exchange calculator</h3>
        {data && <span className="text-[11px] font-semibold text-muted">Rate · {data.date}</span>}
      </div>

      {data && shown.length > 0 && (
        <p className="mt-1 text-xs font-semibold text-brand">
          {shown
            .map((code) => `${money(code).format(1)} ≈ ${localFmt.format(1 / data.rates[code])}`)
            .join('  ·  ')}
        </p>
      )}

      <label
        htmlFor="local-amount"
        className="mt-3 block text-[11px] font-bold uppercase tracking-wide text-muted"
      >
        Amount in {local}
      </label>
      <div className="mt-1 flex items-center gap-2 rounded-2xl border border-line bg-canvas px-3 py-2.5 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
        <span className="font-display text-2xl font-bold text-muted">{symbol}</span>
        <input
          id="local-amount"
          inputMode="decimal"
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
          placeholder={String(quick[0])}
          className="w-full bg-transparent text-2xl font-extrabold text-ink outline-none"
          aria-label={`Amount in ${local}`}
        />
      </div>

      <div className="mt-2 flex gap-2">
        {quick.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => setAmountStr(String(q))}
            className="flex-1 rounded-xl bg-canvas py-2 text-xs font-semibold text-ink hover:bg-brand/10 hover:text-brand"
          >
            {plain.format(q)}
          </button>
        ))}
      </div>

      {isError ? (
        <div className="mt-3 rounded-2xl bg-canvas px-3 py-3 text-sm text-muted">
          Couldn’t load today’s rate.{' '}
          <button type="button" className="font-bold text-brand" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      ) : (
        <div className={`mt-3 grid gap-2 ${CARD_COLS[home.length] ?? 'grid-cols-2'}`}>
          {home.map((code) => (
            <div
              key={code}
              className="rounded-2xl border border-brand/20 bg-brand/5 px-3 py-3 text-center"
            >
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted">{code}</p>
              <p className="mt-0.5 font-display text-2xl font-bold text-ink">
                {isPending || !data
                  ? '…'
                  : typeof data.rates[code] === 'number'
                    ? money(code).format(amount * data.rates[code])
                    : '—'}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* A currency the provider didn't quote today is said out loud rather
          than left as a silent dash. */}
      {data && data.missing.length > 0 && (
        <p className="mt-2 text-[11px] font-semibold text-brand">
          No rate for {data.missing.join(', ')} today.
        </p>
      )}

      {data && shown.length > 0 && (
        <p className="mt-2 text-[11px] text-muted">
          e.g. {localFmt.format(quick[0])} ≈{' '}
          {shown.map((code) => money(code).format(quick[0] * data.rates[code])).join(' ≈ ')}
        </p>
      )}
    </div>
  )
}
