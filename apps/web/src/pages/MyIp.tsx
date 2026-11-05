/**
 * "What's my IP": the one tool that can't run in the browser alone. No
 * web API exposes the public address, so the page asks the Worker
 * (`GET /api/v1/myip`), which reads it from the connection and adds the
 * approximate location and ISP Cloudflare's edge attaches to it.
 *
 * Same origin as the site by default (in development via the Vite proxy
 * to `wrangler dev`): no CORS involved. On a split deployment
 * (`VITE_API_BASE_URL` set) the site's origin must be in the Worker's
 * `ALLOWED_ORIGINS`.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import CopyJsonButton from '../components/CopyJsonButton'
import { ToolPage } from '../components/ToolPage'
import { API_FETCH_BASE } from '../blog/site'
import './MyIp.css'

/** Body of `GET /api/v1/myip` (see `MyIpResult` in openapi.yaml). */
interface MyIpResult {
  ip: string
  version: 4
  routable: boolean
  location: {
    approximate: true
    city: string | null
    region: string | null
    regionCode: string | null
    country: string | null
    postalCode: string | null
    continent: string | null
    timezone: string | null
    latitude: number | null
    longitude: number | null
  }
  isp: { asn: number | null; organization: string | null }
}

type State =
  | { status: 'loading' }
  | { status: 'ok'; data: MyIpResult }
  | { status: 'error'; message: string }

const ENDPOINT = `${API_FETCH_BASE}/api/v1/myip`

async function fetchMyIp(signal: AbortSignal): Promise<MyIpResult> {
  let response: Response
  try {
    response = await fetch(ENDPOINT, { signal, cache: 'no-store' })
  } catch (e) {
    if (signal.aborted) throw e
    // Network failure, or a cross-origin answer the browser refused (CORS).
    throw new Error('Could not reach the WebTools API. Check your connection and try again.', {
      cause: e,
    })
  }
  const body = (await response.json().catch(() => null)) as
    | MyIpResult
    | { error?: string }
    | null
  if (!response.ok || !body || !('ip' in body)) {
    const message = body && 'error' in body && body.error
    throw new Error(message || `The API answered with HTTP ${response.status}.`)
  }
  return body
}

/** "FR" → "France", in the visitor's language, falling back to the code. */
function countryName(code: string | null): string | null {
  if (!code) return null
  try {
    return new Intl.DisplayNames(undefined, { type: 'region' }).of(code) ?? code
  } catch {
    return code
  }
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="myip-row">
      <dt>{label}</dt>
      <dd>{value ?? <span className="myip-unknown">Unknown</span>}</dd>
    </div>
  )
}

function Results({ data }: { data: MyIpResult }) {
  const { location: loc, isp } = data
  const country = countryName(loc.country)
  const place = [loc.city, loc.region, country].filter(Boolean).join(', ') || null
  const hasCoords = loc.latitude !== null && loc.longitude !== null
  const hasGeo = Boolean(place || loc.timezone || hasCoords)

  return (
    <>
      <section className="myip-hero" aria-label="Your IP address">
        <span className="myip-hero-label">Your public IPv4 address</span>
        <code className="myip-address">{data.ip}</code>
        <div className="myip-hero-actions">
          <CopyJsonButton text={data.ip} label="Copy IP" ariaLabel={`Copy ${data.ip}`} />
          <CopyJsonButton data={data} label="Copy JSON" />
          <Link className="button button-secondary" to={`/ip?cidr=${encodeURIComponent(`${data.ip}/32`)}`}>
            Open in subnet calculator
          </Link>
        </div>
      </section>

      {!data.routable && (
        <p className="tool-hint myip-note" role="note">
          This is a private or loopback address, not a public one: the API was reached without going
          through the internet (local development). The location and provider below are those of
          this machine&rsquo;s internet connection.
        </p>
      )}

      <div className="myip-cards">
        <section className="myip-card" aria-labelledby="myip-location">
          <header className="myip-card-head">
            <h2 id="myip-location">Location</h2>
            <span className="badge badge-neutral" title="Estimated from an IP geolocation database">
              Approximate
            </span>
          </header>
          {hasGeo ? (
            <dl className="myip-list">
              <Row label="Place" value={place} />
              <Row label="Postal code" value={loc.postalCode} />
              <Row label="Time zone" value={loc.timezone} />
              <Row
                label="Coordinates"
                value={
                  hasCoords ? (
                    <a
                      href={`https://www.openstreetmap.org/?mlat=${loc.latitude}&mlon=${loc.longitude}#map=10/${loc.latitude}/${loc.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {loc.latitude?.toFixed(4)}, {loc.longitude?.toFixed(4)}
                    </a>
                  ) : null
                }
              />
            </dl>
          ) : (
            <p className="myip-empty">No location data for this address.</p>
          )}
          <p className="myip-card-foot">
            Estimated from your IP address, not from your device. It usually points to your
            provider&rsquo;s nearest hub and can be off by tens of kilometres, or show the exit
            location of a VPN or proxy.
          </p>
        </section>

        <section className="myip-card" aria-labelledby="myip-isp">
          <header className="myip-card-head">
            <h2 id="myip-isp">Internet provider</h2>
          </header>
          {isp.organization || isp.asn !== null ? (
            <dl className="myip-list">
              <Row label="Network" value={isp.organization} />
              <Row label="ASN" value={isp.asn !== null ? <code>AS{isp.asn}</code> : null} />
            </dl>
          ) : (
            <p className="myip-empty">No network data for this address.</p>
          )}
          <p className="myip-card-foot">
            The organisation that announces your address on the internet: usually your ISP, mobile
            carrier, company network, VPN or cloud provider.
          </p>
        </section>
      </div>
    </>
  )
}

function MyIp() {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    fetchMyIp(controller.signal).then(
      (data) => setState({ status: 'ok', data }),
      (e: unknown) => {
        if (controller.signal.aborted) return
        setState({ status: 'error', message: e instanceof Error ? e.message : String(e) })
      },
    )
    return () => controller.abort()
  }, [attempt])

  const refresh = useCallback(() => {
    setState({ status: 'loading' })
    setAttempt((n) => n + 1)
  }, [])

  return (
    <ToolPage
      toolId="myip"
      lede="The public IPv4 address websites see when you connect, with the approximate location and the internet provider it belongs to. Nothing is stored or logged."
    >
      {state.status === 'loading' && (
        <p className="myip-loading" role="status">
          Looking up your address…
        </p>
      )}

      {state.status === 'error' && (
        <div className="error-box" role="alert">
          <div>{state.message}</div>
        </div>
      )}

      {state.status === 'ok' && <Results data={state.data} />}

      {state.status !== 'loading' && (
        <div className="myip-refresh">
          <button type="button" className="button button-ghost" onClick={refresh}>
            Check again
          </button>
          <span className="tool-hint">Switched network or turned on a VPN? Check again.</span>
        </div>
      )}
    </ToolPage>
  )
}

export default MyIp
