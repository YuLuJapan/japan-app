// The country field: a list you filter, not a box you fill.
//
// The country used to be free text, and three features read it — the Essentials
// gating, the currency guess and the analytics grouping — so "Jappan" quietly
// meant "not Japan" and "japan " split the analytics group in two. The fix is
// that what you type never becomes the value: it filters 243 countries, and the
// value is whichever one you land on.
//
// A native <select> was the obvious cheap answer and is the wrong one here: 243
// unfiltered options on a phone is worse than the text box it replaces. This is
// a combobox instead — which means the keyboard and the screen reader are the
// part that has to be got right, not an afterthought, so they are what
// src/tests/country-picker.test.tsx is mostly about.
//
// The component holds no country of its own. `value` is the text, `selected` is
// whatever country that text names (decided by the caller, from the list the
// API serves), and choosing one simply writes its name back through `onChange`.
// One source of truth, and the caller keeps the one it already had.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Country } from '../api/types'
import { flagFor } from '../lib/country-flag'

interface Props {
  id: string
  /** What is in the box: a filter while typing, a country's name once chosen. */
  value: string
  onChange: (value: string) => void
  /** The list, or undefined while it is still in flight. */
  countries: Country[] | undefined
  /** The country `value` names, if it names one. Draws the flag. */
  selected: Country | undefined
  invalid?: boolean
  describedBy?: string
}

/** Name first, then the spellings it also answers to ("UK", "Holland"). */
function matches(countries: Country[], query: string): Country[] {
  const q = query.trim().toLowerCase()
  if (!q) return countries
  const named = countries.filter((c) => c.name.toLowerCase().startsWith(q))
  const inside = countries.filter(
    (c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q)
  )
  const aliased = countries.filter(
    (c) =>
      !c.name.toLowerCase().includes(q) &&
      (c.aliases ?? []).some((a) => a.toLowerCase().includes(q))
  )
  return [...named, ...inside, ...aliased]
}

export function CountryPicker({
  id,
  value,
  onChange,
  countries,
  selected,
  invalid,
  describedBy,
}: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listId = `${id}-list`
  const listRef = useRef<HTMLUListElement>(null)

  const found = useMemo(() => matches(countries ?? [], value), [countries, value])
  const activeId = open && found[active] ? `${id}-option-${found[active].code}` : undefined

  // Typing moves the ground under the highlight, so it goes back to the top
  // rather than staying on whichever row happens to be in that position now.
  useEffect(() => setActive(0), [value])

  // Keep the highlighted row on screen when the keyboard is what is moving it.
  // Called optionally because jsdom has no layout and so no scrollIntoView —
  // the same reason the map cannot mount in a test.
  useEffect(() => {
    if (!open) return
    const row = listRef.current?.querySelector('[data-active="true"]')
    row?.scrollIntoView?.({ block: 'nearest' })
  }, [active, open])

  const choose = (country: Country) => {
    onChange(country.name)
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      if (!found.length) return
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (i + step + found.length) % found.length)
      return
    }
    // Enter chooses what is highlighted; with the list shut it belongs to the
    // form, which is what submits the sheet.
    if (e.key === 'Enter' && open && found[active]) {
      e.preventDefault()
      choose(found[active])
    }
  }

  return (
    <div className="relative">
      <div className="relative mt-1">
        {selected ? (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg"
          >
            {flagFor(selected.code)}
          </span>
        ) : null}
        <input
          id={id}
          type="text"
          className={`field ${selected ? 'pl-12' : ''}`}
          placeholder="Japan"
          value={value}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-invalid={!!invalid}
          aria-describedby={describedBy}
          autoComplete="off"
          maxLength={80}
          onChange={(e) => {
            onChange(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          // A click lands after the blur, so closing has to wait for it.
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
        />
      </div>

      {/* What a sighted user reads off the list length, said out loud. */}
      <p aria-live="polite" className="sr-only">
        {open ? countMessage(countries, found.length) : ''}
      </p>

      <ul
        id={listId}
        role="listbox"
        aria-label="Countries"
        hidden={!open}
        ref={listRef}
        className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-2xl border border-line bg-white py-1 shadow-card"
      >
        {found.map((country, i) => (
          <li
            key={country.code}
            id={`${id}-option-${country.code}`}
            role="option"
            aria-selected={selected?.code === country.code}
            data-active={i === active}
            className={`flex cursor-pointer items-center gap-3 px-4 py-2 text-base ${
              i === active ? 'bg-canvas' : ''
            }`}
            // Before the blur, so the choice is not lost to the field closing.
            onMouseDown={(e) => {
              e.preventDefault()
              choose(country)
            }}
            onMouseEnter={() => setActive(i)}
          >
            <span aria-hidden="true" className="text-lg">
              {flagFor(country.code)}
            </span>
            <span>{country.name}</span>
          </li>
        ))}
        {!found.length ? (
          <li className="px-4 py-2 text-sm text-muted" role="presentation">
            {countries ? 'No country matches that.' : 'Loading the country list…'}
          </li>
        ) : null}
      </ul>
    </div>
  )
}

function countMessage(countries: Country[] | undefined, count: number): string {
  if (!countries) return 'Loading the country list.'
  if (!count) return 'No country matches that.'
  return count === 1 ? '1 country' : `${count} countries`
}
