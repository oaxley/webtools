/** Metadata of one blog post, derived from its MDX frontmatter. */
export interface PostMeta {
  /** URL slug — the MDX file name without `.mdx`. */
  slug: string
  title: string
  /** One-liner for listing cards, meta description and RSS. */
  description: string
  /** YYYY-MM-DD. Used for sorting, RSS and sitemap only — never displayed. */
  date: string
  /** YYYY-MM-DD of the last meaningful update, if any. */
  updated?: string
  tags: string[]
  /** Ids from `TOOLS` (src/tools.ts), shown as "Related tools". */
  tools: string[]
  /** Tie-breaker for posts sharing a date (lower comes first). */
  order: number
  draft: boolean
  /** Card cover overrides; defaults come from the first related tool. */
  cover?: PostCover
  readingMinutes: number
  /** h2/h3 headings in document order, for the "On this page" list. */
  headings: PostHeading[]
}

export interface PostHeading {
  depth: 2 | 3
  text: string
  /** Same id rehype-slug gives the rendered heading. */
  id: string
}

/** Optional cover customisation for listing cards. */
export interface PostCover {
  /** Short monogram drawn on the cover, e.g. "MCP". */
  label?: string
  /** CSS colour for the cover gradient, e.g. "#4f46e5". */
  accent?: string
}
