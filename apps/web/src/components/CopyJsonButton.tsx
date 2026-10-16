import { useEffect, useRef, useState } from 'react'
import './CopyJsonButton.css'

type CopyState = 'idle' | 'copied' | 'error'

interface CopyJsonButtonProps {
  /** The value to serialise and copy. Pretty-printed with 2-space indent. */
  data?: unknown
  /** Plain text to copy verbatim instead of serialising `data`. */
  text?: string
  /** Label shown next to the icon in the idle state. */
  label?: string
  /** Disable the button (e.g. when there's nothing meaningful to copy yet). */
  disabled?: boolean
  /** Visual size. `sm` fits in a title row next to a heading. */
  size?: 'sm' | 'md'
  /** Accessible name — defaults to the label. */
  ariaLabel?: string
  /** Extra class names appended to the base button class. */
  className?: string
}

/**
 * A small "Copy JSON" button that serialises `data` with `JSON.stringify`
 * (pretty-printed) and writes it to the clipboard. Flashes a check icon
 * and a "Copied" label for ~1.6 s after a successful copy.
 *
 * Falls back to a hidden textarea + `document.execCommand('copy')` in
 * environments without the async clipboard API (e.g. non-secure contexts).
 */
function CopyJsonButton({
  data,
  text,
  label = 'Copy JSON',
  disabled = false,
  size = 'md',
  ariaLabel,
  className,
}: CopyJsonButtonProps) {
  const [state, setState] = useState<CopyState>('idle')
  const resetRef = useRef<number | null>(null)

  // Any pending reset timer must not fire after unmount.
  useEffect(() => {
    return () => {
      if (resetRef.current !== null) {
        window.clearTimeout(resetRef.current)
      }
    }
  }, [])

  const flash = (next: Exclude<CopyState, 'idle'>) => {
    setState(next)
    if (resetRef.current !== null) {
      window.clearTimeout(resetRef.current)
    }
    resetRef.current = window.setTimeout(() => {
      setState('idle')
      resetRef.current = null
    }, 1600)
  }

  const handleClick = async () => {
    const json = text ?? JSON.stringify(data, null, 2)
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(json)
      } else {
        // Fallback for non-secure contexts and older browsers.
        const ta = document.createElement('textarea')
        ta.value = json
        ta.setAttribute('readonly', '')
        ta.style.position = 'absolute'
        ta.style.left = '-9999px'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
      }
      flash('copied')
    } catch {
      flash('error')
    }
  }

  const title =
    state === 'copied' ? 'Copied!' : state === 'error' ? 'Copy failed' : label

  const displayLabel =
    state === 'copied' ? 'Copied' : state === 'error' ? 'Failed' : label

  const classes = [
    'copy-json-button',
    size === 'sm' ? 'copy-json-button--sm' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <button
      type="button"
      className={classes}
      onClick={handleClick}
      disabled={disabled}
      aria-label={ariaLabel ?? label}
      title={title}
    >
      {state === 'copied' ? (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
      <span className="copy-json-label">{displayLabel}</span>
    </button>
  )
}

export default CopyJsonButton
