import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { calculateCIDR, type CidrResult } from '@webtools/core'
import './IpCalculator.css'

const DEFAULT_CIDR = '192.168.1.0/24'
const EXAMPLES = ['10.0.0.0/8', '172.16.0.0/12', '192.168.1.0/25', '10.10.10.0/30']

type Outcome =
  | { ok: true; result: CidrResult }
  | { ok: false; error: string };

function IpCalculator() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [input, setInput] = useState(() => searchParams.get('cidr') ?? DEFAULT_CIDR)
  const [submitted, setSubmitted] = useState(
    () => searchParams.get('cidr') ?? DEFAULT_CIDR,
  )

  useEffect(() => {
    document.title = 'IP Subnet Calculator — WebTools'
  }, [])

  const outcome: Outcome = useMemo(() => {
    try {
      return { ok: true, result: calculateCIDR(submitted) }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Invalid IPv4 CIDR' }
    }
  }, [submitted])

  const submit = (value: string) => {
    setSubmitted(value)
    setSearchParams(value ? { cidr: value } : {}, { replace: true })
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
              <th scope="row">Network</th>
              <td>
                <code>{outcome.result.network}</code>
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
              <th scope="row">Prefix length</th>
              <td>
                <code>/{outcome.result.prefix}</code>
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
          </tbody>
        </table>
      ) : (
        <p className="error-box" role="alert">
          {outcome.error}
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
        </dl>
      </section>
    </main>
  )
}

export default IpCalculator
