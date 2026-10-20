import { useEffect, useState } from 'react'
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
import CopyJsonButton from '../components/CopyJsonButton'
import './NanoIdGenerator.css'

interface Settings {
  alphabet: NanoIdAlphabet
  size: number
  count: number
}

const DEFAULTS: Settings = {
  alphabet: 'url',
  size: NANOID_DEFAULT_SIZE,
  count: 5,
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
function collisionHint(size: number, alphabet: NanoIdAlphabet): string {
  const bits = nanoIdEntropyBits(size, alphabet)
  const log10 =
    0.5 * Math.log10(2 * Math.log(1 / 0.99)) + (bits / 2) * Math.log10(2)
  return (
    `${Math.round(bits)} bits of entropy: about ${formatFromLog10(log10)} ` +
    'IDs before a 1% chance of a duplicate.'
  )
}

function NanoIdGenerator() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  // The size field is edited as free text; only valid sizes regenerate.
  const [sizeInput, setSizeInput] = useState(String(DEFAULTS.size))
  // Generation runs entirely in the browser via @webtools/core — no
  // network round-trip, nothing logged server-side.
  const [ids, setIds] = useState<string[]>(() => generateNanoIds(DEFAULTS))

  useEffect(() => {
    document.title = 'NanoID Generator — WebTools'
  }, [])

  const regenerate = (next: Settings) => {
    setSettings(next)
    setIds(generateNanoIds(next))
  }

  const update = (patch: Partial<Settings>) =>
    regenerate({ ...settings, ...patch })

  const parsedSize = Number(sizeInput)
  const sizeValid = sizeInput.trim() !== '' && isValidSize(parsedSize)

  const counts = Array.from({ length: MAX_NANOID_COUNT }, (_, i) => i + 1)

  return (
    <main className="tool-page nanoid-page">
      <h1>NanoID Generator</h1>
      <p className="tool-lede">
        Generate compact, URL-friendly random identifiers, up to{' '}
        {MAX_NANOID_COUNT} at a time. The default 21-character ID is about
        as collision-resistant as a v4 UUID.
      </p>

      <form
        className="nanoid-controls"
        onSubmit={(e) => {
          e.preventDefault()
          if (sizeValid) regenerate({ ...settings, size: parsedSize })
        }}
      >
        <label className="nanoid-field">
          Alphabet
          <select
            value={settings.alphabet}
            onChange={(e) =>
              update({ alphabet: e.target.value as NanoIdAlphabet })
            }
          >
            {NANOID_ALPHABET_NAMES.map((name) => (
              <option key={name} value={name}>
                {ALPHABET_LABELS[name]}
              </option>
            ))}
          </select>
        </label>

        <label className="nanoid-field">
          Size
          <input
            type="number"
            inputMode="numeric"
            min={NANOID_MIN_SIZE}
            max={NANOID_MAX_SIZE}
            step={1}
            value={sizeInput}
            aria-invalid={!sizeValid}
            className={sizeValid ? undefined : 'nanoid-invalid'}
            onChange={(e) => {
              setSizeInput(e.target.value)
              const size = Number(e.target.value)
              if (e.target.value.trim() !== '' && isValidSize(size)) {
                update({ size })
              }
            }}
          />
        </label>

        <label className="nanoid-field">
          Count
          <select
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

        <button type="submit" className="nanoid-generate" disabled={!sizeValid}>
          Generate
        </button>
      </form>

      <p className="nanoid-hint" role={sizeValid ? undefined : 'alert'}>
        {sizeValid
          ? collisionHint(settings.size, settings.alphabet)
          : `Size must be a whole number between ${NANOID_MIN_SIZE} and ${NANOID_MAX_SIZE}.`}
      </p>

      <section className="nanoid-results" aria-label="Generated NanoIDs">
        <div className="nanoid-results-header">
          <h2>
            {ids.length} ID{ids.length > 1 ? 's' : ''} ({settings.size} chars,{' '}
            {NANOID_ALPHABETS[settings.alphabet].length}-symbol alphabet)
          </h2>
          <CopyJsonButton text={ids.join('\n')} label="Copy all" size="sm" />
        </div>
        <ol className="nanoid-list">
          {ids.map((id, i) => (
            // Short IDs over tiny alphabets can repeat, so key by position.
            <li key={`${i}-${id}`} className="nanoid-row">
              <code className="nanoid-value">{id}</code>
              <CopyJsonButton
                text={id}
                label="Copy"
                size="sm"
                ariaLabel={`Copy ${id}`}
              />
            </li>
          ))}
        </ol>
      </section>
    </main>
  )
}

export default NanoIdGenerator
