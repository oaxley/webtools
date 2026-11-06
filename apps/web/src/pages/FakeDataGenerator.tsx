import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  FAKE_DATA_FIELD_IDS,
  FAKE_DATA_GROUPS,
  FAKE_DATA_SELECTORS,
  generateFakeData,
  MAX_FAKE_DATA_COUNT,
  MAX_FAKE_DATA_SEED,
  MAX_FAKE_DATA_VALUES,
  maxFakeDataCount,
  type FakeDataGroup,
  type FakeRecord,
} from '@webtools/core/fakeData'
import CopyJsonButton from '../components/CopyJsonButton'
import { SegmentedControl, ToolPage } from '../components/ToolPage'
import { readInt } from '../urlParams'
import './FakeDataGenerator.css'

type View = 'table' | 'json' | 'csv'

const DEFAULT_FIELDS = ['person.fullName', 'person.email', 'location.city', 'misc.id']
const DEFAULT_COUNT = 10

/** Field id → record key, e.g. `company.name` → `companyName`. */
const KEY_OF = new Map(FAKE_DATA_GROUPS.flatMap((g) => g.fields.map((f) => [f.id, f.key])))

/** `?fields=person,location.city` → field ids; unknown ids are dropped. */
function fieldsFromParam(raw: string | null): Set<string> {
  if (raw === null) return new Set(DEFAULT_FIELDS)
  const ids = new Set<string>()
  for (const selector of raw.split(',').map((s) => s.trim())) {
    if (!FAKE_DATA_SELECTORS.includes(selector)) continue
    const group = FAKE_DATA_GROUPS.find((g) => g.id === selector)
    if (group) group.fields.forEach((f) => ids.add(f.id))
    else ids.add(selector)
  }
  return ids
}

/** Shortest selector list for the URL: whole groups collapse to their id. */
function fieldsToParam(selected: Set<string>): string {
  return FAKE_DATA_GROUPS.flatMap((g) => {
    const picked = g.fields.filter((f) => selected.has(f.id))
    if (picked.length === g.fields.length) return [g.id]
    return picked.map((f) => f.id)
  }).join(',')
}

function sameFields(a: Set<string>, b: readonly string[]): boolean {
  return a.size === b.length && b.every((id) => a.has(id))
}

/** RFC 4180 field: quoted when it holds a comma, quote or line break. */
function csvCell(value: FakeRecord[string] | undefined): string {
  const text = value === undefined ? '' : String(value)
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function toCsv(keys: string[], records: FakeRecord[]): string {
  const lines = [keys.map(csvCell).join(',')]
  for (const r of records) lines.push(keys.map((k) => csvCell(r[k])).join(','))
  return lines.join('\r\n') + '\r\n'
}

function download(name: string, type: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

function parseSeed(raw: string): number | undefined | null {
  if (raw.trim() === '') return undefined
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 && n <= MAX_FAKE_DATA_SEED ? n : null
}

function GroupFields({
  group,
  selected,
  onToggle,
}: {
  group: FakeDataGroup
  selected: Set<string>
  onToggle: (ids: string[], on: boolean) => void
}) {
  const ids = group.fields.map((f) => f.id)
  const picked = ids.filter((id) => selected.has(id)).length
  const all = picked === ids.length
  return (
    <details className="fake-group" open={picked > 0 || group.id === 'person'}>
      <summary>
        <label className="fake-check fake-group-check" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={all}
            ref={(el) => {
              if (el) el.indeterminate = picked > 0 && !all
            }}
            onChange={() => onToggle(ids, !all)}
          />
          {group.label}
        </label>
        <span className="fake-group-count">
          {picked}/{ids.length}
        </span>
      </summary>
      <ul>
        {group.fields.map((f) => (
          <li key={f.id}>
            <label className="fake-check" title={`${f.id} — e.g. ${f.example}`}>
              <input
                type="checkbox"
                checked={selected.has(f.id)}
                onChange={(e) => onToggle([f.id], e.target.checked)}
              />
              {f.label}
            </label>
          </li>
        ))}
      </ul>
    </details>
  )
}

function FakeDataGenerator() {
  const [params, setParams] = useSearchParams()
  const [selected, setSelected] = useState(() => fieldsFromParam(params.get('fields')))
  const [count, setCount] = useState(
    () => readInt(params, 'count', 1, MAX_FAKE_DATA_COUNT) ?? DEFAULT_COUNT,
  )
  const [countInput, setCountInput] = useState(String(count))
  const [seedInput, setSeedInput] = useState(() => params.get('seed') ?? '')
  const [view, setView] = useState<View>(() => {
    const v = params.get('view')
    return v === 'json' || v === 'csv' ? v : 'table'
  })
  // Bumped by "Generate new" to draw a fresh unseeded batch.
  const [nonce, setNonce] = useState(0)

  const seed = parseSeed(seedInput)
  const countValid = (() => {
    const n = Number(countInput)
    return countInput.trim() !== '' && Number.isInteger(n) && n >= 1 && n <= MAX_FAKE_DATA_COUNT
  })()

  const writeUrl = (patch: { fields?: Set<string>; count?: number; seed?: string; view?: View }) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        const set = (key: string, value: string, isDefault: boolean) => {
          if (isDefault) next.delete(key)
          else next.set(key, value)
        }
        if (patch.fields) {
          set('fields', fieldsToParam(patch.fields), sameFields(patch.fields, DEFAULT_FIELDS))
        }
        if (patch.count !== undefined) set('count', String(patch.count), patch.count === DEFAULT_COUNT)
        if (patch.seed !== undefined) set('seed', patch.seed.trim(), patch.seed.trim() === '')
        if (patch.view) set('view', patch.view, patch.view === 'table')
        return next
      },
      { replace: true },
    )
  }

  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(selected)
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)))
    setSelected(next)
    writeUrl({ fields: next })
  }

  const selectAll = (on: boolean) => {
    const next = new Set(on ? FAKE_DATA_FIELD_IDS : [])
    setSelected(next)
    writeUrl({ fields: next })
  }

  const fields = useMemo(() => FAKE_DATA_FIELD_IDS.filter((id) => selected.has(id)), [selected])
  const keys = useMemo(() => fields.map((id) => KEY_OF.get(id)!), [fields])

  // Same cap as the API and MCP tool (fields × records), so a page setup
  // always works there too. The chosen count is kept and comes back once
  // fewer fields are selected.
  const maxCount = maxFakeDataCount(fields.length)
  const effectiveCount = Math.min(count, maxCount)

  // Generation runs entirely in the browser: no network round-trip.
  const records = useMemo(() => {
    void nonce
    if (fields.length === 0 || seed === null) return []
    return generateFakeData({ fields, count: effectiveCount, seed }).records
  }, [fields, effectiveCount, seed, nonce])

  const json = useMemo(() => JSON.stringify(records, null, 2), [records])
  const csv = useMemo(() => toCsv(keys, records), [keys, records])

  return (
    <ToolPage
      toolId="fake-data"
      wide
      className="fake-page"
      lede={`Realistic fake records to seed a database or fill a UI, up to ${MAX_FAKE_DATA_COUNT} at a time (${MAX_FAKE_DATA_VALUES.toLocaleString('en')} values per batch). Pick fields on the left; fields of a group agree within a record (the email matches the name, the ZIP code matches the state).`}
    >
      <form
        className="tool-controls"
        onSubmit={(e) => {
          e.preventDefault()
          setNonce((n) => n + 1)
        }}
      >
        <label className="tool-field">
          Records
          <input
            type="number"
            inputMode="numeric"
            className="tool-input fake-number"
            min={1}
            max={MAX_FAKE_DATA_COUNT}
            step={1}
            value={countInput}
            aria-invalid={!countValid}
            onChange={(e) => {
              setCountInput(e.target.value)
              const n = Number(e.target.value)
              if (Number.isInteger(n) && n >= 1 && n <= MAX_FAKE_DATA_COUNT && e.target.value.trim() !== '') {
                setCount(n)
                writeUrl({ count: n })
              }
            }}
          />
        </label>

        <label className="tool-field" title="Same seed, fields and count give the same records">
          Seed (optional)
          <input
            type="text"
            inputMode="numeric"
            className="tool-input fake-seed"
            placeholder="random"
            value={seedInput}
            aria-invalid={seed === null}
            onChange={(e) => {
              setSeedInput(e.target.value)
              if (parseSeed(e.target.value) !== null) writeUrl({ seed: e.target.value })
            }}
          />
        </label>

        <div className="tool-field">
          View
          <SegmentedControl
            ariaLabel="View"
            value={view}
            options={[
              { value: 'table', label: 'Table' },
              { value: 'json', label: 'JSON' },
              { value: 'csv', label: 'CSV' },
            ]}
            onChange={(v) => {
              setView(v)
              writeUrl({ view: v })
            }}
          />
        </div>

        <div className="tool-controls-actions">
          <button
            type="submit"
            className="button button-primary"
            disabled={fields.length === 0 || seed !== undefined}
            title={seed !== undefined ? 'Clear the seed to draw new records' : undefined}
          >
            Generate new
          </button>
        </div>
      </form>

      {!countValid && (
        <p className="tool-hint fake-error" role="alert">
          Records must be a whole number between 1 and {MAX_FAKE_DATA_COUNT}.
        </p>
      )}
      {countValid && effectiveCount < count && (
        <p className="tool-hint fake-capped" role="status">
          Showing {effectiveCount} records instead of {count}: a batch holds at most{' '}
          {MAX_FAKE_DATA_VALUES.toLocaleString('en')} values, and {fields.length} fields ×{' '}
          {count} would be {(fields.length * count).toLocaleString('en')}. Pick fewer fields for more
          records.
        </p>
      )}
      {seed === null && (
        <p className="tool-hint fake-error" role="alert">
          The seed must be a whole number between 0 and {MAX_FAKE_DATA_SEED}, or empty for random
          records.
        </p>
      )}
      {seed !== undefined && seed !== null && (
        <p className="tool-hint">
          Seeded: these records come out the same every time, here, in the API and in the MCP tool.
        </p>
      )}

      <div className="fake-layout">
        <aside className="fake-fields" aria-label="Fields">
          <div className="fake-fields-header">
            <h2>
              Fields <span className="fake-group-count">{fields.length}</span>
            </h2>
            <div className="fake-fields-actions">
              <button type="button" className="button button-ghost" onClick={() => selectAll(true)}>
                All
              </button>
              <button type="button" className="button button-ghost" onClick={() => selectAll(false)}>
                None
              </button>
            </div>
          </div>
          {FAKE_DATA_GROUPS.map((g) => (
            <GroupFields key={g.id} group={g} selected={selected} onToggle={toggle} />
          ))}
        </aside>

        <section className="fake-results" aria-label="Generated records">
          <div className="fake-results-header">
            <h2>
              {records.length} record{records.length === 1 ? '' : 's'}
              {fields.length > 0 && `, ${fields.length} field${fields.length === 1 ? '' : 's'}`}
            </h2>
            <div className="fake-results-actions">
              <CopyJsonButton
                text={view === 'csv' ? csv : json}
                label={view === 'csv' ? 'Copy CSV' : 'Copy JSON'}
                size="sm"
                disabled={records.length === 0}
              />
              <button
                type="button"
                className="button button-ghost fake-download"
                disabled={records.length === 0}
                onClick={() =>
                  view === 'csv'
                    ? download('fake-data.csv', 'text/csv', csv)
                    : download('fake-data.json', 'application/json', json + '\n')
                }
              >
                Download {view === 'csv' ? 'CSV' : 'JSON'}
              </button>
            </div>
          </div>

          {fields.length === 0 ? (
            <p className="fake-empty">Pick at least one field on the left.</p>
          ) : view === 'table' ? (
            <div className="fake-table-wrap">
              <table className="fake-table">
                <thead>
                  <tr>
                    {keys.map((k) => (
                      <th key={k} scope="col">
                        {k}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {records.map((r, i) => (
                    <tr key={i}>
                      {keys.map((k) => (
                        <td key={k} title={String(r[k])}>
                          {String(r[k])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <pre className="fake-code">{view === 'csv' ? csv : json}</pre>
          )}
        </section>
      </div>
    </ToolPage>
  )
}

export default FakeDataGenerator
