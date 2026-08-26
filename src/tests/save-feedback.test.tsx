// Feedback for writes: something moves while the request is out, and something
// is said when it lands. Both are read off the mutation cache rather than
// wired into each form, so this exercises the cache, not any one screen.
import { QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
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

describe('when the toast is allowed to speak', () => {
  /**
   * The bug this pins: "Saved" appearing a beat before the saved thing does.
   * A mutation returns its invalidations, query-core awaits them, and only
   * then does the MutationCache's `onSettled` say anything — so the
   * confirmation and the new value land together, however slow the refetch.
   */
  function Screen() {
    const { data } = useQuery({
      queryKey: ['thing'],
      queryFn: () => later(state.value, state.fetchMs),
      staleTime: 60_000,
    })
    const save = useMutation({
      meta: { success: 'Place saved' },
      mutationFn: async () => {
        state.value = 'new' // the server now holds the new value
        state.fetchMs = state.refetchMs // …and the read back is however slow
        return 'ok'
      },
      // What every mutation in api/mutations.ts does, via `refreshed`.
      onSuccess: () =>
        Promise.race([
          queryClient.invalidateQueries({ queryKey: ['thing'] }),
          later(undefined, 500),
        ]),
    })
    return (
      <>
        <p data-testid="value">{data ?? '—'}</p>
        <button type="button" onClick={() => save.mutate()}>
          Save
        </button>
      </>
    )
  }

  const state = { value: 'old', fetchMs: 0, refetchMs: 0 }

  beforeEach(() => {
    state.value = 'old'
    state.fetchMs = 0
    state.refetchMs = 0
  })

  afterEach(() => {
    queryClient.clear()
  })

  it('waits for the refetched value to be on screen', async () => {
    state.refetchMs = 300 // comfortably inside the grace period
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <Screen />
        <Feedback />
      </QueryClientProvider>
    )
    await waitFor(() => expect(screen.getByTestId('value')).toHaveTextContent('old'))

    await user.click(screen.getByRole('button', { name: 'Save' }))

    // The moment the toast appears, the screen must already agree with it.
    await screen.findByText('Place saved', {}, { timeout: 2000 })
    expect(screen.getByTestId('value')).toHaveTextContent('new')
  })

  it('does not hold the confirmation hostage to a slow refetch', async () => {
    // The other half of the trade. Waiting is right when the refetch is cheap
    // and wrong when it isn't: a cold serverless function or a train can make
    // it seconds, and a form sitting in "Saving…" long after the save landed
    // is a worse lie than an early toast. Past the grace period the write
    // stops waiting — the refetch still lands, the screen still catches up.
    state.refetchMs = 4000 // a cold function, or a tunnel
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={queryClient}>
        <Screen />
        <Feedback />
      </QueryClientProvider>
    )
    await waitFor(() => expect(screen.getByTestId('value')).toHaveTextContent('old'))

    const startedAt = Date.now()
    await user.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Place saved', {}, { timeout: 3000 })
    expect(Date.now() - startedAt).toBeLessThan(3000)
  })

  it('still says so when there is nothing to refetch', async () => {
    // A mutation with no invalidations resolves immediately — the toast must
    // not wait for something that will never happen.
    const user = userEvent.setup()
    renderHarness({ run: () => later('ok', 10), meta: { success: 'Reminder set' } })
    await user.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Reminder set')).toBeInTheDocument()
  })
})
