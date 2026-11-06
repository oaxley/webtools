/**
 * "Recently used" tools (kept in localStorage) and tool search, shared by
 * the home page and `/tools`.
 */
import { useState } from 'react'
import { TOOLS, type Tool } from './tools'

const RECENT_KEY = 'webtools:recent-ids'
export const MAX_RECENT = 6

function loadRecentIds(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter((id): id is string => typeof id === 'string')
  } catch {
    return []
  }
}

/**
 * Tools the visitor actually opened, newest first, and the callback that
 * records an opening (pass it to `ToolCard`'s `onOpen`).
 */
export function useRecentTools(): { recent: Tool[]; recordOpen: (tool: Tool) => void } {
  const [recentIds, setRecentIds] = useState<string[]>(loadRecentIds)

  const byId = new Map(TOOLS.map((t) => [t.id, t]))
  const recent = recentIds
    .map((id) => byId.get(id))
    .filter((t): t is Tool => t !== undefined && t.available)
    .slice(0, MAX_RECENT)

  const recordOpen = (tool: Tool) => {
    if (!tool.available) return
    setRecentIds((prev) => {
      const next = [tool.id, ...prev.filter((id) => id !== tool.id)].slice(0, MAX_RECENT)
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(next))
      } catch {
        // Storage unavailable (private mode, etc.): recents just won't persist.
      }
      return next
    })
  }

  return { recent, recordOpen }
}

/** Tools whose name, description or tags contain `query` (case-insensitive). */
export function searchTools(query: string, tools: Tool[] = TOOLS): Tool[] {
  const q = query.trim().toLowerCase()
  if (!q) return tools
  return tools.filter((t) => [t.name, t.description, ...t.tags].join(' ').toLowerCase().includes(q))
}
