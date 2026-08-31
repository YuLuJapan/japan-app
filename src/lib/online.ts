import { useEffect, useState } from 'react'

/**
 * Whether the browser thinks it has a connection.
 *
 * `navigator.onLine` is the starting answer and the two window events are the
 * updates — polling it would be the same answer at a worse time. Read lazily so
 * the first render is right rather than briefly optimistic.
 *
 * Worth knowing what this does and does not mean: `true` says the device has a
 * network interface, not that anything is reachable. It is exactly right for
 * "should this screen offer to send something", and wrong as a health check.
 */
export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine)

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  return online
}
