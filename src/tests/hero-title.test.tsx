import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HeroTitle, splitDestination } from '../components/HeroTitle'

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

describe('HeroTitle', () => {
  it('accents the destination and keeps the heading on one line', () => {
    render(<HeroTitle title="Yuval & Luciana in Japan" destination="Japan" />)
    const heading = screen.getByRole('heading', { name: 'Yuval & Luciana in Japan' })
    expect(heading).toHaveClass('whitespace-nowrap')
    expect(screen.getByText('Japan')).toHaveClass('text-brand')
  })
})
