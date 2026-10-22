/**
 * Blog post registry.
 *
 * Metadata comes from `virtual:blog-posts` (parsed and validated from the
 * MDX frontmatter at build time by `build/blogPosts.ts`), so the listing
 * page never has to load post bodies. Bodies are code-split: each MDX
 * file becomes its own chunk, loaded when the post is opened.
 */
import { lazy, type LazyExoticComponent } from 'react'
import type { MDXContent } from 'mdx/types'
import { POSTS } from 'virtual:blog-posts'
import type { PostMeta } from './types'

export type { PostMeta }

const bodies = import.meta.glob<{ default: MDXContent }>('./posts/*.mdx')

/** Published posts (plus drafts in dev), newest first. */
export const posts: PostMeta[] = POSTS

export function findPost(slug: string): PostMeta | undefined {
  return posts.find((p) => p.slug === slug)
}

/**
 * Lazily-loaded body component per slug, built once at module load so
 * every render sees the same component type for a given post.
 */
export const postBodies: Readonly<Record<string, LazyExoticComponent<MDXContent>>> =
  Object.fromEntries(
    Object.entries(bodies).map(([path, loader]) => [
      path.replace(/^\.\/posts\/(.*)\.mdx$/, '$1'),
      lazy(loader),
    ]),
  )
