import { lazy, Suspense } from 'react'

// Loaded on demand: the page carries the QR code encoder, which no other
// page needs.
const TotpTool = lazy(() => import('./TotpTool.tsx'))

export default function TotpToolRoute() {
  return (
    <Suspense fallback={<main className="tool-main" />}>
      <TotpTool />
    </Suspense>
  )
}
