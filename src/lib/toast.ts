// Transient feedback for things that happen away from the screen: a save that
// went through, a delete that didn't.
//
// A module-level store rather than a React context, because the thing that
// knows a mutation finished is the QueryClient's MutationCache (api/queryClient
// .ts) — a callback that runs outside the tree and has no hook to reach for.
// Components read it through useSyncExternalStore in components/Feedback.tsx.

export type ToastTone = 'success' | 'error'

export interface Toast {
  id: number
  tone: ToastTone
  message: string
}

/** How long a toast stays up. An error gets longer: it may need re-reading. */
const LIFETIME: Record<ToastTone, number> = { success: 3200, error: 6000 }

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()
const timers = new Map<number, ReturnType<typeof setTimeout>>()

const emit = () => listeners.forEach((listener) => listener())

export function subscribeToToasts(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export const getToasts = () => toasts

export function dismissToast(id: number) {
  const timer = timers.get(id)
  if (timer) {
    clearTimeout(timer)
    timers.delete(id)
  }
  if (!toasts.some((toast) => toast.id === id)) return
  toasts = toasts.filter((toast) => toast.id !== id)
  emit()
}

/**
 * Show one. Repeats collapse: retrying a failing save three times should read
 * as one problem, not three stacked copies of the same sentence.
 */
export function showToast(tone: ToastTone, message: string): number {
  const duplicate = toasts.find((toast) => toast.tone === tone && toast.message === message)
  if (duplicate) {
    dismissToast(duplicate.id)
  }
  const id = nextId++
  toasts = [...toasts, { id, tone, message }]
  timers.set(
    id,
    setTimeout(() => dismissToast(id), LIFETIME[tone])
  )
  emit()
  return id
}

/** Test seam — nothing in the app clears the whole stack. */
export function resetToasts() {
  timers.forEach((timer) => clearTimeout(timer))
  timers.clear()
  toasts = []
  emit()
}
