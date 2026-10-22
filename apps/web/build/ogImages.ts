/**
 * Link-preview (Open Graph) images, rendered at build time.
 *
 * satori lays out a small element tree (flexbox subset of CSS) into SVG
 * with real text shaping; resvg rasterises that SVG to PNG. Both run in
 * Node only — nothing here ships to the browser.
 *
 * Fonts come straight from the @fontsource packages (satori reads
 * woff/ttf/otf, not woff2).
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Resvg } from '@resvg/resvg-js'
import satori from 'satori'

export const OG_WIDTH = 1200
export const OG_HEIGHT = 630
const PAD_X = 72
const PAD_Y = 60
/** Inner content width. */
const INNER = OG_WIDTH - 2 * PAD_X
const TILE = 220

const require = createRequire(import.meta.url)

function font(pkg: string, file: string): Buffer {
  return readFileSync(require.resolve(`${pkg}/files/${file}`))
}

type Weight = 400 | 500 | 600 | 700

let fontsCache: Parameters<typeof satori>[1]['fonts'] | undefined
function fonts() {
  fontsCache ??= [
    ...([400, 500, 600, 700] as Weight[]).map((weight) => ({
      name: 'Inter',
      data: font('@fontsource/inter', `inter-latin-${weight}-normal.woff`),
      weight,
      style: 'normal' as const,
    })),
    {
      name: 'JetBrains Mono',
      data: font('@fontsource/jetbrains-mono', 'jetbrains-mono-latin-700-normal.woff'),
      weight: 700 as const,
      style: 'normal' as const,
    },
  ]
  return fontsCache
}

// ---- Tiny element helpers (satori takes React-element-shaped objects) ----

type Style = Record<string, string | number>
interface Node {
  type: string
  props: { style?: Style; children?: Child | Child[]; [key: string]: unknown }
}
type Child = Node | string | null | false

function h(type: string, style: Style, ...children: Child[]): Node {
  const kids = children.filter((c): c is Node | string => c !== null && c !== false)
  return { type, props: { style: { display: 'flex', ...style }, children: kids } }
}

/** The logo mark (same paths as public/favicon.svg), as an inline SVG. */
function logoMark(size: number): Node {
  return {
    type: 'svg',
    props: {
      width: size,
      height: size,
      viewBox: '0 0 32 32',
      fill: 'none',
      children: [
        {
          type: 'defs',
          props: {
            children: {
              type: 'linearGradient',
              props: {
                id: 'g',
                x1: '0',
                y1: '0',
                x2: '32',
                y2: '32',
                gradientUnits: 'userSpaceOnUse',
                children: [
                  { type: 'stop', props: { offset: '0', stopColor: '#b45cff' } },
                  { type: 'stop', props: { offset: '1', stopColor: '#7a16c4' } },
                ],
              },
            },
          },
        },
        { type: 'rect', props: { width: '32', height: '32', rx: '8', fill: 'url(#g)' } },
        {
          type: 'path',
          props: {
            d: 'M10 10 4.5 16l5.5 6M22 10l5.5 6-5.5 6',
            stroke: '#fff',
            strokeWidth: '2.8',
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          },
        },
        {
          type: 'path',
          props: {
            d: 'm16 11.2 1.25 3.55L20.8 16l-3.55 1.25L16 20.8l-1.25-3.55L11.2 16l3.55-1.25z',
            fill: '#fff',
          },
        },
      ],
    },
  }
}

function brandRow(): Node {
  return h(
    'div',
    { alignItems: 'center', gap: 18 },
    logoMark(56),
    h(
      'div',
      { fontSize: 34, fontWeight: 700, letterSpacing: -1, color: '#f5f3ff' },
      'Web',
      h('span', { color: '#c084fc' }, 'Tools'),
    ),
  )
}

/** Hex `#rrggbb` mixed towards black (amount 0..1). */
function darken(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const ch = (shift: number) => Math.round(((n >> shift) & 255) * (1 - amount))
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`
}

function titleSize(title: string, narrow: boolean): number {
  const len = narrow ? title.length * 1.3 : title.length
  if (len > 80) return 48
  if (len > 55) return 56
  return 66
}

export interface OgCard {
  /** Small uppercase label above the title, e.g. "Blog" or "Tool". */
  eyebrow: string
  title: string
  description?: string
  /** Monogram drawn in the accent tile on the right, e.g. "JWT". */
  monogram?: string
  /** `#rrggbb` accent for the tile. */
  accent?: string
  /** Shown along the bottom, e.g. tags or "No sign-up · REST API · MCP". */
  footer?: string[]
}

function cardTree(card: OgCard): Node {
  const accent = card.accent ?? '#9322e8'
  return h(
    'div',
    {
      // satori adds padding to the box size, so size the content area.
      width: OG_WIDTH - 2 * PAD_X,
      height: OG_HEIGHT - 2 * PAD_Y,
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: `${PAD_Y}px ${PAD_X}px`,
      fontFamily: 'Inter',
      color: '#f5f3ff',
      backgroundColor: '#120f1a',
      backgroundImage:
        'radial-gradient(circle at 92% 0%, rgba(170, 59, 255, 0.45), rgba(170, 59, 255, 0) 55%), radial-gradient(circle at 0% 100%, rgba(37, 99, 235, 0.28), rgba(37, 99, 235, 0) 50%)',
    },
    brandRow(),
    h(
      'div',
      { alignItems: 'center', justifyContent: 'space-between', width: INNER },
      h(
        'div',
        {
          flexDirection: 'column',
          width: card.monogram ? INNER - TILE - 56 : INNER,
        },
        h(
          'div',
          {
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: 3,
            textTransform: 'uppercase',
            color: '#c084fc',
          },
          card.eyebrow,
        ),
        h(
          'div',
          {
            marginTop: 18,
            fontSize: titleSize(card.title, Boolean(card.monogram)),
            fontWeight: 700,
            lineHeight: 1.08,
            letterSpacing: -1.6,
          },
          card.title,
        ),
        card.description
          ? h(
              'div',
              {
                marginTop: 22,
                fontSize: 27,
                fontWeight: 400,
                lineHeight: 1.4,
                color: '#b4adc6',
                // Keep long descriptions to two lines.
                maxHeight: 76,
                overflow: 'hidden',
              },
              card.description,
            )
          : null,
      ),
      card.monogram
        ? h(
            'div',
            {
              width: TILE,
              height: TILE,
              flexShrink: 0,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 40,
              border: '2px solid rgba(255, 255, 255, 0.18)',
              backgroundImage: `linear-gradient(135deg, ${accent}, ${darken(accent, 0.55)})`,
              boxShadow: `0 30px 60px ${darken(accent, 0.7)}`,
              transform: 'rotate(4deg)',
              fontFamily: 'JetBrains Mono',
              fontSize: card.monogram.length > 3 ? 54 : 70,
              fontWeight: 700,
              color: '#ffffff',
            },
            card.monogram,
          )
        : null,
    ),
    h(
      'div',
      {
        alignItems: 'center',
        gap: 14,
        height: 44,
        width: INNER,
        fontSize: 22,
        fontWeight: 500,
        color: '#b4adc6',
      },
      ...(card.footer ?? []).map((item) =>
        h(
          'div',
          {
            padding: '8px 16px',
            borderRadius: 999,
            border: '1px solid rgba(255, 255, 255, 0.16)',
            backgroundColor: 'rgba(255, 255, 255, 0.06)',
          },
          item,
        ),
      ),
    ),
  )
}

export async function renderOgCard(card: OgCard): Promise<Buffer> {
  // satori's types expect a ReactNode; our plain objects have that shape.
  const svg = await satori(cardTree(card) as unknown as Parameters<typeof satori>[0], {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: fonts(),
  })
  return new Resvg(svg, { fitTo: { mode: 'width', value: OG_WIDTH } }).render().asPng()
}

/** Square app icon (apple-touch-icon): the logo mark on its own. */
export function renderAppIcon(size: number): Buffer {
  const svg = readFileSync(new URL('../public/favicon.svg', import.meta.url), 'utf8')
    // iOS rounds the corners itself: fill the whole square.
    .replace('rx="8"', 'rx="0"')
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
}
