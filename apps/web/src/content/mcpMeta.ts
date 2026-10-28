/**
 * Title, description and colour of the `/mcp` page. Shared by the page
 * (`pages/McpPage.tsx`) and the build (`build/blogStatic.ts`, which writes
 * `dist/mcp.html`, its preview image and its sitemap entry), so the
 * browser and link previews always agree. Plain constants only: this file
 * is also loaded by Node at build time.
 */
export const MCP_PAGE = {
  path: '/mcp',
  title: 'MCP server',
  description:
    'Connect Claude, Cursor, OpenCode or your own agent to WebTools over MCP, so it decodes JWTs and certificates, does subnet math and generates IDs with real code instead of guesses.',
  monogram: 'MCP',
  accent: '#4f46e5',
} as const
