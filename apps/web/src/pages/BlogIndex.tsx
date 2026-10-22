import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { GridCard, PostCover, PostKicker, ReadMore } from '../blog/cards'
import { posts, type PostMeta } from '../blog/posts'
import { usePageMeta } from '../usePageMeta'
import './Blog.css'
import './BlogIndex.css'

/** Grid cards shown before "Load more" (the featured post is extra). */
const PAGE_SIZE = 9

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
