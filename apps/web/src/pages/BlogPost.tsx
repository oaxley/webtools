import { Suspense } from 'react'
import { MDXProvider } from '@mdx-js/react'
import { Link, useParams } from 'react-router-dom'
import { findPost, postBodies } from '../blog/posts'
import { mdxComponents } from '../blog/mdxComponents'
import { SITE_AUTHOR } from '../blog/site'
import { TOOLS } from '../tools'
import { usePageMeta } from '../usePageMeta'
import NotFound from './NotFound'
import './Blog.css'

function BlogPost() {
  const { slug = '' } = useParams()
  const post = findPost(slug)
  const Body = Object.hasOwn(postBodies, slug) ? postBodies[slug] : undefined

  usePageMeta({
    title: post ? `${post.title} — WebTools` : 'Page not found — WebTools',
    description: post?.description,
  })

  if (!post || !Body) return <NotFound />

  const related = post.tools
    .map((id) => TOOLS.find((t) => t.id === id))
    .filter((t) => t !== undefined)

  return (
    <main className="blog-page post-page">
      <nav className="post-breadcrumb" aria-label="Breadcrumb">
        <Link to="/blog">← All posts</Link>
      </nav>

      <article className="post">
        <header className="post-header">
          <h1>{post.title}</h1>
          <p className="post-lede">{post.description}</p>
          <p className="post-meta">
            <span>By {SITE_AUTHOR}</span>
            <span aria-hidden="true">·</span>
            <span>{post.readingMinutes} min read</span>
          </p>
          {post.tags.length > 0 && (
            <ul className="post-tags" aria-label="Tags">
              {post.tags.map((tag) => (
                <li key={tag}>
                  <Link className="tag-chip" to={`/blog?tag=${encodeURIComponent(tag)}`}>
                    {tag}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </header>

        <div className="prose">
          <MDXProvider components={mdxComponents}>
            <Suspense fallback={<p className="post-loading">Loading…</p>}>
              <Body />
            </Suspense>
          </MDXProvider>
        </div>
      </article>

      {related.length > 0 && (
        <section className="post-related" aria-labelledby="related-tools">
          <h2 id="related-tools">Related tools</h2>
          <div className="tools-grid">
            {related.map((tool) =>
              tool.available ? (
                <Link key={tool.id} className="tool-card" to={tool.path}>
                  <span
                    className="tool-tile"
                    aria-hidden="true"
                    style={{ '--tile-accent': tool.accent } as React.CSSProperties}
                  >
                    {tool.monogram}
                  </span>
                  <span className="tool-body">
                    <span className="tool-name">{tool.name}</span>
                    <span className="tool-desc">{tool.description}</span>
                  </span>
                </Link>
              ) : null,
            )}
          </div>
        </section>
      )}
    </main>
  )
}

export default BlogPost
