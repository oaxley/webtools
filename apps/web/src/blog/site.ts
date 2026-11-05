import { SITE_CONFIG } from '../../site.config.ts'

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '')
}

/** Public origin of the website (canonical URLs, feeds). */
export const SITE_URL = trimSlash(
  import.meta.env.VITE_SITE_URL || SITE_CONFIG.defaultSiteUrl,
)

/** Public origin of the Worker serving `/api/v1/*` and `/mcp`. */
export const API_BASE_URL = trimSlash(
  import.meta.env.VITE_API_BASE_URL || SITE_CONFIG.defaultApiBaseUrl || SITE_URL,
)

export const MCP_URL = `${API_BASE_URL}/mcp`

/**
 * Prefix for `fetch()` calls the pages make to the API. Unlike
 * `API_BASE_URL` (an absolute URL, for display and copy-paste), this is
 * empty — same origin — unless the API is explicitly configured on
 * another host. Same origin needs no CORS, works on any preview
 * deployment, and in development goes through the Vite proxy to
 * `wrangler dev` (see `vite.config.ts`).
 */
export const API_FETCH_BASE = trimSlash(
  import.meta.env.VITE_API_BASE_URL || SITE_CONFIG.defaultApiBaseUrl || '',
)

export const SITE_AUTHOR = SITE_CONFIG.author
export const SITE_NAME = SITE_CONFIG.name
export const SITE_DESCRIPTION = SITE_CONFIG.description
