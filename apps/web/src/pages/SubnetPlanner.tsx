import { useEffect, useId, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  bytesToText,
  calculateCIDR,
  decodeBase64,
  encodeBase64,
  ipToInt,
  isIPv4,
  planSubnets,
  prefixForHosts,
  SUBNET_RESERVATION_NAMES,
  SUBNET_RESERVATIONS,
  textToBytes,
  usableHostsForPrefix,
  type SubnetAllocation,
  type SubnetAllocationError,
  type SubnetPlan,
  type SubnetReservation,
} from '@webtools/core'
import CopyJsonButton from '../components/CopyJsonButton'
import { Examples, SegmentedControl, ToolPage } from '../components/ToolPage'
import './SubnetPlanner.css'

/* ---- Plan tree -------------------------------------------------------------- */

interface PlanNode {
  id: number
  name: string
  hosts: number
  /** Preferred network address, set when the subnet was created from a free block. */
  at?: string
  children: PlanNode[]
}

/** A node as written in examples and parsed from the URL (no ids yet). */
interface NodeSpec {
  name: string
  hosts: number
  at?: string
  children?: NodeSpec[]
}

let nextId = 1
const withIds = (specs: NodeSpec[]): PlanNode[] =>
  specs.map((s) => ({ id: nextId++, name: s.name, hosts: s.hosts, at: s.at, children: withIds(s.children ?? []) }))

function mapTree(nodes: PlanNode[], fn: (node: PlanNode) => PlanNode | null): PlanNode[] {
  return nodes.flatMap((n) => {
    const next = fn({ ...n, children: mapTree(n.children, fn) })
    return next ? [next] : []
  })
}

/** Biggest subnets first at every level; ties keep their order. Picked addresses are dropped. */
function packLargestFirst(nodes: PlanNode[], reservation: SubnetReservation): PlanNode[] {
  const rank = (n: PlanNode) => prefixForHosts(n.hosts, reservation) ?? 99
  return [...nodes]
    .sort((a, b) => rank(a) - rank(b))
    .map((n) => ({ ...n, at: undefined, children: packLargestFirst(n.children, reservation) }))
}

/* ---- URL format ------------------------------------------------------------
 * The whole plan lives in one `p` parameter: URL-safe Base64 (no padding) of
 * a compact JSON value `{ c: cidr, r?: reservation, s: subnets }`, where each
 * subnet is `[hosts, name?, address?, children?]` with trailing defaults
 * dropped. `?cidr=10.0.0.0/16` alone also works, to start an empty plan.
 */

type WireNode = [number, string?, string?, WireNode[]?]

interface PlanState {
  cidr: string
  reservation: SubnetReservation
  nodes: NodeSpec[]
}

function toWire(nodes: PlanNode[]): WireNode[] {
  return nodes.map((n) => {
    const w: WireNode = [n.hosts, n.name, n.at ?? '', n.children.length ? toWire(n.children) : undefined]
    while (w.length > 1 && (w[w.length - 1] === undefined || w[w.length - 1] === '')) w.pop()
    return w
  })
}

function fromWire(value: unknown, depth = 0): NodeSpec[] {
  if (!Array.isArray(value) || depth > 32) throw new Error('bad plan')
  return value.map((w) => {
    if (!Array.isArray(w)) throw new Error('bad plan')
    const [hosts, name = '', at = '', children = []] = w as unknown[]
    if (!Number.isInteger(hosts) || (hosts as number) < 1) throw new Error('bad plan')
    if (typeof name !== 'string' || typeof at !== 'string') throw new Error('bad plan')
    if (at !== '' && !isIPv4(at)) throw new Error('bad plan')
    const node: NodeSpec = { hosts: hosts as number, name, children: fromWire(children, depth + 1) }
    if (at) node.at = at
    return node
  })
}

function encodePlan(state: { cidr: string; reservation: SubnetReservation; nodes: PlanNode[] }): string {
  const value: { c: string; r?: SubnetReservation; s: WireNode[] } = { c: state.cidr.trim(), s: toWire(state.nodes) }
  if (state.reservation !== 'standard') value.r = state.reservation
  return encodeBase64(textToBytes(JSON.stringify(value)), { urlSafe: true, padding: false })
}

function decodePlan(text: string): PlanState | null {
  try {
    const json = bytesToText(decodeBase64(text))
    if (json === null) return null
    const value = JSON.parse(json) as { c?: unknown; r?: unknown; s?: unknown }
    if (typeof value?.c !== 'string') return null
    const reservation = SUBNET_RESERVATION_NAMES.find((r) => r === value.r) ?? 'standard'
    return { cidr: value.c, reservation, nodes: fromWire(value.s ?? []) }
  } catch {
    return null
  }
}

/* ---- Computed plan ------------------------------------------------------------ */

interface PlannedLevel {
  plan: SubnetPlan
  rows: PlannedRow[]
}

interface PlannedRow {
  node: PlanNode
  entry: SubnetAllocation | SubnetAllocationError
  /** Children planned inside this subnet, when it was allocated. */
  inner: PlannedLevel | null
}

function planLevel(cidr: string, nodes: PlanNode[], reservation: SubnetReservation): PlannedLevel {
  const plan = planSubnets(
    cidr,
    nodes.map((n) => ({ hosts: n.hosts, name: n.name, at: n.at })),
    { reservation },
  )
  return {
    plan,
    rows: nodes.map((node, i) => {
      const entry = plan.entries[i]
      return { node, entry, inner: entry.ok ? planLevel(entry.cidr, node.children, reservation) : null }
    }),
  }
}

function cidrError(cidr: string): string | null {
  try {
    calculateCIDR(cidr)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid CIDR.'
  }
}

function tryPlan(cidr: string, nodes: PlanNode[], reservation: SubnetReservation) {
  try {
    return { ok: true as const, level: planLevel(cidr, nodes, reservation) }
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : 'Invalid CIDR.' }
  }
}

/** Largest number of hosts a subnet could get among its siblings. */
function maxPrefixFor(level: PlannedLevel, index: number, reservation: SubnetReservation): number {
  const { parent } = level.plan
  const others = level.rows.filter((_, i) => i !== index).map((r) => ({ hosts: r.node.hosts }))
  const free = planSubnets(parent.cidr, others, { reservation }).free
  const largest = free.length ? Math.min(...free.map((b) => Number(b.split('/')[1]))) : parent.prefix
  return Math.max(largest, parent.prefix)
}

/* ---- Exports ------------------------------------------------------------------- */

interface FlatRow {
  depth: number
  name: string
  cidr: string
  mask: string
  firstHost: string
  lastHost: string
  broadcast: string
  usableHosts: number
  requestedHosts: number | null
}

function flatten(level: PlannedLevel | null, depth = 0, out: FlatRow[] = []): FlatRow[] {
  if (!level) return out
  const items: { start: number; row: FlatRow; inner: PlannedLevel | null }[] = []
  for (const r of level.rows) {
    if (!r.entry.ok) continue
    const e = r.entry
    items.push({
      start: e.start,
      inner: r.inner,
      row: {
        depth,
        name: e.name,
        cidr: e.cidr,
        mask: e.subnetMask,
        firstHost: e.firstHost ?? '',
        lastHost: e.lastHost ?? '',
        broadcast: e.broadcast,
        usableHosts: e.usableHosts,
        requestedHosts: e.requestedHosts,
      },
    })
  }
  for (const cidr of level.plan.free) {
    const c = calculateCIDR(cidr)
    items.push({
      start: ipToInt(c.network),
      inner: null,
      row: {
        depth,
        name: 'Spare',
        cidr,
        mask: c.subnetMask,
        firstHost: c.firstHost ?? '',
        lastHost: c.lastHost ?? '',
        broadcast: c.broadcast,
        usableHosts: c.usableHosts,
        requestedHosts: null,
      },
    })
  }
  items.sort((a, b) => a.start - b.start)
  for (const item of items) {
    out.push(item.row)
    // A spare block inside a subnet that has children is listed under it.
    if (item.inner && item.inner.rows.length) flatten(item.inner, depth + 1, out)
  }
  return out
}

function toMarkdown(rows: FlatRow[]): string {
  const lines = ['| Subnet | Name | Range | Usable hosts |', '|---|---|---|---|']
  for (const r of rows) {
    const indent = '\u00a0\u00a0'.repeat(r.depth)
    lines.push(`| ${indent}\`${r.cidr}\` | ${r.name.replace(/\|/g, '\\|')} | ${r.firstHost} – ${r.lastHost} | ${r.usableHosts.toLocaleString('en-US')} |`)
  }
  return lines.join('\n')
}

function toCsv(rows: FlatRow[]): string {
  const q = (v: string | number | null) => {
    const s = v === null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = 'depth,name,cidr,mask,first_host,last_host,broadcast,usable_hosts,requested_hosts'
  return [
    head,
    ...rows.map((r) =>
      [r.depth, r.name, r.cidr, r.mask, r.firstHost, r.lastHost, r.broadcast, r.usableHosts, r.requestedHosts].map(q).join(','),
    ),
  ].join('\n')
}

function toJson(level: PlannedLevel): unknown {
  return {
    cidr: level.plan.parent.cidr,
    free: level.plan.free,
    subnets: level.rows.map((r) =>
      r.entry.ok
        ? {
            name: r.entry.name,
            cidr: r.entry.cidr,
            mask: r.entry.subnetMask,
            network: r.entry.network,
            firstHost: r.entry.firstHost,
            lastHost: r.entry.lastHost,
            broadcast: r.entry.broadcast,
            usableHosts: r.entry.usableHosts,
            requestedHosts: r.entry.requestedHosts,
            ...(r.inner && r.inner.rows.length ? { split: toJson(r.inner) } : {}),
          }
        : { name: r.entry.name, requestedHosts: r.entry.requestedHosts, error: r.entry.error },
    ),
  }
}

/* ---- Examples ------------------------------------------------------------------ */

interface Example {
  label: string
  title: string
  cidr: string
  reservation: SubnetReservation
  plan: NodeSpec[]
}

const az = (zone: string): NodeSpec => ({
  name: zone,
  hosts: 4091,
  children: [
    { name: 'Private', hosts: 2043 },
    { name: 'Public', hosts: 251 },
  ],
})

const EXAMPLES: Example[] = [
  {
    label: 'Office /22',
    title: 'The office plan from the "Reading a CIDR block" guide',
    cidr: '10.20.0.0/22',
    reservation: 'standard',
    plan: [
      { name: 'Staff laptops', hosts: 254 },
      { name: 'Wi-Fi guests', hosts: 254 },
      { name: 'Printers and IoT', hosts: 126 },
      { name: 'Servers', hosts: 126 },
    ],
  },
  {
    label: 'AWS VPC /16',
    title: 'A VPC split per availability zone, then into private and public subnets',
    cidr: '10.0.0.0/16',
    reservation: 'aws',
    plan: [az('eu-west-1a'), az('eu-west-1b'), az('eu-west-1c')],
  },
  {
    label: 'Home lab /24',
    title: 'A small network with a point-to-point link',
    cidr: '192.168.1.0/24',
    reservation: 'standard',
    plan: [
      { name: 'LAN', hosts: 100 },
      { name: 'IoT', hosts: 50 },
      { name: 'DMZ', hosts: 10 },
      { name: 'Router link', hosts: 2 },
    ],
  },
]

const DEFAULT = EXAMPLES[0]

/* ---- Components ---------------------------------------------------------------- */

const fmt = (n: number) => n.toLocaleString('en-US')

/** Power-of-two slider plus an exact count on its right. */
function HostsControl({
  hosts,
  minPrefix,
  reservation,
  label,
  onChange,
}: {
  hosts: number
  /** Largest block allowed (smallest prefix number). */
  minPrefix: number
  reservation: SubnetReservation
  label: string
  onChange: (hosts: number) => void
}) {
  const maxPrefix = SUBNET_RESERVATIONS[reservation].maxPrefix
  const prefix = prefixForHosts(hosts, reservation)
  const lo = Math.min(minPrefix, prefix ?? minPrefix)
  const steps = maxPrefix - lo
  const position = prefix === null ? steps : maxPrefix - prefix
  const [draft, setDraft] = useState<string | null>(null)
  const maxHosts = usableHostsForPrefix(lo, reservation)

  return (
    <div className="sp-hosts">
      <input
        type="range"
        className="sp-slider"
        min={0}
        max={steps}
        value={Math.min(position, steps)}
        disabled={steps === 0}
        aria-label={`${label}: block size`}
        aria-valuetext={prefix === null ? undefined : `/${prefix}, ${usableHostsForPrefix(prefix, reservation)} hosts`}
        onChange={(e) => {
          setDraft(null)
          onChange(usableHostsForPrefix(maxPrefix - Number(e.target.value), reservation))
        }}
      />
      <input
        type="number"
        className="sp-number"
        min={1}
        max={maxHosts}
        value={draft ?? hosts}
        aria-label={`${label}: hosts needed`}
        aria-invalid={draft !== null}
        title="Hosts needed"
        onChange={(e) => {
          const n = Number(e.target.value)
          if (e.target.value !== '' && Number.isInteger(n) && n >= 1 && prefixForHosts(n, reservation) !== null) {
            setDraft(null)
            onChange(n)
          } else {
            setDraft(e.target.value)
          }
        }}
        onBlur={() => setDraft(null)}
      />
      <span className="sp-hosts-unit">hosts</span>
    </div>
  )
}

function UsageBar({
  level,
  reservation,
  onPickFree,
}: {
  level: PlannedLevel
  reservation: SubnetReservation
  onPickFree: (cidr: string) => void
}) {
  const { parent, usedAddresses } = level.plan
  const start = ipToInt(parent.network)
  const size = parent.totalAddresses
  const pct = (n: number) => `${(n / size) * 100}%`
  return (
    <div className="sp-usage">
      <div className="sp-bar" role="img" aria-label={`${fmt(usedAddresses)} of ${fmt(size)} addresses allocated`}>
        {level.rows.map((r, i) =>
          r.entry.ok ? (
            <span
              key={r.node.id}
              className="sp-bar-seg"
              title={`${r.entry.name || `Subnet ${i + 1}`}: ${r.entry.cidr}`}
              style={
                {
                  left: pct(r.entry.start - start),
                  width: pct(r.entry.totalAddresses),
                  '--seg-hue': (i * 57) % 360,
                } as React.CSSProperties
              }
            />
          ) : null,
        )}
      </div>
      <p className="sp-usage-text">
        {fmt(usedAddresses)} of {fmt(size)} addresses allocated ({Math.round((usedAddresses / size) * 1000) / 10}%)
        {level.plan.free.length > 0 && (
          <>
            {' · '}Free:{' '}
            {level.plan.free.slice(0, 6).map((b, i) => {
              const usable = usableHostsForPrefix(Number(b.split('/')[1]), reservation)
              return (
                <span key={b}>
                  {i > 0 && ', '}
                  {usable > 0 ? (
                    <button
                      type="button"
                      className="sp-free"
                      onClick={() => onPickFree(b)}
                      title={`Add a subnet on ${b} (${fmt(usable)} hosts)`}
                    >
                      {b}
                    </button>
                  ) : (
                    <code title={`Too small for a ${SUBNET_RESERVATIONS[reservation].label} subnet`}>{b}</code>
                  )}
                </span>
              )
            })}
            {level.plan.free.length > 6 && ` and ${level.plan.free.length - 6} more`}
          </>
        )}
      </p>
    </div>
  )
}

interface Actions {
  rename: (id: number, name: string) => void
  setHosts: (id: number, hosts: number) => void
  remove: (id: number) => void
  /** Add a subnet under `parentId` (null: the top-level block). */
  add: (parentId: number | null, level: PlannedLevel) => void
  /** Add a subnet filling the free block `cidr` under `parentId`. */
  addAt: (parentId: number | null, cidr: string) => void
}

function Level({
  level,
  parentId,
  depth,
  reservation,
  actions,
}: {
  level: PlannedLevel
  parentId: number | null
  depth: number
  reservation: SubnetReservation
  actions: Actions
}) {
  const full = level.plan.free.length === 0
  return (
    <div className={depth === 0 ? 'sp-level' : 'sp-level sp-level-nested'}>
      {level.rows.length > 0 && (
        <UsageBar level={level} reservation={reservation} onPickFree={(b) => actions.addAt(parentId, b)} />
      )}
      <ol className="sp-list">
        {level.rows.map((row, i) => (
          <SubnetRow
            key={row.node.id}
            row={row}
            index={i}
            level={level}
            depth={depth}
            reservation={reservation}
            actions={actions}
          />
        ))}
      </ol>
      <button
        type="button"
        className="sp-add"
        disabled={full}
        title={full ? 'No free space left in this block' : undefined}
        onClick={() => actions.add(parentId, level)}
      >
        + Add subnet{depth > 0 ? ` in ${level.plan.parent.cidr}` : ''}
      </button>
    </div>
  )
}

function SubnetRow({
  row,
  index,
  level,
  depth,
  reservation,
  actions,
}: {
  row: PlannedRow
  index: number
  level: PlannedLevel
  depth: number
  reservation: SubnetReservation
  actions: Actions
}) {
  const { node, entry } = row
  const minPrefix = useMemo(() => maxPrefixFor(level, index, reservation), [level, index, reservation])
  const label = node.name || `Subnet ${index + 1}`
  return (
    <li className={entry.ok ? 'sp-subnet' : 'sp-subnet sp-subnet-error'}>
      <div className="sp-row">
        <span className="sp-swatch" style={{ '--seg-hue': (index * 57) % 360 } as React.CSSProperties} aria-hidden="true" />
        <input
          className="sp-name"
          value={node.name}
          placeholder={`Subnet ${index + 1}`}
          aria-label="Subnet name"
          onChange={(e) => actions.rename(node.id, e.target.value)}
        />
        <code className="sp-cidr">{entry.ok ? entry.cidr : entry.prefix === null ? '—' : `/${entry.prefix}`}</code>
        <HostsControl
          hosts={node.hosts}
          minPrefix={minPrefix}
          reservation={reservation}
          label={label}
          onChange={(hosts) => actions.setHosts(node.id, hosts)}
        />
        <div className="sp-subnet-actions">
          {entry.ok && entry.prefix < SUBNET_RESERVATIONS[reservation].maxPrefix && (
            <button
              type="button"
              className="sp-icon-btn"
              disabled={!!row.inner && row.inner.plan.free.length === 0}
              onClick={() => row.inner && actions.add(node.id, row.inner)}
              title={`Split ${entry.cidr} into smaller subnets`}
              aria-label={`Split ${label}`}
            >
              Split
            </button>
          )}
          <button
            type="button"
            className="sp-icon-btn sp-remove"
            onClick={() => actions.remove(node.id)}
            title="Remove"
            aria-label={`Remove ${label}`}
          >
            ×
          </button>
        </div>
      </div>

      {entry.ok ? (
        <dl className="sp-values">
          <div title="First and last usable host">
            <dt>Hosts</dt>
            <dd>
              {entry.firstHost} – {entry.lastHost}
            </dd>
          </div>
          <div>
            <dt>Mask</dt>
            <dd>{entry.subnetMask}</dd>
          </div>
          <div>
            <dt>Broadcast</dt>
            <dd>{entry.broadcast}</dd>
          </div>
          <div title={`${fmt(entry.totalAddresses)} addresses in the block`}>
            <dt>Usable</dt>
            <dd>{fmt(entry.usableHosts)}</dd>
          </div>
          <div>
            <dt>Spare</dt>
            <dd>{fmt(entry.spare)}</dd>
          </div>
        </dl>
      ) : (
        <p className="sp-error" role="alert">
          {entry.error}
        </p>
      )}

      {row.inner && row.inner.rows.length > 0 && (
        <Level level={row.inner} parentId={node.id} depth={depth + 1} reservation={reservation} actions={actions} />
      )}
    </li>
  )
}

/* ---- Page ---------------------------------------------------------------------- */

function initialState(params: URLSearchParams) {
  const encoded = params.get('p')
  const decoded = encoded ? decodePlan(encoded) : null
  const state: PlanState = decoded ??
    (params.get('cidr')
      ? { cidr: params.get('cidr') ?? '', reservation: 'standard', nodes: [] }
      : { cidr: DEFAULT.cidr, reservation: DEFAULT.reservation, nodes: DEFAULT.plan })
  return { ...state, nodes: withIds(state.nodes) }
}

function SubnetPlanner() {
  const [params, setParams] = useSearchParams()
  const [initial] = useState(() => initialState(params))
  const [cidr, setCidr] = useState(initial.cidr)
  // Last valid block: the plan stays on screen while the input is being edited.
  const [plannedCidr, setPlannedCidr] = useState(() => (cidrError(initial.cidr) ? DEFAULT.cidr : initial.cidr))
  const [reservation, setReservation] = useState<SubnetReservation>(initial.reservation)
  const [nodes, setNodes] = useState<PlanNode[]>(initial.nodes)
  const inputId = useId()
  const noteId = useId()

  const inputError = useMemo(() => cidrError(cidr), [cidr])
  const outcome = useMemo(() => tryPlan(plannedCidr, nodes, reservation), [plannedCidr, nodes, reservation])
  const level = outcome.ok ? outcome.level : null

  // Keep the plan in the URL so it can be shared.
  useEffect(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        for (const legacy of ['cidr', 'plan', 'res']) next.delete(legacy)
        next.set('p', encodePlan({ cidr: plannedCidr, reservation, nodes }))
        return next
      },
      { replace: true },
    )
  }, [plannedCidr, nodes, reservation, setParams])

  const commit = (nextNodes: PlanNode[], nextReservation = reservation) => {
    setNodes(nextNodes)
    setReservation(nextReservation)
  }

  const insert = (parentId: number | null, node: PlanNode) => {
    if (parentId === null) commit([...nodes, node])
    else commit(mapTree(nodes, (n) => (n.id === parentId ? { ...n, children: [...n.children, node] } : n)))
  }

  const actions: Actions = {
    rename: (id, name) => setNodes((ns) => mapTree(ns, (n) => (n.id === id ? { ...n, name } : n))),
    setHosts: (id, hosts) => commit(mapTree(nodes, (n) => (n.id === id ? { ...n, hosts } : n))),
    addAt: (parentId, block) => {
      const [network, prefix] = block.split('/')
      const hosts = usableHostsForPrefix(Number(prefix), reservation)
      if (hosts < 1) return
      insert(parentId, { id: nextId++, name: '', hosts, at: network, children: [] })
    },
    remove: (id) => commit(mapTree(nodes, (n) => (n.id === id ? null : n))),
    add: (parentId, at) => {
      // Default size: half the largest free block (the whole of it when it
      // is the last one that fits).
      const free = at.plan.free.map((b) => Number(b.split('/')[1]))
      const largest = free.length ? Math.min(...free) : at.plan.parent.prefix
      const maxPrefix = SUBNET_RESERVATIONS[reservation].maxPrefix
      const prefix = Math.min(largest === at.plan.parent.prefix ? largest + 1 : largest, maxPrefix)
      const hosts = Math.max(1, usableHostsForPrefix(prefix, reservation))
      insert(parentId, { id: nextId++, name: '', hosts, children: [] })
    },
  }

  const load = (ex: Example) => {
    setCidr(ex.cidr)
    setPlannedCidr(ex.cidr)
    setReservation(ex.reservation)
    setNodes(withIds(ex.plan))
  }

  const flat = useMemo(() => flatten(level), [level])
  const hasSubnets = nodes.length > 0
  const parent = level?.plan.parent

  return (
    <ToolPage
      toolId="subnet-planner"
      wide
      className="sp-page"
      lede={
        <>
          Split an IPv4 block into subnets sized by how many hosts each one needs. Each subnet
          lands on an aligned boundary, can be split again, and the free space is listed as CIDR
          blocks. Everything runs in your browser.
        </>
      }
    >
      <div className="tool-controls sp-controls">
        <div className="tool-field sp-parent">
          <label htmlFor={inputId}>Block to split</label>
          <input
            id={inputId}
            className="tool-input"
            value={cidr}
            onChange={(e) => {
              const next = e.target.value
              setCidr(next)
              if (!cidrError(next)) setPlannedCidr(next)
            }}
            onBlur={() => {
              // Leaving the field with an invalid block brings back the planned one.
              if (inputError) setCidr(plannedCidr)
            }}
            placeholder="e.g. 10.20.0.0/22"
            aria-invalid={!!inputError}
            aria-describedby={noteId}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <div className="tool-field">
          Reserved per subnet
          <SegmentedControl
            ariaLabel="Reserved addresses per subnet"
            value={reservation}
            options={SUBNET_RESERVATION_NAMES.map((r) => ({ value: r, label: SUBNET_RESERVATIONS[r].label }))}
            onChange={(r) => commit(nodes, r)}
          />
        </div>
      </div>
      {/* The error takes the note's place, so nothing below moves. */}
      <p id={noteId} className={inputError ? 'sp-note sp-note-error' : 'sp-note'} role={inputError ? 'alert' : undefined}>
        {inputError ?? SUBNET_RESERVATIONS[reservation].note}
      </p>

      <Examples items={EXAMPLES.map((ex) => ({ label: ex.label, title: ex.title, onClick: () => load(ex) }))} />

      {!outcome.ok ? (
        <div className="error-box" role="alert">
          {outcome.error}
        </div>
      ) : (
        parent &&
        level && (
          <div className={inputError ? 'sp-plan sp-plan-stale' : 'sp-plan'}>
            <section className="sp-summary" aria-label="Block summary">
              <code className="sp-summary-cidr">{parent.cidr}</code>
              <span>
                {parent.network} – {parent.broadcast}
              </span>
              <span>mask {parent.subnetMask}</span>
              <span>{fmt(parent.totalAddresses)} addresses</span>
              {parent.cidr !== plannedCidr.trim() && <span className="badge badge-neutral">normalised from {plannedCidr.trim()}</span>}
            </section>

            <div className="sp-toolbar">
              <button
                type="button"
                className="button button-secondary"
                disabled={!hasSubnets}
                onClick={() => commit(packLargestFirst(nodes, reservation))}
                title="Reorder every level so the biggest subnets are placed first. Packs tighter."
              >
                Pack largest first
              </button>
              <button
                type="button"
                className="button button-ghost"
                disabled={!hasSubnets}
                onClick={() => commit([])}
              >
                Clear
              </button>
              <div className="sp-export">
                <CopyJsonButton text={toMarkdown(flat)} label="Markdown" size="sm" disabled={!hasSubnets} ariaLabel="Copy as Markdown table" />
                <CopyJsonButton text={toCsv(flat)} label="CSV" size="sm" disabled={!hasSubnets} ariaLabel="Copy as CSV" />
                <CopyJsonButton data={toJson(level)} label="JSON" size="sm" disabled={!hasSubnets} ariaLabel="Copy as JSON" />
              </div>
            </div>

            <Level level={level} parentId={null} depth={0} reservation={reservation} actions={actions} />

            <p className="sp-footer">
              Need the details of a single block? Use the <Link to="/ip">IP Subnet Calculator</Link>. Why
              subnets must be aligned is explained in{' '}
              <Link to="/blog/reading-cidr-blocks">Reading a CIDR block</Link>.
            </p>
          </div>
        )
      )}
    </ToolPage>
  )
}

export default SubnetPlanner
