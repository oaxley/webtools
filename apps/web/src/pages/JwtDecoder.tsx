import { useEffect, useMemo, useState } from 'react'
import {
  customPayloadClaims,
  decodeJWT,
  hasClaim,
  KNOWN_CLAIMS,
  type JwtClaimSpec,
  type JwtDecoded,
} from '@webtools/core'
import CopyJsonButton from '../components/CopyJsonButton'
import { DecodedBlock, DefinitionLink, RfcLink } from './decoderShared'
import { flashInJson, jumpToFieldGuide } from './decoderUtils'
import './JwtDecoder.css'

// Public jwt.io sample token. Used as the default so the page shows
// something useful on first load.
const SAMPLE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' +
  'eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.' +
  'SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'

// A more realistic OIDC-ish sample with an exp in the future, so users
// can see the date formatting / expiry badge in action.
const SAMPLE_OIDC =
  (() => {
    const future = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 2 // +2 days
    const past = Math.floor(Date.now() / 1000) - 60 * 60 // -1 hour
    const b64 = (obj: Record<string, unknown>) =>
      btoa(JSON.stringify(obj))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '')
    const header = b64({ alg: 'RS256', typ: 'JWT', kid: 'key-2026-10' })
    const payload = b64({
      iss: 'https://auth.example.com',
      sub: 'user_42',
      aud: ['web-app', 'mobile-app'],
      exp: future,
      nbf: past,
      iat: past,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      scope: 'openid profile email',
    })
    return `${header}.${payload}.sample-signature-not-verified`
  })()

type Outcome =
  | { ok: true; decoded: JwtDecoded }
  | { ok: false; error: string }

function JwtDecoder() {
  // Tokens are intentionally NOT mirrored to the URL: they often carry
  // real credentials or PII, and the URL would leak into history,
  // referer headers, server logs, and shared screenshots.
  const [input, setInput] = useState(SAMPLE)

  useEffect(() => {
    document.title = 'JWT Decoder — WebTools'
  }, [])

  const outcome: Outcome = useMemo(() => {
    try {
      return { ok: true, decoded: decodeJWT(input) }
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : 'Invalid JWT',
      }
    }
  }, [input])

  const flashClaimInJson = (key: string) => flashInJson(key, 'data-claim')

  const handleClaimKeyClick = (spec: JwtClaimSpec, present: boolean) => {
    if (present) {
      flashClaimInJson(spec.key)
    } else {
      // Missing claim can't be highlighted — fall back to the explanation
      // so the click is never a no-op.
      jumpToFieldGuide(`claim-${spec.key}`)
    }
  }

  const handleClaimNameClick = (spec: JwtClaimSpec) => {
    jumpToFieldGuide(`claim-${spec.key}`)
  }

  const payloadKnown = KNOWN_CLAIMS.filter((c) => c.location === 'payload')
  const headerKnown = KNOWN_CLAIMS.filter((c) => c.location === 'header')
  const customs = outcome.ok ? customPayloadClaims(outcome.decoded) : []

  return (
    <main className="tool-page tool-page-wide">
      <h1>JWT Decoder</h1>
      <p className="tool-lede">
        Paste a JWT to inspect its header, payload and signature. 
      </p>

      <form
        className="decoder-form"
        onSubmit={(e) => {
          e.preventDefault()
        }}
      >
        <textarea
          className="decoder-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9…"
          aria-label="JWT"
          autoComplete="off"
          spellCheck={false}
          rows={4}
        />
      </form>

      <p className="examples">
        Try:{' '}
        <button
          type="button"
          className="example-link"
          onClick={() => setInput(SAMPLE)}
        >
          HS256 sample
        </button>{' '}
        ·{' '}
        <button
          type="button"
          className="example-link"
          onClick={() => setInput(SAMPLE_OIDC)}
        >
          OIDC sample
        </button>{' '}
        ·{' '}
        <button
          type="button"
          className="example-link"
          onClick={() => setInput('')}
        >
          Clear
        </button>
      </p>

      {!outcome.ok && input.trim() !== '' && (
        <p className="error-box" role="alert">
          {outcome.error}
        </p>
      )}

      <div className="decoder-grid">
        <aside className="claims-column" aria-label="Known claims">
          <h2 className="column-title">Known claims</h2>

          <ClaimList
            heading="Header"
            claims={headerKnown}
            decoded={outcome.ok ? outcome.decoded : null}
            onKeyClick={handleClaimKeyClick}
            onNameClick={handleClaimNameClick}
          />

          <ClaimList
            heading="Payload"
            claims={payloadKnown}
            decoded={outcome.ok ? outcome.decoded : null}
            onKeyClick={handleClaimKeyClick}
            onNameClick={handleClaimNameClick}
          />

          {customs.length > 0 && (
            <>
              <h3 className="claim-group-heading">Other claims in this token</h3>
              <ul className="claim-list">
                {customs.map((key) => (
                  <li
                    key={key}
                    className="claim-row claim-row-present claim-row-custom"
                    title="Custom claim — not part of any standard"
                  >
                    <span
                      className="claim-dot claim-dot-present"
                      aria-hidden="true"
                    />
                    {/* Custom claims have no spec, so there's nothing to
                        link to in the field guide — the row just flashes
                        the value in the decoded JSON. */}
                    <button
                      type="button"
                      className="claim-key-button"
                      onClick={() => flashClaimInJson(key)}
                      aria-label={`Highlight ${key} in the decoded token`}
                      title="Highlight in decoded token"
                    >
                      <span className="claim-key">{key}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>

        <section className="decoded-column" aria-label="Decoded token">
          <h2 className="column-title">Decoded</h2>

          {outcome.ok ? (
            <>
              <DecodedBlock
                title="Header"
                part={outcome.decoded.header.json}
                extra={<AlgBadge alg={outcome.decoded.header.json.alg} />}
                annotateKey={annotateClaim}
              />
              <DecodedBlock
                title="Payload"
                part={outcome.decoded.payload.json}
                annotateKey={annotateClaim}
                action={
                  <CopyJsonButton
                    size="sm"
                    data={outcome.decoded.payload.json}
                    ariaLabel="Copy payload as JSON"
                  />
                }
              />
              <section className="decoded-block">
                <h3 className="decoded-title">Signature</h3>
                <code className="signature-value">
                  {outcome.decoded.signature || <em>empty</em>}
                </code>
                <p className="signature-note">
                  Signatures are not verified by this tool — you'd need the
                  signing key to do that.
                </p>
              </section>
            </>
          ) : (
            <p className="empty-note">
              {input.trim() === ''
                ? 'Paste a JWT above to see its decoded contents here.'
                : 'The token couldn\'t be decoded. See the error above.'}
            </p>
          )}
        </section>
      </div>

      <section className="field-guide" aria-label="Field explanations">
        <h2>What are these fields?</h2>
        <p className="field-guide-hint">
          Tip: click any claim in the list to jump straight to its
          explanation. Click a claim present in the token to also flash
          it in the decoded view.
        </p>
        <dl>
          <div id="claim-jwt">
            <dt>What is a JWT?</dt>
            <dd>
              A JSON Web Token is a compact, URL-safe way to represent a
              set of claims as a signed JSON object. It has three parts
              separated by dots: <code>header.payload.signature</code>,
              each base64url-encoded.
            </dd>
          </div>
          <div id="claim-header">
            <dt>Header</dt>
            <dd>
              Metadata about the token itself — primarily the signing
              algorithm (<code>alg</code>) and the token type
              (<code>typ</code>). Must decode to a JSON object.
            </dd>
          </div>
          <div id="claim-payload">
            <dt>Payload</dt>
            <dd>
              The claims. A set of key-value pairs about the subject of
              the token and the context in which it was issued.
            </dd>
          </div>
          <div id="claim-signature">
            <dt>Signature</dt>
            <dd>
              A cryptographic signature over the base64url-encoded
              header and payload, computed with the algorithm named in
              the header. This tool does not verify it.
            </dd>
          </div>
        </dl>

        {/* Match the on-screen order: Header first, Payload second —
            same as the Decoded panel on the right. We split into two
            separate <dl>s so each group can carry its own heading
            without violating the dl content model. */}
        <h3 className="field-group-heading">Header claims</h3>
        <dl>
          {KNOWN_CLAIMS.filter((c) => c.location === 'header').map((spec) => (
            <ClaimExplanation key={spec.key} spec={spec} />
          ))}
        </dl>

        <h3 className="field-group-heading">Payload claims</h3>
        <dl>
          {KNOWN_CLAIMS.filter((c) => c.location === 'payload').map((spec) => (
            <ClaimExplanation key={spec.key} spec={spec} />
          ))}
        </dl>
      </section>
    </main>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface ClaimListProps {
  heading: string
  claims: JwtClaimSpec[]
  decoded: JwtDecoded | null
  onKeyClick: (spec: JwtClaimSpec, present: boolean) => void
  onNameClick: (spec: JwtClaimSpec) => void
}

function ClaimList({
  heading,
  claims,
  decoded,
  onKeyClick,
  onNameClick,
}: ClaimListProps) {
  return (
    <>
      <h3 className="claim-group-heading">{heading}</h3>
      <ul className="claim-list">
        {claims.map((spec) => {
          const present = decoded ? hasClaim(decoded, spec) : false
          return (
            <li
              key={spec.key}
              className={`claim-row ${
                present ? 'claim-row-present' : 'claim-row-missing'
              }`}
              title={spec.description}
            >
              <span
                className={`claim-dot ${
                  present ? 'claim-dot-present' : 'claim-dot-missing'
                }`}
                aria-hidden="true"
              />
              {/* Clicking the key flashes the matching value in the decoded
                  JSON (or jumps to the explanation when the claim is
                  missing — the user asked for a non-no-op fallback). */}
              <button
                type="button"
                className="claim-key-button"
                onClick={() => onKeyClick(spec, present)}
                aria-label={
                  present
                    ? `Highlight ${spec.key} in the decoded token`
                    : `Explain ${spec.key} (${spec.name})`
                }
                title={spec.name}
              >
                <span className="claim-key">{spec.key}</span>
              </button>
              <DefinitionLink
                onClick={() => onNameClick(spec)}
                label={`Jump to the definition of ${spec.name}`}
              />
            </li>
          )
        })}
      </ul>
    </>
  )
}

// ---------------------------------------------------------------------------
// Per-claim annotation (date comments + expiry badge)
// ---------------------------------------------------------------------------

/**
 * Annotate numeric JWT time claims (`exp`, `iat`, `nbf`) with a human
 * readable UTC date and, for `exp`, an active/expired badge.
 * `Date.now()` is read lazily so the annotation stays fresh on re-render.
 */
function annotateClaim(key: string, value: unknown): React.ReactNode {
  if (typeof value !== 'number') return null
  if (key !== 'exp' && key !== 'iat' && key !== 'nbf') return null

  const nowSec = Math.floor(Date.now() / 1000)
  const iso = formatIsoDate(new Date(value * 1000))
  const delta = value - nowSec

  if (key === 'exp') {
    const expired = delta <= 0
    const label = expired ? 'expired' : 'active'
    const title = expired
      ? `Expired ${relativeTime(delta)} · ${iso}`
      : `Expires in ${relativeTime(delta)} · ${iso}`
    return (
      <>
        {' '}
        <span className="json-comment">// {iso}</span>{' '}
        <span
          className={`exp-badge ${
            expired ? 'exp-badge-expired' : 'exp-badge-active'
          }`}
          title={title}
        >
          {label}
        </span>
      </>
    )
  }

  // iat / nbf: show date + relative time inline.
  const rel =
    key === 'iat'
      ? delta <= 0
        ? `issued ${relativeTime(delta)}`
        : `issued ${relativeTime(delta)} from now`
      : delta <= 0
        ? `valid since ${relativeTime(delta)}`
        : `not valid for another ${relativeTime(delta)}`
  return (
    <>
      {' '}
      <span className="json-comment">
        // {iso} ({rel})
      </span>
    </>
  )
}

function formatIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`
  )
}

// Rounds to the largest sensible unit. Always returns a positive-looking
// phrase like "7 months" or "3 seconds" — the surrounding copy chooses
// between "ago" / "from now" based on sign.
function relativeTime(deltaSeconds: number): string {
  const s = Math.abs(deltaSeconds)
  const units: Array<[string, number]> = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60],
    ['second', 1],
  ]
  for (const [name, secs] of units) {
    if (s >= secs) {
      const n = Math.floor(s / secs)
      const suffix = n === 1 ? '' : 's'
      const direction = deltaSeconds < 0 ? ' ago' : ''
      return `${n} ${name}${suffix}${direction}`
    }
  }
  return `${deltaSeconds < 0 ? 'just now' : 'in a moment'}`
}

// ---------------------------------------------------------------------------
// Field-guide entry for a single known claim
// ---------------------------------------------------------------------------

function ClaimExplanation({ spec }: { spec: JwtClaimSpec }) {
  return (
    <div id={`claim-${spec.key}`}>
      <dt>
        <code className="field-key">{spec.key}</code>
        {spec.rfc && <RfcLink rfc={spec.rfc} />}
      </dt>
      <dd>
        <h4 className="field-name">{spec.name}</h4>
        <p className="field-description">{spec.description}</p>
      </dd>
    </div>
  )
}

function AlgBadge({ alg }: { alg: unknown }) {
  if (typeof alg !== 'string') return null
  const dangerous = alg.toLowerCase() === 'none'
  return (
    <span
      className={`alg-badge ${dangerous ? 'alg-badge-danger' : ''}`}
      title={
        dangerous
          ? 'alg "none" means the token is unsigned. Reject these unless you know exactly why you accept them.'
          : `Signing algorithm: ${alg}`
      }
    >
      {alg}
    </span>
  )
}

export default JwtDecoder
