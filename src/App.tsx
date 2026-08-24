import { QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from 'react-router-dom'
import { queryClient } from './api/queryClient'
import { Feedback } from './components/Feedback'
import { router } from './router'

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      {/* Outside the router on purpose: a save survives the navigation that
          often follows it, and its confirmation should too. */}
      <Feedback />
    </QueryClientProvider>
  )
}
