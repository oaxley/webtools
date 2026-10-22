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
