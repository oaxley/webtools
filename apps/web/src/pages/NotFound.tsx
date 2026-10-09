import { Link } from 'react-router-dom'

function NotFound() {
  return (
    <main className="tool-page">
      <h1>Page not found</h1>
      <p className="tool-lede">
        This page does not exist yet. <Link to="/">Back to home</Link>.
      </p>
    </main>
  )
}

export default NotFound
