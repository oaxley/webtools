import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { calculateCIDR, isRoutable, type CidrResult } from '@webtools/core'
import './IpCalculator.css'

const DEFAULT_CIDR = '192.168.1.0/24'
const EXAMPLES = ['10.0.0.0/8', '172.16.0.0/12', '192.168.1.0/25', '10.10.10.0/30']

type Outcome =
  | { ok: true; result: CidrResult; routable: boolean }
  | { ok: false; error: string };

function splitCidr(cidr: string): [string, string] {
  const i = cidr.indexOf('/')
  return i === -1 ? [cidr, ''] : [cidr.slice(0, i), cidr.slice(i + 1)]
}

function IpCalculator() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initial = searchParams.get('cidr') ?? DEFAULT_CIDR
  const [input, setInput] = useState(initial)
  const [submitted, setSubmitted] = useState(initial)
  const [netEdit, setNetEdit] = useState(() => splitCidr(initial)[0])
  const [prefixEdit, setPrefixEdit] = useState(() => splitCidr(initial)[1])
  const [draftError, setDraftError] = useState<string | null>(null)

  useEffect(() => {
    document.title = 'IP Subnet Calculator — WebTools'
  }, [])

  const outcome: Outcome = useMemo(() => {
    try {
      return { ok: true, result: calculateCIDR(submitted), routable: isRoutable(submitted) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Invalid IPv4 CIDR' }
    }
  }, [submitted])

  const submit = (value: string) => {
    const [net, prefix] = splitCidr(value.trim())
    setSubmitted(value)
    setInput(value)
    setNetEdit(net)
    setPrefixEdit(prefix)
    setDraftError(null)
    setSearchParams(value ? { cidr: value } : {}, { replace: true })
  }

  // Live-update from the editable Network / Prefix rows. Valid combinations
  // recompute the whole table immediately; invalid ones keep the last good
  // result and show an inline hint instead of wiping the table mid-typing.
  const applyDraft = (net: string, prefix: string) => {
    const combined = `${net.trim()}/${prefix.trim()}`
    try {
      calculateCIDR(combined)
      setSubmitted(combined)
      setInput(combined)
      setDraftError(null)
      setSearchParams({ cidr: combined }, { replace: true })
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : 'Invalid IPv4 CIDR')
    }
  }

  const onNetChange = (net: string) => {
    setNetEdit(net)
    applyDraft(net, prefixEdit)
  }

  const onPrefixChange = (prefix: string) => {
    setPrefixEdit(prefix)
    applyDraft(netEdit, prefix)
  }

  return (
    <main className="tool-page">
      <h1>IP Subnet Calculator</h1>
      <p className="tool-lede">
        Enter an IPv4 network in CIDR notation to get its network, broadcast,
        mask and host range.
      </p>

      <form
        className="cidr-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit(input)
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="192.168.1.0/24"
          aria-label="CIDR notation"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit">Calculate</button>
      </form>

      <p className="examples">
        Try:{' '}
        {EXAMPLES.map((ex, i) => (
          <span key={ex}>
            {i > 0 && ' · '}
            <button
              type="button"
              className="example-link"
              onClick={() => {
                setInput(ex)
                submit(ex)
              }}
            >
              {ex}
            </button>
          </span>
        ))}
      </p>

      {outcome.ok ? (
        <table className="result-table">
          <tbody>
            <tr>
              <th scope="row">
                <label htmlFor="network-edit">
                  Network
                  <span className="tip">
                    <button
                      type="button"
                      className="tip-trigger"
                      aria-label="About the Network field"
                      aria-describedby="network-tip"
                    >
                      ?
                    </button>
                    <span className="tip-bubble" role="tooltip" id="network-tip">
                      Editable — change the address to recompute the subnet
                      live. Host bits are masked off automatically.
                    </span>
                  </span>
                  <span className="visually-hidden">(editable)</span>
                </label>
              </th>
              <td>
                <input
                  id="network-edit"
                  className="cell-edit"
                  type="text"
                  value={netEdit}
                  onChange={(e) => onNetChange(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Network address (editable)"
                />
              </td>
            </tr>
            <tr>
              <th scope="row">
                <label htmlFor="prefix-edit">
                  Prefix length
                  <span className="tip">
                    <button
                      type="button"
                      className="tip-trigger"
                      aria-label="About the Prefix length field"
                      aria-describedby="prefix-tip"
                    >
                      ?
                    </button>
                    <span className="tip-bubble" role="tooltip" id="prefix-tip">
                      Editable — change the prefix (0–32) to recompute the
                      subnet live.
                    </span>
                  </span>
                  <span className="visually-hidden">(editable)</span>
                </label>
              </th>
              <td>
                <span className="prefix-edit">
                  /
                  <input
                    id="prefix-edit"
                    type="number"
                    min={0}
                    max={32}
                    value={prefixEdit}
                    onChange={(e) => onPrefixChange(e.target.value)}
                    aria-label="Prefix length 0 to 32 (editable)"
                  />
                </span>
              </td>
            </tr>
            <tr>
              <th scope="row">Broadcast</th>
              <td>
                <code>{outcome.result.broadcast}</code>
              </td>
            </tr>
            <tr>
              <th scope="row">Subnet mask</th>
              <td>
                <code>{outcome.result.subnetMask}</code>
              </td>
            </tr>
            <tr>
              <th scope="row">First host</th>
              <td>
                <code>{outcome.result.firstHost}</code>
              </td>
            </tr>
            <tr>
              <th scope="row">Last host</th>
              <td>
                <code>{outcome.result.lastHost}</code>
              </td>
            </tr>
            <tr>
              <th scope="row">Total addresses</th>
              <td>{outcome.result.totalAddresses.toLocaleString('en-US')}</td>
            </tr>
            <tr>
              <th scope="row">Usable hosts</th>
              <td>{outcome.result.usableHosts.toLocaleString('en-US')}</td>
            </tr>
            <tr>
              <th scope="row">Routable</th>
              <td>
                {outcome.routable ? (
                  <span className="badge badge-yes">Yes</span>
                ) : (
                  <span className="badge badge-no">No</span>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      ) : (
        <p className="error-box" role="alert">
          {outcome.error}
        </p>
      )}
      {outcome.ok && draftError && (
        <p className="draft-hint" role="status">
          {draftError}
        </p>
      )}

      <section className="field-guide" aria-label="Field explanations">
        <h2>What do these fields mean?</h2>
        <dl>
          <div>
            <dt>Network</dt>
            <dd>
              The first address of the block. All host bits are zero — it
              identifies the subnet itself and cannot be assigned to a device.
            </dd>
          </div>
          <div>
            <dt>Broadcast</dt>
            <dd>
              The last address of the block, with all host bits set to one.
              Traffic sent here reaches every host on the subnet; it cannot be
              assigned to a device.
            </dd>
          </div>
          <div>
            <dt>Subnet mask</dt>
            <dd>
              A 32-bit mask that splits the address into network and host
              parts. A <code>255</code> octet means those 8 bits belong to the
              network; <code>0</code> means they belong to hosts.
            </dd>
          </div>
          <div>
            <dt>Prefix length</dt>
            <dd>
              The number after the slash in CIDR notation (0–32). It counts how
              many leading bits are the network portion — e.g. <code>/24</code>{' '}
              leaves 8 bits for 256 addresses.
            </dd>
          </div>
          <div>
            <dt>First / Last host</dt>
            <dd>
              The first and last addresses you can actually assign to devices:
              network address + 1 up to broadcast address − 1. On a{' '}
              <code>/31</code> link both addresses are usable (RFC 3021), and on
              a <code>/32</code> there is a single host.
            </dd>
          </div>
          <div>
            <dt>Total addresses</dt>
            <dd>
              Every address in the block, equal to 2 raised to the number of
              host bits — network and broadcast included.
            </dd>
          </div>
          <div>
            <dt>Usable hosts</dt>
            <dd>
              Total addresses minus the reserved network and broadcast
              addresses. A <code>/31</code> has 2 usable hosts and a{' '}
              <code>/32</code> has 1, since nothing is reserved there.
            </dd>
          </div>
          <div>
            <dt>Routable</dt>
            <dd>
              Whether the subnet is part of the publicly routable address
              space. Private ranges (<code>10.0.0.0/8</code>,{' '}
              <code>172.16.0.0/12</code>, <code>192.168.0.0/16</code>),
              loopback, link-local, multicast, reserved and documentation
              blocks are not routable on the public internet.
            </dd>
          </div>
        </dl>
      </section>
    </main>
  )
}

export default IpCalculator
