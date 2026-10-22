/**
 * Light/dark theme handling.
 *
 * The user's choice ('system' | 'light' | 'dark') lives in localStorage;
 * the *resolved* theme is written to `<html data-theme>`, which every
 * stylesheet keys off. An inline script in index.html applies it before
 * first paint (no flash); this module keeps it in sync afterwards and
 * lets components subscribe (e.g. canvas drawings that read CSS vars).
 */
import { useCallback, useSyncExternalStore } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark'
export type ResolvedTheme = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'webtools:theme'

const DARK_QUERY = '(prefers-color-scheme: dark)'
const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: '#ffffff',
  dark: '#14121c',
}

function readPreference(): ThemePreference {
  try {
    const v = localStorage.getItem(THEME_STORAGE_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    // Storage unavailable: fall through to system.
  }
  return 'system'
}

function resolve(pref: ThemePreference): ResolvedTheme {
  if (pref !== 'system') return pref
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

const listeners = new Set<() => void>()
let preference: ThemePreference = readPreference()
let resolved: ResolvedTheme = resolve(preference)

function apply(animate: boolean) {
  const root = document.documentElement
  const next = resolve(preference)
  if (animate && next !== resolved) {
    root.classList.add('theme-transition')
    window.setTimeout(() => root.classList.remove('theme-transition'), 250)
  }
  resolved = next
  root.dataset.theme = resolved
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', THEME_COLORS[resolved])
  listeners.forEach((l) => l())
}

window.matchMedia(DARK_QUERY).addEventListener('change', () => {
  if (preference === 'system') apply(true)
})

// Keep tabs in sync when the preference changes elsewhere.
window.addEventListener('storage', (e) => {
  if (e.key !== THEME_STORAGE_KEY) return
  preference = readPreference()
  apply(true)
})

apply(false)

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setThemePreference(next: ThemePreference) {
  preference = next
  try {
    if (next === 'system') localStorage.removeItem(THEME_STORAGE_KEY)
    else localStorage.setItem(THEME_STORAGE_KEY, next)
  } catch {
    // Not persisted, but still applied for this page view.
  }
  apply(true)
}

/** Current preference + resolved theme, re-rendering on change. */
export function useTheme() {
  const pref = useSyncExternalStore(subscribe, () => preference)
  const theme = useSyncExternalStore(subscribe, () => resolved)
  const setPreference = useCallback((p: ThemePreference) => setThemePreference(p), [])
  return { preference: pref, theme, setPreference }
}
