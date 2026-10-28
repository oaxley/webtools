/**
 * Non-component helpers shared by decoder pages.
 *
 * These live in a plain `.ts` module so react-refresh keeps working on
 * `decoderShared.tsx` (fast refresh only tracks component-only modules).
 */

/**
 * Scroll a field-guide entry into view and briefly flash it.
 */
export function jumpToFieldGuide(anchor: string) {
  const target = document.getElementById(anchor)
  if (!target) return
  target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  target.classList.remove('field-flash')
  // Force reflow so re-adding the class restarts the animation.
  void target.offsetWidth
  target.classList.add('field-flash')
}

/**
 * Flash the matching value line in a decoded block and scroll it into
 * view. The `flashAttr` argument must match the one used when rendering
 * the block.
 */
export function flashInJson(key: string, flashAttr = 'data-claim') {
  const el = document.querySelector<HTMLElement>(
    `[${flashAttr}="${cssEscape(key)}"]`,
  )
  if (!el) return
  el.classList.remove('claim-flash')
  void el.offsetWidth
  el.classList.add('claim-flash')
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

/**
 * Minimal CSS attribute-value escaping. The decoder keys we flash are
 * well-known identifiers (claim names, field keys) and don't contain
 * selector metacharacters, but this keeps the helper safe for future
 * callers that might pass arbitrary strings.
 */
function cssEscape(s: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(s)
  }
  return s.replace(/["\\]/g, '\\$&')
}
