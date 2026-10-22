/**
 * Site-wide settings shared by the app (via `src/blog/site.ts`) and the
 * build plugins (`build/`). Plain constants only: this file is loaded
 * both in the browser bundle and by Node at build time.
 *
 * The URLs are defaults. Override them per environment with
 * `VITE_SITE_URL` / `VITE_API_BASE_URL` (e.g. in the Cloudflare Pages
 * build settings); no content changes are needed.
 */
export const SITE_CONFIG = {
  name: 'WebTools',
  author: 'The WebTools team',
  description:
    'WebTools — free online tools for developers and network engineers.',
  /** Public origin of the website, no trailing slash. */
  defaultSiteUrl: 'https://webtools.example.com',
  /**
   * Public origin of the Worker serving `/api/v1/*` and `/mcp`.
   * `undefined` means "same origin as the site".
   */
  defaultApiBaseUrl: undefined as string | undefined,
} as const

/** Placeholder used in MDX code blocks, replaced at build time. */
export const API_BASE_TOKEN = '@@API_BASE@@'
