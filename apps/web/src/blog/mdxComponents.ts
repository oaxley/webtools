import type { MDXComponents } from 'mdx/types'
import { Anchor, Callout, Pre, Tab, Table, Tabs, ToolLink, TryIt } from './components'

/** Element overrides and components available in every blog post. */
export const mdxComponents: MDXComponents = {
  pre: Pre,
  a: Anchor,
  table: Table,
  Callout,
  TryIt,
  ToolLink,
  Tabs,
  Tab,
}
