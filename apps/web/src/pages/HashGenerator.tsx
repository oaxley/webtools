/**
 * Hash generator: MD5, SHA-1, SHA-2, SHA-3 and CRC-32 of text or hex
 * bytes, optionally as an HMAC, one algorithm at a time or all at once.
 *
 * Settings live in the query string (`/hash?alg=md5&output=base64`) so a
 * configured page can be linked to. The input and the HMAC key never do:
 * they may be secrets.
 */
import { useDeferredValue, useId, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  computeAllHashes,
  computeHash,
  HASH_ALGORITHMS,
  HASH_INFO,
  textToBytes,
  type AllHashesResult,
  type BytesFormat,
  type DigestFormat,
  type HashAlgorithm,
  type HashResult,
} from '@webtools/core'
import CopyJsonButton from '../components/CopyJsonButton'
import { Examples, SegmentedControl, ToolPage } from '../components/ToolPage'
import { readBool, writeParams } from '../urlParams'
import '../components/IoPanels.css'
import './HashGenerator.css'

type Choice = HashAlgorithm | 'all'

interface Settings {
  alg: Choice
  format: BytesFormat
  output: DigestFormat
  upper: boolean
  hmac: boolean
}

const DEFAULTS: Settings = {
  alg: 'sha256',
  format: 'text',
  output: 'hex',
  upper: false,
  hmac: false,
}

const CHOICES: Choice[] = [...HASH_ALGORITHMS, 'all']

function settingsFromParams(params: URLSearchParams): Settings {
  const alg = params.get('alg')?.toLowerCase()
  return {
    alg: CHOICES.includes(alg as Choice) ? (alg as Choice) : DEFAULTS.alg,
    format: params.get('format') === 'hex' ? 'hex' : 'text',
    output: params.get('output') === 'base64' ? 'base64' : 'hex',
    upper: readBool(params, 'upper') ?? DEFAULTS.upper,
    hmac: readBool(params, 'hmac') ?? DEFAULTS.hmac,
  }
}

const label = (choice: Choice) => (choice === 'all' ? 'All' : HASH_INFO[choice].label)

type Outcome =
  | { ok: true; kind: 'one'; result: HashResult }
  | { ok: true; kind: 'all'; result: AllHashesResult }
  | { ok: false; error: string }

const plural = (n: number, word: string) => `${n.toLocaleString('en-US')} ${word}${n === 1 ? '' : 's'}`

interface Example {
  label: string
  input: string
  format?: BytesFormat
  key?: string
}

const EXAMPLES: Example[] = [
  { label: 'abc', input: 'abc' },
  { label: 'Hello, World!', input: 'Hello, World!' },
  { label: 'Hex bytes', input: 'de ad be ef', format: 'hex' },
  {
    label: 'Webhook signature (HMAC)',
    input: '{"event":"payment.succeeded","id":"evt_123"}',
    key: 'whsec_test_secret',
  },
]

function HashGenerator() {
  const [params, setParams] = useSearchParams()
  const [settings, setSettings] = useState<Settings>(() => settingsFromParams(params))
  const [input, setInput] = useState('')
  const [key, setKey] = useState('')
  const [keyFormat, setKeyFormat] = useState<BytesFormat>('text')
  const inputId = useId()
  const keyId = useId()

  // SHA-3 and "All" take a moment on large pastes: keep typing responsive.
  const deferredInput = useDeferredValue(input)
  const deferredKey = useDeferredValue(key)

  const update = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    setParams((prev) => writeParams(prev, next, DEFAULTS), { replace: true })
  }

  const { alg } = settings
  // CRC-32 is a checksum: it can't be keyed.
  const hmacAvailable = alg === 'all' || HASH_INFO[alg].hmac
  const useHmac = settings.hmac && hmacAvailable

  const outcome: Outcome = useMemo(() => {
    const options = {
      input: deferredInput,
      inputFormat: settings.format,
      outputFormat: settings.output,
      uppercase: settings.upper,
      hmacKey: useHmac ? deferredKey : undefined,
      hmacKeyFormat: keyFormat,
    }
    try {
      return alg === 'all'
        ? { ok: true, kind: 'all', result: computeAllHashes(options) }
        : { ok: true, kind: 'one', result: computeHash({ ...options, algorithm: alg }) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Hashing failed.' }
    }
  }, [alg, settings.format, settings.output, settings.upper, useHmac, deferredInput, deferredKey, keyFormat])

  const single = outcome.ok && outcome.kind === 'one' ? outcome.result : null
  const all = outcome.ok && outcome.kind === 'all' ? outcome.result : null
  const output = single?.digest ?? ''

  let inputCount = plural(input.length, 'character')
  if (settings.format === 'text') inputCount = plural(textToBytes(input).length, 'byte')
  else if (outcome.ok) inputCount = plural(outcome.result.inputBytes, 'byte')

  const resultTitle = alg === 'all' ? (useHmac ? 'HMACs' : 'Digests') : `${useHmac ? 'HMAC-' : ''}${label(alg)}`

  return (
    <ToolPage
      toolId="hash"
      wide
      className="hash-page"
      lede="Compute MD5, SHA-1, SHA-256, SHA-512, SHA-3 and CRC-32 hashes of text or bytes, or an HMAC with a secret key. Everything runs in your browser."
    >
      <div className="hash-tabs">
        <SegmentedControl
          ariaLabel="Hash algorithm"
          value={alg}
          options={CHOICES.map((c) => ({ value: c, label: label(c) }))}
          onChange={(next) => update({ alg: next })}
        />
      </div>

      <div className="tool-controls hash-controls">
        <div className="tool-field">
          Output
          <SegmentedControl
            ariaLabel="Output format"
            value={settings.output}
            options={[
              { value: 'hex', label: 'Hex' },
              { value: 'base64', label: 'Base64' },
            ]}
            onChange={(output) => update({ output })}
          />
        </div>

        <label className="tool-check" title={settings.output === 'base64' ? 'Base64 is case-sensitive' : undefined}>
          <input
            type="checkbox"
            checked={settings.upper && settings.output === 'hex'}
            disabled={settings.output !== 'hex'}
            onChange={(e) => update({ upper: e.target.checked })}
          />
          Uppercase
        </label>

        <label
          className="tool-check"
          title={
            hmacAvailable
              ? 'Keyed hash (RFC 2104): proves the message came from someone who knows the key'
              : 'CRC-32 is a checksum, not a cryptographic hash: it has no HMAC'
          }
        >
          <input
            type="checkbox"
            checked={useHmac}
            disabled={!hmacAvailable}
            onChange={(e) => update({ hmac: e.target.checked })}
          />
          HMAC
        </label>

        {useHmac && (
          <div className="tool-field hash-key-field">
            <label htmlFor={keyId}>Secret key</label>
            <div className="hash-key-row">
              <input
                id={keyId}
                type="text"
                className="tool-input hash-key-input"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={keyFormat === 'hex' ? 'e.g. 0b0b0b0b…' : 'Your secret key'}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
              />
              <SegmentedControl
                ariaLabel="Key format"
                value={keyFormat}
                options={[
                  { value: 'text', label: 'Text' },
                  { value: 'hex', label: 'Hex' },
                ]}
                onChange={setKeyFormat}
              />
            </div>
          </div>
        )}
      </div>

      <div className="io-grid">
        <section className="io-panel" aria-label="Input">
          <div className="io-panel-head">
            <label htmlFor={inputId} className="io-panel-title">
              {settings.format === 'hex' ? 'Hex bytes' : 'Text'}
            </label>
            <SegmentedControl
              ariaLabel="Input format"
              value={settings.format}
              options={[
                { value: 'text', label: 'Text' },
                { value: 'hex', label: 'Hex' },
              ]}
              onChange={(format) => update({ format })}
            />
          </div>
          <textarea
            id={inputId}
            className="io-textarea"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              settings.format === 'hex'
                ? 'Paste hex bytes, e.g. 48 65 6c 6c 6f…'
                : 'Type or paste text to hash…'
            }
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <div className="io-panel-foot">
            <span>{inputCount}</span>
            {settings.format === 'text' && <span>Hashed as UTF-8</span>}
          </div>
        </section>

        <section className="io-panel" aria-label="Result" aria-live="polite">
          <div className="io-panel-head">
            <h2 className="io-panel-title">{resultTitle}</h2>
            {alg !== 'all' && (
              <CopyJsonButton
                text={output}
                label="Copy"
                size="sm"
                disabled={output === ''}
                ariaLabel={`Copy ${resultTitle} digest`}
              />
            )}
          </div>
          {!outcome.ok ? (
            <div className="error-box io-error" role="alert">
              {outcome.error}
            </div>
          ) : all ? (
            <div className="hash-all">
              <table className="hash-table">
                <tbody>
                  {all.hashes.map((h) => (
                    <tr key={h.algorithm}>
                      <th scope="row">
                        <button
                          type="button"
                          className="hash-table-alg"
                          onClick={() => update({ alg: h.algorithm })}
                          title={`Show only ${HASH_INFO[h.algorithm].label}`}
                        >
                          {HASH_INFO[h.algorithm].label}
                        </button>
                      </th>
                      <td>
                        <code>{h.digest}</code>
                      </td>
                      <td className="hash-table-copy">
                        <CopyJsonButton
                          text={h.digest}
                          label="Copy"
                          size="sm"
                          ariaLabel={`Copy ${HASH_INFO[h.algorithm].label} digest`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <textarea
              className="io-textarea io-output hash-output"
              value={output}
              readOnly
              aria-label={`${resultTitle} digest`}
              spellCheck={false}
            />
          )}
          <div className="io-panel-foot">
            <span>
              {single &&
                `${single.bits} bits · ${plural(single.digest.length, settings.output === 'hex' ? 'hex digit' : 'character')}`}
              {all && plural(all.hashes.length, 'algorithm')}
            </span>
            {outcome.ok && input === '' && <span>Digest of empty input</span>}
            {all && useHmac && <span>CRC-32 has no HMAC</span>}
          </div>
        </section>
      </div>

      <Examples
        items={[
          ...EXAMPLES.map((ex) => ({
            label: ex.label,
            onClick: () => {
              setInput(ex.input)
              if (ex.key !== undefined) {
                setKey(ex.key)
                setKeyFormat('text')
                update({
                  format: ex.format ?? 'text',
                  hmac: true,
                  alg: alg === 'crc32' ? 'sha256' : alg,
                })
              } else {
                update({ format: ex.format ?? 'text', hmac: false })
              }
            },
          })),
          { label: 'Clear', onClick: () => setInput('') },
        ]}
      />

      <section className="field-guide" aria-label="About these hashes">
        <h2>Which hash should I use?</h2>
        <p className="field-guide-hint">
          A hash turns any input into a short fixed-size fingerprint. The same input always gives
          the same digest, and you can't get the input back from it.
        </p>
        <dl>
          <div>
            <dt>SHA-256</dt>
            <dd>
              The safe default. Used by TLS certificates, Git's new object format, Bitcoin,
              Subresource Integrity and most download checksums. SHA-224 is the same algorithm cut
              to 224 bits.
            </dd>
          </div>
          <div>
            <dt>SHA-512 and SHA-384</dt>
            <dd>
              Longer digests from the same SHA-2 family, and often faster than SHA-256 on 64-bit
              CPUs. SHA-384 is SHA-512 cut to 384 bits, which also makes it immune to
              length-extension attacks.
            </dd>
          </div>
          <div>
            <dt>SHA3-256 and SHA3-512</dt>
            <dd>
              A newer standard (FIPS 202, 2015) built in a completely different way (Keccak). No
              weakness is known in SHA-2, so SHA-3 is mostly a backup and a requirement in some
              protocols such as Ethereum (which uses the original Keccak padding, so its hashes
              differ from these).
            </dd>
          </div>
          <div>
            <dt>MD5 and SHA-1</dt>
            <dd>
              <strong>Broken</strong>: anyone can craft two different inputs with the same digest.
              Fine for spotting accidental corruption or matching legacy checksums, never for
              signatures, certificates or anything an attacker could choose.
            </dd>
          </div>
          <div>
            <dt>CRC-32</dt>
            <dd>
              Not a cryptographic hash but a checksum: fast, 32 bits, and good at catching
              transmission errors. Used by zip, gzip, PNG and Ethernet. Trivial to forge.
            </dd>
          </div>
          <div>
            <dt>HMAC</dt>
            <dd>
              A hash mixed with a secret key (RFC 2104). Only someone with the key can produce or
              check it, which is how webhooks (Stripe, GitHub, Slack), AWS request signing and JWTs
              signed with <code>HS256</code> prove a message is genuine. HMAC-MD5 and HMAC-SHA1 are
              still considered safe, though SHA-256 is preferred.
            </dd>
          </div>
          <div>
            <dt>Passwords</dt>
            <dd>
              None of these. They are designed to be fast, which makes guessing billions of
              passwords cheap. Store passwords with a slow, salted function such as Argon2id,
              scrypt or bcrypt.
            </dd>
          </div>
        </dl>
      </section>
    </ToolPage>
  )
}

export default HashGenerator
