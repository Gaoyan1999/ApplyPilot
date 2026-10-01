import App from './App.tsx'
import { TasksPage } from './pages/TasksPage.tsx'
import { ContextPage } from './pages/ContextPage.tsx'
import { useHashRoute } from './hooks/useHashRoute.ts'

export function Root() {
  const path = useHashRoute()
  if (path === '/tasks') return <TasksPage />
  if (path === '/context') return <ContextPage />
  return <App />
}
