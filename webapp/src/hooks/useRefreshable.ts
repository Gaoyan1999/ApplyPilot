import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Fetches `fetcher` once on mount and exposes `refresh()` to refetch
 * on-demand -- callers trigger it after a mutation or while something in
 * the background (e.g. a search run) is actively changing the data, rather
 * than polling on a fixed interval regardless of whether anything changed.
 */
export function useRefreshable<T>(fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const fetcherRef = useRef(fetcher)
  fetcherRef.current = fetcher

  const refresh = useCallback(async () => {
    try {
      const result = await fetcherRef.current()
      setData(result)
      setError(null)
    } catch (e) {
      setError(e as Error)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { data, error, refresh }
}
