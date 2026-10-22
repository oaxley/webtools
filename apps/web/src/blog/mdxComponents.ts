import type { MDXComponents } from 'mdx/types'
import { Anchor, Callout, Figure, Pre, Tab, Table, Tabs, ToolLink, TryIt } from './components'

/** Element overrides and components available in every blog post. */
export const mdxComponents: MDXComponents = {
  pre: Pre,
  figure: Figure,
  a: Anchor,
  table: Table,
  Callout,
  TryIt,
  ToolLink,
  Tabs,
  Tab,
}
