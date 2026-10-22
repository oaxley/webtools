import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTheme } from '../theme'
import { calculateCIDR, isRoutable, type CidrResult } from '@webtools/core'
import CopyJsonButton from '../components/CopyJsonButton'
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

interface NodeBox {
  label: string
  value: string
  cx: number
  cy: number
  width: number
  height: number
}

// Hit-test region bound to a field-guide anchor so clicking a canvas box
// scrolls down to the matching explanation.
interface HitRegion {
  anchor: string
  x: number
  y: number
  width: number
  height: number
}

// Reads a CSS custom property from the document root. Used to keep the
// canvas visualisation in sync with the current light/dark theme without
// hard-coding colours in the component.
function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function drawCloud(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  stroke: string,
  fill: string,
) {
  const r = 26
  ctx.save()
  ctx.beginPath()
  // A friendly four-bump cloud, roughly centred on (cx, cy).
  ctx.arc(cx - 32, cy + 4, r * 0.7, Math.PI * 0.5, Math.PI * 1.5)
  ctx.arc(cx - 14, cy - 14, r * 0.8, Math.PI, Math.PI * 1.85)
  ctx.arc(cx + 14, cy - 18, r * 0.85, Math.PI * 1.1, Math.PI * 1.9)
  ctx.arc(cx + 34, cy + 2, r * 0.7, Math.PI * 1.5, Math.PI * 0.5)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = stroke
  ctx.stroke()
  ctx.restore()

  ctx.save()
  ctx.fillStyle = stroke
  ctx.font = '600 13px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('Internet', cx, cy + 4)
  ctx.restore()
}

function drawNode(
  ctx: CanvasRenderingContext2D,
  node: NodeBox,
  stroke: string,
  fill: string,
  text: string,
  muted: string,
  options: { drawValue?: boolean } = {},
) {
  const { cx, cy, width, height, label, value } = node
  const drawValue = options.drawValue ?? true
  const x = cx - width / 2
  const y = cy - height / 2
  const r = 10
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + width - r, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + r)
  ctx.lineTo(x + width, y + height - r)
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  ctx.lineTo(x + r, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = stroke
  ctx.stroke()

  ctx.fillStyle = muted
  ctx.font = '600 11px system-ui, -apple-system, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label.toUpperCase(), cx, y + 16)

  if (drawValue) {
    ctx.fillStyle = text
    ctx.font = '600 14px ui-monospace, SFMono-Regular, Menlo, monospace'
    ctx.fillText(value, cx, y + height - 18)
  }
  ctx.restore()
}

function drawLink(
  ctx: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  stroke: string,
  width = 1.5,
) {
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(from.x, from.y)
  ctx.lineTo(to.x, to.y)
  ctx.lineWidth = width
  ctx.strokeStyle = stroke
  ctx.stroke()
  ctx.restore()
}

// Layout constants shared between the canvas drawing and the HTML overlay
// so the two stay perfectly aligned on resize.
const SUBNET_BOX_WIDTH = 240
const BOX_HEIGHT = 60
const PREFIX_BOX_WIDTH = 110
const BOX_GAP = 14
const SUBNET_CENTER_Y = 180
const CANVAS_HEIGHT = 520

// Mobile fallback: the canvas gets cramped on narrow viewports, so under
// 640px we switch to a classic key/value table. Each row is a clickable
// link to the matching field-guide entry below, mirroring the canvas
// click-to-explain affordance.
interface MobileTableProps {
  outcome: Outcome
  netEdit: string
  prefixEdit: string
  onNetChange: (value: string) => void
  onPrefixChange: (value: string) => void
  jumpToField: (anchor: string) => void
}

function MobileTable({
  outcome,
  netEdit,
  prefixEdit,
  onNetChange,
  onPrefixChange,
  jumpToField,
}: MobileTableProps) {
  if (!outcome.ok) return null
  const { result, routable } = outcome

  const rows: Array<{ anchor: string; label: string; value: React.ReactNode }> = [
    {
      anchor: 'field-broadcast',
      label: 'Broadcast',
      value: <code>{result.broadcast}</code>,
    },
    {
      anchor: 'field-subnet-mask',
      label: 'Subnet mask',
      value: <code>{result.subnetMask}</code>,
    },
    {
      anchor: 'field-host-range',
      label: 'First host',
      value: <code>{result.firstHost ?? '—'}</code>,
    },
    {
      anchor: 'field-host-range',
      label: 'Last host',
      value: <code>{result.lastHost ?? '—'}</code>,
    },
    {
      anchor: 'field-total',
      label: 'Total addresses',
      value: result.totalAddresses.toLocaleString('en-US'),
    },
    {
      anchor: 'field-usable',
      label: 'Usable hosts',
      value: result.usableHosts.toLocaleString('en-US'),
    },
    {
      anchor: 'field-routable',
      label: 'Routable',
      value: routable ? (
        <span className="ip-badge ip-badge-yes">Yes</span>
      ) : (
        <span className="ip-badge ip-badge-no">No</span>
      ),
    },
  ]

  return (
    <table className="result-table">
      <tbody>
        {/* Editable Network row. Clicks on the <th> jump to the explanation,
            while the <input> itself stays usable. */}
        <tr>
          <th scope="row">
            <button
              type="button"
              className="row-link"
              onClick={() => jumpToField('field-network')}
            >
              Network
            </button>
          </th>
          <td>
            <input
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
            <button
              type="button"
              className="row-link"
              onClick={() => jumpToField('field-prefix')}
            >
              Prefix length
            </button>
          </th>
          <td>
            <span className="prefix-edit">
              /
              <input
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
        {rows.map((row, i) => (
          <tr key={`${row.anchor}-${i}`} className="row-clickable">
            <th scope="row">
              {/* The explicit onClick on the button is important: on touch
                  devices `click` events on <tr> don't always fire, so we
                  avoid relying on bubbling. The whole row still looks
                  clickable thanks to the .row-clickable hover styles. */}
              <button
                type="button"
                className="row-link"
                onClick={() => jumpToField(row.anchor)}
              >
                {row.label}
              </button>
            </th>
            <td
              className="cell-clickable"
              onClick={() => jumpToField(row.anchor)}
            >
              {row.value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function IpCalculator() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initial = searchParams.get('cidr') ?? DEFAULT_CIDR
  const [input, setInput] = useState(initial)
  const [submitted, setSubmitted] = useState(initial)
  // The canvas reads colours from CSS variables, so redraw on theme change.
  const { theme } = useTheme()
  const [netEdit, setNetEdit] = useState(() => splitCidr(initial)[0])
  const [prefixEdit, setPrefixEdit] = useState(() => splitCidr(initial)[1])
  const [draftError, setDraftError] = useState<string | null>(null)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const hitRegionsRef = useRef<HitRegion[]>([])
  const [canvasWidth, setCanvasWidth] = useState(880)
  const [hoverAnchor, setHoverAnchor] = useState<string | null>(null)

  // On narrow viewports the canvas becomes cramped and labels overlap, so
  // we fall back to the classic table layout. The breakpoint matches the
  // existing mobile styles across the app.
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(max-width: 640px)').matches
  })

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(max-width: 640px)')
    const handler = (ev: MediaQueryListEvent) => setIsMobile(ev.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

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

  // Keep the canvas width in sync with its container so the diagram scales
  // down nicely on smaller viewports without needing CSS transforms.
  useLayoutEffect(() => {
    const el = wrapperRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.max(320, Math.floor(entry.contentRect.width - 24)) // minus padding
        setCanvasWidth(w)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const submit = (value: string) => {
    const trimmed = value.trim()
    const [net, prefix] = splitCidr(trimmed)
    setInput(value)
    try {
      calculateCIDR(trimmed)
      setSubmitted(trimmed)
      setNetEdit(net)
      setPrefixEdit(prefix)
      setDraftError(null)
      setSearchParams(trimmed ? { cidr: trimmed } : {}, { replace: true })
    } catch (e) {
      setDraftError(e instanceof Error ? e.message : 'Invalid IPv4 CIDR')
    }
  }

  // Live-update from the editable subnet / prefix fields embedded in the
  // canvas. Valid combinations recompute the diagram immediately; invalid
  // ones keep the last good diagram and show an inline hint instead of
  // wiping it mid-typing.
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

  // Precomputed layout coordinates in CSS pixels — reused by both the canvas
  // drawing effect and the HTML overlay below. The subnet box and prefix box
  // are treated as a pair, horizontally centred together.
  const pairWidth = SUBNET_BOX_WIDTH + BOX_GAP + PREFIX_BOX_WIDTH
  const pairLeft = canvasWidth / 2 - pairWidth / 2
  const subnetBoxLeft = pairLeft
  const subnetCenterX = subnetBoxLeft + SUBNET_BOX_WIDTH / 2
  const prefixBoxLeft = subnetBoxLeft + SUBNET_BOX_WIDTH + BOX_GAP
  const prefixCenterX = prefixBoxLeft + PREFIX_BOX_WIDTH / 2
  const subnetBoxTop = SUBNET_CENTER_Y - BOX_HEIGHT / 2

  // Redraw whenever the subnet, size, or theme-affecting state changes.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = canvasWidth
    const height = CANVAS_HEIGHT
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, width, height)

    const bg = cssVar('--bg', '#ffffff')
    const border = cssVar('--border', '#d4d4d8')
    const text = cssVar('--text-h', '#111827')
    const muted = cssVar('--text', '#6b7280')
    const panel = cssVar('--surface-2', '#f6f5f9')
    const routableColor = '#16a34a'
    const nonRoutableColor = '#dc2626'

    if (!outcome.ok) {
      ctx.fillStyle = muted
      ctx.font = '14px system-ui, -apple-system, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('Enter a valid IPv4 CIDR to see the diagram.', width / 2, height / 2)
      return
    }

    const { result, routable } = outcome

    // --- Layout --------------------------------------------------------------
    // The cloud is centred over the subnet box (not the subnet+prefix pair)
    // so the vertical "Internet" axis lines up with the network address.
    const cloudCenter = { x: subnetCenterX, y: 60 }
    const subnetCenter = { x: subnetCenterX, y: SUBNET_CENTER_Y }
    const prefixCenter = { x: prefixCenterX, y: SUBNET_CENTER_Y }

    const childY = 320
    // Four child boxes laid out in a row. We reserve a side margin on
    // both edges and a minimum inter-box gap, then size each box to
    // fit — crucially subtracting the gap budget from the available
    // width BEFORE dividing, otherwise the last box overflows the
    // canvas on narrower viewports (its right edge used to land at
    // `width + 10`, which is why the two right-hand boxes looked
    // clipped). Any slack beyond the box cap is redistributed as
    // extra gap so the row stays visually centred.
    const sideMargin = 20
    const minGap = 10
    const availableWidth = width - 2 * sideMargin
    const childWidth = Math.min(
      170,
      Math.floor((availableWidth - 3 * minGap) / 4),
    )
    const slack = Math.max(0, availableWidth - (4 * childWidth + 3 * minGap))
    const childGap = minGap + slack / 3
    const firstChildCx = sideMargin + childWidth / 2
    const childCenters = Array.from({ length: 4 }, (_, i) => ({
      x: firstChildCx + i * (childWidth + childGap),
      y: childY,
    }))

    const grandY = 450
    // `anchor` ties each box to its matching <div id> in the field guide below.
    const children: Array<NodeBox & { anchor: string }> = [
      {
        label: 'Network',
        value: result.network,
        cx: childCenters[0].x,
        cy: childCenters[0].y,
        width: childWidth,
        height: 60,
        anchor: 'field-network',
      },
      {
        label: 'Broadcast',
        value: result.broadcast,
        cx: childCenters[1].x,
        cy: childCenters[1].y,
        width: childWidth,
        height: 60,
        anchor: 'field-broadcast',
      },
      {
        label: 'First host',
        value: result.firstHost ?? '—',
        cx: childCenters[2].x,
        cy: childCenters[2].y,
        width: childWidth,
        height: 60,
        anchor: 'field-host-range',
      },
      {
        label: 'Total addresses',
        value: result.totalAddresses.toLocaleString('en-US'),
        cx: childCenters[3].x,
        cy: childCenters[3].y,
        width: childWidth,
        height: 60,
        anchor: 'field-total',
      },
    ]

    // `parent` is the index in `children` each grandchild hangs from.
    const grandchildren: Array<NodeBox & { anchor: string; parent: number }> = [
      {
        label: 'Subnet mask',
        value: result.subnetMask,
        cx: childCenters[0].x,
        cy: grandY,
        width: childWidth,
        height: 60,
        anchor: 'field-subnet-mask',
        parent: 0,
      },
      {
        label: 'Last host',
        value: result.lastHost ?? '—',
        cx: childCenters[2].x,
        cy: grandY,
        width: childWidth,
        height: 60,
        anchor: 'field-host-range',
        parent: 2,
      },
      {
        label: 'Usable hosts',
        value: result.usableHosts.toLocaleString('en-US'),
        cx: childCenters[3].x,
        cy: grandY,
        width: childWidth,
        height: 60,
        anchor: 'field-usable',
        parent: 3,
      },
    ]

    // --- Draw ----------------------------------------------------------------
    // Cloud → Subnet link, coloured by routability. Drops straight down into
    // the top edge of the subnet box.
    drawLink(
      ctx,
      { x: cloudCenter.x, y: cloudCenter.y + 24 },
      { x: subnetCenter.x, y: SUBNET_CENTER_Y - BOX_HEIGHT / 2 },
      routable ? routableColor : nonRoutableColor,
      3,
    )

    // Subnet → each child link.
    for (const c of children) {
      drawLink(
        ctx,
        { x: subnetCenter.x, y: subnetCenter.y + BOX_HEIGHT / 2 },
        { x: c.cx, y: c.cy - c.height / 2 },
        border,
      )
    }

    // Child → grandchild links: Network → Subnet mask, First host → Last host,
    // Total addresses → Usable hosts.
    for (const g of grandchildren) {
      const p = children[g.parent]
      drawLink(
        ctx,
        { x: p.cx, y: p.cy + p.height / 2 },
        { x: g.cx, y: g.cy - g.height / 2 },
        border,
      )
    }

    // Cloud (Internet).
    drawCloud(ctx, cloudCenter.x, cloudCenter.y, text, panel)

    // Subnet box without the value — the HTML input overlay renders it.
    const subnetNode: NodeBox = {
      label: 'IP',
      value: '',
      cx: subnetCenter.x,
      cy: subnetCenter.y,
      width: SUBNET_BOX_WIDTH,
      height: BOX_HEIGHT,
    }
    drawNode(ctx, subnetNode, text, panel, text, muted, { drawValue: false })

    // Prefix box, mirroring the subnet box but narrower; HTML overlay
    // renders the editable number so this stays non-interactive.
    const prefixNode: NodeBox = {
      label: 'Prefix',
      value: '',
      cx: prefixCenter.x,
      cy: prefixCenter.y,
      width: PREFIX_BOX_WIDTH,
      height: BOX_HEIGHT,
    }
    drawNode(ctx, prefixNode, text, panel, text, muted, { drawValue: false })

    // Routable / Not routable caption on the link, placed just right of the
    // routable link so it doesn't overlap either box.
    ctx.save()
    ctx.font = '600 12px system-ui, -apple-system, sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = routable ? routableColor : nonRoutableColor
    const linkMidY = (cloudCenter.y + 24 + SUBNET_CENTER_Y - BOX_HEIGHT / 2) / 2
    ctx.fillText(
      routable ? 'routable' : 'not routable',
      subnetCenter.x + 10,
      linkMidY,
    )
    ctx.restore()

    // Children and grandchildren.
    for (const c of children) drawNode(ctx, c, border, bg, text, muted)
    for (const g of grandchildren) drawNode(ctx, g, border, bg, text, muted)

    // Register hit regions for click-to-scroll. Includes the subnet /
    // prefix boxes (which also have HTML overlay inputs — the hit test
    // only fires outside those inputs because they stop event propagation).
    hitRegionsRef.current = [
      {
        anchor: 'field-network',
        x: subnetCenter.x - SUBNET_BOX_WIDTH / 2,
        y: subnetCenter.y - BOX_HEIGHT / 2,
        width: SUBNET_BOX_WIDTH,
        height: BOX_HEIGHT,
      },
      {
        anchor: 'field-prefix',
        x: prefixCenter.x - PREFIX_BOX_WIDTH / 2,
        y: prefixCenter.y - BOX_HEIGHT / 2,
        width: PREFIX_BOX_WIDTH,
        height: BOX_HEIGHT,
      },
      ...children.map((c) => ({
        anchor: c.anchor,
        x: c.cx - c.width / 2,
        y: c.cy - c.height / 2,
        width: c.width,
        height: c.height,
      })),
      ...grandchildren.map((g) => ({
        anchor: g.anchor,
        x: g.cx - g.width / 2,
        y: g.cy - g.height / 2,
        width: g.width,
        height: g.height,
      })),
    ]
  }, [outcome, canvasWidth, subnetCenterX, prefixCenterX, theme])

  // Map a mouse event on the canvas to a hit region, if any.
  const hitTest = (ev: React.MouseEvent<HTMLCanvasElement>): HitRegion | null => {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    const x = ev.clientX - rect.left
    const y = ev.clientY - rect.top
    for (const region of hitRegionsRef.current) {
      if (
        x >= region.x &&
        x <= region.x + region.width &&
        y >= region.y &&
        y <= region.y + region.height
      ) {
        return region
      }
    }
    return null
  }

  // Shared "scroll to field + flash" used by both the canvas and the table
  // fallback. Kept outside the canvas-specific handlers so the mobile table
  // rows can reuse it verbatim.
  const jumpToField = (anchor: string) => {
    const target = document.getElementById(anchor)
    if (!target) return
    target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    target.classList.remove('field-flash')
    // Force reflow so re-adding the class actually restarts the animation.
    void target.offsetWidth
    target.classList.add('field-flash')
  }

  const handleCanvasClick = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const region = hitTest(ev)
    if (!region) return
    jumpToField(region.anchor)
  }

  const handleCanvasMove = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const region = hitTest(ev)
    setHoverAnchor(region?.anchor ?? null)
  }

  const handleCanvasLeave = () => setHoverAnchor(null)

  // Pretty-printed JSON payload copied by the canvas corner button. Includes
  // the CIDR and the routable flag alongside the raw CidrResult so the
  // pasted blob is self-contained.
  const copyPayload = outcome.ok
    ? {
        cidr: submitted,
        ...outcome.result,
        routable: outcome.routable,
      }
    : null

  return (
    <main className="tool-page">
      <h1>IP Subnet Calculator</h1>
      <p className="tool-lede">
        {isMobile
          ? 'Enter an IPv4 network in CIDR notation. Tap any field to jump to its explanation.'
          : 'Enter an IPv4 network in CIDR notation to see its structure as a diagram.'}
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

      {!outcome.ok && (
        <p className="error-box" role="alert">
          {outcome.error}
        </p>
      )}
      {outcome.ok && draftError && (
        <p className="draft-hint" role="status">
          {draftError}
        </p>
      )}

      {isMobile ? (
        <MobileTable
          outcome={outcome}
          netEdit={netEdit}
          prefixEdit={prefixEdit}
          onNetChange={onNetChange}
          onPrefixChange={onPrefixChange}
          jumpToField={jumpToField}
        />
      ) : (
        <div className="canvas-wrapper" ref={wrapperRef}>
          <div className="canvas-stage" style={{ width: canvasWidth, height: CANVAS_HEIGHT }}>
            <canvas
              ref={canvasRef}
              className="subnet-canvas"
              role="img"
              aria-label="Subnet structure diagram. Click any box to jump to its explanation."
              style={{ cursor: hoverAnchor ? 'pointer' : 'default' }}
              onClick={handleCanvasClick}
              onMouseMove={handleCanvasMove}
              onMouseLeave={handleCanvasLeave}
            />

            {/* Copy-as-JSON button pinned to the top-right of the canvas.
                Disabled when the current input doesn't parse so we never
                offer a stale snapshot to copy. */}
            <div className="copy-json-anchor">
              <CopyJsonButton
                data={copyPayload}
                disabled={!outcome.ok}
                ariaLabel="Copy subnet information as JSON"
              />
            </div>

            {/* Editable subnet address, overlayed on the subnet box. */}
            <input
              type="text"
              className="subnet-overlay-input"
              value={netEdit}
              onChange={(e) => onNetChange(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              aria-label="Network address (editable)"
              style={{
                left: subnetBoxLeft + 12,
                top: subnetBoxTop + BOX_HEIGHT - 34,
                width: SUBNET_BOX_WIDTH - 24,
              }}
            />

            {/* Editable prefix, overlayed inside its own box. */}
            <span
              className="prefix-overlay"
              style={{
                left: prefixBoxLeft + 10,
                top: subnetBoxTop + BOX_HEIGHT - 36,
                width: PREFIX_BOX_WIDTH - 20,
              }}
            >
              <span className="prefix-slash">/</span>
              <input
                type="number"
                min={0}
                max={32}
                value={prefixEdit}
                onChange={(e) => onPrefixChange(e.target.value)}
                aria-label="Prefix length 0 to 32 (editable)"
              />
            </span>
          </div>
        </div>
      )}

      <section className="field-guide" aria-label="Field explanations">
        <h2>What do these fields mean?</h2>
        <p className="field-guide-hint">
          {isMobile
            ? 'Tip: tap any row above to jump straight to its explanation.'
            : 'Tip: click any box in the diagram to jump straight to its explanation.'}
        </p>
        <dl>
          <div id="field-network">
            <dt>Network</dt>
            <dd>
              The first address of the block. All host bits are zero — it
              identifies the subnet itself and cannot be assigned to a device.
            </dd>
          </div>
          <div id="field-broadcast">
            <dt>Broadcast</dt>
            <dd>
              The last address of the block, with all host bits set to one.
              Traffic sent here reaches every host on the subnet; it cannot be
              assigned to a device.
            </dd>
          </div>
          <div id="field-subnet-mask">
            <dt>Subnet mask</dt>
            <dd>
              A 32-bit mask that splits the address into network and host
              parts. A <code>255</code> octet means those 8 bits belong to the
              network; <code>0</code> means they belong to hosts.
            </dd>
          </div>
          <div id="field-prefix">
            <dt>Prefix length</dt>
            <dd>
              The number after the slash in CIDR notation (0–32). It counts how
              many leading bits are the network portion — e.g. <code>/24</code>{' '}
              leaves 8 bits for 256 addresses.
            </dd>
          </div>
          <div id="field-host-range">
            <dt>First / Last host</dt>
            <dd>
              The first and last addresses you can actually assign to devices:
              network address + 1 up to broadcast address − 1. On a{' '}
              <code>/31</code> link both addresses are usable (RFC 3021), and on
              a <code>/32</code> there is a single host.
            </dd>
          </div>
          <div id="field-total">
            <dt>Total addresses</dt>
            <dd>
              Every address in the block, equal to 2 raised to the number of
              host bits — network and broadcast included.
            </dd>
          </div>
          <div id="field-usable">
            <dt>Usable hosts</dt>
            <dd>
              Total addresses minus the reserved network and broadcast
              addresses. A <code>/31</code> has 2 usable hosts and a{' '}
              <code>/32</code> has 1, since nothing is reserved there.
            </dd>
          </div>
          <div id="field-routable">
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
