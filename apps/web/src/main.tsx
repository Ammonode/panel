import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registry } from './extensions/registry'
import { makeRouter } from './router'
import './styles/app.css'

// Remember affiliate referrals (?ref=CODE) for the sign up that may follow.
const ref = new URLSearchParams(location.search).get('ref')
if (ref && /^[a-z0-9]{4,32}$/i.test(ref))
  fetch(`/api/affiliates/visit/${ref}`, { method: 'POST', credentials: 'same-origin' }).catch(() => {})

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
})
const router = makeRouter(queryClient)

// Public API for extensions and themes.
;(window as unknown as { Ammonode: unknown }).Ammonode = { registry, queryClient, router }

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
)
