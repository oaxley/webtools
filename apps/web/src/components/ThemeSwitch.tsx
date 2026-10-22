import { useTheme, type ThemePreference } from '../theme'
import './ThemeSwitch.css'

const OPTIONS: { value: ThemePreference; label: string; icon: React.ReactNode }[] = [
  {
    value: 'system',
    label: 'System theme',
    icon: (
      <>
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </>
    ),
  },
  {
    value: 'light',
    label: 'Light theme',
    icon: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </>
    ),
  },
  {
    value: 'dark',
    label: 'Dark theme',
    icon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  },
]

/** Three-way System / Light / Dark switch (toggle buttons). */
export function ThemeSwitch() {
  const { preference, setPreference } = useTheme()
  return (
    <div className="theme-switch" role="group" aria-label="Colour theme">
      {OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={preference === o.value}
          title={o.label}
          className="theme-switch-option"
          onClick={() => setPreference(o.value)}
        >
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            focusable="false"
          >
            {o.icon}
          </svg>
          <span className="sr-only">{o.label}</span>
        </button>
      ))}
    </div>
  )
}
