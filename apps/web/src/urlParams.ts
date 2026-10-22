/**
 * Small helpers for tool settings stored in the query string, so a
 * configured tool can be linked to (`/uuid?version=4&count=3`).
 */

/** Integer param within [min, max], or undefined when absent/invalid. */
export function readInt(
  params: URLSearchParams,
  key: string,
  min: number,
  max: number,
): number | undefined {
  const raw = params.get(key)
  if (raw === null || raw.trim() === '') return undefined
  const n = Number(raw)
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined
}

/** `1`/`true` → true, `0`/`false` → false, anything else → undefined. */
export function readBool(params: URLSearchParams, key: string): boolean | undefined {
  const raw = params.get(key)?.toLowerCase()
  if (raw === '1' || raw === 'true') return true
  if (raw === '0' || raw === 'false') return false
  return undefined
}

/**
 * Copy of `prev` with `values` written in: entries equal to their default
 * are removed so the URL stays short. Booleans are written as 1/0.
 */
export function writeParams<T extends object>(
  prev: URLSearchParams,
  values: T,
  defaults: T,
): URLSearchParams {
  const next = new URLSearchParams(prev)
  for (const key of Object.keys(values) as (keyof T & string)[]) {
    const value = values[key]
    if (value === defaults[key]) next.delete(key)
    else next.set(key, typeof value === 'boolean' ? (value ? '1' : '0') : String(value))
  }
  return next
}

/**
 * Read `key` from the URL fragment (`#key=value`). For sensitive inputs
 * (tokens, certificates): fragments are never sent to the server nor in
 * Referer headers. Pair with `clearFragment()` once the value is used,
 * so it doesn't stay in the address bar or in copied links.
 */
export function readFragmentParam(key: string): string | undefined {
  if (typeof window === 'undefined' || !window.location.hash) return undefined
  const value = new URLSearchParams(window.location.hash.slice(1)).get(key)
  return value === null || value.trim() === '' ? undefined : value
}

/** Drop the fragment from the address bar without a navigation. */
export function clearFragment(): void {
  if (!window.location.hash) return
  const { pathname, search } = window.location
  window.history.replaceState(window.history.state, '', pathname + search)
}
