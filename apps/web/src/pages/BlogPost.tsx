import { Suspense, useRef } from 'react'
import { MDXProvider } from '@mdx-js/react'
import { Link, useParams } from 'react-router-dom'
import { ClockIcon, GridCard } from '../blog/cards'
import { coverOf } from '../blog/cover'
import { mdxComponents } from '../blog/mdxComponents'
import { ReadingProgress, TableOfContents } from '../blog/PostAside'
import { findPost, postBodies, posts, type PostMeta } from '../blog/posts'
import { SITE_AUTHOR } from '../blog/site'
import { TOOLS } from '../tools'
import { usePageMeta } from '../usePageMeta'
import NotFound from './NotFound'
import './Blog.css'

const MORE_GUIDES = 3

/** Other posts, most shared tags first, then newest (the listing order). */
function relatedPosts(post: PostMeta): PostMeta[] {
  return posts
    .filter((p) => p.slug !== post.slug)
    .map((p, index) => ({
      p,
      index,
      shared:
        p.tags.filter((t) => post.tags.includes(t)).length +
        p.tools.filter((t) => post.tools.includes(t)).length,
    }))
    .sort((a, b) => b.shared - a.shared || a.index - b.index)
    .slice(0, MORE_GUIDES)
    .map(({ p }) => p)
}

function PostHero({ post }: { post: PostMeta }) {
  const { label, accent } = coverOf(post)
  return (
    <header className="ink-hero post-hero">
      <div className="ink-hero-inner post-hero-inner">
        <nav className="post-breadcrumb" aria-label="Breadcrumb">
          <ol>
            <li>
              <Link to="/blog">Blog</Link>
            </li>
            {post.tags[0] && (
              <li>
                <Link to={`/blog?tag=${encodeURIComponent(post.tags[0])}`}>{post.tags[0]}</Link>
              </li>
            )}
          </ol>
        </nav>
        <div className="post-hero-grid">
          <div className="post-hero-text">
            <h1>{post.title}</h1>
            <p className="post-lede">{post.description}</p>
            <p className="post-byline">
              <span className="post-byline-avatar" aria-hidden="true">
                WT
              </span>
              <span>By {SITE_AUTHOR}</span>
              <span aria-hidden="true">·</span>
              <span className="post-byline-time">
                <ClockIcon /> {post.readingMinutes} min read
              </span>
              {post.draft && <span className="badge">Draft</span>}
            </p>
          </div>
          <div
            className="post-hero-tile"
            style={{ '--cover-accent': accent } as React.CSSProperties}
            aria-hidden="true"
          >
            <span>{label}</span>
          </div>
        </div>
      </div>
    </header>
  )
}

function PostNav({ post }: { post: PostMeta }) {
  // `posts` is newest first: "previous" is the older neighbour.
  const i = posts.findIndex((p) => p.slug === post.slug)
  const newer = i > 0 ? posts[i - 1] : undefined
  const older = i >= 0 && i < posts.length - 1 ? posts[i + 1] : undefined
  if (!newer && !older) return null
  return (
    <nav className="post-nav" aria-label="More posts">
      {older ? (
        <Link className="post-nav-link" to={`/blog/${older.slug}`} rel="prev">
          <span className="post-nav-dir">← Previous</span>
          <span className="post-nav-title">{older.title}</span>
        </Link>
      ) : (
        <span />
      )}
      {newer && (
        <Link className="post-nav-link post-nav-next" to={`/blog/${newer.slug}`} rel="next">
          <span className="post-nav-dir">Next →</span>
          <span className="post-nav-title">{newer.title}</span>
        </Link>
      )}
    </nav>
  )
}

function BlogPost() {
  const { slug = '' } = useParams()
  const post = findPost(slug)
  const Body = Object.hasOwn(postBodies, slug) ? postBodies[slug] : undefined
  const articleRef = useRef<HTMLElement>(null)

  usePageMeta({
    title: post ? `${post.title} — WebTools` : 'Page not found — WebTools',
    description: post?.description,
  })

  if (!post || !Body) return <NotFound />

  const related = post.tools
    .map((id) => TOOLS.find((t) => t.id === id))
    .filter((t) => t !== undefined)
    .filter((t) => t.available)
  const more = relatedPosts(post)

  return (
    // `key` resets scroll-tracking state when moving between posts.
    <main className="post-page" key={post.slug}>
      <ReadingProgress targetRef={articleRef} />
      <PostHero post={post} />

      <div className="post-layout">
        <article className="post" ref={articleRef} aria-label={post.title}>
          {post.headings.length > 2 && (
            <details className="post-toc-mobile">
              <summary>On this page</summary>
              <TableOfContents headings={post.headings} />
            </details>
          )}

          <div className="prose">
            <MDXProvider components={mdxComponents}>
              <Suspense fallback={<p className="post-loading">Loading…</p>}>
                <Body />
              </Suspense>
            </MDXProvider>
          </div>

          {post.tags.length > 0 && (
            <ul className="post-tags" aria-label="Tags">
              {post.tags.map((tag) => (
                <li key={tag}>
                  <Link className="tag-chip" to={`/blog?tag=${encodeURIComponent(tag)}`}>
                    #{tag}
                  </Link>
                </li>
              ))}
            </ul>
          )}

          <PostNav post={post} />
        </article>

        <aside className="post-aside" aria-label="On this page">
          <div className="post-aside-sticky">
            {post.headings.length > 0 && (
              <section>
                <h2 className="post-aside-title">On this page</h2>
                <TableOfContents headings={post.headings} />
              </section>
            )}
            {related.length > 0 && (
              <section>
                <h2 className="post-aside-title">Tools in this guide</h2>
                <ul className="post-aside-tools">
                  {related.map((tool) => (
                    <li key={tool.id}>
                      <Link to={tool.path}>
                        <span
                          className="tool-tile"
                          aria-hidden="true"
                          style={{ '--tile-accent': tool.accent } as React.CSSProperties}
                        >
                          {tool.monogram}
                        </span>
                        {tool.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </aside>
      </div>

      {more.length > 0 && (
        <section className="post-more" aria-labelledby="more-guides">
          <div className="post-more-inner">
            <h2 id="more-guides">More guides</h2>
            <div className="post-grid">
              {more.map((p) => (
                <GridCard key={p.slug} post={p} headingLevel={3} />
              ))}
            </div>
          </div>
        </section>
      )}
    </main>
  )
}

export default BlogPost
