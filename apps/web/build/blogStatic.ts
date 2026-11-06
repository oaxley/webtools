/**
 * Vite plugin wiring the MDX blog into the app and into Cloudflare Pages.
 *
 * - `virtual:blog-posts` — validated, sorted post metadata for the app
 *   (listing page, post lookup). Drafts are included in dev only.
 * - `virtual:api-reference` — the `/api` endpoint reference, built from
 *   the worker's hand-written OpenAPI document (`build/apiReference.ts`).
 *   The dev server also serves that document at `/openapi.yaml`.
 * - Replaces `@@API_BASE@@` in MDX sources with the public API origin
 *   *before* MDX/Shiki run, so code samples stay highlighted and the
 *   domain lives in one place (see `site.config.ts`).
 * - On `vite build`, writes static artefacts next to the SPA:
 *     dist/blog.html                listing page with its own meta tags
 *     dist/blog/<slug>.html         one per post: title, description,
 *                                   canonical, Open Graph, JSON-LD
 *     dist/sitemap.xml              home, /tools, tools, /api, /mcp and posts
 *     dist/tools.html               the full tool list
 *     dist/<tool>.html              one per available tool (meta tags)
 *     dist/mcp.html                 the MCP server page
 *     dist/api.html                 the REST API page
 *     dist/openapi.yaml             the OpenAPI document, `servers`
 *                                   pointed at the API origin
 *     dist/og/**.png                1200×630 link-preview images
 *                                   (default, blog, all-tools, api, mcp, posts,
 *                                   tools)
 *     dist/apple-touch-icon.png     180×180 app icon
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
import { coverOf } from '../src/blog/cover.ts'
import { MCP_PAGE } from '../src/content/mcpMeta.ts'
import { API_PAGE, OPENAPI_PATH } from '../src/content/apiMeta.ts'
import { TOOLS_PAGE } from '../src/content/toolsMeta.ts'
import { buildApiReference, OPENAPI_FILE, openApiFor } from './apiReference.ts'
import { OG_HEIGHT, OG_WIDTH, renderAppIcon, renderOgCard, type OgCard } from './ogImages.ts'

const VIRTUAL_ID = 'virtual:blog-posts'
const RESOLVED_VIRTUAL_ID = '\0' + VIRTUAL_ID
const API_VIRTUAL_ID = 'virtual:api-reference'
const RESOLVED_API_VIRTUAL_ID = '\0' + API_VIRTUAL_ID

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

interface PageMeta {
  title: string
  description: string
  /**
   * Canonical URL. Omitted for index.html, which Pages also serves as the
   * SPA fallback for unknown paths (a canonical there would point every
   * such page at the home page).
   */
  url?: string
  type: 'website' | 'article'
  /** Absolute URL of the 1200×630 preview image. */
  image: string
  imageAlt: string
  jsonLd?: unknown
}

/** Rewrite the built `index.html` head for one page. */
function renderHtml(template: string, meta: PageMeta): string {
  const title = escapeXml(meta.title)
  const description = escapeXml(meta.description)
  const tags = [
    ...(meta.url ? [`<link rel="canonical" href="${meta.url}" />`] : []),
    `<meta name="author" content="${escapeXml(SITE_CONFIG.author)}" />`,
    `<meta property="og:site_name" content="${SITE_CONFIG.name}" />`,
    `<meta property="og:type" content="${meta.type}" />`,
    `<meta property="og:title" content="${title}" />`,
    `<meta property="og:description" content="${description}" />`,
    ...(meta.url ? [`<meta property="og:url" content="${meta.url}" />`] : []),
    `<meta property="og:image" content="${meta.image}" />`,
    `<meta property="og:image:type" content="image/png" />`,
    `<meta property="og:image:width" content="${OG_WIDTH}" />`,
    `<meta property="og:image:height" content="${OG_HEIGHT}" />`,
    `<meta property="og:image:alt" content="${escapeXml(meta.imageAlt)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${title}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${meta.image}" />`,
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

function renderSitemap(posts: PostMeta[], siteUrl: string): string {
  const urls: { loc: string; lastmod?: string }[] = [
    { loc: `${siteUrl}/` },
    { loc: `${siteUrl}${TOOLS_PAGE.path}` },
    ...TOOLS.filter((t) => t.available).map((t) => ({ loc: `${siteUrl}${t.path}` })),
    { loc: `${siteUrl}${API_PAGE.path}` },
    { loc: `${siteUrl}${MCP_PAGE.path}` },
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

function writeFile(path: string, content: string | Buffer): void {
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
      if (id === VIRTUAL_ID) return RESOLVED_VIRTUAL_ID
      if (id === API_VIRTUAL_ID) return RESOLVED_API_VIRTUAL_ID
      return undefined
    },

    async load(id) {
      if (id === RESOLVED_API_VIRTUAL_ID) {
        // Watched so dev picks up edits to the worker's document.
        this.addWatchFile(join(config.root, OPENAPI_FILE))
        const reference = await buildApiReference(config.root, apiBaseUrl)
        return `export const API_REFERENCE = ${JSON.stringify(reference)};`
      }
      if (id !== RESOLVED_VIRTUAL_ID) return undefined
      // Re-run when any post changes, so dev picks up frontmatter edits.
      const list = posts()
      return `export const POSTS = ${JSON.stringify(list)};`
    },

    configureServer(server) {
      // Same file `vite build` writes to dist/, so the page's links work in dev.
      server.middlewares.use(OPENAPI_PATH, (_req, res) => {
        res.setHeader('Content-Type', 'application/yaml; charset=utf-8')
        res.end(openApiFor(config.root, apiBaseUrl))
      })
    },

    transform(code, id) {
      if (!id.endsWith('.mdx')) return undefined
      return { code: code.replaceAll(API_BASE_TOKEN, apiBaseUrl), map: null }
    },

    handleHotUpdate({ file, server }) {
      if (file.endsWith('openapi.yaml')) {
        const mod = server.moduleGraph.getModuleById(RESOLVED_API_VIRTUAL_ID)
        if (mod) server.moduleGraph.invalidateModule(mod)
        return
      }
      if (!file.endsWith('.mdx') || !file.includes(POSTS_DIR)) return
      const mod = server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_ID)
      if (mod) server.moduleGraph.invalidateModule(mod)
    },

    async writeBundle() {
      const outDir = join(config.root, config.build.outDir)
      const template = readFileSync(join(outDir, 'index.html'), 'utf8')
      const list = posts()

      /** Render one OG image to dist/og/<name>.png; returns its URL. */
      const og = async (name: string, card: OgCard) => {
        writeFile(join(outDir, 'og', `${name}.png`), await renderOgCard(card))
        return `${siteUrl}/og/${name}.png`
      }
      const page = (file: string, meta: PageMeta) =>
        writeFile(join(outDir, file), renderHtml(template, meta))

      const available = TOOLS.filter((t) => t.available)
      const toolsLine = `${available.length} tools`

      // Home: rewrite index.html itself (the SPA fallback for every other
      // path too — generic tags are right there).
      page('index.html', {
        title: `${SITE_CONFIG.name} — Free online tools for developers`,
        description: SITE_CONFIG.description,
        type: 'website',
        image: await og('default', {
          eyebrow: 'Developer tools',
          title: 'Precise, privacy-first tools for engineers.',
          description: 'Subnets, JWTs, X.509 certificates, UUIDs, NanoIDs, ULIDs, Base64 and hashes.',
          footer: [toolsLine, 'REST API', 'MCP server', 'No sign-up'],
        }),
        imageAlt: `${SITE_CONFIG.name}: developer tools in the browser, over a REST API and via MCP`,
      })

      page('blog.html', {
        title: `Blog — ${SITE_CONFIG.name}`,
        description:
          'Practical guides on JWTs, UUIDs, NanoIDs, ULIDs, X.509 certificates, hashes, passwords and TOTP.',
        url: `${siteUrl}/blog`,
        type: 'website',
        image: await og('blog', {
          eyebrow: 'Blog',
          title: 'Guides for the tools you reach for every day.',
          description: 'Tokens, certificates, identifiers, networks, hashes and passwords.',
          footer: [`${list.length} guides`],
        }),
        imageAlt: `${SITE_CONFIG.name} blog`,
      })

      // `og/tools/` holds the per-tool images, hence `all-tools.png`.
      page(`${TOOLS_PAGE.path.slice(1)}.html`, {
        title: `${TOOLS_PAGE.title} — ${SITE_CONFIG.name}`,
        description: TOOLS_PAGE.description,
        url: `${siteUrl}${TOOLS_PAGE.path}`,
        type: 'website',
        image: await og('all-tools', {
          eyebrow: 'The toolbox',
          title: TOOLS_PAGE.title,
          description: TOOLS_PAGE.description,
          monogram: TOOLS_PAGE.monogram,
          accent: TOOLS_PAGE.accent,
          footer: [toolsLine, 'Runs in your browser', 'No sign-up'],
        }),
        imageAlt: `${SITE_CONFIG.name}: all tools`,
      })

      const apiTools = available.filter((t) => t.api).length
      page(`${API_PAGE.path.slice(1)}.html`, {
        title: `${API_PAGE.title} — ${SITE_CONFIG.name}`,
        description: API_PAGE.description,
        url: `${siteUrl}${API_PAGE.path}`,
        type: 'website',
        image: await og('api', {
          eyebrow: 'For developers',
          title: API_PAGE.title,
          description: API_PAGE.description,
          monogram: API_PAGE.monogram,
          accent: API_PAGE.accent,
          footer: [`${apiTools} endpoints`, 'OpenAPI 3.1', 'No API key'],
        }),
        imageAlt: `${SITE_CONFIG.name} ${API_PAGE.title}: endpoints and OpenAPI document`,
      })
      writeFile(join(outDir, OPENAPI_PATH.slice(1)), openApiFor(config.root, apiBaseUrl))

      const mcpTools = available.filter((t) => t.mcp).length
      page(`${MCP_PAGE.path.slice(1)}.html`, {
        title: `${MCP_PAGE.title} — ${SITE_CONFIG.name}`,
        description: MCP_PAGE.description,
        url: `${siteUrl}${MCP_PAGE.path}`,
        type: 'website',
        image: await og('mcp', {
          eyebrow: 'For AI agents',
          title: MCP_PAGE.title,
          description: MCP_PAGE.description,
          monogram: MCP_PAGE.monogram,
          accent: MCP_PAGE.accent,
          footer: [`${mcpTools} tools`, 'No API key', 'No sign-up'],
        }),
        imageAlt: `${SITE_CONFIG.name} ${MCP_PAGE.title}: connect your AI agent`,
      })

      for (const tool of available) {
        const url = `${siteUrl}${tool.path}`
        page(`${tool.path.slice(1)}.html`, {
          title: `${tool.name} — ${SITE_CONFIG.name}`,
          description: tool.description,
          url,
          type: 'website',
          image: await og(`tools/${tool.id}`, {
            eyebrow: 'Free online tool',
            title: tool.name,
            description: tool.description,
            monogram: tool.monogram,
            accent: tool.accent,
            // Only advertise the API and MCP for tools that have them.
            footer: [
              'Runs in your browser',
              ...(tool.api ? ['REST API'] : []),
              ...(tool.mcp ? ['MCP'] : []),
            ],
          }),
          imageAlt: `${tool.name} on ${SITE_CONFIG.name}`,
          jsonLd: {
            '@context': 'https://schema.org',
            '@type': 'WebApplication',
            name: tool.name,
            description: tool.description,
            url,
            applicationCategory: 'DeveloperApplication',
            operatingSystem: 'Any',
            offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
          },
        })
      }

      for (const post of list) {
        const url = `${siteUrl}/blog/${post.slug}`
        const cover = coverOf(post)
        const image = await og(`blog/${post.slug}`, {
          eyebrow: 'Blog',
          title: post.title,
          monogram: cover.label,
          accent: cover.accent,
          footer: [...post.tags.slice(0, 3).map((t) => `#${t}`), `${post.readingMinutes} min read`],
        })
        page(join('blog', `${post.slug}.html`), {
          title: `${post.title} — ${SITE_CONFIG.name}`,
          description: post.description,
          url,
          type: 'article',
          image,
          imageAlt: post.title,
          jsonLd: {
            '@context': 'https://schema.org',
            '@type': 'BlogPosting',
            headline: post.title,
            description: post.description,
            image,
            datePublished: post.date,
            dateModified: post.updated ?? post.date,
            author: { '@type': 'Organization', name: SITE_CONFIG.author },
            publisher: { '@type': 'Organization', name: SITE_CONFIG.name },
            mainEntityOfPage: url,
            keywords: post.tags.join(', '),
          },
        })
      }

      writeFile(join(outDir, 'apple-touch-icon.png'), renderAppIcon(180))

      writeFile(join(outDir, 'sitemap.xml'), renderSitemap(list, siteUrl))
    },
  }
}
