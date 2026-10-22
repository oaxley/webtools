import { useState } from 'react'
import { Link, NavLink, Outlet } from 'react-router-dom'
import './App.css'
import { Logo } from './components/Logo'
import { ThemeSwitch } from './components/ThemeSwitch'
import { CATEGORIES, NAV_ITEMS, TOOLS } from './tools'

function SiteFooter() {
  const year = new Date().getFullYear()
  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <div className="site-footer-brand">
          <Link to="/" aria-label="WebTools home">
            <Logo size={26} />
          </Link>
          <p>
            Precise, privacy-first tools for engineers — in your browser, over a REST API, or
            inside your AI agent via MCP.
          </p>
          <p className="site-footer-note">
            <span className="badge badge-success">Runs in your browser</span> Nothing you paste is
            logged.
          </p>
        </div>
        {CATEGORIES.map((cat) => {
          const tools = TOOLS.filter((t) => t.category === cat.id && t.available)
          if (tools.length === 0) return null
          return (
            <nav key={cat.id} className="site-footer-col" aria-label={`${cat.label} tools`}>
              <h2>{cat.label}</h2>
              <ul>
                {tools.map((t) => (
                  <li key={t.id}>
                    <Link to={t.path}>{t.name}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          )
        })}
        <nav className="site-footer-col" aria-label="Resources">
          <h2>Resources</h2>
          <ul>
            <li>
              <Link to="/blog">Blog</Link>
            </li>
            <li>
              <a href="/blog/rss.xml">RSS feed</a>
            </li>
            <li>
              <Link to="/api">REST API</Link>
            </li>
            <li>
              <Link to="/mcp">MCP server</Link>
            </li>
          </ul>
        </nav>
      </div>
      <div className="site-footer-bottom">
        <p>© {year} WebTools. Free online tools for developers.</p>
      </div>
    </footer>
  )
}

function App() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="site-header">
        <div className="site-header-inner">
          <Link className="brand" to="/" aria-label="WebTools home">
            <Logo />
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
          <div className="site-header-menu" id="main-nav" data-open={menuOpen || undefined}>
            <nav aria-label="Main" onClick={() => setMenuOpen(false)}>
              <ul>
                {NAV_ITEMS.map((item) => (
                  <li key={item.label}>
                    {/* TODO: populate API, MCP and Contacts pages. */}
                    <NavLink to={item.href} end={item.href === '/'}>
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </nav>
            <ThemeSwitch />
          </div>
        </div>
      </header>

      <div id="main-content" className="site-main" tabIndex={-1}>
        <Outlet />
      </div>

      <SiteFooter />
    </>
  )
}

export default App
