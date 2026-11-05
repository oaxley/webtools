declare module 'virtual:blog-posts' {
  import type { PostMeta } from './types'
  /** Validated post metadata, sorted newest first. */
  export const POSTS: PostMeta[]
}

interface ImportMetaEnv {
  /** Public site origin, e.g. https://webtools.example.com */
  readonly VITE_SITE_URL?: string
  /** Public origin of the API / MCP Worker. Defaults to the site origin. */
  readonly VITE_API_BASE_URL?: string
  /** Dev only: where `wrangler dev` listens, for the Vite proxy. Default http://127.0.0.1:8787 */
  readonly VITE_WORKER_URL?: string
}

declare module 'virtual:api-reference' {
  /** The `/api` endpoint reference, built from the OpenAPI document. */
  export const API_REFERENCE: import('../content/apiReferenceTypes').ApiReference
}
