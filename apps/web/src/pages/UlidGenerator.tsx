import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { generateULIDs, MAX_ULID_COUNT } from '@webtools/core'
import { IdResults } from '../components/IdResults'
import { ToolPage } from '../components/ToolPage'
import { readBool, readInt, writeParams } from '../urlParams'

interface Settings {
  count: number
  monotonic: boolean
  lowercase: boolean
}

const DEFAULTS: Settings = {
  count: 5,
  monotonic: true,
  lowercase: false,
}

/** Settings from `?count=3&monotonic=0&lowercase=1`, else defaults. */
function settingsFromParams(params: URLSearchParams): Settings {
  return {
    count: readInt(params, 'count', 1, MAX_ULID_COUNT) ?? DEFAULTS.count,
    monotonic: readBool(params, 'monotonic') ?? DEFAULTS.monotonic,
    lowercase: readBool(params, 'lowercase') ?? DEFAULTS.lowercase,
  }
}

function UlidGenerator() {
  const [params, setParams] = useSearchParams()
  const [settings, setSettings] = useState<Settings>(() => settingsFromParams(params))
  // Generation runs entirely in the browser via @webtools/core — no
  // network round-trip, nothing logged server-side.
  const [ulids, setUlids] = useState<string[]>(() => generateULIDs(settings))

  const regenerate = useCallback(
    (next: Settings) => {
      setSettings(next)
      setUlids(generateULIDs(next))
      setParams((prev) => writeParams(prev, next, DEFAULTS), { replace: true })
    },
    [setParams],
  )

  const update = (patch: Partial<Settings>) => regenerate({ ...settings, ...patch })

  const counts = Array.from({ length: MAX_ULID_COUNT }, (_, i) => i + 1)

  return (
    <ToolPage
      toolId="ulid"
      lede={`Generate ULIDs, up to ${MAX_ULID_COUNT} at a time: 26-character IDs that start with a timestamp, so they sort by creation time even as plain text.`}
    >
      <form
        className="tool-controls"
        onSubmit={(e) => {
          e.preventDefault()
          regenerate(settings)
        }}
      >
        <label className="tool-field">
          Count
          <select
            className="tool-input"
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

        <label
          className="tool-check"
          title="IDs created in the same millisecond stay in creation order"
        >
          <input
            type="checkbox"
            checked={settings.monotonic}
            onChange={(e) => update({ monotonic: e.target.checked })}
          />
          Monotonic
        </label>

        <label className="tool-check">
          <input
            type="checkbox"
            checked={settings.lowercase}
            onChange={(e) => update({ lowercase: e.target.checked })}
          />
          Lowercase
        </label>

        <div className="tool-controls-actions">
          <button type="submit" className="button button-primary">
            Generate new
          </button>
        </div>
      </form>

      <p className="tool-hint">
        The first 10 characters are the creation time, the last 16 are random.
        {settings.monotonic
          ? ' Monotonic: IDs from the same millisecond stay in creation order.'
          : ' Not monotonic: IDs from the same millisecond may sort in any order.'}
      </p>

      <IdResults
        ids={ulids}
        title={`${ulids.length} ULID${ulids.length > 1 ? 's' : ''}`}
        ariaLabel="Generated ULIDs"
      />
    </ToolPage>
  )
}

export default UlidGenerator
