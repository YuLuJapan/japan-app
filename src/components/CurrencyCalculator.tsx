// Money helper: type an amount in yen, see it in USD and ILS. Rates come from
// /api/rates (refreshed daily, cached for offline). Yen is the input; the two
// conversions update live.
import { useState } from 'react'
import { useRates } from '../api/hooks'

const usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const ilsFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'ILS' })
const yenFmt = new Intl.NumberFormat('en-US')

export function CurrencyCalculator() {
  const { data, isPending, isError, refetch } = useRates()
  const [yen, setYen] = useState('1000')

  const amount = Number(yen.replace(/[^0-9.]/g, '')) || 0

  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <div className="flex items-center justify-between">
        <label htmlFor="yen" className="text-sm font-bold">
          Yen converter
        </label>
        {data && <span className="text-[11px] text-muted">Rates · {data.date}</span>}
      </div>

      <div className="mt-2 flex items-center gap-2 rounded-xl border border-line bg-canvas px-3 py-2 focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/20">
        <span className="font-display text-xl font-extrabold text-muted">¥</span>
        <input
          id="yen"
          inputMode="decimal"
          value={yen}
          onChange={(e) => setYen(e.target.value)}
          placeholder="1000"
          className="w-full bg-transparent text-xl font-extrabold text-ink outline-none"
          aria-label="Amount in yen"
        />
      </div>

      {isError ? (
        <div className="mt-3 text-sm text-muted">
          Couldn't load today's rate.{' '}
          <button type="button" className="font-bold text-brand" onClick={() => refetch()}>
            Retry
          </button>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <div className="rounded-xl bg-canvas px-3 py-2.5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted">US Dollar</p>
            <p className="font-display text-lg font-extrabold text-ink">
              {isPending || !data ? '…' : usdFmt.format(amount * data.usd)}
            </p>
          </div>
          <div className="rounded-xl bg-canvas px-3 py-2.5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted">Shekel</p>
            <p className="font-display text-lg font-extrabold text-ink">
              {isPending || !data ? '…' : ilsFmt.format(amount * data.ils)}
            </p>
          </div>
        </div>
      )}

      {data && (
        <p className="mt-2 text-[11px] text-muted">
          ¥{yenFmt.format(1000)} ≈ {usdFmt.format(1000 * data.usd)} ≈ {ilsFmt.format(1000 * data.ils)}
        </p>
      )}
    </div>
  )
}
