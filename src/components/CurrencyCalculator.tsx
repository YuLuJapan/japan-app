// Money helper: type an amount in yen, see it in USD and ILS. Rates come from
// /api/rates (refreshed daily, cached for offline). Yen is the input; the two
// conversions update live.
import { useState } from 'react'
import { useRates } from '../api/hooks'

const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const ilsFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'ILS' })
const yen = new Intl.NumberFormat('en-US')

export function CurrencyCalculator() {
  const { data, isPending, isError, refetch } = useRates()
  const [amountStr, setAmountStr] = useState('1000')

  const amount = Number(amountStr.replace(/[^0-9.]/g, '')) || 0

  return (
    <div className="rounded-3xl border border-line bg-white p-4 shadow-card">
      <div className="flex items-center justify-between">
        <h3 className="font-display text-base font-extrabold">💱 Exchange calculator</h3>
        {data && <span className="text-[11px] font-semibold text-muted">Rate · {data.date}</span>}
      </div>

      {data && (
        <p className="mt-1 text-xs font-semibold text-brand">
          US$1 ≈ ¥{Math.round(1 / data.usd)} &nbsp;·&nbsp; ₪1 ≈ ¥{Math.round(1 / data.ils)}
        </p>
      )}

      <label htmlFor="yen" className="mt-3 block text-[11px] font-bold uppercase tracking-wide text-muted">
        Amount in yen
      </label>
      <div className="mt-1 flex items-center gap-2 rounded-2xl border border-line bg-canvas px-3 py-2.5 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
        <span className="font-display text-2xl font-extrabold text-muted">¥</span>
        <input
          id="yen"
          inputMode="decimal"
          value={amountStr}
          onChange={(e) => setAmountStr(e.target.value)}
          placeholder="1000"
          className="w-full bg-transparent text-2xl font-extrabold text-ink outline-none"
          aria-label="Amount in yen"
        />
      </div>

      {isError ? (
        <div className="mt-3 rounded-2xl bg-canvas px-3 py-3 text-sm text-muted">
          Couldn’t load today’s rate.{' '}
          <button type="button" className="font-bold text-brand" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-2xl border border-brand/20 bg-brand/5 px-3 py-3 text-center">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted">US Dollar</p>
            <p className="mt-0.5 font-display text-2xl font-extrabold text-ink">
              {isPending || !data ? '…' : usdFmt.format(amount * data.usd)}
            </p>
          </div>
          <div className="rounded-2xl border border-brand/20 bg-brand/5 px-3 py-3 text-center">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Shekel (ILS)</p>
            <p className="mt-0.5 font-display text-2xl font-extrabold text-ink">
              {isPending || !data ? '…' : ilsFmt.format(amount * data.ils)}
            </p>
          </div>
        </div>
      )}

      {data && (
        <p className="mt-2 text-[11px] text-muted">
          e.g. ¥{yen.format(1000)} ≈ {usdFmt.format(1000 * data.usd)} ≈ {ilsFmt.format(1000 * data.ils)}
        </p>
      )}
    </div>
  )
}
