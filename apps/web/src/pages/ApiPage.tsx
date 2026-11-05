/**
 * `/api`: the REST API guide and endpoint reference.
 *
 * The guide part is MDX (`src/content/api.mdx`), like `/mcp`. The
 * reference below it is generated from the worker's hand-written OpenAPI
 * document (`apps/worker/src/openapi.yaml`, via `virtual:api-reference`),
 * so the page, the downloadable spec and the worker's tests all read the
 * same source. Same post layout and styles as `/mcp`.
 */
import { lazy, Suspense, useRef, useState } from 'react'
import { MDXProvider } from '@mdx-js/react'
import { Link } from 'react-router-dom'
import { API_REFERENCE } from 'virtual:api-reference'
import { Anchor } from '../blog/components'
import { mdxComponents } from '../blog/mdxComponents'
import { ReadingProgress, TableOfContents } from '../blog/PostAside'
import type { PostHeading } from '../blog/types'
import { API_BASE_URL } from '../blog/site'
import CopyJsonButton from '../components/CopyJsonButton'
import { API_PAGE, OPENAPI_PATH } from '../content/apiMeta'
import type { ApiEndpoint, ApiField, ApiSample } from '../content/apiReferenceTypes'
import { usePageMeta } from '../usePageMeta'
import './Blog.css'
import './ApiPage.css'

const Body = lazy(() => import('../content/api.mdx'))

const TITLE = API_PAGE.title
const DESCRIPTION = API_PAGE.description
const BASE_URL = `${API_BASE_URL}/api/v1`
const SPEC_URL = `${API_BASE_URL}/api/v1/openapi.yaml`

/** The h2s of `content/api.mdx`, with the ids rehype-slug gives them. */
const GUIDE_HEADINGS: PostHeading[] = [
  { depth: 2, text: 'Import into your API client', id: 'import-into-your-api-client' },
  { depth: 2, text: 'Conventions', id: 'conventions' },
  { depth: 2, text: 'Errors', id: 'errors' },
  { depth: 2, text: 'Limits', id: 'limits' },
]

const groupId = (name: string) => `endpoints-${name.toLowerCase()}`

const HEADINGS: PostHeading[] = [
  ...GUIDE_HEADINGS,
  ...API_REFERENCE.groups.map((g) => ({
    depth: 2 as const,
    text: `${g.name} endpoints`,
    id: groupId(g.name),
  })),
]

/** `#` link next to a heading, with the same copy-on-click as MDX headings. */
function HeadingLink({ id }: { id: string }) {
  return (
    <Anchor href={`#${id}`} className="heading-anchor" aria-hidden tabIndex={-1}>
      #
    </Anchor>
  )
}

function MethodBadge({ method }: { method: string }) {
  return <span className={`api-method api-method-${method.toLowerCase()}`}>{method}</span>
}

function FieldTable({ fields, caption }: { fields: ApiField[]; caption: string }) {
  return (
    <div className="table-scroll">
      <table className="api-fields">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Description</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => (
            <tr key={f.name}>
              <th scope="row">
                <code>{f.name}</code>
                <span className="api-field-type">{f.type}</span>
                {f.required && <span className="api-field-required">required</span>}
              </th>
              <td>
                <div dangerouslySetInnerHTML={{ __html: f.descriptionHtml }} />
                {(f.enum || f.range || f.defaultValue) && (
                  <dl className="api-field-meta">
                    {f.enum && (
                      <div>
                        <dt>One of</dt>
                        <dd>
                          {f.enum.map((v) => (
                            <code key={v}>{v}</code>
                          ))}
                        </dd>
                      </div>
                    )}
                    {f.range && (
                      <div>
                        <dt>Range</dt>
                        <dd>{f.range}</dd>
                      </div>
                    )}
                    {f.defaultValue && (
                      <div>
                        <dt>Default</dt>
                        <dd>
                          <code>{f.defaultValue}</code>
                        </dd>
                      </div>
                    )}
                  </dl>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CodeBlock({ label, html, text }: { label: string; html: string; text: string }) {
  return (
    <div className="code-block">
      <div className="code-block-header">
        <span className="code-block-lang">{label}</span>
        <CopyJsonButton
          text={text}
          label="Copy"
          size="sm"
          ariaLabel={`Copy ${label.toLowerCase()}`}
          className="code-copy"
        />
      </div>
      {/* Shiki output: a <pre> with dual-theme colours, styled like MDX blocks. */}
      <div className="api-code" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}

const NOTES: Record<NonNullable<ApiSample['note']>, string> = {
  abridged: 'Abridged: the real response has more entries.',
  varies: 'Generated values differ on every call.',
}

/** Request/response pairs, as tabs when there are several. */
function Samples({ endpoint }: { endpoint: ApiEndpoint }) {
  const [active, setActive] = useState(0)
  const { samples } = endpoint
  if (samples.length === 0) return null
  const sample = samples[Math.min(active, samples.length - 1)]
  return (
    <div className="api-samples">
      {samples.length > 1 && (
        <div className="tabs-list" role="tablist" aria-label={`${endpoint.summary}: examples`}>
          {samples.map((s, i) => (
            <button
              key={s.name}
              type="button"
              role="tab"
              id={`${endpoint.id}-tab-${i}`}
              aria-selected={i === active}
              aria-controls={`${endpoint.id}-panel`}
              tabIndex={i === active ? 0 : -1}
              className="tabs-tab"
              onClick={() => setActive(i)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
                const next = (i + (e.key === 'ArrowRight' ? 1 : samples.length - 1)) % samples.length
                setActive(next)
                document.getElementById(`${endpoint.id}-tab-${next}`)?.focus()
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}
      <div
        id={`${endpoint.id}-panel`}
        role={samples.length > 1 ? 'tabpanel' : undefined}
        aria-labelledby={samples.length > 1 ? `${endpoint.id}-tab-${active}` : undefined}
        className="api-sample"
      >
        <CodeBlock label="Request" html={sample.requestHtml} text={sample.requestText} />
        <CodeBlock label="Response" html={sample.responseHtml} text={sample.responseText} />
        {sample.note && <p className="api-sample-note">{NOTES[sample.note]}</p>}
      </div>
    </div>
  )
}

function Endpoint({ endpoint }: { endpoint: ApiEndpoint }) {
  const { tool } = endpoint
  return (
    <section className="api-endpoint" aria-labelledby={endpoint.id}>
      <h3 id={endpoint.id}>
        {endpoint.summary}
        <HeadingLink id={endpoint.id} />
      </h3>
      <p className="api-route">
        <MethodBadge method={endpoint.method} />
        <code>{endpoint.path}</code>
        {tool && (
          <Link className="api-route-tool" to={tool.path}>
            Open the tool <span aria-hidden="true">→</span>
          </Link>
        )}
      </p>
      <div dangerouslySetInnerHTML={{ __html: endpoint.descriptionHtml }} />

      {endpoint.fields.length > 0 && (
        <>
          <h4>{endpoint.location === 'query' ? 'Query parameters' : 'Body fields'}</h4>
          <FieldTable
            fields={endpoint.fields}
            caption={`${endpoint.method} ${endpoint.path} ${endpoint.location === 'query' ? 'query parameters' : 'body fields'}`}
          />
        </>
      )}

      <h4>Example</h4>
      <Samples endpoint={endpoint} />

      {endpoint.responseFields.length > 0 && (
        <details className="api-response-fields">
          <summary>Response fields</summary>
          <FieldTable
            fields={endpoint.responseFields}
            caption={`${endpoint.method} ${endpoint.path} response fields`}
          />
        </details>
      )}

      <ul className="api-errors" aria-label="Error responses">
        {endpoint.errors.map((e) => (
          <li key={e.code}>
            <code>{e.code}</code>
            <span dangerouslySetInnerHTML={{ __html: e.descriptionHtml }} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function ApiPage() {
  const articleRef = useRef<HTMLElement>(null)
  usePageMeta({ title: `${TITLE} — WebTools`, description: DESCRIPTION })
  const endpoints = API_REFERENCE.groups.flatMap((g) => g.endpoints)

  return (
    <main className="post-page api-page">
      <ReadingProgress targetRef={articleRef} />
      <header className="ink-hero post-hero">
        <div className="ink-hero-inner post-hero-inner">
          <div className="post-hero-grid">
            <div className="post-hero-text">
              <h1>{TITLE}</h1>
              <p className="post-lede">{DESCRIPTION}</p>
              <p className="post-byline">
                <code>{BASE_URL}</code>
              </p>
              <p className="api-hero-actions">
                <a className="button button-primary" href={OPENAPI_PATH} download="webtools-openapi.yaml">
                  Download OpenAPI (YAML)
                </a>
                <CopyJsonButton
                  text={SPEC_URL}
                  label="Copy spec URL"
                  ariaLabel="Copy the OpenAPI document URL"
                  className="api-hero-copy"
                />
              </p>
            </div>
            <div
              className="post-hero-tile"
              style={{ '--cover-accent': API_PAGE.accent } as React.CSSProperties}
              aria-hidden="true"
            >
              <span>{API_PAGE.monogram}</span>
            </div>
          </div>
        </div>
      </header>

      <div className="post-layout">
        <article className="post" ref={articleRef} aria-label={TITLE}>
          <details className="post-toc-mobile">
            <summary>On this page</summary>
            <TableOfContents headings={HEADINGS} />
          </details>

          <div className="prose">
            <MDXProvider components={mdxComponents}>
              <Suspense fallback={<p className="post-loading">Loading…</p>}>
                <Body />
              </Suspense>
            </MDXProvider>

            {API_REFERENCE.groups.map((group) => (
              <section key={group.name} aria-labelledby={groupId(group.name)}>
                <h2 id={groupId(group.name)}>
                  {group.name} endpoints
                  <HeadingLink id={groupId(group.name)} />
                </h2>
                <p>{group.description}</p>
                {group.endpoints.map((endpoint) => (
                  <Endpoint key={endpoint.id} endpoint={endpoint} />
                ))}
              </section>
            ))}
          </div>
        </article>

        <aside className="post-aside" aria-label="On this page">
          <div className="post-aside-sticky">
            <section>
              <h2 className="post-aside-title">On this page</h2>
              <TableOfContents headings={HEADINGS} />
            </section>
            <section>
              <h2 className="post-aside-title">Endpoints</h2>
              <ul className="api-aside-endpoints">
                {endpoints.map((e) => (
                  <li key={e.id}>
                    <a href={`#${e.id}`}>
                      <MethodBadge method={e.method} />
                      <code>{e.path.replace('/api/v1/', '')}</code>
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </aside>
      </div>
    </main>
  )
}

export default ApiPage
