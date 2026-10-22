import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  generateNanoIds,
  MAX_NANOID_COUNT,
  NANOID_ALPHABET_NAMES,
  NANOID_ALPHABETS,
  NANOID_DEFAULT_SIZE,
  NANOID_MAX_SIZE,
  NANOID_MIN_SIZE,
  nanoIdEntropyBits,
  type NanoIdAlphabet,
} from '@webtools/core'
import { IdResults } from '../components/IdResults'
import { ToolPage } from '../components/ToolPage'
import { readBool, readInt, writeParams } from '../urlParams'
import './NanoIdGenerator.css'

interface Settings {
  alphabet: NanoIdAlphabet
  size: number
  count: number
  safeEnds: boolean
}

const DEFAULTS: Settings = {
  alphabet: 'url',
  size: NANOID_DEFAULT_SIZE,
  count: 5,
  safeEnds: false,
}

/** Alphabets containing '-' or '_', for which `safeEnds` matters. */
function hasUnsafeEdgeChars(alphabet: NanoIdAlphabet): boolean {
  return /[-_]/.test(NANOID_ALPHABETS[alphabet])
}

const ALPHABET_LABELS: Record<NanoIdAlphabet, string> = {
  url: 'URL-safe (A-Za-z0-9_-)',
  alphanumeric: 'Alphanumeric (A-Za-z0-9)',
  lowercase: 'Lowercase (a-z0-9)',
  numbers: 'Numbers (0-9)',
  hex: 'Hex (0-9a-f)',
  nolookalikes: 'No look-alikes (no 0 O 1 l I)',
}

function isValidSize(size: number): boolean {
  return (
    Number.isInteger(size) && size >= NANOID_MIN_SIZE && size <= NANOID_MAX_SIZE
  )
}

/**
 * Format a number known only by its base-10 logarithm, so very long IDs
 * (whose collision thresholds dwarf `Number.MAX_VALUE`) still render.
 */
function formatFromLog10(log10: number): string {
  if (log10 < 15) {
    return new Intl.NumberFormat('en', {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(Math.max(1, Math.round(10 ** log10)))
  }
  const exponent = Math.floor(log10)
  const mantissa = 10 ** (log10 - exponent)
  return `${mantissa.toFixed(1)} × 10^${exponent}`
}

/**
 * How many IDs can be generated before the chance of a duplicate
 * reaches 1% (birthday bound: n ≈ sqrt(2 · N · ln(1 / (1 − p)))).
 */
function collisionHint(
  size: number,
  alphabet: NanoIdAlphabet,
  safeEnds: boolean,
): string {
  const bits = nanoIdEntropyBits(size, alphabet, safeEnds)
  const log10 =
    0.5 * Math.log10(2 * Math.log(1 / 0.99)) + (bits / 2) * Math.log10(2)
  return (
    `${Math.round(bits)} bits of entropy: about ${formatFromLog10(log10)} ` +
    'IDs before a 1% chance of a duplicate.'
  )
}

/** Settings from `?alphabet=hex&size=12&count=3&safeEnds=1`, else defaults. */
function settingsFromParams(params: URLSearchParams): Settings {
  const alphabet = params.get('alphabet')
  return {
    alphabet: (NANOID_ALPHABET_NAMES as readonly string[]).includes(alphabet ?? '')
      ? (alphabet as NanoIdAlphabet)
      : DEFAULTS.alphabet,
    size: readInt(params, 'size', NANOID_MIN_SIZE, NANOID_MAX_SIZE) ?? DEFAULTS.size,
    count: readInt(params, 'count', 1, MAX_NANOID_COUNT) ?? DEFAULTS.count,
    safeEnds: readBool(params, 'safeEnds') ?? DEFAULTS.safeEnds,
  }
}

function NanoIdGenerator() {
  const [params, setParams] = useSearchParams()
  const [settings, setSettings] = useState<Settings>(() => settingsFromParams(params))
  // The size field is edited as free text; only valid sizes regenerate.
  const [sizeInput, setSizeInput] = useState(String(settings.size))
  // Generation runs entirely in the browser via @webtools/core — no
  // network round-trip, nothing logged server-side.
  const [ids, setIds] = useState<string[]>(() => generateNanoIds(settings))

  const regenerate = (next: Settings) => {
    setSettings(next)
    setIds(generateNanoIds(next))
    setParams((prev) => writeParams(prev, next, DEFAULTS), { replace: true })
  }

  const update = (patch: Partial<Settings>) => regenerate({ ...settings, ...patch })

  const parsedSize = Number(sizeInput)
  const sizeValid = sizeInput.trim() !== '' && isValidSize(parsedSize)
  const edgeMatters = hasUnsafeEdgeChars(settings.alphabet)

  const counts = Array.from({ length: MAX_NANOID_COUNT }, (_, i) => i + 1)

  return (
    <ToolPage
      toolId="nanoid"
      className="nanoid-page"
      lede={`Generate compact, URL-friendly random identifiers, up to ${MAX_NANOID_COUNT} at a time. The default 21-character ID is about as collision-resistant as a v4 UUID.`}
    >
      <form
        className="tool-controls"
        onSubmit={(e) => {
          e.preventDefault()
          if (sizeValid) regenerate({ ...settings, size: parsedSize })
        }}
      >
        <label className="tool-field nanoid-alphabet">
          Alphabet
          <select
            className="tool-input"
            value={settings.alphabet}
            onChange={(e) => update({ alphabet: e.target.value as NanoIdAlphabet })}
          >
            {NANOID_ALPHABET_NAMES.map((name) => (
              <option key={name} value={name}>
                {ALPHABET_LABELS[name]}
              </option>
            ))}
          </select>
        </label>

        <label className="tool-field">
          Size
          <input
            type="number"
            inputMode="numeric"
            className="tool-input nanoid-size"
            min={NANOID_MIN_SIZE}
            max={NANOID_MAX_SIZE}
            step={1}
            value={sizeInput}
            aria-invalid={!sizeValid}
            onChange={(e) => {
              setSizeInput(e.target.value)
              const size = Number(e.target.value)
              if (e.target.value.trim() !== '' && isValidSize(size)) {
                update({ size })
              }
            }}
          />
        </label>

        <label className="tool-field">
          Count
          <select
            className="tool-input"
            value={settings.count}
            onChange={(e) => update({ count: Number(e.target.value) })}
          >
            {counts.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <label
          className="tool-check"
          title="Keep the first and last characters alphanumeric, never '-' or '_'"
        >
          <input
            type="checkbox"
            checked={settings.safeEnds}
            disabled={!edgeMatters}
            onChange={(e) => update({ safeEnds: e.target.checked })}
          />
          Safe ends
        </label>

        <div className="tool-controls-actions">
          <button type="submit" className="button button-primary" disabled={!sizeValid}>
            Generate new
          </button>
        </div>
      </form>

      {sizeValid ? (
        <p className="tool-hint">
          {collisionHint(settings.size, settings.alphabet, settings.safeEnds)}
          {settings.safeEnds && edgeMatters && " Safe ends: never starts or ends with '-' or '_'."}
        </p>
      ) : (
        <p className="tool-hint nanoid-size-error" role="alert">
          Size must be a whole number between {NANOID_MIN_SIZE} and {NANOID_MAX_SIZE}.
        </p>
      )}

      <IdResults
        ids={ids}
        title={`${ids.length} ID${ids.length > 1 ? 's' : ''} (${settings.size} chars, ${NANOID_ALPHABETS[settings.alphabet].length}-symbol alphabet)`}
        ariaLabel="Generated NanoIDs"
      />
    </ToolPage>
  )
}

export default NanoIdGenerator
