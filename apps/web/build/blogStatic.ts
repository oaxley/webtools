/**
 * Vite plugin wiring the MDX blog into the app and into Cloudflare Pages.
 *
 * - `virtual:blog-posts` — validated, sorted post metadata for the app
 *   (listing page, post lookup). Drafts are included in dev only.
 * - Replaces `@@API_BASE@@` in MDX sources with the public API origin
 *   *before* MDX/Shiki run, so code samples stay highlighted and the
 *   domain lives in one place (see `site.config.ts`).
 * - On `vite build`, writes static artefacts next to the SPA:
 *     dist/blog.html                listing page with its own meta tags
 *     dist/blog/<slug>.html         one per post: title, description,
 *                                   canonical, Open Graph, JSON-LD
 *     dist/blog/rss.xml             RSS 2.0 feed
 *     dist/sitemap.xml              home, tools and posts
 *   `<name>.html` (not `<name>/index.html`) so Pages serves them at the
 *   canonical, slash-less URLs without a redirect. Pages serves them
 *   directly, so crawlers and link previews see
 *   the right tags; the React app then takes over in the browser. Any
 *   other path falls back to `index.html` (no top-level 404.html).
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin, ResolvedConfig } from 'vite'
import { API_BASE_TOKEN, SITE_CONFIG } from '../site.config.ts'
import { TOOLS } from '../src/tools.ts'
import type { PostMeta } from '../src/blog/types.ts'
import { loadPosts, POSTS_DIR } from './blogPosts.ts'

const VIRTUAL_ID = 'virtual:blog-posts'
const RESOLVED_VIRTUAL_ID = '\0' + VIRTUAL_ID

interface Options {
  /** Public site origin; falls back to `SITE_CONFIG.defaultSiteUrl`. */
  siteUrl?: string
  /** Public API origin; falls back to the site origin. */
  apiBaseUrl?: string
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** RFC 822 date for RSS, at noon UTC to avoid day shifts in readers. */
function rssDate(isoDay: string): string {
  return new Date(`${isoDay}T12:00:00Z`).toUTCString()
}

interface PageMeta {
  title: string
  description: string
  url: string
  type: 'website' | 'article'
  jsonLd?: unknown
}

/** Rewrite the built `index.html` head for one page. */
function renderHtml(template: string, meta: PageMeta, siteUrl: string): string {
  const title = escapeXml(meta.title)
  const description = escapeXml(meta.description)
  const tags = [
    `<link rel="canonical" href="${meta.url}" />`,
    `<meta name="author" content="${escapeXml(SITE_CONFIG.author)}" />`,
    `<meta property="og:site_name" content="${SITE_CONFIG.name}" />`,
    `<meta property="og:type" content="${meta.type}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:url" content="${meta.url}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<link rel="alternate" type="application/rss+xml" title="${SITE_CONFIG.name} blog" href="${siteUrl}/blog/rss.xml" />`,
    ...(meta.jsonLd
      ? [
          `<script type="application/ld+json">${JSON.stringify(meta.jsonLd).replace(/</g, '\\u003c')}</script>`,
        ]
      : []),
  ]

  return template
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${title}</title>`)
    .replace(
      /<meta\s+name="description"[\s\S]*?\/>/,
      `<meta name="description" content="${description}" />`,
    )
    .replace('</head>', `  ${tags.join('\n    ')}\n  </head>`)
}

function renderRss(posts: PostMeta[], siteUrl: string): string {
  const items = posts
    .map((p) => {
      const url = `${siteUrl}/blog/${p.slug}`
      return [
        '    <item>',
        `      <title>${escapeXml(p.title)}</title>`,
        `      <link>${url}</link>`,
        `      <guid isPermaLink="true">${url}</guid>`,
        `      <description>${escapeXml(p.description)}</description>`,
        `      <pubDate>${rssDate(p.date)}</pubDate>`,
        `      <dc:creator>${escapeXml(SITE_CONFIG.author)}</dc:creator>`,
        ...p.tags.map((t) => `      <category>${escapeXml(t)}</category>`),
        '    </item>',
      ].join('\n')
    })
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>${SITE_CONFIG.name} blog</title>
    <link>${siteUrl}/blog</link>
    <atom:link href="${siteUrl}/blog/rss.xml" rel="self" type="application/rss+xml" />
    <description>Practical guides for developers and network engineers, built around the ${SITE_CONFIG.name} tools, API and MCP server.</description>
    <language>en</language>
${items}
  </channel>
</rss>
`
}

function renderSitemap(posts: PostMeta[], siteUrl: string): string {
  const urls: { loc: string; lastmod?: string }[] = [
    { loc: `${siteUrl}/` },
    ...TOOLS.filter((t) => t.available).map((t) => ({ loc: `${siteUrl}${t.path}` })),
    { loc: `${siteUrl}/blog`, lastmod: posts[0]?.updated ?? posts[0]?.date },
    ...posts.map((p) => ({
      loc: `${siteUrl}/blog/${p.slug}`,
      lastmod: p.updated ?? p.date,
    })),
  ]
  const body = urls
    .map(
      (u) =>
        `  <url><loc>${escapeXml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`,
    )
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`
}

function writeFile(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content)
}

export function blogStatic(options: Options = {}): Plugin {
  const siteUrl = trimSlash(options.siteUrl || SITE_CONFIG.defaultSiteUrl)
  const apiBaseUrl = trimSlash(
    options.apiBaseUrl || SITE_CONFIG.defaultApiBaseUrl || siteUrl,
  )
  let config: ResolvedConfig

  const posts = () => loadPosts(config.root, config.command === 'serve')

  return {
    name: 'webtools-blog',
    // Must run before @mdx-js/rollup so the API origin is substituted in
    // the raw MDX source, ahead of Shiki highlighting.
    enforce: 'pre',

    configResolved(resolved) {
      config = resolved
    },

    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_VIRTUAL_ID : undefined
    },

    load(id) {
      if (id !== RESOLVED_VIRTUAL_ID) return undefined
      // Re-run when any post changes, so dev picks up frontmatter edits.
      const list = posts()
      return `export const POSTS = ${JSON.stringify(list)};`
    },

    transform(code, id) {
      if (!id.endsWith('.mdx')) return undefined
      return { code: code.replaceAll(API_BASE_TOKEN, apiBaseUrl), map: null }
    },

    handleHotUpdate({ file, server }) {
      if (!file.endsWith('.mdx') || !file.includes(POSTS_DIR)) return
      const mod = server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_ID)
      if (mod) server.moduleGraph.invalidateModule(mod)
    },

    writeBundle() {
      const outDir = join(config.root, config.build.outDir)
      const template = readFileSync(join(outDir, 'index.html'), 'utf8')
      const list = posts()

      writeFile(
        join(outDir, 'blog.html'),
        renderHtml(
          template,
          {
            title: `Blog — ${SITE_CONFIG.name}`,
            description:
              'Practical guides on JWTs, UUIDs, NanoIDs, X.509 certificates and giving AI agents real tools via MCP.',
            url: `${siteUrl}/blog`,
            type: 'website',
          },
          siteUrl,
        ),
      )

      for (const post of list) {
        const url = `${siteUrl}/blog/${post.slug}`
        writeFile(
          join(outDir, 'blog', `${post.slug}.html`),
          renderHtml(
            template,
            {
              title: `${post.title} — ${SITE_CONFIG.name}`,
              description: post.description,
              url,
              type: 'article',
              jsonLd: {
                '@context': 'https://schema.org',
                '@type': 'BlogPosting',
                headline: post.title,
                description: post.description,
                datePublished: post.date,
                dateModified: post.updated ?? post.date,
                author: { '@type': 'Organization', name: SITE_CONFIG.author },
                publisher: { '@type': 'Organization', name: SITE_CONFIG.name },
                mainEntityOfPage: url,
                keywords: post.tags.join(', '),
              },
            },
            siteUrl,
          ),
        )
      }

      writeFile(join(outDir, 'blog', 'rss.xml'), renderRss(list, siteUrl))
      writeFile(join(outDir, 'sitemap.xml'), renderSitemap(list, siteUrl))
    },
  }
}
