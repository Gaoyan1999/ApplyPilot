import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Fetches `fetcher` once on mount (and again whenever a value in `deps`
 * changes -- e.g. filter/sort/page params baked into the fetcher closure)
 * and exposes `refresh()` to refetch on-demand -- callers trigger it after a
 * mutation or while something in the background (e.g. a search run) is
 * actively changing the data, rather than polling on a fixed interval
 * regardless of whether anything changed.
 */
export function useRefreshable<T>(fetcher: () => Promise<T>, deps: unknown[] = []) {
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

  // Collapsed to a single string key so the effect dependency array has a
  // fixed length (a spread `...deps` trips the exhaustive-deps lint rule).
  // deps must be JSON-serializable -- true for the primitives/string-arrays
  // callers pass today (filter/sort/page values).
  const depsKey = JSON.stringify(deps)

  // eslint-disable-next-line react-hooks/exhaustive-deps -- depsKey is the intentional, caller-controlled refetch trigger
  useEffect(() => {
    refresh()
  }, [refresh, depsKey])

  return { data, error, refresh }
}
