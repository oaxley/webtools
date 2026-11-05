/**
 * Shape of `virtual:api-reference`: the `/api` endpoint reference, built
 * from `apps/worker/src/openapi.yaml` by `build/apiReference.ts`. HTML
 * fields are pre-rendered at build time (Markdown, Shiki), so the page
 * ships no parser or highlighter.
 */
export interface ApiReference {
  groups: ApiGroup[]
}

/** One OpenAPI tag: Network, Security, Identifiers, Data. */
export interface ApiGroup {
  name: string
  description: string
  endpoints: ApiEndpoint[]
}

export interface ApiEndpoint {
  /** `operationId`, used as the section's anchor. */
  id: string
  method: string
  path: string
  summary: string
  descriptionHtml: string
  tag: string
  /** Matching tool page, if any. */
  tool?: { name: string; path: string; monogram: string; accent: string }
  /** Where `fields` go: the query string (GET) or the body (POST). */
  location: 'query' | 'body'
  fields: ApiField[]
  /** Top-level fields of the 200 response. */
  responseFields: ApiField[]
  /** Responses are sent with `Cache-Control: no-store`. */
  noStore: boolean
  samples: ApiSample[]
  errors: { code: string; descriptionHtml: string }[]
}

export interface ApiField {
  name: string
  /** e.g. `string`, `integer`, `string | null`, `string[]`. */
  type: string
  required: boolean
  descriptionHtml: string
  enum?: string[]
  /** e.g. `1–10`, `1–3 chars`. */
  range?: string
  /** JSON-encoded default value. */
  defaultValue?: string
}

/** A request and the response it produces. */
export interface ApiSample {
  name: string
  label: string
  requestHtml: string
  requestText: string
  responseHtml: string
  responseText: string
  /** `abridged`: shortened for reading; `varies`: generated values. */
  note?: 'abridged' | 'varies'
}
