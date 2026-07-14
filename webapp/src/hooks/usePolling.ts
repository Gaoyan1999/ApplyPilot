import { useEffect, useRef, useState } from 'react'

/**
 * Polls `fetcher` on a fixed interval using a setTimeout chain (not
 * setInterval), so a slow request never overlaps with the next tick —
 * relevant since SQLite writes can briefly hold up reads for up to the
 * backend's 10s busy_timeout.
 */
export function usePolling<T>(fetcher: () => Promise<T>, intervalMs = 3000) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    async function tick() {
      try {
        const result = await fetcherRef.current()
        if (!cancelled) {
          setData(result)
          setError(null)
        }
      } catch (e) {
        if (!cancelled) setError(e as Error)
      } finally {
        if (!cancelled) timer = setTimeout(tick, intervalMs)
      }
    }

    tick()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [intervalMs])

  return { data, error }
}
