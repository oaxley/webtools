/**
 * Load and validate blog post metadata from `src/blog/posts/*.mdx`.
 *
 * Runs in Node at build/dev time only. The result feeds the
 * `virtual:blog-posts` module (listing data for the app) and the
 * Cloudflare Pages artefacts (per-post HTML, RSS, sitemap). Any invalid
 * frontmatter throws, which fails `vite build` and shows the error
 * overlay in dev — a broken post never ships silently.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import GithubSlugger from 'github-slugger'
import { parse as parseYaml } from 'yaml'
import { TOOLS } from '../src/tools.ts'
import type { PostCover, PostHeading, PostMeta } from '../src/blog/types.ts'

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const WORDS_PER_MINUTE = 220

export const POSTS_DIR = 'src/blog/posts'

function fail(file: string, message: string): never {
  throw new Error(`[blog] ${file}: ${message}`)
}

function requireString(file: string, data: Record<string, unknown>, key: string): string {
  const value = data[key]
  if (typeof value !== 'string' || value.trim() === '') {
    fail(file, `frontmatter '${key}' must be a non-empty string.`)
  }
  return value.trim()
}

function optionalStringList(file: string, data: Record<string, unknown>, key: string): string[] {
  const value = data[key] ?? []
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    fail(file, `frontmatter '${key}' must be a list of strings.`)
  }
  return value
}

function parseCover(file: string, value: unknown): PostCover | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(file, "'cover' must be a mapping with optional 'label' and 'accent'.")
  }
  const cover: PostCover = {}
  for (const [key, v] of Object.entries(value)) {
    if (key !== 'label' && key !== 'accent') fail(file, `unknown 'cover' key '${key}'.`)
    if (typeof v !== 'string' || v.trim() === '') {
      fail(file, `'cover.${key}' must be a non-empty string.`)
    }
    if (key === 'label' && v.length > 6) fail(file, "'cover.label' must be at most 6 characters.")
    if (key === 'accent' && !/^#[0-9a-fA-F]{6}$/.test(v)) {
      fail(file, "'cover.accent' must be a #rrggbb colour.")
    }
    cover[key] = v.trim()
  }
  return cover
}

/**
 * h2/h3 headings of an MDX body, with the ids rehype-slug will give them
 * (same slugger, same document order, so duplicate suffixes line up).
 * Inline Markdown is reduced to its text first, as rehype-slug sees it.
 */
function extractHeadings(body: string): PostHeading[] {
  const slugger = new GithubSlugger()
  const headings: PostHeading[] = []
  let fence: string | null = null
  for (const line of body.split(/\r?\n/)) {
    const f = /^\s*(```+|~~~+)/.exec(line)
    if (f) {
      if (fence === null) fence = f[1]
      else if (f[1].startsWith(fence[0]) && f[1].length >= fence.length) fence = null
      continue
    }
    if (fence !== null) continue
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (!m) continue
    // Code spans are literal; elsewhere drop links and emphasis markers
    // (`_` only at word edges, as in CommonMark: snake_case stays).
    const text = m[2]
      .split(/(`[^`]*`)/)
      .map((part) =>
        part.startsWith('`')
          ? part.slice(1, -1)
          : part
              .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
              .replace(/(\*\*|\*)(\S(?:.*?\S)?)\1/g, '$2')
              .replace(/(?<![\w])(__|_)(\S(?:.*?\S)?)\1(?![\w])/g, '$2'),
      )
      .join('')
    // Every heading advances the slugger, even ones we don't list.
    const id = slugger.slug(text)
    const depth = m[1].length
    if (depth === 2 || depth === 3) headings.push({ depth, text, id })
  }
  return headings
}

/** Rough reading time: prose words only (code blocks and JSX excluded). */
function readingMinutes(body: string): number {
  const prose = body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/^(import|export) .*$/gm, ' ')
  const words = prose.split(/\s+/).filter((w) => /\w/.test(w)).length
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE))
}

export function parsePost(file: string, source: string): PostMeta {
  const match = FRONTMATTER.exec(source)
  if (!match) fail(file, 'missing YAML frontmatter block (--- … ---).')

  let data: unknown
  try {
    data = parseYaml(match[1])
  } catch (e) {
    fail(file, `invalid YAML frontmatter: ${(e as Error).message}`)
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    fail(file, 'frontmatter must be a YAML mapping.')
  }
  const fm = data as Record<string, unknown>

  const known = new Set(['title', 'description', 'date', 'updated', 'tags', 'tools', 'order', 'draft', 'cover'])
  for (const key of Object.keys(fm)) {
    if (!known.has(key)) fail(file, `unknown frontmatter key '${key}'.`)
  }

  const slug = basename(file, '.mdx')
  if (!SLUG.test(slug)) {
    fail(file, 'file name must be a lower-case kebab-case slug, e.g. my-post.mdx.')
  }

  const date = requireString(file, fm, 'date')
  if (!ISO_DATE.test(date)) fail(file, `'date' must be YYYY-MM-DD, got '${date}'.`)
  const updated = fm.updated === undefined ? undefined : requireString(file, fm, 'updated')
  if (updated !== undefined && !ISO_DATE.test(updated)) {
    fail(file, `'updated' must be YYYY-MM-DD, got '${updated}'.`)
  }

  const tools = optionalStringList(file, fm, 'tools')
  const toolIds = new Set(TOOLS.map((t) => t.id))
  for (const id of tools) {
    if (!toolIds.has(id)) {
      fail(file, `unknown tool id '${id}' in 'tools'. Known ids: ${[...toolIds].join(', ')}.`)
    }
  }

  const order = fm.order ?? 0
  if (typeof order !== 'number' || !Number.isInteger(order)) {
    fail(file, `'order' must be an integer.`)
  }
  const draft = fm.draft ?? false
  if (typeof draft !== 'boolean') fail(file, `'draft' must be true or false.`)

  return {
    slug,
    title: requireString(file, fm, 'title'),
    description: requireString(file, fm, 'description'),
    date,
    ...(updated !== undefined && { updated }),
    tags: optionalStringList(file, fm, 'tags'),
    tools,
    order,
    draft,
    ...(fm.cover !== undefined && { cover: parseCover(file, fm.cover) }),
    readingMinutes: readingMinutes(source.slice(match[0].length)),
    headings: extractHeadings(source.slice(match[0].length)),
  }
}

/**
 * All posts, sorted newest first, then by ascending `order` for posts
 * sharing a date. Drafts are dropped unless `includeDrafts` is set.
 */
export function loadPosts(root: string, includeDrafts: boolean): PostMeta[] {
  const dir = join(root, POSTS_DIR)
  const posts = readdirSync(dir)
    .filter((f) => f.endsWith('.mdx'))
    .map((f) => parsePost(f, readFileSync(join(dir, f), 'utf8')))
    .filter((p) => includeDrafts || !p.draft)

  return posts.sort((a, b) =>
    a.date === b.date ? a.order - b.order : a.date < b.date ? 1 : -1,
  )
}
