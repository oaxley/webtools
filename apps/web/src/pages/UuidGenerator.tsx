import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { generateUUIDs, MAX_UUID_COUNT, type UuidVersion } from '@webtools/core'
import { IdResults } from '../components/IdResults'
import { SegmentedControl, ToolPage } from '../components/ToolPage'
import { readBool, readInt, writeParams } from '../urlParams'

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

/** Settings from `?version=4&count=3&uppercase=1&hyphens=0`, else defaults. */
function settingsFromParams(params: URLSearchParams): Settings {
  const version = params.get('version')
  return {
    version: version === '4' ? 4 : version === '7' ? 7 : DEFAULTS.version,
    count: readInt(params, 'count', 1, MAX_UUID_COUNT) ?? DEFAULTS.count,
    uppercase: readBool(params, 'uppercase') ?? DEFAULTS.uppercase,
    hyphens: readBool(params, 'hyphens') ?? DEFAULTS.hyphens,
  }
}

function UuidGenerator() {
  const [params, setParams] = useSearchParams()
  const [settings, setSettings] = useState<Settings>(() => settingsFromParams(params))
  // Generation runs entirely in the browser via @webtools/core — no
  // network round-trip, nothing logged server-side.
  const [uuids, setUuids] = useState<string[]>(() => generateUUIDs(settings))

  const regenerate = useCallback(
    (next: Settings) => {
      setSettings(next)
      setUuids(generateUUIDs(next))
      setParams((prev) => writeParams(prev, next, DEFAULTS), { replace: true })
    },
    [setParams],
  )

  const update = (patch: Partial<Settings>) => regenerate({ ...settings, ...patch })

  const counts = Array.from({ length: MAX_UUID_COUNT }, (_, i) => i + 1)

  return (
    <ToolPage
      toolId="uuid"
      lede={`Generate RFC 9562 version 7 or version 4 UUIDs, up to ${MAX_UUID_COUNT} at a time.`}
    >
      <form
        className="tool-controls"
        onSubmit={(e) => {
          e.preventDefault()
          regenerate(settings)
        }}
      >
        <div className="tool-field">
          <span>Version</span>
          <SegmentedControl
            ariaLabel="UUID version"
            value={settings.version}
            options={[
              { value: 7, label: 'v7' },
              { value: 4, label: 'v4' },
            ]}
            onChange={(version) => update({ version })}
          />
        </div>

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

        <label className="tool-check">
          <input
            type="checkbox"
            checked={settings.uppercase}
            onChange={(e) => update({ uppercase: e.target.checked })}
          />
          Uppercase
        </label>

        <label className="tool-check">
          <input
            type="checkbox"
            checked={settings.hyphens}
            onChange={(e) => update({ hyphens: e.target.checked })}
          />
          Hyphens
        </label>

        <div className="tool-controls-actions">
          <button type="submit" className="button button-primary">
            Generate new
          </button>
        </div>
      </form>

      <p className="tool-hint">{VERSION_HINTS[settings.version]}</p>

      <IdResults
        ids={uuids}
        title={`${uuids.length} UUID${uuids.length > 1 ? 's' : ''} (v${settings.version})`}
        ariaLabel="Generated UUIDs"
      />
    </ToolPage>
  )
}

export default UuidGenerator
