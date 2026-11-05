import { lazy, Suspense } from 'react'

// Loaded on demand: the page carries the pre-highlighted endpoint
// reference (~110 KB), which no other page needs.
const ApiPage = lazy(() => import('./ApiPage.tsx'))

export default function ApiPageRoute() {
  return (
    <Suspense fallback={<main className="post-page" />}>
      <ApiPage />
    </Suspense>
  )
}
