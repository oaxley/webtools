/**
 * Shared React building blocks for decoder pages (JWT, X.509, …).
 *
 * These helpers were originally inlined inside `JwtDecoder.tsx`. They are
 * lifted here so the X.509 decoder can reuse the same look & feel without
 * duplication, and so future decoders can pick them up for free.
 *
 * The components are intentionally decoder-agnostic — they know how to
 * render JSON, resolve RFC references, and render a titled decoded block,
 * but they do not know anything about JWT claims or X.509 fields. Field-
 * specific annotations are passed in via the optional `annotateKey` prop
 * on `JsonTree`.
 *
 * Non-component helpers live in `decoderUtils.ts` so react-refresh can
 * keep hot-reloading these components.
 */
import type { ReactNode } from 'react'
import { rfcUrl } from './decoderUtils'
import './decoderShared.css'

// ---------------------------------------------------------------------------
// DecodedBlock — titled container around a decoded JSON object.
// ---------------------------------------------------------------------------

export interface DecodedBlockProps {
  title: string
  part: Record<string, unknown>
  /** Inline content rendered next to the title (e.g. an algorithm badge). */
  extra?: ReactNode
  /** Trailing action pushed to the right of the title row (e.g. copy button). */
  action?: ReactNode
  /** Per-key annotation renderer, invoked for every top-level and nested key. */
  annotateKey?: KeyAnnotator
  /**
   * HTML `data-*` attribute name used by click-to-flash integrations.
   * Defaults to `"data-claim"` for backwards compatibility with the JWT
   * page; X.509 passes `"data-field"`.
   */
  flashAttr?: string
}

export function DecodedBlock({
  title,
  part,
  extra,
  action,
  annotateKey,
  flashAttr,
}: DecodedBlockProps) {
  return (
    <section className="decoded-block">
      <h3 className="decoded-title">
        {title}
        {extra}
        {action && <span className="decoded-title-action">{action}</span>}
      </h3>
      <pre className="decoded-json">
        <JsonTree obj={part} annotateKey={annotateKey} flashAttr={flashAttr} />
      </pre>
    </section>
  )
}

// ---------------------------------------------------------------------------
// JSON tree renderer with per-key annotations.
// ---------------------------------------------------------------------------

export type KeyAnnotator = (key: string, value: unknown) => ReactNode

interface JsonTreeProps {
  obj: Record<string, unknown>
  indent?: number
  annotateKey?: KeyAnnotator
  flashAttr?: string
}

export function JsonTree({
  obj,
  indent = 2,
  annotateKey,
  flashAttr = 'data-claim',
}: JsonTreeProps) {
  const keys = Object.keys(obj)
  if (keys.length === 0) return <>{'{}'}</>
  const pad = ' '.repeat(indent)
  return (
    <>
      {'{\n'}
      {keys.map((key, i) => {
        // The `data-*` attribute is written dynamically so the attribute
        // name can be customised per decoder (claim vs field). React
        // happily accepts a computed data-attribute via spread.
        const dataAttrs = { [flashAttr]: key } as Record<string, string>
        return (
          <span key={key} {...dataAttrs} className="json-line">
            {pad}
            <span className="json-key">"{key}"</span>
            {': '}
            <JsonValue
              value={obj[key]}
              indent={indent + 2}
              annotateKey={annotateKey}
              flashAttr={flashAttr}
            />
            {i < keys.length - 1 ? ',' : ''}
            {annotateKey?.(key, obj[key])}
            {'\n'}
          </span>
        )
      })}
      {' '.repeat(Math.max(0, indent - 2))}
      {'}'}
    </>
  )
}

interface JsonValueProps {
  value: unknown
  indent: number
  annotateKey?: KeyAnnotator
  flashAttr?: string
}

function JsonValue({ value, indent, annotateKey, flashAttr }: JsonValueProps) {
  if (value === null) return <span className="json-null">null</span>
  if (typeof value === 'boolean') {
    return <span className="json-bool">{String(value)}</span>
  }
  if (typeof value === 'number') {
    return <span className="json-number">{value}</span>
  }
  if (typeof value === 'string') {
    return <span className="json-string">"{escapeString(value)}"</span>
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <>{'[]'}</>
    const pad = ' '.repeat(indent)
    return (
      <>
        {'[\n'}
        {value.map((item, i) => (
          <span key={i}>
            {pad}
            <JsonValue
              value={item}
              indent={indent + 2}
              annotateKey={annotateKey}
              flashAttr={flashAttr}
            />
            {i < value.length - 1 ? ',' : ''}
            {'\n'}
          </span>
        ))}
        {' '.repeat(Math.max(0, indent - 2))}
        {']'}
      </>
    )
  }
  if (typeof value === 'object') {
    return (
      <JsonTree
        obj={value as Record<string, unknown>}
        indent={indent}
        annotateKey={annotateKey}
        flashAttr={flashAttr}
      />
    )
  }
  return <span>{String(value)}</span>
}

// Minimal JSON string escaping so values with embedded quotes/newlines
// don't visually break the pretty-printed output.
function escapeString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
}

// ---------------------------------------------------------------------------
// RFC / OIDC spec link.
// ---------------------------------------------------------------------------

/**
 * Small inline icon button rendered at the end of each field-list row.
 * Jumps to the field's definition in the field guide below.
 */
export function DefinitionLink({
  onClick,
  label,
}: {
  onClick: () => void
  label: string
}) {
  return (
    <button
      type="button"
      className="claim-definition-link"
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {/* Classic chain-link glyph — two interlocking loops. */}
        <path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5" />
        <path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5" />
      </svg>
    </button>
  )
}

export function RfcLink({ rfc }: { rfc: string }) {
  const href = rfcUrl(rfc)
  if (!href) {
    return <span className="field-rfc">{rfc}</span>
  }
  return (
    <a
      className="field-rfc field-rfc-link"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {rfc}
      <span aria-hidden="true" className="field-rfc-arrow">
        ↗
      </span>
    </a>
  )
}
