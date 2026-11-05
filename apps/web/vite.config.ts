import mdx from '@mdx-js/rollup'
import react from '@vitejs/plugin-react'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypePrettyCode from 'rehype-pretty-code'
import rehypeSlug from 'rehype-slug'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import { defineConfig, loadEnv, type ProxyOptions } from 'vite'
import { blogStatic } from './build/blogStatic.ts'

// https://vite.dev/config/
/** Where `pnpm dev:worker` (`wrangler dev`) listens. */
const DEFAULT_WORKER_URL = 'http://127.0.0.1:8787'

/**
 * Dev proxy: `/api/v1/*` on the Vite server goes to the local Worker,
 * so pages call the API on their own origin, exactly like a
 * single-domain production deployment. No CORS, no env var, and it
 * works from other devices on the LAN.
 */
function workerProxy(target: string): ProxyOptions {
  return {
    target,
    changeOrigin: true,
    configure(proxy) {
      proxy.on('proxyReq', (proxyReq, req) => {
        // Cloudflare's edge sets CF-Connecting-IP in production;
        // `wrangler dev` would say 127.0.0.1. Pass the real client (e.g.
        // a phone on the LAN) so /api/v1/myip shows its address.
        const ip = req.socket.remoteAddress?.replace(/^::ffff:/, '')
        if (ip) proxyReq.setHeader('CF-Connecting-IP', ip)
        // Same origin from the browser's point of view: drop Origin so
        // the Worker doesn't treat it as a cross-origin call.
        proxyReq.removeHeader('origin')
      })
      proxy.on('error', (_err, _req, res) => {
        // Worker not running: a JSON error the pages can show.
        if ('writeHead' in res && !res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              error: `The local API is not running. Start it with \`pnpm dev:worker\` (expected at ${target}).`,
            }),
          )
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  // Override with VITE_WORKER_URL if wrangler dev listens elsewhere.
  const workerUrl = env.VITE_WORKER_URL || DEFAULT_WORKER_URL
  // Only the REST API: `/api` and `/mcp` themselves are site pages. MCP
  // clients in development talk to the Worker directly (see its README).
  const proxy = { '/api/v1/': workerProxy(workerUrl) }

  return {
    plugins: [
      // Before MDX: substitutes the API origin and serves post metadata.
      blogStatic({
        siteUrl: env.VITE_SITE_URL,
        apiBaseUrl: env.VITE_API_BASE_URL,
      }),
      {
        // MDX must run before the React plugin so the JSX it emits goes
        // through the usual React transform (and Fast Refresh in dev).
        enforce: 'pre',
        ...mdx({
          providerImportSource: '@mdx-js/react',
          remarkPlugins: [
            // Strips the YAML block from the rendered output. Metadata is
            // parsed and validated separately (build/blogPosts.ts).
            remarkFrontmatter,
            remarkGfm,
          ],
          rehypePlugins: [
            rehypeSlug,
            [
              rehypeAutolinkHeadings,
              {
                behavior: 'append',
                properties: { className: ['heading-anchor'], ariaHidden: true, tabIndex: -1 },
                content: { type: 'text', value: '#' },
              },
            ],
            // Shiki runs at build time: highlighted HTML, zero runtime JS.
            [
              rehypePrettyCode,
              {
                theme: { light: 'github-light', dark: 'github-dark' },
                keepBackground: false,
              },
            ],
          ],
        }),
      },
      react({ include: /\.(mdx|jsx|js|ts|tsx)$/ }),
    ],
    // Listen on all interfaces so the site is reachable from other devices
    // on the local network.
    // 192.168.x.x is not routable from the internet, so this stays LAN-only
    // as long as the router does not port-forward to this machine.
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      proxy,
    },
    preview: {
      host: '0.0.0.0',
      port: 4173,
      strictPort: true,
      proxy,
    },
  }
})
