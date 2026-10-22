import CopyJsonButton from './CopyJsonButton'
import './IdResults.css'

/** Numbered list of generated IDs with per-row and "copy all" buttons. */
export function IdResults({
  ids,
  title,
  ariaLabel,
}: {
  ids: string[]
  title: string
  ariaLabel: string
}) {
  return (
    <section className="id-results" aria-label={ariaLabel}>
      <div className="id-results-header">
        <h2>{title}</h2>
        <CopyJsonButton text={ids.join('\n')} label="Copy all" size="sm" />
      </div>
      <ol className="id-list">
        {ids.map((id, i) => (
          <li key={`${i}-${id}`} className="id-row">
            <span className="id-index" aria-hidden="true">
              {String(i + 1).padStart(2, '0')}
            </span>
            <code className="id-value">{id}</code>
            <CopyJsonButton text={id} label="Copy" size="sm" ariaLabel={`Copy ${id}`} />
          </li>
        ))}
      </ol>
    </section>
  )
}
