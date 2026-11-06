/**
 * Title and description of the `/tools` page. Shared by the page
 * (`pages/ToolsIndex.tsx`) and the build (`build/blogStatic.ts`, which
 * writes `dist/tools.html`, its preview image and its sitemap entry), so
 * the browser and link previews always agree. Plain constants only: this
 * file is also loaded by Node at build time.
 */
export const TOOLS_PAGE = {
  path: '/tools',
  title: 'All tools',
  description:
    'Every WebTools tool in one place: subnet calculator and planner, JWT and X.509 decoders, UUID, NanoID and ULID generators, Base64/32/58, hashes, passwords, TOTP and fake data.',
  monogram: 'ALL',
  accent: '#7c3aed',
} as const
