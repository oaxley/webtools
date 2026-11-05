/**
 * Turn the hand-written OpenAPI document (`apps/worker/src/openapi.yaml`)
 * into the data behind the `/api` page's endpoint reference.
 *
 * Runs in Node at build/dev time only, so the page ships neither a YAML
 * parser nor a highlighter: Markdown descriptions are pre-rendered to
 * HTML, and request/response samples to Shiki-highlighted HTML using the
 * same themes as the MDX code blocks. Result: `virtual:api-reference`.
 *
 * Request samples pair with response samples by example name (see the
 * header comment of `openapi.yaml`), so each endpoint shows a request
 * next to the response it really produces.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { micromark } from 'micromark'
import { gfm, gfmHtml } from 'micromark-extension-gfm'
import { codeToHtml } from 'shiki'
import { parse as parseYaml } from 'yaml'
import { API_BASE_TOKEN } from '../site.config.ts'
import { TOOLS } from '../src/tools.ts'
import type {
  ApiEndpoint,
  ApiField,
  ApiReference,
  ApiSample,
} from '../src/content/apiReferenceTypes.ts'

/** The worker owns the document; the site reads it from there. */
export const OPENAPI_FILE = '../worker/src/openapi.yaml'

type Json = Record<string, unknown>

interface Example {
  summary?: string
  value: unknown
  'x-abridged'?: boolean
  'x-varies'?: boolean
}
interface Parameter {
  name: string
  in: string
  required?: boolean
  description?: string
  schema: Json
  examples?: Record<string, Example>
}
interface MediaType {
  schema: Json
  examples?: Record<string, Example>
}
interface Operation {
  operationId: string
  tags: string[]
  summary: string
  description?: string
  parameters?: Parameter[]
  requestBody?: { content: Record<string, MediaType> }
  responses: Record<string, Json>
}
interface Document {
  info: { description?: string }
  tags: { name: string; description?: string }[]
  paths: Record<string, Record<string, Operation>>
  components: { schemas: Record<string, Json>; responses: Record<string, Json> }
}

/** Read the raw document, for copying into `dist/` as-is. */
export function readOpenApi(root: string): string {
  return readFileSync(join(root, OPENAPI_FILE), 'utf8')
}

/** The document with its `servers` placeholder replaced. */
export function openApiFor(root: string, apiBaseUrl: string): string {
  return readOpenApi(root).replaceAll(API_BASE_TOKEN, apiBaseUrl)
}

function markdown(text: string | undefined): string {
  if (!text) return ''
  return micromark(text.trim(), { extensions: [gfm()], htmlExtensions: [gfmHtml()] })
}

function highlight(code: string, lang: 'bash' | 'json'): Promise<string> {
  return codeToHtml(code, {
    lang,
    themes: { light: 'github-light', dark: 'github-dark' },
    defaultColor: false,
  })
}

/** Follow one local `$ref`, e.g. `#/components/schemas/Error`. */
function deref<T>(doc: Document, node: unknown): T {
  let current = node as Json
  while (current && typeof current.$ref === 'string') {
    const path = (current.$ref as string).replace(/^#\//, '').split('/')
    current = path.reduce<Json>((at, key) => at[key] as Json, doc as unknown as Json)
  }
  return current as T
}

/** Short type label: `string`, `integer`, `string | null`, `boolean[]`… */
function typeLabel(doc: Document, raw: Json): string {
  const schema = deref<Json>(doc, raw)
  if (schema.const !== undefined) return JSON.stringify(schema.const)
  const type = schema.type
  if (Array.isArray(type)) return type.join(' | ')
  if (type === 'array') return `${typeLabel(doc, (schema.items ?? {}) as Json)}[]`
  if (typeof type === 'string') return type
  if (schema.oneOf) return 'object'
  return 'any'
}

/** Restrictions worth showing next to the description. */
function constraints(schema: Json): Pick<ApiField, 'enum' | 'range' | 'defaultValue'> {
  const out: Pick<ApiField, 'enum' | 'range' | 'defaultValue'> = {}
  if (Array.isArray(schema.enum)) out.enum = schema.enum.map(String)
  const min = schema.minimum ?? schema.minLength
  const max = schema.maximum ?? schema.maxLength
  if (min !== undefined || max !== undefined) {
    const unit = schema.minLength !== undefined || schema.maxLength !== undefined ? ' chars' : ''
    out.range =
      min !== undefined && max !== undefined
        ? `${min}–${max}${unit}`
        : min !== undefined
          ? `≥ ${min}${unit}`
          : `≤ ${max}${unit}`
  }
  if (schema.default !== undefined) out.defaultValue = JSON.stringify(schema.default)
  return out
}

/** Properties of an object schema, merging `allOf` parts. */
function objectProperties(doc: Document, raw: Json): { props: Record<string, Json>; required: string[] } {
  const schema = deref<Json>(doc, raw)
  const props: Record<string, Json> = {}
  const required: string[] = []
  for (const part of (schema.allOf as Json[] | undefined) ?? []) {
    const sub = objectProperties(doc, part)
    Object.assign(props, sub.props)
    required.push(...sub.required)
  }
  Object.assign(props, (schema.properties as Record<string, Json> | undefined) ?? {})
  required.push(...((schema.required as string[] | undefined) ?? []))
  return { props, required }
}

function bodyFields(doc: Document, schema: Json): ApiField[] {
  const { props, required } = objectProperties(doc, schema)
  return Object.entries(props).map(([name, raw]) => {
    const prop = deref<Json>(doc, raw)
    return {
      name,
      type: typeLabel(doc, prop),
      required: required.includes(name),
      descriptionHtml: markdown(prop.description as string | undefined),
      ...constraints(prop),
    }
  })
}

function queryFields(doc: Document, params: Parameter[]): ApiField[] {
  return params.map((p) => ({
    name: p.name,
    type: typeLabel(doc, p.schema),
    required: p.required === true,
    descriptionHtml: markdown(p.description),
    ...constraints(p.schema),
  }))
}

/**
 * `curl` for a GET: the parameters whose example shares the response
 * example's name, plus the first example of each required parameter. No
 * match means the response example shows the defaults.
 */
function getCurl(apiBase: string, path: string, params: Parameter[], name: string): string {
  const query = new URLSearchParams()
  for (const p of params) {
    const ex = p.examples?.[name]
    if (ex) {
      query.set(p.name, String(ex.value))
    } else if (p.required) {
      const first = Object.values(p.examples ?? {})[0]?.value ?? (p.schema.examples as unknown[])?.[0]
      query.set(p.name, String(first))
    }
  }
  // Keep `/` and `,` readable: both are fine in a query string.
  const qs = query.toString().replace(/%2F/g, '/').replace(/%2C/g, ',')
  return `curl "${apiBase}${path}${qs ? `?${qs}` : ''}"`
}

/** `curl` for a POST with a JSON body, wrapped for reading. */
function postCurl(apiBase: string, path: string, body: unknown): string {
  const json = JSON.stringify(body)
  // Shell single quotes can't contain a single quote: close, escape, reopen.
  const quoted = `'${json.replace(/'/g, `'\\''`)}'`
  const data = (body as Json | null)?.data
  if (typeof data === 'string' && data.includes('\n')) {
    // Multi-line payloads (PEM) read better from a file.
    return [
      `curl "${apiBase}${path}" \\`,
      `  -H 'Content-Type: application/json' \\`,
      `  --data-binary @- <<'EOF'`,
      JSON.stringify(body, null, 2),
      'EOF',
    ].join('\n')
  }
  return [`curl "${apiBase}${path}" \\`, `  -H 'Content-Type: application/json' \\`, `  -d ${quoted}`].join('\n')
}

async function endpoint(
  doc: Document,
  apiBase: string,
  path: string,
  method: string,
  op: Operation,
): Promise<ApiEndpoint> {
  const ok = deref<{ content: Record<string, MediaType>; headers?: Json }>(doc, op.responses['200'])
  const okJson = ok.content['application/json']
  const responseExamples = okJson?.examples ?? {}
  const params = op.parameters ?? []
  const body = op.requestBody?.content['application/json']

  const samples: ApiSample[] = []
  for (const [name, response] of Object.entries(responseExamples)) {
    let curl: string
    if (method === 'POST') {
      const request = body?.examples?.[name]
      if (!request) continue
      curl = postCurl(apiBase, path, request.value)
    } else {
      curl = getCurl(apiBase, path, params, name)
    }
    samples.push({
      name,
      label: response.summary ?? name,
      requestHtml: await highlight(curl, 'bash'),
      requestText: curl,
      responseHtml: await highlight(JSON.stringify(response.value, null, 2), 'json'),
      responseText: JSON.stringify(response.value, null, 2),
      note: response['x-abridged'] ? 'abridged' : response['x-varies'] ? 'varies' : undefined,
    })
  }

  const errors = Object.entries(op.responses)
    .filter(([code]) => code !== '200')
    .map(([code, raw]) => ({
      code,
      descriptionHtml: markdown(deref<{ description?: string }>(doc, raw).description),
    }))

  const tool = TOOLS.find((t) => t.api?.path === path)
  return {
    id: op.operationId,
    method,
    path,
    summary: op.summary,
    descriptionHtml: markdown(op.description),
    tag: op.tags[0],
    tool: tool ? { name: tool.name, path: tool.path, monogram: tool.monogram, accent: tool.accent } : undefined,
    location: method === 'GET' ? 'query' : 'body',
    fields: method === 'GET' ? queryFields(doc, params) : body ? bodyFields(doc, body.schema) : [],
    responseFields: okJson ? responseFields(doc, okJson.schema) : [],
    noStore: ok.headers?.['Cache-Control'] !== undefined,
    samples,
    errors,
  }
}

/** Top-level fields of a response, or of each `oneOf` branch merged. */
function responseFields(doc: Document, raw: Json): ApiField[] {
  const schema = deref<Json>(doc, raw)
  const branches = (schema.oneOf as Json[] | undefined) ?? [schema]
  const seen = new Map<string, ApiField>()
  for (const branch of branches) {
    const resolved = deref<Json>(doc, branch)
    // `allOf: [oneOf, object]` (password): flatten every part.
    const parts = (resolved.allOf as Json[] | undefined)?.flatMap((p) => {
      const d = deref<Json>(doc, p)
      return (d.oneOf as Json[] | undefined) ?? [d]
    }) ?? [resolved]
    for (const part of parts) {
      for (const field of bodyFields(doc, part)) {
        const existing = seen.get(field.name)
        // The same field in several branches: keep the first description.
        if (!existing) seen.set(field.name, field)
        else if (!existing.descriptionHtml && field.descriptionHtml) {
          seen.set(field.name, { ...existing, descriptionHtml: field.descriptionHtml })
        }
      }
    }
  }
  return [...seen.values()].map((f) => ({ ...f, required: false }))
}

/** Parse the document and build the reference shown on `/api`. */
export async function buildApiReference(root: string, apiBaseUrl: string): Promise<ApiReference> {
  const doc = parseYaml(readOpenApi(root)) as Document
  const endpoints: ApiEndpoint[] = []
  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      if (op.tags.includes('Meta')) continue
      endpoints.push(await endpoint(doc, apiBaseUrl, path, method.toUpperCase(), op))
    }
  }
  return {
    groups: doc.tags
      .filter((t) => t.name !== 'Meta')
      .map((t) => ({
        name: t.name,
        description: t.description ?? '',
        endpoints: endpoints.filter((e) => e.tag === t.name),
      }))
      .filter((g) => g.endpoints.length > 0),
  }
}
