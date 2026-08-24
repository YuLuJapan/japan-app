import { MutationCache, QueryClient } from '@tanstack/react-query'
import { saveErrorMessage } from '../lib/errors'
import { showToast } from '../lib/toast'

/**
 * What a mutation may declare about its own feedback:
 *
 * - `success` — the line to confirm it with. Omit it and nothing is said,
 *   which is right for anything whose result is already on screen.
 * - `toast: false` — this one reports itself. Used by the notification
 *   plumbing, which has its own state next to the switch.
 */
interface MutationFeedback {
  success?: string
  toast?: false
}

const feedbackOf = (meta: unknown): MutationFeedback => (meta ?? {}) as MutationFeedback

// Tuned for slow/intermittent connections while traveling (FR-013):
// previously loaded content stays on screen; refetch-on-focus keeps the other
// traveler's edits visible on next view (FR-018).
export const queryClient = new QueryClient({
  // Feedback for every write, in one place. A save used to be silent from the
  // tap until the list happened to redraw — and a *failed* delete was silent
  // for good, because the confirm dialog had already closed over it and no
  // form was left on screen to hold the error. Reading the outcome off the
  // cache means every mutation is covered, including the ones added next.
  mutationCache: new MutationCache({
    onSuccess: (_data, _variables, _context, mutation) => {
      const { success, toast } = feedbackOf(mutation.meta)
      if (toast === false || !success) return
      showToast('success', success)
    },
    onError: (error, _variables, _context, mutation) => {
      if (feedbackOf(mutation.meta).toast === false) return
      showToast('error', saveErrorMessage(error, "That didn't save — try again."))
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 24 * 60 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
})
