import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HeroTitle, splitDestination, splitTitleLines } from '../components/HeroTitle'

describe('splitDestination', () => {
  it('peels the destination off the end of the title', () => {
    expect(splitDestination('Yuval & Luciana in Japan', 'Japan')).toEqual([
      'Yuval & Luciana in ',
      'Japan',
    ])
  })

  it('leaves the title whole when the destination is not its tail', () => {
    expect(splitDestination('A trip', 'Japan')).toEqual(['A trip', ''])
    expect(splitDestination('Yuval & Luciana in Japan')).toEqual(['Yuval & Luciana in Japan', ''])
  })
})

describe('splitTitleLines', () => {
  it('gives the destination its own line, after the travellers', () => {
    expect(splitTitleLines('Yuval and Luciana in Japan', 'Japan')).toEqual({
      names: 'Yuval and Luciana',
      connector: 'in',
      accent: 'Japan',
    })
  })

  it('keeps one line when a single word leads the connector', () => {
    // "Yuval" / "in Japan" would read as a mistake rather than a layout.
    expect(splitTitleLines('Yuval in Japan', 'Japan')).toEqual({
      names: 'Yuval in ',
      connector: '',
      accent: 'Japan',
    })
    expect(splitTitleLines('Trip to Japan', 'Japan')).toEqual({
      names: 'Trip to ',
      connector: '',
      accent: 'Japan',
    })
  })

  it('leaves a name override alone', () => {
    expect(splitTitleLines('Honeymoon', 'Japan')).toEqual({
      names: 'Honeymoon',
      connector: '',
      accent: '',
    })
  })
})

describe('HeroTitle', () => {
  it('breaks after the travellers and accents the destination', () => {
    render(<HeroTitle title="Yuval and Luciana in Japan" destination="Japan" />)
    screen.getByRole('heading', { name: 'Yuval and Luciana in Japan' })
    expect(screen.getByText('Yuval and Luciana')).toHaveClass('block')
    expect(screen.getByText('Japan')).toHaveClass('text-brand')
  })
})
