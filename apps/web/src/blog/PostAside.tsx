/**
 * Reading aids for a post page: the "On this page" list with the current
 * section highlighted, and the reading-progress bar under the header.
 */
import { useEffect, useRef, useState } from 'react'
import type { PostHeading } from './types'

/** Distance below the viewport top at which a heading becomes "current". */
const ACTIVE_OFFSET = 120

/**
 * Id of the last heading scrolled past. Polls the DOM on scroll rather
 * than observing elements, because the post body is lazy-loaded and the
 * headings may not exist yet when this mounts.
 */
function useActiveHeading(ids: string[]): string | null {
  const [active, setActive] = useState<string | null>(null)
  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      let current: string | null = null
      for (const id of ids) {
        const el = document.getElementById(id)
        if (!el) continue
        if (el.getBoundingClientRect().top - ACTIVE_OFFSET <= 0) current = id
        else break
      }
      // At the very bottom, the last short sections can't reach the
      // offset: highlight the final heading instead.
      const atEnd =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4
      if (atEnd && ids.length > 0 && document.getElementById(ids[ids.length - 1])) {
        current = ids[ids.length - 1]
      }
      setActive(current)
    }
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(update)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    onScroll()
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [ids])
  return active
}

export function TableOfContents({
  headings,
  className,
}: {
  headings: PostHeading[]
  className?: string
}) {
  const [ids] = useState(() => headings.map((h) => h.id))
  const active = useActiveHeading(ids)
  if (headings.length === 0) return null
  return (
    <ol className={`toc ${className ?? ''}`}>
      {headings.map((h) => (
        <li key={h.id} className={`toc-item toc-depth-${h.depth}`}>
          <a href={`#${h.id}`} aria-current={active === h.id ? 'location' : undefined}>
            {h.text}
          </a>
        </li>
      ))}
    </ol>
  )
}

/** Thin bar under the sticky header showing how far the article is read. */
export function ReadingProgress({ targetRef }: { targetRef: React.RefObject<HTMLElement | null> }) {
  const barRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let frame = 0
    const update = () => {
      frame = 0
      const el = targetRef.current
      const bar = barRef.current
      if (!el || !bar) return
      const rect = el.getBoundingClientRect()
      const total = rect.height - window.innerHeight
      const progress = total <= 0 ? 1 : Math.min(1, Math.max(0, -rect.top / total))
      bar.style.transform = `scaleX(${progress})`
    }
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(update)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    // The body loads lazily and changes height: re-measure when it does.
    const observer = new ResizeObserver(onScroll)
    if (targetRef.current) observer.observe(targetRef.current)
    onScroll()
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      observer.disconnect()
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [targetRef])
  return (
    <div className="reading-progress" aria-hidden="true">
      <div ref={barRef} className="reading-progress-bar" />
    </div>
  )
}
