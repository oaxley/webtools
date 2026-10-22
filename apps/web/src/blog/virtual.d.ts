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
}
