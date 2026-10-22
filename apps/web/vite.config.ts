import mdx from '@mdx-js/rollup'
import react from '@vitejs/plugin-react'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypePrettyCode from 'rehype-pretty-code'
import rehypeSlug from 'rehype-slug'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import { defineConfig, loadEnv } from 'vite'
import { blogStatic } from './build/blogStatic.ts'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')

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
    },
    preview: {
      host: '0.0.0.0',
      port: 4173,
      strictPort: true,
    },
  }
})
