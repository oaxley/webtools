/**
 * Password generator and strength checker.
 *
 * Three modes:
 * - Random: characters from chosen sets. Strength is exact, since every
 *   character is drawn uniformly: `passwordEntropyBits` counts the
 *   possibilities.
 * - Passphrase: words from the EFF large wordlist, also exact.
 * - Check: a password the user typed, rated by the pattern-matching
 *   estimator. Its dictionaries are ~100 KB, so it is loaded on demand.
 *
 * Settings live in the query string (`/password?mode=passphrase&words=5`)
 * so a configured generator can be linked to. Passwords never do. Blog
 * links may pre-fill the check field with a public example through the
 * fragment (`#password=…`), which is read once, then cleared, and never
 * reaches a server.
 *
 * The opt-in breach check sends only the first 5 hex digits of the
 * password's SHA-1 to Have I Been Pwned (k-anonymity), with padding so
 * even the response size says nothing, and matches the rest locally.
 */
import { useDeferredValue, useEffect, useId, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  AMBIGUOUS_CHARACTERS,
  bytesToHex,
  crackTimes,
  digest,
  generatePasswords,
  MAX_PASSWORD_COUNT,
  PASSPHRASE_MAX_WORDS,
  PASSPHRASE_MIN_WORDS,
  PASSWORD_CHARSET_NAMES,
  PASSWORD_CHARSETS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordEntropyBits,
  scoreFromLog10,
  STRENGTH_LABELS,
  textToBytes,
  type CrackTime,
  type PassphraseOptions,
  type PasswordCharset,
  type RandomPasswordOptions,
  type StrengthScore,
} from '@webtools/core'
import type { StrengthEstimate } from '@webtools/core/passwordStrength'
import CopyJsonButton from '../components/CopyJsonButton'
import { IdResults } from '../components/IdResults'
import { SegmentedControl, ToolPage } from '../components/ToolPage'
import { clearFragment, readBool, readFragmentParam, readInt, writeParams } from '../urlParams'
import './PasswordGenerator.css'

type Mode = 'random' | 'passphrase' | 'check'

interface Settings {
  mode: Mode
  length: number
  lower: boolean
  upper: boolean
  digits: boolean
  symbols: boolean
  ambiguous: boolean
  each: boolean
  words: number
  sep: string
  caps: boolean
  num: boolean
}

const DEFAULTS: Settings = {
  mode: 'random',
  length: 20,
  lower: true,
  upper: true,
  digits: true,
  symbols: true,
  ambiguous: false,
  each: true,
  words: 6,
  sep: '-',
  caps: false,
  num: false,
}

const SEPARATORS = [
  { value: '-', label: 'Hyphen  -' },
  { value: ' ', label: 'Space' },
  { value: '.', label: 'Dot  .' },
  { value: '_', label: 'Underscore  _' },
  { value: ',', label: 'Comma  ,' },
  { value: '/', label: 'Slash  /' },
]

const SET_LABELS: Record<PasswordCharset, string> = {
  lower: 'a–z',
  upper: 'A–Z',
  digits: '0–9',
  symbols: '!@#$…',
}

/** Extra candidates shown under the main password. */
const MORE_COUNT = 5

function settingsFromParams(params: URLSearchParams): Settings {
  const mode = params.get('mode')
  const sep = params.get('sep')
  const sets = Object.fromEntries(
    PASSWORD_CHARSET_NAMES.map((s) => [s, readBool(params, s) ?? DEFAULTS[s]]),
  ) as Pick<Settings, PasswordCharset>
  // At least one set, whatever the URL says.
  if (!PASSWORD_CHARSET_NAMES.some((s) => sets[s])) sets.lower = true
  return {
    mode: mode === 'passphrase' || mode === 'check' ? mode : 'random',
    length:
      readInt(params, 'length', PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH) ?? DEFAULTS.length,
    ...sets,
    ambiguous: readBool(params, 'ambiguous') ?? DEFAULTS.ambiguous,
    each: readBool(params, 'each') ?? DEFAULTS.each,
    words: readInt(params, 'words', PASSPHRASE_MIN_WORDS, PASSPHRASE_MAX_WORDS) ?? DEFAULTS.words,
    sep: SEPARATORS.some((s) => s.value === sep) ? sep! : DEFAULTS.sep,
    caps: readBool(params, 'caps') ?? DEFAULTS.caps,
    num: readBool(params, 'num') ?? DEFAULTS.num,
  }
}

function generatorOptions(s: Settings): RandomPasswordOptions | PassphraseOptions {
  return s.mode === 'passphrase'
    ? {
        mode: 'passphrase',
        words: s.words,
        separator: s.sep,
        capitalize: s.caps,
        includeNumber: s.num,
      }
    : {
        mode: 'random',
        length: s.length,
        sets: PASSWORD_CHARSET_NAMES.filter((set) => s[set]),
        excludeAmbiguous: s.ambiguous,
        requireEachSet: s.each,
      }
}

function generate(s: Settings): string[] {
  if (s.mode === 'check') return []
  const count = Math.min(1 + MORE_COUNT, MAX_PASSWORD_COUNT)
  return generatePasswords({ ...generatorOptions(s), count }).passwords
}

/** Characters the random generator draws from with these settings. */
function alphabetSize(s: Settings): number {
  return PASSWORD_CHARSET_NAMES.filter((set) => s[set])
    .flatMap((set) => [...PASSWORD_CHARSETS[set]])
    .filter((c) => !s.ambiguous || !AMBIGUOUS_CHARACTERS.includes(c)).length
}

/* ---- Strength meter ------------------------------------------------------ */

function StrengthMeter({
  score,
  bits,
  exact,
  times,
}: {
  score: StrengthScore
  bits: number
  exact: boolean
  times: CrackTime[]
}) {
  const label = STRENGTH_LABELS[score]
  return (
    <section className={`pw-meter pw-score-${score}`} aria-label="Password strength">
      <div className="pw-meter-head">
        <div
          className="pw-meter-bar"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={4}
          aria-valuenow={score}
          aria-valuetext={label}
          aria-label="Strength"
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className={i <= score ? 'is-on' : undefined} />
          ))}
        </div>
        <p className="pw-meter-verdict">
          <strong>{label}</strong>
          <span>
            {exact ? '' : '≈ '}
            {Math.round(bits)} bits
            {exact ? ' of entropy, exact' : ', estimated'}
          </span>
        </p>
      </div>
      <dl className="pw-crack">
        {times.map((t) => (
          <div key={t.scenario} title={t.detail}>
            <dt>{t.label}</dt>
            <dd>{t.text}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** Score, bits and crack times for a password whose entropy is exact. */
function exactStrength(bits: number) {
  const log10 = bits * Math.log10(2)
  return { score: scoreFromLog10(log10), bits, times: crackTimes(log10) }
}

/* ---- Breach check (Have I Been Pwned, k-anonymity) ------------------------ */

type BreachState =
  | { state: 'idle' }
  | { state: 'checking'; password: string }
  | { state: 'done'; count: number }
  | { state: 'error'; message: string }

async function breachCount(password: string, signal: AbortSignal): Promise<number> {
  const hash = bytesToHex(digest('sha1', textToBytes(password))).toUpperCase()
  const prefix = hash.slice(0, 5)
  const suffix = hash.slice(5)
  const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
    // Padding adds fake entries (count 0) so the response size doesn't
    // reveal how many real suffixes share the prefix.
    headers: { 'Add-Padding': 'true' },
    signal,
    referrerPolicy: 'no-referrer',
    credentials: 'omit',
  })
  if (!response.ok) throw new Error(`Have I Been Pwned answered ${response.status}.`)
  for (const line of (await response.text()).split('\n')) {
    const [candidate, count] = line.trim().split(':')
    if (candidate === suffix) return Number(count)
  }
  return 0
}

/* ---- Page ------------------------------------------------------------------ */

type StrengthModule = typeof import('@webtools/core/passwordStrength')

function PasswordGenerator() {
  const [params, setParams] = useSearchParams()
  const [settings, setSettings] = useState<Settings>(() => settingsFromParams(params))
  // Generation runs in the browser: nothing is sent or logged anywhere.
  const [passwords, setPasswords] = useState<string[]>(() => generate(settings))
  const [checked, setChecked] = useState(() => readFragmentParam('password') ?? '')
  useEffect(clearFragment, [])
  const [reveal, setReveal] = useState(false)
  const [strength, setStrength] = useState<StrengthModule | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [breach, setBreach] = useState<BreachState>({ state: 'idle' })
  const checkId = useId()

  const { mode } = settings

  const update = (patch: Partial<Settings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    if (next.mode !== 'check') setPasswords(generate(next))
    setParams((prev) => writeParams(prev, next, DEFAULTS), { replace: true })
  }

  // The estimator and its dictionaries load only once Check is opened.
  useEffect(() => {
    if (mode !== 'check' || strength) return
    let cancelled = false
    import('@webtools/core/passwordStrength').then(
      (module) => !cancelled && setStrength(module),
      () => !cancelled && setLoadError(true),
    )
    return () => {
      cancelled = true
    }
  }, [mode, strength])

  const deferredChecked = useDeferredValue(checked)
  const estimate: StrengthEstimate | null = useMemo(
    () => (strength && deferredChecked !== '' ? strength.estimateStrength(deferredChecked) : null),
    [strength, deferredChecked],
  )

  const generated = mode === 'check' ? null : exactStrength(passwordEntropyBits(generatorOptions(settings)))
  const [main, ...more] = passwords
  const enabledSets = PASSWORD_CHARSET_NAMES.filter((s) => settings[s])

  const runBreachCheck = () => {
    const password = checked
    setBreach({ state: 'checking', password })
    // Ignore an answer that arrives after the password was edited.
    const settle = (next: BreachState) =>
      setBreach((prev) =>
        prev.state === 'checking' && prev.password === password ? next : prev,
      )
    breachCount(password, AbortSignal.timeout(15_000)).then(
      (count) => settle({ state: 'done', count }),
      (e: unknown) =>
        settle({
          state: 'error',
          message:
            e instanceof Error && e.message.startsWith('Have I Been Pwned')
              ? e.message
              : 'Could not reach Have I Been Pwned. Check your connection and try again.',
        }),
    )
  }

  return (
    <ToolPage
      toolId="password"
      className="password-page"
      lede="Generate strong random passwords and passphrases with their exact strength, or check how long a password would survive an attack. Everything runs in your browser."
    >
      <div className="pw-tabs">
        <SegmentedControl
          ariaLabel="Mode"
          value={mode}
          options={[
            { value: 'random', label: 'Random' },
            { value: 'passphrase', label: 'Passphrase' },
            { value: 'check', label: 'Check a password' },
          ]}
          onChange={(next) => update({ mode: next })}
        />
      </div>

      {mode !== 'check' && main !== undefined && generated && (
        <>
          <section className="pw-result" aria-label="Generated password">
            <output className="pw-value" aria-live="polite">
              {main}
            </output>
            <div className="pw-result-actions">
              <CopyJsonButton text={main} label="Copy" ariaLabel="Copy password" />
              <button
                type="button"
                className="button button-primary"
                onClick={() => setPasswords(generate(settings))}
              >
                Regenerate
              </button>
            </div>
          </section>

          <StrengthMeter
            score={generated.score}
            bits={generated.bits}
            exact
            times={generated.times}
          />

          <div className="tool-controls pw-controls">
            {mode === 'random' ? (
              <>
                <label className="tool-field pw-slider">
                  <span>
                    Length <output className="pw-slider-value">{settings.length}</output>
                  </span>
                  <input
                    type="range"
                    min={PASSWORD_MIN_LENGTH}
                    max={64}
                    value={Math.min(settings.length, 64)}
                    onChange={(e) => update({ length: Number(e.target.value) })}
                  />
                </label>
                <label className="tool-field">
                  Exact
                  <input
                    type="number"
                    className="tool-input pw-number"
                    min={PASSWORD_MIN_LENGTH}
                    max={PASSWORD_MAX_LENGTH}
                    value={settings.length}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      if (Number.isInteger(n) && n >= PASSWORD_MIN_LENGTH && n <= PASSWORD_MAX_LENGTH) {
                        update({ length: n })
                      }
                    }}
                  />
                </label>
                <fieldset className="pw-sets">
                  <legend className="tool-field">Characters</legend>
                  {PASSWORD_CHARSET_NAMES.map((set) => (
                    <label
                      key={set}
                      className="tool-check"
                      title={`${PASSWORD_CHARSETS[set].length} characters: ${PASSWORD_CHARSETS[set]}`}
                    >
                      <input
                        type="checkbox"
                        checked={settings[set]}
                        // Keep at least one set.
                        disabled={settings[set] && enabledSets.length === 1}
                        onChange={(e) => update({ [set]: e.target.checked })}
                      />
                      <code>{SET_LABELS[set]}</code>
                    </label>
                  ))}
                </fieldset>
                <label className="tool-check" title="Leave out 0 O 1 l I |">
                  <input
                    type="checkbox"
                    checked={settings.ambiguous}
                    onChange={(e) => update({ ambiguous: e.target.checked })}
                  />
                  No look-alikes
                </label>
                <label
                  className="tool-check"
                  title="Many sites demand one of each; this costs well under a bit of entropy"
                >
                  <input
                    type="checkbox"
                    checked={settings.each}
                    disabled={enabledSets.length === 1}
                    onChange={(e) => update({ each: e.target.checked })}
                  />
                  At least one of each
                </label>
              </>
            ) : (
              <>
                <label className="tool-field pw-slider">
                  <span>
                    Words <output className="pw-slider-value">{settings.words}</output>
                  </span>
                  <input
                    type="range"
                    min={PASSPHRASE_MIN_WORDS}
                    max={PASSPHRASE_MAX_WORDS}
                    value={settings.words}
                    onChange={(e) => update({ words: Number(e.target.value) })}
                  />
                </label>
                <label className="tool-field">
                  Separator
                  <select
                    className="tool-input"
                    value={settings.sep}
                    onChange={(e) => update({ sep: e.target.value })}
                  >
                    {SEPARATORS.map((s) => (
                      <option key={s.label} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="tool-check">
                  <input
                    type="checkbox"
                    checked={settings.caps}
                    onChange={(e) => update({ caps: e.target.checked })}
                  />
                  Capitalise
                </label>
                <label className="tool-check" title="One random digit after one random word">
                  <input
                    type="checkbox"
                    checked={settings.num}
                    onChange={(e) => update({ num: e.target.checked })}
                  />
                  Add a number
                </label>
              </>
            )}
          </div>

          <p className="tool-hint">
            {mode === 'random'
              ? `Each character is drawn at random from ${alphabetSize(settings)} possible ones.`
              : `Each word is one of 7,776 from the EFF wordlist: about 12.9 bits, like five dice rolls.`}{' '}
            Generated with your browser's cryptographic random number generator.
          </p>

          <IdResults
            ids={more}
            title={`${more.length} more`}
            ariaLabel="More generated passwords"
          />
        </>
      )}

      {mode === 'check' && (
        <>
          <div className="pw-check">
            <label htmlFor={checkId} className="tool-field">
              Password to check
            </label>
            <div className="pw-check-row">
              <input
                id={checkId}
                type={reveal ? 'text' : 'password'}
                className="tool-input pw-check-input"
                value={checked}
                onChange={(e) => {
                  setChecked(e.target.value)
                  // A breach result belongs to the password it was computed for.
                  setBreach({ state: 'idle' })
                }}
                placeholder="Type or paste a password"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                // Password managers shouldn't offer to save what's typed here.
                data-1p-ignore
                data-lpignore="true"
              />
              <button
                type="button"
                className="button button-ghost"
                aria-pressed={reveal}
                onClick={() => setReveal(!reveal)}
              >
                {reveal ? 'Hide' : 'Show'}
              </button>
            </div>
            <p className="pw-private">
              <span className="tool-chip-dot" aria-hidden="true" /> Never leaves your browser.
              Checked locally against common passwords, words, names, keyboard patterns and
              dates.
            </p>
          </div>

          {loadError ? (
            <div className="error-box" role="alert">
              The strength checker failed to load. Reload the page to try again.
            </div>
          ) : !strength ? (
            <p className="tool-hint">Loading the checker…</p>
          ) : estimate ? (
            <>
              <StrengthMeter
                score={estimate.score}
                bits={estimate.bits}
                exact={false}
                times={estimate.crackTimes}
              />

              {(estimate.warning || estimate.suggestions.length > 0) && (
                <div className="pw-feedback" aria-live="polite">
                  {estimate.warning && <p className="pw-warning">{estimate.warning}</p>}
                  {estimate.suggestions.length > 0 && (
                    <ul>
                      {estimate.suggestions.map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <section className="pw-patterns" aria-label="How an attacker would see it">
                <h2>How an attacker would see it</h2>
                <ol>
                  {estimate.patterns.map((p) => (
                    <li key={`${p.start}-${p.token}`} className={`pw-pattern pw-pattern-${p.pattern}`}>
                      <code>{reveal ? p.token : '•'.repeat([...p.token].length)}</code>
                      <span>{p.description}</span>
                      <span className="pw-pattern-bits">
                        {Math.max(0, Math.round(Math.log2(p.guesses)))} bits
                      </span>
                    </li>
                  ))}
                </ol>
                {!reveal && (
                  <p className="tool-hint">Click Show to see which part of the password each piece is.</p>
                )}
              </section>

              <section className="pw-breach" aria-label="Breach check">
                <div>
                  <h2>Has it leaked?</h2>
                  <p>
                    Checks <a href="https://haveibeenpwned.com/Passwords">Have I Been Pwned</a>'s
                    list of over 900 million breached passwords. Only the first 5 characters of the
                    password's SHA-1 hash are sent; the match happens here.
                  </p>
                </div>
                {breach.state === 'done' ? (
                  breach.count > 0 ? (
                    <p className="pw-breach-result is-bad" role="status">
                      Found in breaches <strong>{breach.count.toLocaleString('en-US')}</strong>{' '}
                      {breach.count === 1 ? 'time' : 'times'}. Don't use it.
                    </p>
                  ) : (
                    <p className="pw-breach-result is-good" role="status">
                      Not found in any known breach.
                    </p>
                  )
                ) : (
                  <button
                    type="button"
                    className="button button-ghost"
                    disabled={breach.state === 'checking'}
                    onClick={runBreachCheck}
                  >
                    {breach.state === 'checking' ? 'Checking…' : 'Check against breaches'}
                  </button>
                )}
                {breach.state === 'error' && (
                  <p className="pw-breach-result is-bad" role="alert">
                    {breach.message}
                  </p>
                )}
              </section>
            </>
          ) : (
            <p className="tool-hint">
              Strength shows up as you type. Try <code>P@ssw0rd</code>,{' '}
              <code>Tr0ub4dor&amp;3</code> or <code>correct horse battery staple</code>.
            </p>
          )}
        </>
      )}

      <section className="field-guide" aria-label="About password strength">
        <h2>What makes a password strong?</h2>
        <p className="field-guide-hint">
          Strength is the number of guesses an attacker needs. Bits are that number on a log scale:
          each extra bit doubles the work.
        </p>
        <dl>
          <div>
            <dt>Length beats complexity</dt>
            <dd>
              Every random character multiplies the possibilities. 16 random characters from all
              94 give about 105 bits; adding a symbol to an 8-character password barely moves it.
            </dd>
          </div>
          <div>
            <dt>Random, not clever</dt>
            <dd>
              Crackers try leaked passwords, dictionary words, names and dates first, with the
              usual tweaks: a capital at the start, digits and a <code>!</code> at the end,{' '}
              <code>@</code> for <code>a</code>. <code>P@ssw0rd1!</code> looks complex and falls in
              seconds. Only a generator gives you the strength the length promises.
            </dd>
          </div>
          <div>
            <dt>Passphrases</dt>
            <dd>
              Words picked at random (Diceware) are easier to type and remember. Six words from the
              EFF list give 77.5 bits, enough for a password manager's master password or disk
              encryption.
            </dd>
          </div>
          <div>
            <dt>Exact vs estimated</dt>
            <dd>
              For generated passwords the meter is exact: it counts what the generator could have
              produced. For a typed password it can only estimate, by matching the patterns
              attackers try. Patterns it misses make a password look stronger than it is.
            </dd>
          </div>
          <div>
            <dt>How the site stores it</dt>
            <dd>
              The same password survives centuries against bcrypt or Argon2id and minutes against
              plain MD5 or SHA-256. You can't choose how a site hashes passwords, so assume the
              worst case.
            </dd>
          </div>
          <div>
            <dt>Use a password manager</dt>
            <dd>
              A different random password for every site means one breach doesn't unlock the
              others. Turn on two-factor authentication where you can.
            </dd>
          </div>
          <div>
            <dt>Current guidance</dt>
            <dd>
              NIST SP 800-63B asks sites for a minimum length, to accept long passphrases, and to
              check new passwords against breach lists, and advises against forced symbol rules
              and periodic changes.
            </dd>
          </div>
        </dl>
      </section>
    </ToolPage>
  )
}

export default PasswordGenerator
