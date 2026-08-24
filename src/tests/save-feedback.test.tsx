// Feedback for writes: something moves while the request is out, and something
// is said when it lands. Both are read off the mutation cache rather than
// wired into each form, so this exercises the cache, not any one screen.
import { QueryClientProvider, useMutation } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { queryClient } from '../api/queryClient'
import { Feedback } from '../components/Feedback'
import { resetToasts } from '../lib/toast'

const later = <T,>(value: T, ms: number, reject = false) =>
  new Promise<T>((resolve, rejectIt) =>
    setTimeout(() => (reject ? rejectIt(value) : resolve(value)), ms)
  )

interface HarnessProps {
  run: () => Promise<unknown>
  meta?: Record<string, unknown>
}

/** One button wired to one mutation — whatever a screen would do. */
function SaveButton({ run, meta }: HarnessProps) {
  const mutation = useMutation({ mutationFn: run, meta })
  return (
    <button type="button" onClick={() => mutation.mutate()}>
      Save
    </button>
  )
}

function renderHarness(props: HarnessProps) {
  // The app's own client, the one carrying the MutationCache under test — the
  // mutation and the Feedback host have to share it.
  return render(
    <QueryClientProvider client={queryClient}>
      <SaveButton {...props} />
      <Feedback />
    </QueryClientProvider>
  )
}

afterEach(() => {
  resetToasts()
  queryClient.getMutationCache().clear()
})

describe('feedback for a write', () => {
  it('shows that something is happening while the request is out', async () => {
    const user = userEvent.setup()
    renderHarness({ run: () => later('ok', 600), meta: { success: 'Place saved' } })

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Working…')).toBeInTheDocument()
    expect(await screen.findByText('Place saved')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Working…')).not.toBeInTheDocument())
  })

  it('says nothing on success when the mutation named no line', async () => {
    const user = userEvent.setup()
    renderHarness({ run: () => later('ok', 10) })

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(queryClient.isMutating()).toBe(0))
    expect(screen.queryByRole('button', { name: /saved/i })).not.toBeInTheDocument()
  })

  it('reports a failure even when nothing is left on screen to hold it', async () => {
    const user = userEvent.setup()
    renderHarness({
      run: () => later(new ApiError(0, 'NETWORK', 'No connection'), 10, true),
      meta: { success: 'Place deleted' },
    })

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText("That didn't save — try again.")).toBeInTheDocument()
    expect(screen.queryByText('Place deleted')).not.toBeInTheDocument()
  })

  it('shows the rule that was broken when the server names one', async () => {
    const user = userEvent.setup()
    renderHarness({
      run: () =>
        later(
          new ApiError(400, 'VALIDATION', 'Validation failed', ['title must not be empty']),
          10,
          true
        ),
    })

    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('title must not be empty')).toBeInTheDocument()
  })

  it('leaves the mutations that report themselves alone', async () => {
    const user = userEvent.setup()
    renderHarness({
      run: () => later(new ApiError(500, 'INTERNAL', 'Boom'), 10, true),
      meta: { toast: false },
    })

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(queryClient.isMutating()).toBe(0))
    expect(screen.queryByText("That didn't save — try again.")).not.toBeInTheDocument()
  })

  it('collapses a repeated failure into one line', async () => {
    const user = userEvent.setup()
    renderHarness({ run: () => later(new ApiError(500, 'INTERNAL', 'Boom'), 10, true) })

    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText("That didn't save — try again.")
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(queryClient.isMutating()).toBe(0))
    expect(screen.getAllByText("That didn't save — try again.")).toHaveLength(1)
  })
})
