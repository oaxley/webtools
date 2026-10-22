import { TOOLS } from '../tools.ts'
import type { PostMeta } from './types.ts'

const FALLBACK_ACCENT = '#7c3aed'

/** Cover label + accent: frontmatter `cover`, else the first related tool. */
export function coverOf(post: PostMeta): { label: string; accent: string } {
  const tool = TOOLS.find((t) => t.id === post.tools[0])
  return {
    label: post.cover?.label ?? tool?.monogram ?? post.title.slice(0, 2).toUpperCase(),
    accent: post.cover?.accent ?? tool?.accent ?? FALLBACK_ACCENT,
  }
}
