import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { posts, type PostMeta } from '../blog/posts'
import { TOOLS } from '../tools'
import { usePageMeta } from '../usePageMeta'
import './Blog.css'
import './BlogIndex.css'

const FALLBACK_ACCENT = '#7c3aed'
/** Grid cards shown before "Load more" (the featured post is extra). */
const PAGE_SIZE = 9

/** Cover label + accent: frontmatter `cover`, else the first related tool. */
function coverOf(post: PostMeta): { label: string; accent: string } {
  const tool = TOOLS.find((t) => t.id === post.tools[0])
  return {
    label: post.cover?.label ?? tool?.monogram ?? post.title.slice(0, 2).toUpperCase(),
    accent: post.cover?.accent ?? tool?.accent ?? FALLBACK_ACCENT,
  }
}

/** Decorative, generated cover art — no image files to maintain. */
function PostCover({ post, size }: { post: PostMeta; size: 'lg' | 'md' }) {
  const { label, accent } = coverOf(post)
  return (
    <div
      className={`post-cover post-cover-${size}`}
      style={{ '--cover-accent': accent } as React.CSSProperties}
      aria-hidden="true"
    >
      <span className="post-cover-label">{label}</span>
      <span className="post-cover-tags">
        {post.tags.slice(0, size === 'lg' ? 3 : 1).map((t) => (
          <span key={t}>#{t}</span>
        ))}
      </span>
    </div>
  )
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7v5l3 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

function ReadMore() {
  return (
    <span className="post-read-more">
      Read post <span aria-hidden="true">→</span>
    </span>
  )
}

function PostKicker({ post, latest }: { post: PostMeta; latest?: boolean }) {
  return (
    <p className="post-kicker">
      {latest && <span className="post-kicker-latest">Latest</span>}
      {post.draft && <span className="post-kicker-latest">Draft</span>}
      <span className="post-kicker-time">
        <ClockIcon /> {post.readingMinutes} min read
      </span>
    </p>
  )
}

function FeaturedCard({ post, latest }: { post: PostMeta; latest: boolean }) {
  return (
    <Link className="featured-card" to={`/blog/${post.slug}`}>
      <div className="featured-card-body">
        <PostKicker post={post} latest={latest} />
        <h2 className="featured-card-title">{post.title}</h2>
        <p className="featured-card-desc">{post.description}</p>
        <ReadMore />
      </div>
      <PostCover post={post} size="lg" />
    </Link>
  )
}

export function GridCard({ post, headingLevel = 2 }: { post: PostMeta; headingLevel?: 2 | 3 }) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  return (
    <Link className="grid-card" to={`/blog/${post.slug}`}>
      <PostCover post={post} size="md" />
      <div className="grid-card-body">
        <Heading className="grid-card-title">{post.title}</Heading>
        <p className="grid-card-desc">{post.description}</p>
        <div className="grid-card-foot">
          <PostKicker post={post} />
          <span className="grid-card-arrow" aria-hidden="true">
            →
          </span>
        </div>
      </div>
    </Link>
  )
}

function BlogIndex() {
  usePageMeta({
    title: 'Blog — WebTools',
    description:
      'Practical guides on JWTs, UUIDs, NanoIDs, X.509 certificates and giving AI agents real tools via MCP.',
  })

  const [searchParams, setSearchParams] = useSearchParams()
  const activeTag = searchParams.get('tag')

  const allTags = useMemo(() => {
    const counts = new Map<string, number>()
    for (const p of posts) for (const t of p.tags) counts.set(t, (counts.get(t) ?? 0) + 1)
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([t]) => t)
  }, [])

  const visible = activeTag ? posts.filter((p) => p.tags.includes(activeTag)) : posts
  const [featured, ...rest] = visible
  const [limit, setLimit] = useState(PAGE_SIZE)
  const shown = rest.slice(0, limit)

  const selectTag = (tag: string | null) => {
    setLimit(PAGE_SIZE)
    setSearchParams(tag && tag !== activeTag ? { tag } : {}, { replace: true })
  }

  return (
    <main className="blog-index">
      <section className="ink-hero">
        <div className="ink-hero-inner blog-hero-inner">
          <p className="eyebrow">Blog</p>
          <h1>Guides for the tools you reach for every day.</h1>
          <p className="blog-hero-lede">
            Practical how-tos on tokens, certificates, identifiers and networks, plus how to
            hand the same tools to your AI agents through our API and MCP server.
          </p>
          <a className="blog-hero-rss" href="/blog/rss.xml">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
              <circle cx="5" cy="19" r="2" fill="currentColor" />
              <path
                d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
            </svg>
            Subscribe via RSS
          </a>
        </div>
      </section>

      <div className="blog-index-content">
        {allTags.length > 0 && (
          <div className="blog-filter" role="group" aria-label="Filter posts by tag">
            <button
              type="button"
              className="tag-chip"
              aria-pressed={activeTag === null}
              onClick={() => selectTag(null)}
            >
              All posts
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="tag-chip"
                aria-pressed={activeTag === tag}
                onClick={() => selectTag(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
        )}

        {featured === undefined ? (
          <p className="blog-empty">No posts yet.</p>
        ) : (
          <>
            <FeaturedCard post={featured} latest={activeTag === null} />
            {rest.length > 0 && (
              <div className="post-grid">
                {shown.map((post) => (
                  <GridCard key={post.slug} post={post} />
                ))}
              </div>
            )}
            {rest.length > shown.length && (
              <button
                type="button"
                className="button button-secondary blog-more"
                onClick={() => setLimit((n) => n + PAGE_SIZE)}
              >
                Load more posts
              </button>
            )}
          </>
        )}
      </div>
    </main>
  )
}

export default BlogIndex
