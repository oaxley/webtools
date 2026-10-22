import { useId } from 'react'

/**
 * WebTools logo: `< >` chevrons around a spark, on a purple tile.
 * Keep in sync with public/favicon.svg and public/logo.svg.
 */
export function LogoMark({ size = 28 }: { size?: number }) {
  // Unique gradient id: several marks can be on the page at once.
  const gradientId = useId()
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#b45cff" />
          <stop offset="1" stopColor="#7a16c4" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="8" fill={`url(#${gradientId})`} />
      <path
        d="M10 10 4.5 16l5.5 6M22 10l5.5 6-5.5 6"
        stroke="#fff"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="m16 11.2 1.25 3.55L20.8 16l-3.55 1.25L16 20.8l-1.25-3.55L11.2 16l3.55-1.25z"
        fill="#fff"
      />
    </svg>
  )
}

/** Mark + "WebTools" wordmark. Colours follow the theme tokens. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <span className="logo">
      <LogoMark size={size} />
      <span className="logo-word">
        Web<span className="logo-word-accent">Tools</span>
      </span>
    </span>
  )
}
