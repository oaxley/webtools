import { lazy, Suspense } from 'react'

// Loaded on demand: the page carries Faker and its English data (a few
// hundred KB), which no other page needs.
const FakeDataGenerator = lazy(() => import('./FakeDataGenerator.tsx'))

export default function FakeDataGeneratorRoute() {
  return (
    <Suspense fallback={<main className="tool-main" />}>
      <FakeDataGenerator />
    </Suspense>
  )
}
