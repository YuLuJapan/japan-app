import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TripSheet } from '../components/TripSheet'

function renderSheet() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <TripSheet mode="add" onClose={() => {}} />
    </QueryClientProvider>
  )
}

describe('TripSheet travellers', () => {
  it('adds a traveller with just a name', async () => {
    const user = userEvent.setup()
    renderSheet()
    await user.type(screen.getByLabelText('Traveller name'), 'Noa')
    await user.click(screen.getByRole('button', { name: 'Add traveller' }))
    expect(screen.getByText('Noa')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /invite/i })).not.toBeInTheDocument()
  })

  it('adds a traveller with an email and shows a mailto invite link', async () => {
    const user = userEvent.setup()
    renderSheet()
    await user.type(screen.getByLabelText('Traveller name'), 'Noa')
    await user.type(screen.getByLabelText('Traveller email (optional)'), 'noa@example.com')
    await user.click(screen.getByRole('button', { name: 'Add traveller' }))

    const invite = screen.getByRole('link', { name: /invite/i })
    expect(invite.getAttribute('href')).toMatch(/^mailto:noa%40example\.com\?/)
    expect(invite.getAttribute('href')).toContain('subject=')
  })

  it('rejects an invalid email instead of adding the traveller', async () => {
    const user = userEvent.setup()
    renderSheet()
    await user.type(screen.getByLabelText('Traveller name'), 'Noa')
    await user.type(screen.getByLabelText('Traveller email (optional)'), 'not-an-email')
    await user.click(screen.getByRole('button', { name: 'Add traveller' }))

    expect(screen.getByText(/doesn't look like a valid email/i)).toBeInTheDocument()
    expect(screen.queryByText('Noa')).not.toBeInTheDocument()
  })

  it('removes a traveller', async () => {
    const user = userEvent.setup()
    renderSheet()
    await user.type(screen.getByLabelText('Traveller name'), 'Noa')
    await user.click(screen.getByRole('button', { name: 'Add traveller' }))
    expect(screen.getByText('Noa')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove Noa' }))
    expect(screen.queryByText('Noa')).not.toBeInTheDocument()
  })
})
