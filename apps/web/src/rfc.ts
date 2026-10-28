/**
 * Links to the specifications the tools implement.
 *
 * Kept in a plain `.ts` module so react-refresh keeps working on the
 * component that uses it (fast refresh only tracks component-only modules).
 */

/**
 * Turn a spec reference like `"RFC 7519 §4.1.1"`, `"RFC 6238 Appendix B"`
 * or `"OIDC Core 1.0 §5.1"` into a canonical URL. Unknown shapes return
 * `null` and callers fall back to showing the plain text.
 */
export function rfcUrl(ref: string): string | null {
  const rfcMatch = ref.match(/^RFC\s+(\d+)(?:\s+(?:§\s*([\d.]+)|Appendix\s+([A-Z])))?/i)
  if (rfcMatch) {
    const [, number, section, appendix] = rfcMatch
    const base = `https://datatracker.ietf.org/doc/html/rfc${number}`
    if (section) return `${base}#section-${section}`
    if (appendix) return `${base}#appendix-${appendix.toUpperCase()}`
    return base
  }
  const oidcMatch = ref.match(/^OIDC\s+Core\s+1\.0(?:\s+§\s*([\d.]+))?/i)
  if (oidcMatch) {
    const [, section] = oidcMatch
    const base = 'https://openid.net/specs/openid-connect-core-1_0.html'
    return section ? `${base}#Section-${section}` : base
  }
  return null
}
