/**
 * Shared page for the Base64, Base32 and Base58 tools: input on the left,
 * live result on the right.
 *
 * The three tools live at their own URLs (`/base64`, `/base32`,
 * `/base58`) but render this one component, so they look and behave the
 * same. The text being converted is never written to the URL: it may be
 * a secret. Only the settings are (`/base64?mode=decode&urlsafe=1`).
 */
import { useDeferredValue, useId, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  convertEncoding,
  textToBytes,
  type Base32Variant,
  type BaseEncoding,
  type BytesFormat,
  type ConversionResult,
  type EncodingOperation,
} from '@webtools/core'
import CopyJsonButton from '../components/CopyJsonButton'
import { Examples, SegmentedControl, ToolPage } from '../components/ToolPage'
import { readBool, writeParams } from '../urlParams'
import './EncodingTool.css'

interface EncodingMeta {
  label: string
  lede: string
  examples: { label: string; mode: EncodingOperation; input: string; format?: BytesFormat }[]
}

const META: Record<BaseEncoding, EncodingMeta> = {
  base64: {
    label: 'Base64',
    lede: 'Encode text or bytes as Base64, or decode it back. Standard and URL-safe alphabets, with or without padding. Everything runs in your browser.',
    examples: [
      { label: 'Encode text', mode: 'encode', input: 'Hello, World!' },
      { label: 'Decode Base64', mode: 'decode', input: 'SGVsbG8sIFdvcmxkIQ==' },
      { label: 'JWT header', mode: 'decode', input: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' },
    ],
  },
  base32: {
    label: 'Base32',
    lede: 'Encode text or bytes as Base32, or decode it back. RFC 4648 (used by TOTP secrets) and Crockford alphabets. Everything runs in your browser.',
    examples: [
      { label: 'Encode text', mode: 'encode', input: 'Hello, World!' },
      { label: 'Decode Base32', mode: 'decode', input: 'JBSWY3DPFQQFO33SNRSCC===' },
      { label: 'TOTP secret', mode: 'decode', input: 'JBSWY3DPEHPK3PXP' },
    ],
  },
  base58: {
    label: 'Base58',
    lede: 'Encode text or bytes as Base58, or decode it back. Bitcoin alphabet, as used by addresses, IPFS and Solana keys. Everything runs in your browser.',
    examples: [
      { label: 'Encode text', mode: 'encode', input: 'Hello World!' },
      { label: 'Decode Base58', mode: 'decode', input: '2NEpo7TZRRrLZSi2U' },
      { label: 'Encode hex bytes', mode: 'encode', input: '00eb15231dfceb60925886b67d065299925915aeb172c06647', format: 'hex' },
      { label: 'Address-style value', mode: 'decode', input: '1NS17iag9jJgTHD1VXjvLCEnZuQ3rJDE9L' },
    ],
  },
}

const ENCODINGS: BaseEncoding[] = ['base64', 'base32', 'base58']

interface Settings {
  mode: EncodingOperation
  format: BytesFormat
  urlsafe: boolean
  padding: boolean
  variant: Base32Variant
}

const DEFAULTS: Settings = {
  mode: 'encode',
  format: 'text',
  urlsafe: false,
  padding: true,
  variant: 'rfc4648',
}

function settingsFromParams(params: URLSearchParams): Settings {
  return {
    mode: params.get('mode') === 'decode' ? 'decode' : 'encode',
    format: params.get('format') === 'hex' ? 'hex' : 'text',
    urlsafe: readBool(params, 'urlsafe') ?? DEFAULTS.urlsafe,
    padding: readBool(params, 'padding') ?? DEFAULTS.padding,
    variant: params.get('variant') === 'crockford' ? 'crockford' : 'rfc4648',
  }
}

/**
 * Text handed from one encoding tab to the next. Kept in memory rather
 * than in router state, so it never lands in the browser history.
 */
let carriedInput: string | null = null

function takeCarriedInput(): string {
  const input = carriedInput ?? ''
  carriedInput = null
  return input
}

type Outcome =
  | { ok: true; result: ConversionResult }
  | { ok: false; error: string }
  | null

const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`

function EncodingTool({ encoding }: { encoding: BaseEncoding }) {
  // Keyed so switching tabs remounts with fresh state (and the carried text).
  return <EncodingToolPage key={encoding} encoding={encoding} />
}

function EncodingToolPage({ encoding }: { encoding: BaseEncoding }) {
  const meta = META[encoding]
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [settings, setSettings] = useState<Settings>(() => settingsFromParams(params))
  const [input, setInput] = useState(takeCarriedInput)
  const [showHex, setShowHex] = useState(false)
  const inputId = useId()

  // Base58 is quadratic: keep typing responsive on long input.
  const deferredInput = useDeferredValue(input)

  const update = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    setParams((prev) => writeParams(prev, next, DEFAULTS), { replace: true })
  }

  const outcome: Outcome = useMemo(() => {
    if (deferredInput === '') return null
    try {
      return {
        ok: true,
        result: convertEncoding({
          encoding,
          operation: settings.mode,
          input: deferredInput,
          inputFormat: settings.format,
          options: {
            urlSafe: settings.urlsafe,
            padding: settings.padding,
            variant: settings.variant,
          },
        }),
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Conversion failed.' }
    }
  }, [encoding, settings, deferredInput])

  const decoded = outcome?.ok && outcome.result.operation === 'decode' ? outcome.result : null
  const encoded = outcome?.ok && outcome.result.operation === 'encode' ? outcome.result : null
  // Binary output can't be shown as text: fall back to hex.
  const binary = decoded !== null && decoded.text === null
  const hexView = decoded !== null && (showHex || binary)
  const output = encoded ? encoded.output : decoded ? (hexView ? decoded.hex : decoded.text!) : ''

  const switchEncoding = (next: BaseEncoding) => {
    if (next === encoding) return
    carriedInput = input
    const query = writeParams(
      new URLSearchParams(),
      { mode: settings.mode, format: settings.format },
      { mode: DEFAULTS.mode, format: DEFAULTS.format },
    ).toString()
    navigate(`/${next}${query ? `?${query}` : ''}`, { state: { keepScroll: true } })
  }

  /** Move the result into the input and flip the direction. */
  const swap = () => {
    if (settings.mode === 'encode') {
      update({ mode: 'decode' })
      setInput(encoded?.output ?? '')
    } else {
      update({ mode: 'encode', format: hexView ? 'hex' : 'text' })
      setInput(output)
    }
    setShowHex(false)
  }

  const inputLabel =
    settings.mode === 'decode' ? meta.label : settings.format === 'hex' ? 'Hex bytes' : 'Text'
  const outputLabel = settings.mode === 'encode' ? meta.label : 'Decoded'

  let inputCount = plural(input.length, 'character')
  if (settings.mode === 'encode' && settings.format === 'text') {
    inputCount = plural(textToBytes(input).length, 'byte')
  } else if (encoded) {
    inputCount = plural(encoded.inputBytes, 'byte')
  }

  return (
    <ToolPage toolId={encoding} wide lede={meta.lede} className="encoding-page">
      <div className="encoding-tabs">
        <SegmentedControl
          ariaLabel="Encoding"
          value={encoding}
          options={ENCODINGS.map((e) => ({ value: e, label: META[e].label }))}
          onChange={switchEncoding}
        />
      </div>

      <div className="tool-controls encoding-controls">
        <div className="tool-field">
          Direction
          <SegmentedControl
            ariaLabel="Direction"
            value={settings.mode}
            options={[
              { value: 'encode', label: 'Encode' },
              { value: 'decode', label: 'Decode' },
            ]}
            onChange={(mode) => update({ mode })}
          />
        </div>

        {encoding === 'base32' && (
          <label className="tool-field">
            Alphabet
            <select
              className="tool-input"
              value={settings.variant}
              onChange={(e) => update({ variant: e.target.value as Base32Variant })}
            >
              <option value="rfc4648">RFC 4648</option>
              <option value="crockford">Crockford</option>
            </select>
          </label>
        )}

        {settings.mode === 'encode' && encoding === 'base64' && (
          <label className="tool-check" title="Use - and _ instead of + and /, safe in URLs and file names">
            <input
              type="checkbox"
              checked={settings.urlsafe}
              onChange={(e) => update({ urlsafe: e.target.checked })}
            />
            URL-safe
          </label>
        )}

        {settings.mode === 'encode' && encoding !== 'base58' && (
          <label
            className="tool-check"
            title={
              encoding === 'base32' && settings.variant === 'crockford'
                ? 'Crockford Base32 has no padding'
                : 'Add = characters so the length is a multiple of ' + (encoding === 'base64' ? 4 : 8)
            }
          >
            <input
              type="checkbox"
              checked={settings.padding && !(encoding === 'base32' && settings.variant === 'crockford')}
              disabled={encoding === 'base32' && settings.variant === 'crockford'}
              onChange={(e) => update({ padding: e.target.checked })}
            />
            Padding
          </label>
        )}

        {encoding === 'base58' && (
          <p className="encoding-controls-note">Bitcoin alphabet: no 0, O, I or l.</p>
        )}

        <div className="tool-controls-actions">
          <button
            type="button"
            className="button"
            onClick={swap}
            disabled={!outcome?.ok}
            title="Use the result as the input and flip the direction"
          >
            <span aria-hidden="true">⇄</span> Swap
          </button>
        </div>
      </div>

      <div className="encoding-grid">
        <section className="encoding-panel" aria-label="Input">
          <div className="encoding-panel-head">
            <label htmlFor={inputId} className="encoding-panel-title">
              {inputLabel}
            </label>
            {settings.mode === 'encode' && (
              <SegmentedControl
                ariaLabel="Input format"
                value={settings.format}
                options={[
                  { value: 'text', label: 'Text' },
                  { value: 'hex', label: 'Hex' },
                ]}
                onChange={(format) => update({ format })}
              />
            )}
          </div>
          <textarea
            id={inputId}
            className="encoding-textarea"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              settings.mode === 'decode'
                ? `Paste ${meta.label} here…`
                : settings.format === 'hex'
                  ? 'Paste hex bytes, e.g. 48 65 6c 6c 6f…'
                  : 'Type or paste text to encode…'
            }
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <div className="encoding-panel-foot">
            <span>{inputCount}</span>
            {settings.mode === 'decode' && (
              <span>
                Whitespace{encoding !== 'base58' && ' and missing padding'} ignored
                {encoding === 'base64' && ', both alphabets accepted'}
              </span>
            )}
          </div>
        </section>

        <section className="encoding-panel" aria-label="Result" aria-live="polite">
          <div className="encoding-panel-head">
            <h2 className="encoding-panel-title">{outputLabel}</h2>
            {decoded && (
              <SegmentedControl
                ariaLabel="Show decoded bytes as"
                value={hexView ? 'hex' : 'text'}
                options={[
                  { value: 'text', label: 'Text' },
                  { value: 'hex', label: 'Hex' },
                ]}
                onChange={(view) => setShowHex(view === 'hex')}
              />
            )}
            <CopyJsonButton
              text={output}
              label="Copy"
              size="sm"
              disabled={output === ''}
              ariaLabel={`Copy ${outputLabel.toLowerCase()} output`}
              className="encoding-copy"
            />
          </div>
          {outcome && !outcome.ok ? (
            <div className="error-box encoding-error" role="alert">
              {outcome.error}
            </div>
          ) : (
            <textarea
              className="encoding-textarea encoding-output"
              value={output}
              readOnly
              placeholder="The result appears here as you type."
              aria-label={`${outputLabel} output`}
              spellCheck={false}
            />
          )}
          <div className="encoding-panel-foot">
            <span>
              {encoded && plural(encoded.output.length, 'character')}
              {decoded && plural(decoded.bytes, 'byte')}
            </span>
            {binary && <span>Not valid UTF-8 text, shown as hex</span>}
          </div>
        </section>
      </div>

      <Examples
        items={[
          ...meta.examples.map((ex) => ({
            label: ex.label,
            onClick: () => {
              update({ mode: ex.mode, format: ex.format ?? 'text' })
              setInput(ex.input)
              setShowHex(false)
            },
          })),
          { label: 'Clear', onClick: () => setInput('') },
        ]}
      />

      <section className="field-guide" aria-label="About these encodings">
        <h2>Base64, Base32 or Base58?</h2>
        <p className="field-guide-hint">
          All three turn bytes into printable text. None of them is encryption: anyone can
          decode the result.
        </p>
        <dl>
          <div>
            <dt>Base64</dt>
            <dd>
              64 characters (<code>A–Z a–z 0–9 + /</code>), 4 characters for every 3 bytes
              (+33%). The most compact of the three, used by email attachments, data URLs, PEM
              certificates and HTTP Basic auth. The URL-safe variant swaps <code>+ /</code> for{' '}
              <code>- _</code> and usually drops the <code>=</code> padding; JWTs use it.
            </dd>
          </div>
          <div>
            <dt>Base32</dt>
            <dd>
              32 characters, 8 for every 5 bytes (+60%). Case-insensitive, so it survives being
              read aloud or typed by hand. RFC 4648 (<code>A–Z 2–7</code>) is what TOTP
              authenticator secrets use. Crockford&apos;s alphabet (<code>0–9</code> and letters
              minus <code>I L O U</code>) is used by ULIDs and reads <code>O</code> as 0 and{' '}
              <code>I</code>/<code>L</code> as 1 when decoding.
            </dd>
          </div>
          <div>
            <dt>Base58</dt>
            <dd>
              58 characters: Base64 without <code>0 O I l + /</code>, so there are no look-alikes
              and a double-click selects the whole value. About +37% in size. Leading zero bytes
              become leading <code>1</code>s. Used by Bitcoin addresses, IPFS identifiers and
              Solana keys. The conversion is slow on large inputs, so it&apos;s best for short
              values such as keys and hashes.
            </dd>
          </div>
        </dl>
      </section>
    </ToolPage>
  )
}

export default EncodingTool
