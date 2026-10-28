import type { ReactNode } from 'react'
import { rfcUrl } from '../rfc'
import './RfcLink.css'

/**
 * Link to an RFC (or OIDC) section, opened in a new tab.
 *
 * Default: the small label shown under a term in a field guide
 * (`RFC 7519 §4.1.4 ↗`). With `inline`, a link inside running text whose
 * label is `children`, e.g. `<RfcLink rfc="RFC 4226 §5.3" inline>RFC 4226</RfcLink>`.
 */
export function RfcLink({
  rfc,
  inline = false,
  children,
}: {
  /** Spec reference, e.g. "RFC 6238 §5.2" or "RFC 6238 Appendix B". */
  rfc: string
  inline?: boolean
  /** Visible text; defaults to `rfc`. */
  children?: ReactNode
}) {
  const href = rfcUrl(rfc)
  const className = inline ? 'rfc-inline' : 'field-rfc'
  if (!href) return <span className={className}>{children ?? rfc}</span>
  return (
    <a
      className={inline ? className : 'field-rfc field-rfc-link'}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={inline && children ? `${rfc} (opens in a new tab)` : undefined}
    >
      {children ?? rfc}
      <span aria-hidden="true" className="field-rfc-arrow">
        ↗
      </span>
    </a>
  )
}
