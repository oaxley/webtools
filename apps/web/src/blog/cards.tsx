/** Post cards and generated covers (blog listing, "More guides"). */
import { Link } from 'react-router-dom'
import { coverOf } from './cover'
import type { PostMeta } from './types'
import './cards.css'

/** Decorative, generated cover art — no image files to maintain. */
export function PostCover({ post, size }: { post: PostMeta; size: 'lg' | 'md' }) {
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

export function ClockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7v5l3 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  )
}

export function ReadMore() {
  return (
    <span className="post-read-more">
      Read post <span aria-hidden="true">→</span>
    </span>
  )
}

export function PostKicker({ post, latest }: { post: PostMeta; latest?: boolean }) {
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
