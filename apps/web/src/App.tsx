import { useState } from 'react'
import { Link, Outlet } from 'react-router-dom'
import './App.css'
import { NAV_ITEMS } from './tools'

function App() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <>
      <header className="site-header">
        <Link className="brand" to="/">
          WebTools
        </Link>
        <button
          type="button"
          className="menu-toggle"
          aria-expanded={menuOpen}
          aria-controls="main-nav"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span aria-hidden="true" />
          <span aria-hidden="true" />
          <span aria-hidden="true" />
        </button>
        <nav
          id="main-nav"
          aria-label="Main"
          data-open={menuOpen || undefined}
          onClick={() => setMenuOpen(false)}
        >
          <ul>
            {NAV_ITEMS.map((item) => (
              <li key={item.label}>
                {/* TODO: populate Blog, API, MCP and Contacts pages. */}
                <Link to={item.href}>{item.label}</Link>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <Outlet />

      <footer className="site-footer">
        <p>WebTools — free online tools for developers.</p>
      </footer>
    </>
  )
}

export default App
