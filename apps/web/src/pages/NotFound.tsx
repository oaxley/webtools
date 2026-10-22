import { Link } from 'react-router-dom'
import { TOOLS } from '../tools'
import { usePageMeta } from '../usePageMeta'

function NotFound() {
  usePageMeta({ title: 'Page not found — WebTools' })
  const tools = TOOLS.filter((t) => t.available)
  return (
    <main className="not-found">
      <p className="eyebrow">404</p>
      <h1>Page not found</h1>
      <p className="not-found-lede">
        This page doesn't exist, or not yet. Maybe one of these is what you were after:
      </p>
      <ul className="not-found-links">
        {tools.map((tool) => (
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
      <p>
        <Link className="button button-secondary" to="/">
          ← Back to home
        </Link>
      </p>
    </main>
  )
}

export default NotFound
