import { lazy, Suspense } from 'react'

// Loaded on demand: the page carries the 7,776-word EFF list (~25 KB
// gzipped), which no other page needs.
const PasswordGenerator = lazy(() => import('./PasswordGenerator.tsx'))

export default function PasswordGeneratorRoute() {
  return (
    <Suspense fallback={<main className="tool-main" />}>
      <PasswordGenerator />
    </Suspense>
  )
}
