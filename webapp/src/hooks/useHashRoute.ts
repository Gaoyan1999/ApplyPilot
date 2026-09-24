import { useEffect, useState } from 'react'

function currentPath(): string {
  return window.location.hash.replace(/^#/, '') || '/'
}

/** Minimal hash-based route reader -- no router dependency, no backend
 * change needed since the path never leaves the client. Navigation is just
 * a plain `<a href="#/tasks">`; this hook only re-renders on hashchange. */
export function useHashRoute(): string {
  const [path, setPath] = useState(currentPath)

  useEffect(() => {
    const onHashChange = () => setPath(currentPath())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return path
}
