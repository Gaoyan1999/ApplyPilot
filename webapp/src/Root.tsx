import App from './App.tsx'
import { TasksPage } from './pages/TasksPage.tsx'
import { useHashRoute } from './hooks/useHashRoute.ts'

export function Root() {
  const path = useHashRoute()
  return path === '/tasks' ? <TasksPage /> : <App />
}
