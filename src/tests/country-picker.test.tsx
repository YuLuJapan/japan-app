import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CountryPicker } from '../components/CountryPicker'
import { flagFor } from '../lib/country-flag'
import type { Country } from '../api/types'

const COUNTRIES: Country[] = [
  { code: 'JP', name: 'Japan' },
  { code: 'JO', name: 'Jordan' },
  { code: 'PT', name: 'Portugal' },
  { code: 'GB', name: 'United Kingdom', aliases: ['UK', 'England'] },
]

/**
 * The picker holds no country of its own — the caller owns the text — so the
 * harness owns it here too, the way TripSheet does.
 */
function renderPicker(
  props: Partial<React.ComponentProps<typeof CountryPicker>> = {},
  onChange = vi.fn()
) {
  const value = props.value ?? ''
  const selected = COUNTRIES.find((c) => c.name.toLowerCase() === value.trim().toLowerCase())
  const view = render(
    <CountryPicker
      id="trip-country"
      value={value}
      onChange={onChange}
      countries={COUNTRIES}
      selected={selected}
      {...props}
    />
  )
  return { onChange, view }
}

const options = () => screen.queryAllByRole('option').map((o) => o.textContent)

describe('CountryPicker', () => {
  it('filters the list by what is typed, and never makes it the value', async () => {
    const user = userEvent.setup()
    const { onChange } = renderPicker({ value: 'jap' })

    await user.click(screen.getByRole('combobox'))

    expect(options()).toEqual(['🇯🇵Japan'])
    // Typing reports the text, not a country: only choosing reports a country.
    expect(onChange).not.toHaveBeenCalledWith('Japan')
  })

  it('finds a country by a spelling the list knows it by', async () => {
    const user = userEvent.setup()
    renderPicker({ value: 'england' })

    await user.click(screen.getByRole('combobox'))

    expect(options()).toEqual(['🇬🇧United Kingdom'])
  })

  it('shows the flag beside every name, and beside the chosen one', async () => {
    const user = userEvent.setup()
    const { view } = renderPicker({ value: 'Japan' })

    // Once beside the field, because a country is chosen…
    expect(view.container.querySelector('[aria-hidden="true"]')?.textContent).toBe(flagFor('JP'))
    // …and once on its row in the list.
    await user.click(screen.getByRole('combobox'))
    expect(screen.getByRole('option', { name: /japan/i }).textContent).toContain(flagFor('JP'))
  })

  it('reports the country when one is chosen with the pointer', async () => {
    const user = userEvent.setup()
    const { onChange } = renderPicker({ value: 'jor' })

    await user.click(screen.getByRole('combobox'))
    await user.click(screen.getByRole('option', { name: /jordan/i }))

    expect(onChange).toHaveBeenCalledWith('Jordan')
  })

  it('says nothing matches rather than showing an empty list', async () => {
    const user = userEvent.setup()
    renderPicker({ value: 'Jappan' })

    await user.click(screen.getByRole('combobox'))

    expect(options()).toEqual([])
    expect(
      within(screen.getByRole('listbox')).getByText(/no country matches that/i)
    ).toBeInTheDocument()
  })

  it('says the list is still coming rather than pretending it is empty', async () => {
    const user = userEvent.setup()
    renderPicker({ countries: undefined, selected: undefined })

    await user.click(screen.getByRole('combobox'))

    expect(
      within(screen.getByRole('listbox')).getByText(/loading the country list/i)
    ).toBeInTheDocument()
  })

  // FR-014. The requirement most likely to be quietly skipped, so it is the
  // one with the most tests: everything below is done without a pointer.
  describe('by keyboard alone', () => {
    it('opens, moves and chooses', async () => {
      const user = userEvent.setup()
      const { onChange } = renderPicker({ value: 'j' })

      await user.tab()
      expect(screen.getByRole('combobox')).toHaveFocus()
      // Focus opens the list on its first match, so one step lands on the
      // second: Japan, then Jordan.
      await user.keyboard('{ArrowDown}')
      await user.keyboard('{Enter}')

      expect(onChange).toHaveBeenCalledWith('Jordan')
    })

    it('wraps around the ends rather than stopping dead', async () => {
      const user = userEvent.setup()
      const { onChange } = renderPicker({ value: 'j' })

      await user.tab() // open, on Japan
      await user.keyboard('{ArrowUp}') // past the top, round to the last one
      await user.keyboard('{Enter}')

      expect(onChange).toHaveBeenCalledWith('Jordan')
    })

    it('closes on Escape without choosing anything', async () => {
      const user = userEvent.setup()
      const { onChange } = renderPicker({ value: 'jap' })

      await user.tab()
      await user.keyboard('{ArrowDown}')
      expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'true')

      await user.keyboard('{Escape}')
      expect(screen.getByRole('combobox')).toHaveAttribute('aria-expanded', 'false')
      expect(onChange).not.toHaveBeenCalled()
    })

    it('leaves Enter to the form when the list is shut', async () => {
      const user = userEvent.setup()
      const submit = vi.fn((e: React.FormEvent) => e.preventDefault())
      render(
        <form onSubmit={submit}>
          <CountryPicker
            id="trip-country"
            value="Japan"
            onChange={vi.fn()}
            countries={COUNTRIES}
            selected={COUNTRIES[0]}
          />
          <button type="submit">Save</button>
        </form>
      )

      const field = screen.getByRole('combobox')
      field.focus()
      await user.keyboard('{Escape}')
      await user.keyboard('{Enter}')

      expect(submit).toHaveBeenCalled()
    })
  })

  // What a sighted user reads off the list length has to reach everyone else.
  describe('what it announces', () => {
    it('counts the matches, and says so as the count changes', async () => {
      const user = userEvent.setup()
      const { view } = renderPicker({ value: '' })

      await user.click(screen.getByRole('combobox'))
      const live = view.container.querySelector('[aria-live="polite"]')
      expect(live?.textContent).toBe('4 countries')

      view.rerender(
        <CountryPicker
          id="trip-country"
          value="jap"
          onChange={vi.fn()}
          countries={COUNTRIES}
          selected={undefined}
        />
      )
      expect(view.container.querySelector('[aria-live="polite"]')?.textContent).toBe('1 country')
    })

    it('says when nothing matches', async () => {
      const user = userEvent.setup()
      const { view } = renderPicker({ value: 'Jappan' })

      await user.click(screen.getByRole('combobox'))

      expect(view.container.querySelector('[aria-live="polite"]')?.textContent).toMatch(
        /no country matches/i
      )
    })

    it('wires the combobox to its list, its highlight and its error', async () => {
      const user = userEvent.setup()
      renderPicker({ value: 'jap', invalid: true, describedBy: 'trip-country-error' })
      const field = screen.getByRole('combobox')

      expect(field).toHaveAttribute('aria-controls', 'trip-country-list')
      expect(field).toHaveAttribute('aria-autocomplete', 'list')
      expect(field).toHaveAttribute('aria-invalid', 'true')
      expect(field).toHaveAttribute('aria-describedby', 'trip-country-error')

      await user.click(field)
      await user.keyboard('{ArrowDown}')
      expect(field).toHaveAttribute('aria-activedescendant', 'trip-country-option-JP')
    })

    it('marks the chosen country as the selected option', async () => {
      const user = userEvent.setup()
      renderPicker({ value: 'Japan' })

      await user.click(screen.getByRole('combobox'))

      expect(screen.getByRole('option', { name: /japan/i })).toHaveAttribute(
        'aria-selected',
        'true'
      )
    })
  })
})

describe('flagFor', () => {
  it('turns a code into its flag', () => {
    expect(flagFor('JP')).toBe('🇯🇵')
    expect(flagFor('pt')).toBe('🇵🇹')
  })

  it('hands back anything that is not a code, rather than drawing nonsense', () => {
    expect(flagFor('Japan')).toBe('Japan')
    expect(flagFor('')).toBe('')
    expect(flagFor(null)).toBe('')
  })
})
