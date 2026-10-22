import { useEffect, useMemo, useState } from 'react'
import {
  computeFingerprints,
  customX509Extensions,
  decodeX509,
  describeValidity,
  hasX509Field,
  KNOWN_X509_FIELDS,
  toX509JsonSummary,
  type X509Decoded,
  type X509FieldSpec,
} from '@webtools/core'
import CopyJsonButton from '../components/CopyJsonButton'
import { Examples, ToolPage } from '../components/ToolPage'
import { clearFragment, readFragmentParam } from '../urlParams'
import {
  DecodedBlock,
  DefinitionLink,
  RfcLink,
  type KeyAnnotator,
} from './decoderShared'
import { flashInJson, jumpToFieldGuide } from './decoderUtils'
import './X509Decoder.css'

// A publicly-visible OpenSSL-generated sample cert that ships with the
// page so first-time visitors see the UI populated. Pure test data — the
// private key is thrown away, nothing live depends on it.
const SAMPLE_RSA = [
  '-----BEGIN CERTIFICATE-----',
  'MIIDsjCCApqgAwIBAgIUYvGZlAsjO7p8fNMZzOW585nNmX0wDQYJKoZIhvcNAQEL',
  'BQAwOjEUMBIGA1UEAwwLZXhhbXBsZS5jb20xFTATBgNVBAoMDEV4YW1wbGUgQ29y',
  'cDELMAkGA1UEBhMCVVMwHhcNMjYxMDExMTgyODQ1WhcNMjcxMDExMTgyODQ1WjA6',
  'MRQwEgYDVQQDDAtleGFtcGxlLmNvbTEVMBMGA1UECgwMRXhhbXBsZSBDb3JwMQsw',
  'CQYDVQQGEwJVUzCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAKNKu+wt',
  '47MLEHUeG3VA4rodFvqH1SwBhbM4ALeauo96RhjMznFCOBEHlg3/Bvd/bnr7Xj6b',
  'Rt0yRER0cPRnEN812keLFKHElaYtK35XYsvfcNu9OSVAvxduojcSmYe7xaGciUhW',
  '8DZOHVw+nHvz/GqW9fWEwjaKmZjUKzCNUPUFV5v+rPCpqEDROn2dskMzJdv2sikI',
  'apvLFhvSr6woVcJhIHMcP1Vn7pXwWi9WrHZoC4x5EGAwnUM4tSgyffQNj0P+Mw0r',
  'UfYiEZwofkGma9MDobN+m9WFbstHx0GCqyy9++p/NLYIFeeZaPq6DehrHWnjzRNa',
  'paWiEuVS8vIev20CAwEAAaOBrzCBrDAdBgNVHQ4EFgQU+++bkD1blLzJcZ/CAtv1',
  'zyw1PecwHwYDVR0jBBgwFoAU+++bkD1blLzJcZ/CAtv1zyw1PecwDwYDVR0TAQH/',
  'BAUwAwEB/zAtBgNVHREEJjAkggtleGFtcGxlLmNvbYIPd3d3LmV4YW1wbGUuY29t',
  'hwTAAAIBMAsGA1UdDwQEAwIFoDAdBgNVHSUEFjAUBggrBgEFBQcDAQYIKwYBBQUH',
  'AwIwDQYJKoZIhvcNAQELBQADggEBAAiNR0fpJOy0P+x81M6j9Doh+kPTd2a4gcgf',
  'FsV2zDI1OF0FrafxDrfVYv40EhIjrmwb4/nx3AScLKXHAT8dQrVJ4tFUwgorjnmO',
  'lEIXSJQZiTmOF/0nhB447fYQOxo6pF3p9qTjvKLH9vUjW5gCiIyGQ1VDuFjeUBAQ',
  '6stSg5XhTEJcd5TCHiSWFCTonQ/P3z6I749qawkTu4ZC7xncnGeC1hBWhuLcyLdx',
  'kastBAuYN+jcZ0R5LF5X481SMcDDUi39SB9QZoILRv31v7rv2106uSXgq80VZFcV',
  'poGMwYaA4WkHLzA332Dry4dSRfmyGF2p3nrnBM26mZSRv/k6l3U=',
  '-----END CERTIFICATE-----',
].join('\n')

const SAMPLE_CA = [
  '-----BEGIN CERTIFICATE-----',
  'MIIDZjCCAk6gAwIBAgIUTE5mt0u+Qjf6TpCJsuSiAMUlKGwwDQYJKoZIhvcNAQEL',
  'BQAwOTEYMBYGA1UEAwwPRXhhbXBsZSBSb290IENBMRAwDgYDVQQKDAdFeGFtcGxl',
  'MQswCQYDVQQGEwJVUzAeFw0yNjEwMTExODI4NDVaFw0zNjEwMDgxODI4NDVaMDkx',
  'GDAWBgNVBAMMD0V4YW1wbGUgUm9vdCBDQTEQMA4GA1UECgwHRXhhbXBsZTELMAkG',
  'A1UEBhMCVVMwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDNTFDVi0+u',
  '3uH//qpS+4UbblPxnnuADBt7WJoxsHPK9le9Iu1dSYuQ8Nn+awo+Oe3JkvAPfBQs',
  'Uxf4G6PADjx0wIspLW45ST+n7Td+Vk194oDOLMygZpVNXQg9cbXxDLUdXBJJQvCx',
  '5ReS1HJANGw5S3d+3QeEJtzLKaxi8ceKIsDoahgdEBC+/IAnlgrZ+XQePOtGzhyH',
  'CU2Kv1sO99OSyklFMCkFLW89Lf1X0maS4FWRAQC9fCP7vrYIF/yJ5CgSYZqeKF33',
  's25nVv/W8wfg2qFmhf6GRsCc0FTLMi21YXKjYjq7GQZxxgsdJYaBm2ywQCBh4iM3',
  'RO2hQh7hnBv3AgMBAAGjZjBkMB0GA1UdDgQWBBTJBqbOWs5Si0h9OcX175yX9YD5',
  'kjAfBgNVHSMEGDAWgBTJBqbOWs5Si0h9OcX175yX9YD5kjASBgNVHRMBAf8ECDAG',
  'AQH/AgEBMA4GA1UdDwEB/wQEAwIBBjANBgkqhkiG9w0BAQsFAAOCAQEAWqDq7Ekd',
  'PeTbT6M45sjjjczYcayuAt+FFLSIeYNwx9g3UTCb0Rm2BTzzrvqnCtvt5fEaFBIr',
  'ylSSqlT62RpzQc/EbnzQ6tKPBM4IlEYSnCiM4kseMd6CiE9Cdo54I2UERW6K+t9S',
  'fPG8ouE/3/o8GtrMDI3URpkywc7N/Miq84czLY6/5qwWucSKxUGUhkcpcMVBAnvj',
  '+lFUXuemCC7pa1o8yNeMVOw9ZxEVzrZ1hSkceDSx7qDngBLUlog+PJOUgbPgAu1y',
  'LtGFRY6qnWPCEeYJHDfgw9JIjr9tgQiAS2rgoVCqcLZjX49s8Zqqx+MRBWeSM4NX',
  'YevL+/+GhWB+6A==',
  '-----END CERTIFICATE-----',
].join('\n')

type Outcome =
  | { ok: true; decoded: X509Decoded }
  | { ok: false; error: string }

interface Fingerprints {
  sha1: string
  sha256: string
}

function X509Decoder() {
  // Like the JWT decoder: never written to the URL, but a certificate can
  // be handed over once via the fragment (/x509#cert=<pem or base64>).
  const [input, setInput] = useState(() => readFragmentParam('cert') ?? SAMPLE_RSA)
  useEffect(clearFragment, [])
  const [fingerprintState, setFingerprintState] = useState<
    | { kind: 'idle' }
    | { kind: 'ready'; fingerprints: Fingerprints; forDer: Uint8Array }
    | { kind: 'error'; error: string; forDer: Uint8Array }
  >({ kind: 'idle' })

  const outcome: Outcome = useMemo(() => {
    try {
      return { ok: true, decoded: decodeX509(input) }
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : 'Invalid certificate',
      }
    }
  }, [input])

  // Compute fingerprints on every successful parse. `crypto.subtle` is
  // async but very fast on <10 KB input, so we don't gate the rest of
  // the UI on it; fingerprints just appear a tick later. We tag the
  // computed result with the DER buffer identity so an outdated response
  // for a previous input never overwrites a fresh one.
  useEffect(() => {
    if (!outcome.ok) return
    let cancelled = false
    const forDer = outcome.decoded.derBytes
    computeFingerprints(outcome.decoded)
      .then((fingerprints) => {
        if (cancelled) return
        setFingerprintState({ kind: 'ready', fingerprints, forDer })
      })
      .catch((e: unknown) => {
        if (cancelled) return
        setFingerprintState({
          kind: 'error',
          error: e instanceof Error ? e.message : 'Failed to hash',
          forDer,
        })
      })
    return () => {
      cancelled = true
    }
  }, [outcome])

  // Only expose fingerprints that match the current parse — otherwise we'd
  // briefly show stale values on each keystroke before the next hash lands.
  const fingerprints =
    outcome.ok &&
    fingerprintState.kind === 'ready' &&
    fingerprintState.forDer === outcome.decoded.derBytes
      ? fingerprintState.fingerprints
      : null
  const fingerprintError =
    outcome.ok &&
    fingerprintState.kind === 'error' &&
    fingerprintState.forDer === outcome.decoded.derBytes
      ? fingerprintState.error
      : null

  const flashField = (key: string) => flashInJson(key, 'data-field')

  const handleFieldKeyClick = (spec: X509FieldSpec, present: boolean) => {
    if (present) {
      flashField(spec.key)
    } else {
      // Missing field → jump to the explanation so the click is never a no-op.
      jumpToFieldGuide(`field-${anchorKey(spec.key)}`)
    }
  }

  const handleFieldNameClick = (spec: X509FieldSpec) => {
    jumpToFieldGuide(`field-${anchorKey(spec.key)}`)
  }

  // Build the JSON views for the Decoded column from the shared core
  // helpers so the UI and the API never drift on key names. We split
  // the single summary into its two visible blocks (certificate +
  // extensions); the signature block renders directly from the parsed
  // cert.
  const summary = outcome.ok
    ? toX509JsonSummary(outcome.decoded, fingerprints)
    : null
  const certJson = summary ? summary.certificate : null
  const extensionsJson = summary
    ? (summary.extensions as Record<string, unknown>)
    : null

  const tbsFields = KNOWN_X509_FIELDS.filter((f) => f.location === 'tbs')
  const extFields = KNOWN_X509_FIELDS.filter((f) => f.location === 'extension')
  const derivedFields = KNOWN_X509_FIELDS.filter((f) => f.location === 'derived')

  const customExts = outcome.ok ? customX509Extensions(outcome.decoded) : []

  return (
    <ToolPage
      toolId="x509"
      wide
      lede="Paste an X.509 certificate as PEM or raw base64 DER to inspect its fields, extensions and fingerprints. Everything is parsed in your browser."
    >
      <form
        className="decoder-form"
        onSubmit={(e) => e.preventDefault()}
      >
        <textarea
          className="decoder-input x509-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="-----BEGIN CERTIFICATE-----"
          aria-label="Certificate (PEM or raw base64 DER)"
          autoComplete="off"
          spellCheck={false}
          rows={8}
        />
      </form>

      <Examples
        items={[
          { label: 'RSA server sample', onClick: () => setInput(SAMPLE_RSA) },
          { label: 'Self-signed CA sample', onClick: () => setInput(SAMPLE_CA) },
          { label: 'Clear', onClick: () => setInput('') },
        ]}
      />

      {!outcome.ok && input.trim() !== '' && (
        <p className="error-box" role="alert">
          {outcome.error}
        </p>
      )}

      <div className="decoder-grid">
        <aside className="claims-column" aria-label="Known fields">
          <h2 className="column-title">Known fields</h2>

          <FieldList
            heading="Certificate"
            fields={tbsFields}
            cert={outcome.ok ? outcome.decoded : null}
            onKeyClick={handleFieldKeyClick}
            onNameClick={handleFieldNameClick}
          />

          <FieldList
            heading="Extensions"
            fields={extFields}
            cert={outcome.ok ? outcome.decoded : null}
            onKeyClick={handleFieldKeyClick}
            onNameClick={handleFieldNameClick}
          />

          <FieldList
            heading="Derived"
            fields={derivedFields}
            cert={outcome.ok ? outcome.decoded : null}
            fingerprints={fingerprints}
            onKeyClick={handleFieldKeyClick}
            onNameClick={handleFieldNameClick}
          />

          {customExts.length > 0 && (
            <>
              <h3 className="claim-group-heading">
                Other extensions in this certificate
              </h3>
              <ul className="claim-list">
                {customExts.map((ext) => (
                  <li
                    key={ext.oid}
                    className="claim-row claim-row-present claim-row-custom"
                    title={`Custom extension · OID ${ext.oid}`}
                  >
                    <span
                      className="claim-dot claim-dot-present"
                      aria-hidden="true"
                    />
                    <button
                      type="button"
                      className="claim-key-button"
                      onClick={() => flashField(`ext:${ext.oid}`)}
                      aria-label={`Highlight extension ${ext.oid} in the decoded view`}
                      title={`Highlight ${ext.oid} in the decoded view`}
                    >
                      <span className="claim-key">{ext.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </aside>

        <section className="decoded-column" aria-label="Decoded certificate">
          <h2 className="column-title">Decoded</h2>

          {outcome.ok && summary && certJson && extensionsJson ? (
            <>
              <DecodedBlock
                title="Certificate"
                part={certJson as Record<string, unknown>}
                flashAttr="data-field"
                annotateKey={annotateCertField}
                action={
                  <CopyJsonButton
                    size="sm"
                    data={summary as unknown as Record<string, unknown>}
                    ariaLabel="Copy certificate information as JSON"
                  />
                }
              />
              <DecodedBlock
                title="Extensions"
                part={extensionsJson}
                flashAttr="data-field"
              />
              <section
                className="decoded-block"
                data-field="signatureValue"
              >
                <h3 className="decoded-title">Signature</h3>
                <code className="signature-value">
                  {outcome.decoded.signature.hex}
                </code>
                <p className="signature-note">
                  Signatures are not verified by this tool — you'd need the
                  issuer's public key to do that.
                </p>
              </section>
              <section className="decoded-block">
                <h3 className="decoded-title">Fingerprints</h3>
                {fingerprints ? (
                  <dl className="fingerprint-list">
                    <div
                      className="json-line"
                      data-field="fingerprint.sha256"
                    >
                      <dt>SHA-256</dt>
                      <dd>
                        <code>{fingerprints.sha256}</code>
                      </dd>
                    </div>
                    <div
                      className="json-line"
                      data-field="fingerprint.sha1"
                    >
                      <dt>SHA-1</dt>
                      <dd>
                        <code>{fingerprints.sha1}</code>
                      </dd>
                    </div>
                  </dl>
                ) : fingerprintError ? (
                  <p className="empty-note">
                    Could not compute fingerprints: {fingerprintError}
                  </p>
                ) : (
                  <p className="empty-note">Computing fingerprints…</p>
                )}
              </section>
            </>
          ) : (
            <p className="empty-note">
              {input.trim() === ''
                ? 'Paste a certificate above to see its decoded contents here.'
                : "The certificate couldn't be decoded. See the error above."}
            </p>
          )}
        </section>
      </div>

      <section className="field-guide" aria-label="Field explanations">
        <h2>What are these fields?</h2>
        <p className="field-guide-hint">
          Tip: click any field in the list to flash its value in the decoded
          view, or click its name to jump to the explanation below.
        </p>

        <h3 className="field-group-heading">Certificate fields</h3>
        <dl>
          {tbsFields.map((spec) => (
            <FieldExplanation key={spec.key} spec={spec} />
          ))}
        </dl>

        <h3 className="field-group-heading">Extensions</h3>
        <dl>
          {extFields.map((spec) => (
            <FieldExplanation key={spec.key} spec={spec} />
          ))}
        </dl>

        <h3 className="field-group-heading">Derived values</h3>
        <dl>
          {derivedFields.map((spec) => (
            <FieldExplanation key={spec.key} spec={spec} />
          ))}
        </dl>
      </section>
    </ToolPage>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface FieldListProps {
  heading: string
  fields: X509FieldSpec[]
  cert: X509Decoded | null
  fingerprints?: Fingerprints | null
  onKeyClick: (spec: X509FieldSpec, present: boolean) => void
  onNameClick: (spec: X509FieldSpec) => void
}

function FieldList({
  heading,
  fields,
  cert,
  fingerprints,
  onKeyClick,
  onNameClick,
}: FieldListProps) {
  return (
    <>
      <h3 className="claim-group-heading">{heading}</h3>
      <ul className="claim-list">
        {fields.map((spec) => {
          const present = isPresent(spec, cert, fingerprints ?? null)
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
              <button
                type="button"
                className="claim-key-button"
                onClick={() => onKeyClick(spec, present)}
                aria-label={
                  present
                    ? `Highlight ${spec.name} in the decoded view`
                    : `Explain ${spec.name}`
                }
                title={spec.name}
              >
                <span className="claim-key">{displayKey(spec)}</span>
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

function FieldExplanation({ spec }: { spec: X509FieldSpec }) {
  return (
    <div id={`field-${anchorKey(spec.key)}`}>
      <dt>
        <code className="field-key">{displayKey(spec)}</code>
        {spec.mandatory && <span className="mandatory-badge">required</span>}
        {spec.rfc && <RfcLink rfc={spec.rfc} />}
      </dt>
      <dd>
        <h4 className="field-name">{spec.name}</h4>
        <p className="field-description">{spec.description}</p>
      </dd>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Field presence + display helpers
// ---------------------------------------------------------------------------

function isPresent(
  spec: X509FieldSpec,
  cert: X509Decoded | null,
  fingerprints: Fingerprints | null,
): boolean {
  if (!cert) return false
  if (spec.location === 'derived') {
    // Fingerprints only "exist" once we've computed them.
    return fingerprints !== null
  }
  return hasX509Field(cert, spec)
}

/**
 * Short identifier shown in the field-list and field-guide code block.
 * Mirrors `KNOWN_X509_FIELDS[].key` but strips the `ext:` prefix for
 * extensions and the `fingerprint.` prefix for digests, so the UI reads
 * naturally.
 */
function displayKey(spec: X509FieldSpec): string {
  if (spec.key.startsWith('ext:')) return spec.key.slice(4)
  if (spec.key.startsWith('fingerprint.')) {
    return spec.key.slice('fingerprint.'.length).toUpperCase()
  }
  return spec.key
}

// Turn a field key into a URL-safe anchor fragment.
function anchorKey(key: string): string {
  return key.replace(/[^A-Za-z0-9_-]/g, '-')
}

// ---------------------------------------------------------------------------
// Per-field annotations
// ---------------------------------------------------------------------------

/**
 * Render the pending/active/expired badge next to the `validity` block.
 * Delegates all the English-wording work to `describeValidity` in core
 * so the UI badge and the API's `analysis.message` stay consistent.
 */
const annotateCertField: KeyAnnotator = (key, value) => {
  if (key !== 'validity' || typeof value !== 'object' || value === null) {
    return null
  }
  const validity = value as { notBefore?: unknown; notAfter?: unknown }
  if (
    typeof validity.notAfter !== 'string' ||
    typeof validity.notBefore !== 'string'
  ) {
    return null
  }
  const notBefore = new Date(validity.notBefore)
  const notAfter = new Date(validity.notAfter)
  // We only need a Date pair to classify the window — build a minimal
  // cert-shaped object rather than pulling the real one through props,
  // which would just complicate the shared DecodedBlock plumbing.
  const status = describeValidity({
    validity: { notBefore, notAfter },
  } as X509Decoded)
  const label =
    status.state === 'pending'
      ? 'not yet valid'
      : status.state === 'expired'
        ? 'expired'
        : 'valid'
  return (
    <>
      {' '}
      <span
        className={`exp-badge exp-badge-${status.state}`}
        title={status.message}
      >
        {label}
      </span>
    </>
  )
}

export default X509Decoder
