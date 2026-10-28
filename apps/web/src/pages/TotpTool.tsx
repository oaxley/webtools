/**
 * TOTP generator and verifier (RFC 6238): live codes, an `otpauth://` QR
 * code to scan with an authenticator app, code checking, and every step
 * of the computation.
 *
 * The algorithm, digits and period live in the query string
 * (`/totp?alg=sha256&digits=8`). The secret never does: blog links
 * pre-fill it through the fragment (`#secret=…` or `#uri=…`), which is
 * read once and then cleared. Nothing is sent to a server.
 */
import { useEffect, useId, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import qrcode from 'qrcode-generator'
import {
  buildOtpauthUri,
  bytesToHex,
  decodeTotpSecret,
  generateTotpSecret,
  hotp,
  hotpDetails,
  parseOtpauthUri,
  TOTP_ALGORITHM_NAMES,
  TOTP_ALGORITHMS,
  TOTP_DEFAULTS,
  verifyTotp,
  type TotpAlgorithm,
  type TotpMatch,
} from '@webtools/core'
import CopyJsonButton from '../components/CopyJsonButton'
import { RfcLink } from '../components/RfcLink'
import { Examples, SegmentedControl, ToolPage } from '../components/ToolPage'
import { clearFragment, readFragmentParam, readInt, writeParams } from '../urlParams'
import '../components/IoPanels.css'
import './TotpTool.css'

interface Settings {
  alg: TotpAlgorithm
  digits: number
  period: number
}

const DEFAULTS: Settings = {
  alg: TOTP_DEFAULTS.algorithm,
  digits: TOTP_DEFAULTS.digits,
  period: TOTP_DEFAULTS.period,
}

const PERIODS = [30, 60]
const DIGITS = [6, 7, 8]

function settingsFromParams(params: URLSearchParams): Settings {
  const alg = params.get('alg')?.toLowerCase()
  const period = readInt(params, 'period', 1, 3600)
  return {
    alg: TOTP_ALGORITHMS.includes(alg as TotpAlgorithm) ? (alg as TotpAlgorithm) : DEFAULTS.alg,
    digits: readInt(params, 'digits', 6, 8) ?? DEFAULTS.digits,
    period: period !== undefined && PERIODS.includes(period) ? period : DEFAULTS.period,
  }
}

/** Initial secret and labels: fragment URI, fragment secret, or a new secret. */
function initialAccount() {
  const uri = readFragmentParam('uri')
  if (uri) {
    try {
      return { parsed: parseOtpauthUri(uri) }
    } catch {
      // Fall through to a fresh secret.
    }
  }
  return {
    secret: readFragmentParam('secret')?.toUpperCase() ?? generateTotpSecret(),
    issuer: readFragmentParam('issuer') ?? 'WebTools',
    account: readFragmentParam('account') ?? 'demo@example.com',
  }
}

/** Current Unix time in seconds, refreshed a few times per second. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now() / 1000)
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now() / 1000), 250)
    return () => window.clearInterval(id)
  }, [])
  return now
}

/** "123 456" / "1234 5678": easier to read, as apps show them. */
function groupCode(code: string): string {
  const half = Math.ceil(code.length / 2)
  return `${code.slice(0, half)} ${code.slice(half)}`
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** QR code as an SVG path, dark on white whatever the theme (scanners need contrast). */
function QrCode({ text, label }: { text: string; label: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, 'M')
    qr.addData(text, 'Byte')
    qr.make()
    const count = qr.getModuleCount()
    let d = ''
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (qr.isDark(row, col)) d += `M${col + 4},${row + 4}h1v1h-1z`
      }
    }
    return { size: count + 8, path: d }
  }, [text])
  return (
    <svg
      className="totp-qr"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  )
}

/** Circle that empties as the current code's time runs out. */
function Countdown({ remaining, period }: { remaining: number; period: number }) {
  const r = 20
  const circumference = 2 * Math.PI * r
  const left = Math.ceil(remaining)
  return (
    <div className={`totp-ring${left <= 5 ? ' is-ending' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 48 48">
        <circle className="totp-ring-track" cx="24" cy="24" r={r} />
        <circle
          className="totp-ring-bar"
          cx="24"
          cy="24"
          r={r}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - remaining / period)}
        />
      </svg>
      <span>{left}</span>
    </div>
  )
}

const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ' // "12345678901234567890"

function TotpTool() {
  const [params, setParams] = useSearchParams()
  const [initial] = useState(initialAccount)
  const [settings, setSettings] = useState<Settings>(() =>
    initial.parsed
      ? {
          alg: initial.parsed.algorithm,
          digits: initial.parsed.digits,
          period: PERIODS.includes(initial.parsed.period) ? initial.parsed.period : DEFAULTS.period,
        }
      : settingsFromParams(params),
  )
  const [secret, setSecret] = useState(initial.parsed?.secret ?? initial.secret ?? '')
  const [issuer, setIssuer] = useState(initial.parsed?.issuer ?? initial.issuer ?? '')
  const [account, setAccount] = useState(initial.parsed?.account ?? initial.account ?? '')
  const [uriEdit, setUriEdit] = useState<string | null>(null)
  const [candidate, setCandidate] = useState('')
  useEffect(clearFragment, [])

  const secretId = useId()
  const issuerId = useId()
  const accountId = useId()
  const uriId = useId()
  const verifyId = useId()

  const now = useNow()
  const { alg, digits, period } = settings

  const update = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    setParams((prev) => writeParams(prev, next, DEFAULTS), { replace: true })
  }

  const decoded = useMemo(() => {
    try {
      return { ok: true as const, key: decodeTotpSecret(secret) }
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : 'Invalid secret.' }
    }
  }, [secret])
  const key = decoded.ok ? decoded.key : null

  const counter = Math.floor(now / period)
  const remaining = period - (now % period)
  const options = { algorithm: alg, digits }
  const codes = key
    ? {
        previous: hotp(key, counter - 1, options),
        current: hotp(key, counter, options),
        next: hotp(key, counter + 1, options),
      }
    : null
  const details = useMemo(
    () => (key ? hotpDetails(key, counter, { algorithm: alg, digits }) : null),
    [key, counter, alg, digits],
  )

  const uri = key ? buildOtpauthUri({ secret, issuer, account, algorithm: alg, digits, period }) : ''
  let uriError: string | null = null
  if (uriEdit !== null) {
    try {
      parseOtpauthUri(uriEdit)
    } catch (e) {
      uriError = e instanceof Error ? e.message : 'Invalid URI.'
    }
  }

  const onUriChange = (text: string) => {
    setUriEdit(text)
    try {
      const p = parseOtpauthUri(text)
      setSecret(p.secret)
      setIssuer(p.issuer)
      setAccount(p.account)
      update({ alg: p.algorithm, digits: p.digits, period: PERIODS.includes(p.period) ? p.period : period })
    } catch {
      // Shown under the textarea; the fields keep their last valid values.
    }
  }

  const cleanCandidate = candidate.replace(/\s/g, '')
  let verdict: { match: TotpMatch | null } | null = null
  if (key && cleanCandidate !== '') {
    verdict = { match: verifyTotp(key, cleanCandidate, { ...options, period, time: now, window: 1 }) }
  }

  const loadSecret = (next: string, patch: Partial<Settings> = {}) => {
    setSecret(next)
    setUriEdit(null)
    setCandidate('')
    update(patch)
  }

  const bits = key ? key.length * 8 : 0
  const nonDefault = alg !== 'sha1' || digits !== 6 || period !== 30

  return (
    <ToolPage
      toolId="totp"
      wide
      className="totp-page"
      lede={
        <>
          Generate <RfcLink rfc="RFC 6238" inline>RFC 6238</RfcLink> TOTP codes, scan the QR code
          with Google Authenticator or any authenticator app, check a code, and see every step of
          the computation. Everything runs in your browser.
        </>
      }
    >
      <div className="tool-controls totp-secret">
        <div className="tool-field totp-secret-field">
          <label htmlFor={secretId}>Secret (Base32)</label>
          <div className="totp-secret-row">
            <input
              id={secretId}
              type="text"
              className="tool-input totp-secret-input"
              value={secret}
              aria-invalid={!decoded.ok}
              onChange={(e) => {
                setSecret(e.target.value)
                setUriEdit(null)
              }}
              placeholder="e.g. JBSWY3DPEHPK3PXP"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
            />
            <CopyJsonButton text={secret} label="Copy" size="sm" disabled={!key} ariaLabel="Copy secret" />
            <button type="button" className="button button-secondary" onClick={() => loadSecret(generateTotpSecret())}>
              New secret
            </button>
          </div>
        </div>
        <p className="totp-private">
          <span className="tool-chip-dot" aria-hidden="true" /> Never leaves your browser. Use a test
          secret here, not the one protecting a real account.
        </p>
      </div>

      {!decoded.ok ? (
        <div className="error-box" role="alert">
          {decoded.error}
        </div>
      ) : (
        bits < 128 && (
          <p className="tool-hint totp-warn">
            This secret is {bits} bits.{' '}
            <RfcLink rfc="RFC 4226 §4" inline>
              RFC 4226
            </RfcLink>{' '}
            asks for at least 128 bits and recommends 160 (32 Base32 characters).
          </p>
        )
      )}

      <div className="tool-controls totp-controls">
        <div className="tool-field">
          Algorithm
          <SegmentedControl
            ariaLabel="HMAC algorithm"
            value={alg}
            options={TOTP_ALGORITHMS.map((a) => ({ value: a, label: TOTP_ALGORITHM_NAMES[a].replace('SHA', 'SHA-') }))}
            onChange={(next) => update({ alg: next })}
          />
        </div>
        <div className="tool-field">
          Digits
          <SegmentedControl
            ariaLabel="Digits"
            value={digits}
            options={DIGITS.map((d) => ({ value: d, label: String(d) }))}
            onChange={(next) => update({ digits: next })}
          />
        </div>
        <div className="tool-field">
          Period
          <SegmentedControl
            ariaLabel="Period"
            value={period}
            options={PERIODS.map((p) => ({ value: p, label: `${p} s` }))}
            onChange={(next) => update({ period: next })}
          />
        </div>
        <div className="tool-field totp-label-field">
          <label htmlFor={issuerId}>Issuer</label>
          <input
            id={issuerId}
            type="text"
            className="tool-input"
            value={issuer}
            onChange={(e) => {
              setIssuer(e.target.value.replace(/:/g, ''))
              setUriEdit(null)
            }}
            placeholder="Service name"
            autoComplete="off"
          />
        </div>
        <div className="tool-field totp-label-field">
          <label htmlFor={accountId}>Account</label>
          <input
            id={accountId}
            type="text"
            className="tool-input"
            value={account}
            onChange={(e) => {
              setAccount(e.target.value)
              setUriEdit(null)
            }}
            placeholder="alice@example.com"
            autoComplete="off"
          />
        </div>
      </div>

      {codes && (
        <section className="totp-live" aria-label="Current code">
          <div className="totp-live-step">
            <span className="totp-live-label">Previous</span>
            <code>{groupCode(codes.previous)}</code>
          </div>
          <div className="totp-live-main">
            <Countdown remaining={remaining} period={period} />
            <div>
              <span className="totp-live-label">Current code</span>
              <output className="totp-code" aria-live="off">
                {groupCode(codes.current)}
              </output>
              <span className="totp-live-sub">
                Changes in {plural(Math.ceil(remaining), 'second')}
              </span>
            </div>
            <CopyJsonButton text={codes.current} label="Copy" size="sm" ariaLabel="Copy current code" />
          </div>
          <div className="totp-live-step">
            <span className="totp-live-label">Next</span>
            <code>{groupCode(codes.next)}</code>
          </div>
        </section>
      )}

      <div className="io-grid totp-grid">
        <section className="io-panel totp-qr-panel" aria-label="QR code">
          <div className="io-panel-head">
            <h2 className="io-panel-title">Scan with your phone</h2>
          </div>
          <div className="totp-qr-body">
            {key ? (
              <QrCode text={uri} label={`QR code for ${uri}`} />
            ) : (
              <p className="tool-hint">Enter a valid secret to get a QR code.</p>
            )}
            <p className="totp-qr-hint">
              Google Authenticator, Microsoft Authenticator, Authy, 1Password, Bitwarden: add an
              account, scan, and the code in the app matches the one above.
              {nonDefault && (
                <strong> Some apps (Google Authenticator among them) ignore non-default algorithm, digits or period.</strong>
              )}
            </p>
          </div>
        </section>

        <div className="totp-side">
          <section className="io-panel" aria-label="otpauth URI">
            <div className="io-panel-head">
              <label htmlFor={uriId} className="io-panel-title">
                otpauth:// URI
              </label>
              <CopyJsonButton text={uri} label="Copy" size="sm" disabled={!key} ariaLabel="Copy URI" />
            </div>
            <textarea
              id={uriId}
              className="io-textarea totp-uri"
              value={uriEdit ?? uri}
              aria-invalid={uriError !== null}
              onChange={(e) => onUriChange(e.target.value)}
              onBlur={() => uriError === null && setUriEdit(null)}
              placeholder="otpauth://totp/Issuer:account?secret=…"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
            <div className="io-panel-foot">
              {uriError ? <span className="totp-error">{uriError}</span> : <span>What the QR code contains. Paste one to load it.</span>}
            </div>
          </section>

          <section className="io-panel" aria-label="Check a code">
            <div className="io-panel-head">
              <label htmlFor={verifyId} className="io-panel-title">
                Check a code
              </label>
            </div>
            <div className="totp-verify">
              <input
                id={verifyId}
                type="text"
                inputMode="numeric"
                className="tool-input totp-verify-input"
                value={candidate}
                onChange={(e) => setCandidate(e.target.value.replace(/[^\d\s]/g, ''))}
                placeholder={'0'.repeat(digits)}
                maxLength={digits + 2}
                autoComplete="one-time-code"
              />
              <p className="totp-verdict" aria-live="polite">
                {!verdict ? (
                  'Type the code from your app. Like most servers, this accepts the previous, current and next code.'
                ) : verdict.match ? (
                  <span className="is-valid">
                    ✓ Valid:{' '}
                    {verdict.match.delta === 0
                      ? 'the current code'
                      : verdict.match.delta < 0
                        ? 'the previous code (still accepted for clock drift)'
                        : 'the next code (your clock is ahead)'}
                    , time step {verdict.match.counter.toLocaleString('en-US')}.
                  </span>
                ) : cleanCandidate.length < digits ? (
                  `${plural(digits - cleanCandidate.length, 'more digit')}…`
                ) : (
                  <span className="is-invalid">✗ Not valid in the ±1 step window.</span>
                )}
              </p>
            </div>
          </section>
        </div>
      </div>

      {details && key && (
        <section className="totp-steps" aria-labelledby="totp-steps-title">
          <h2 id="totp-steps-title">How this code was computed</h2>
          <p className="totp-steps-hint">
            HOTP (<RfcLink rfc="RFC 4226 §5.3" inline>RFC 4226 §5.3</RfcLink>) applied to the time
            step (<RfcLink rfc="RFC 6238 §4.2" inline>RFC 6238 §4.2</RfcLink>).
          </p>
          <ol>
            <li>
              <span className="totp-step-name">Time step</span>
              <span className="totp-step-value">
                <code>
                  T = floor({Math.floor(now)} / {period}) = {counter.toLocaleString('en-US')}
                </code>
              </span>
            </li>
            <li>
              <span className="totp-step-name">Counter bytes</span>
              <span className="totp-step-value">
                <code>{bytesToHex(details.counterBytes)}</code>
                <small>T as 8 big-endian bytes</small>
              </span>
            </li>
            <li>
              <span className="totp-step-name">Key</span>
              <span className="totp-step-value">
                <code className="totp-break">{bytesToHex(key)}</code>
                <small>The Base32 secret, decoded: {plural(key.length, 'byte')}</small>
              </span>
            </li>
            <li>
              <span className="totp-step-name">HMAC-{TOTP_ALGORITHM_NAMES[alg].replace('SHA', 'SHA-')}</span>
              <span className="totp-step-value">
                <code className="totp-break totp-hmac">
                  {Array.from(details.hmac, (b, i) => {
                    const inWindow = i >= details.offset && i < details.offset + 4
                    const isLast = i === details.hmac.length - 1
                    return (
                      <span
                        key={i}
                        className={inWindow ? 'is-window' : isLast ? 'is-offset' : undefined}
                      >
                        {b.toString(16).padStart(2, '0')}
                      </span>
                    )
                  })}
                </code>
                <small>HMAC(key, counter bytes)</small>
              </span>
            </li>
            <li>
              <span className="totp-step-name">Offset</span>
              <span className="totp-step-value">
                <code>
                  0x{details.hmac[details.hmac.length - 1].toString(16).padStart(2, '0')} &amp; 0x0f ={' '}
                  {details.offset}
                </code>
                <small>Low 4 bits of the <mark className="is-offset">last byte</mark></small>
              </span>
            </li>
            <li>
              <span className="totp-step-name">Truncate</span>
              <span className="totp-step-value">
                <code>
                  <mark className="is-window">
                    {bytesToHex(details.hmac.slice(details.offset, details.offset + 4))}
                  </mark>{' '}
                  &amp; 0x7fffffff = {details.binary.toLocaleString('en-US')}
                </code>
                <small>4 bytes from the offset, top bit cleared</small>
              </span>
            </li>
            <li>
              <span className="totp-step-name">Code</span>
              <span className="totp-step-value">
                <code>
                  {details.binary.toLocaleString('en-US')} mod 10<sup>{digits}</sup> ={' '}
                  <strong>{details.code}</strong>
                </code>
              </span>
            </li>
          </ol>
        </section>
      )}

      <Examples
        items={[
          {
            label: 'RFC 6238 test secret',
            title: 'The ASCII key "12345678901234567890" from RFC 6238 Appendix B (test vectors)',
            onClick: () => {
              setIssuer('RFC 6238')
              setAccount('test')
              loadSecret(RFC_SECRET, { alg: 'sha1', digits: 8, period: 30 })
            },
          },
          {
            label: 'JBSWY3DPEHPK3PXP',
            title: 'The classic demo secret ("Hello!" + 0xDEADBEEF), 80 bits',
            onClick: () => loadSecret('JBSWY3DPEHPK3PXP', DEFAULTS),
          },
          { label: 'New random secret', onClick: () => loadSecret(generateTotpSecret(), DEFAULTS) },
        ]}
      />

      <section className="field-guide" aria-label="About TOTP">
        <h2>How TOTP works</h2>
        <p className="field-guide-hint">
          The server and your app share a secret once, through the QR code. After that, each side
          computes the code from the secret and the clock, and the code itself is all that travels.
        </p>
        <dl>
          <div>
            <dt>
              The secret
              <RfcLink rfc="RFC 4226 §4" />
            </dt>
            <dd>
              Random bytes, usually 20 (160 bits), shown as Base32 so you can type them if the QR
              code won't scan. Whoever holds the secret can make every future code, so a site has
              to store it carefully, encrypted rather than hashed, since it needs it back.
            </dd>
          </div>
          <div>
            <dt>
              The time step
              <RfcLink rfc="RFC 6238 §4.2" />
            </dt>
            <dd>
              Unix time divided by 30 seconds, rounded down. Both sides get the same number as long
              as their clocks agree, which is why a phone with the wrong time produces wrong codes.
            </dd>
          </div>
          <div>
            <dt>
              HOTP and truncation
              <RfcLink rfc="RFC 4226 §5.3" />
            </dt>
            <dd>
              The step goes through HMAC with the secret (HOTP,{' '}
              <RfcLink rfc="RFC 4226" inline>
                RFC 4226
              </RfcLink>
              ). The last 4 bits of the result
              pick 4 bytes from it, which become a 31-bit number, and its last 6 digits are the
              code.
            </dd>
          </div>
          <div>
            <dt>
              Drift window
              <RfcLink rfc="RFC 6238 §5.2" />
            </dt>
            <dd>
              Servers usually accept the previous and next codes as well, to cover clock drift and
              slow typing: the RFC recommends at most one step either way. That makes 3 valid codes
              out of a million at any moment, so the server must limit attempts, as{' '}
              <RfcLink rfc="RFC 4226 §7.3" inline>
                RFC 4226 §7.3
              </RfcLink>{' '}
              requires.
            </dd>
          </div>
          <div>
            <dt>
              Single use
              <RfcLink rfc="RFC 6238 §5.2" />
            </dt>
            <dd>
              A good server remembers the last time step it accepted and refuses the same code (or
              an older one) again, so a code seen over someone's shoulder can't be replayed.
            </dd>
          </div>
          <div>
            <dt>
              Algorithm, digits, period
              <RfcLink rfc="RFC 6238 §1.2" />
            </dt>
            <dd>
              <RfcLink rfc="RFC 6238 §1.2" inline>
                RFC 6238
              </RfcLink>{' '}
              allows SHA-256 and SHA-512, 8 digits and other periods, but almost every
              site uses SHA-1, 6 digits and 30 seconds, and several apps silently ignore anything
              else. HMAC-SHA1 is still safe here.
            </dd>
          </div>
          <div>
            <dt>Phishing</dt>
            <dd>
              TOTP doesn't check which site you type the code into. A fake login page can relay
              it to the real one within its 30 seconds. Passkeys (WebAuthn) are bound to the
              site&apos;s domain and close that gap.
            </dd>
          </div>
        </dl>
      </section>
    </ToolPage>
  )
}

export default TotpTool
