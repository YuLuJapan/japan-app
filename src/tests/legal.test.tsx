// The terms and privacy pages, and getting back from them.
//
// The interesting case is the one that was wrong: a signed-in reader opens the
// terms from the "Before you start" screen and taps Back. Sending them to
// /gate meant a flash of the sign-in screen while its session check ran, then
// a bounce onward to where they already were.
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { Privacy, Terms } from '../pages/Legal'
import { CONTACT_EMAIL } from '../lib/legal'

const mocks = vi.hoisted(() => ({ navigate: vi.fn() }))

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => mocks.navigate,
}))

/** Two entries, so the terms page has somewhere to go back to. */
const renderFromApp = () =>
  render(
    <MemoryRouter initialEntries={['/trips', '/terms']} initialIndex={1}>
      <Routes>
        <Route path="/terms" element={<Terms />} />
        <Route path="/trips" element={<p>the app</p>} />
      </Routes>
    </MemoryRouter>
  )

/** One entry: opened cold, from a link in an email. */
const renderCold = () =>
  render(
    <MemoryRouter initialEntries={['/terms']}>
      <Routes>
        <Route path="/terms" element={<Terms />} />
      </Routes>
    </MemoryRouter>
  )

describe('getting back from the terms', () => {
  it('returns to the screen you came from, not to the gate', async () => {
    const user = userEvent.setup()
    renderFromApp()
    await user.click(screen.getByRole('button', { name: /back/i }))
    expect(mocks.navigate).toHaveBeenCalledWith(-1)
  })

  it('falls back to the gate when there is nothing to go back to', async () => {
    // Opened straight from a link, so history has no previous entry.
    mocks.navigate.mockClear()
    const user = userEvent.setup()
    renderCold()
    await user.click(screen.getByRole('button', { name: /back/i }))
    expect(mocks.navigate).toHaveBeenCalledWith('/gate', { replace: true })
  })
})

describe('what the documents say', () => {
  it('warns that trip content is unchecked', () => {
    renderCold()
    expect(screen.getByText(/nothing is checked against an airline/i)).toBeInTheDocument()
  })

  it('gives a contact address, which is the only way to delete an account', () => {
    render(
      <MemoryRouter initialEntries={['/privacy']}>
        <Routes>
          <Route path="/privacy" element={<Privacy />} />
        </Routes>
      </MemoryRouter>
    )
    expect(screen.getByText(/no .delete my account. button yet/i)).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: CONTACT_EMAIL })[0]).toHaveAttribute(
      'href',
      `mailto:${CONTACT_EMAIL}`
    )
  })
})
