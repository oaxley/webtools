import { useCallback, useEffect, useState } from 'react'
import { generateUUIDs, MAX_UUID_COUNT, type UuidVersion } from '@webtools/core'
import CopyJsonButton from '../components/CopyJsonButton'
import './UuidGenerator.css'

interface Settings {
  version: UuidVersion
  count: number
  uppercase: boolean
  hyphens: boolean
}

const DEFAULTS: Settings = {
  version: 7,
  count: 5,
  uppercase: false,
  hyphens: true,
}

const VERSION_HINTS: Record<UuidVersion, string> = {
  7: 'Time-ordered: sorts by creation time, a good fit for database keys.',
  4: 'Fully random: reveals nothing about when it was created.',
}

function UuidGenerator() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  // Generation runs entirely in the browser via @webtools/core — no
  // network round-trip, nothing logged server-side.
  const [uuids, setUuids] = useState<string[]>(() => generateUUIDs(DEFAULTS))

  useEffect(() => {
    document.title = 'UUID Generator — WebTools'
  }, [])

  const regenerate = useCallback((next: Settings) => {
    setSettings(next)
    setUuids(generateUUIDs(next))
  }, [])

  const update = (patch: Partial<Settings>) =>
    regenerate({ ...settings, ...patch })

  const counts = Array.from({ length: MAX_UUID_COUNT }, (_, i) => i + 1)

  return (
    <main className="tool-page uuid-page">
      <h1>UUID Generator</h1>
      <p className="tool-lede">
        Generate RFC 9562 version 7 or version 4 UUIDs, up to{' '}
        {MAX_UUID_COUNT} at a time.
      </p>

      <form
        className="uuid-controls"
        onSubmit={(e) => {
          e.preventDefault()
          regenerate(settings)
        }}
      >
        <div
          className="uuid-version-toggle"
          role="radiogroup"
          aria-label="UUID version"
        >
          {([7, 4] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={settings.version === v}
              className={
                settings.version === v
                  ? 'uuid-version uuid-version-active'
                  : 'uuid-version'
              }
              onClick={() => update({ version: v })}
            >
              v{v}
            </button>
          ))}
        </div>

        <label className="uuid-field">
          Count
          <select
            value={settings.count}
            onChange={(e) => update({ count: Number(e.target.value) })}
          >
            {counts.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        <label className="uuid-check">
          <input
            type="checkbox"
            checked={settings.uppercase}
            onChange={(e) => update({ uppercase: e.target.checked })}
          />
          Uppercase
        </label>

        <label className="uuid-check">
          <input
            type="checkbox"
            checked={settings.hyphens}
            onChange={(e) => update({ hyphens: e.target.checked })}
          />
          Hyphens
        </label>

        <button type="submit" className="uuid-generate">
          Generate
        </button>
      </form>

      <p className="uuid-hint">{VERSION_HINTS[settings.version]}</p>

      <section className="uuid-results" aria-label="Generated UUIDs">
        <div className="uuid-results-header">
          <h2>
            {uuids.length} UUID{uuids.length > 1 ? 's' : ''} (v
            {settings.version})
          </h2>
          <CopyJsonButton
            text={uuids.join('\n')}
            label="Copy all"
            size="sm"
          />
        </div>
        <ol className="uuid-list">
          {uuids.map((id) => (
            <li key={id} className="uuid-row">
              <code className="uuid-value">{id}</code>
              <CopyJsonButton
                text={id}
                label="Copy"
                size="sm"
                ariaLabel={`Copy ${id}`}
              />
            </li>
          ))}
        </ol>
      </section>
    </main>
  )
}

export default UuidGenerator
