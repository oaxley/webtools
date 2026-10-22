import { useEffect } from 'react'

const DEFAULT_TITLE = 'WebTools — Free online tools for developers'

function setMetaDescription(content: string) {
  let tag = document.querySelector<HTMLMetaElement>('meta[name="description"]')
  if (!tag) {
    tag = document.createElement('meta')
    tag.name = 'description'
    document.head.appendChild(tag)
  }
  tag.content = content
}

/**
 * Set `document.title` and the meta description for the current page,
 * restoring the previous values on unmount. Crawlers get the same tags
 * from the static per-post HTML written at build time; this keeps them
 * right during client-side navigation.
 */
export function usePageMeta({ title, description }: { title: string; description?: string }) {
  useEffect(() => {
    const prevTitle = document.title
    const prevDescription =
      document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content
    document.title = title
    if (description) setMetaDescription(description)
    return () => {
      document.title = prevTitle || DEFAULT_TITLE
      if (description && prevDescription !== undefined) setMetaDescription(prevDescription)
    }
  }, [title, description])
}
