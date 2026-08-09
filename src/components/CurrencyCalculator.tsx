// Money helper: type an amount in the trip's local currency, see it in your
// home currencies (USD, ILS — whichever isn't the trip's own currency). Rates
// come from /api/rates (refreshed daily, cached for offline).
import { useState } from 'react'
import { useRates } from '../api/hooks'
import { CURRENCY_NAMES, HOME_CURRENCIES, currencySymbol, type CurrencyCode } from '../lib/currency'

const yen = new Intl.NumberFormat('en-US')

const QUICK_AMOUNTS = [1000, 5000, 10000, 50000]

const fmtFor = (code: CurrencyCode) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: code })

interface Props {
  localCurrency: CurrencyCode
}

export function CurrencyCalculator({ localCurrency }: Props) {
  const { data, isPending, isError, refetch } = useRates(localCurrency)
  const [amountStr, setAmountStr] = useState('1000')

  const amount = Number(amountStr.replace(/[^0-9.]/g, '')) || 0
  const targets = HOME_CURRENCIES.filter((c) => c !== localCurrency)
  const rateFor = (target: CurrencyCode) => (target === 'USD' ? data?.usd : data?.ils)
  const localSymbol = currencySymbol(localCurrency)

  return (
    <div className="rounded-3xl border border-line bg-white p-5 shadow-card">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base font-extrabold">Exchange calculator</h3>
        {data && <span className="text-[11px] font-semibold text-muted">Rate · {data.date}</span>}
      </div>

      {data && targets.length > 0 && (
        <p className="mt-1 text-xs font-semibold text-brand">
          {targets
            .map((t) => {
              const rate = rateFor(t)
              return rate ? `${currencySymbol(t)}1 ≈ ${localSymbol}${Math.round(1 / rate)}` : null
            })
            .filter(Boolean)
            .join('  ·  ')}
        </p>
      )}

      <label
        htmlFor="local-amount"
        className="mt-3 block text-[11px] font-bold uppercase tracking-wide text-muted"
      >
        Amount in {CURRENCY_NAMES[localCurrency]}
      </label>
      <div className="mt-1 flex items-center gap-2 rounded-2xl border border-line bg-canvas px-3 py-2.5 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
        <span className="font-display text-2xl font-extrabold text-muted">{localSymbol}</span>
        <input
          id="local-amount"
          inputMode="decimal"
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
          placeholder="1000"
          className="w-full bg-transparent text-2xl font-extrabold text-ink outline-none"
          aria-label={`Amount in ${CURRENCY_NAMES[localCurrency]}`}
        />
      </div>

      <div className="mt-2 flex gap-2">
        {QUICK_AMOUNTS.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => setAmountStr(String(q))}
            className="flex-1 rounded-xl bg-canvas py-2 text-xs font-semibold text-ink hover:bg-brand/10 hover:text-brand"
          >
            {yen.format(q)}
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
      ) : targets.length > 0 ? (
        <div className={`mt-3 grid gap-2 ${targets.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {targets.map((t) => {
            const rate = rateFor(t)
            return (
              <div
                key={t}
                className="rounded-2xl border border-brand/20 bg-brand/5 px-3 py-3 text-center"
              >
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted">
                  {CURRENCY_NAMES[t]}
                </p>
                <p className="mt-0.5 font-display text-2xl font-extrabold text-ink">
                  {isPending || !data || rate === undefined ? '…' : fmtFor(t).format(amount * rate)}
                </p>
              </div>
            )
          })}
        </div>
      ) : null}

      {data && targets.length > 0 && (
        <p className="mt-2 text-[11px] text-muted">
          e.g. {localSymbol}
          {yen.format(1000)} ≈{' '}
          {targets
            .map((t) => {
              const rate = rateFor(t)
              return rate ? fmtFor(t).format(1000 * rate) : null
            })
            .filter(Boolean)
            .join(' ≈ ')}
        </p>
      )}
    </div>
  )
}
