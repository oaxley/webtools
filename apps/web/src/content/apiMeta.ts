/**
 * Title, description and colour of the `/api` page. Shared by the page
 * (`pages/ApiPage.tsx`) and the build (`build/blogStatic.ts`, which writes
 * `dist/api.html`, its preview image and its sitemap entry), so the
 * browser and link previews always agree. Plain constants only: this file
 * is also loaded by Node at build time.
 */
export const API_PAGE = {
  path: '/api',
  title: 'REST API',
  description:
    'Call every WebTools tool over plain HTTPS: subnet maths, JWT and certificate decoding, UUIDs, hashes and passwords as JSON. No API key, and an OpenAPI file for Postman or Bruno.',
  monogram: 'API',
  accent: '#0d9488',
} as const

/** Where the site serves its copy of the OpenAPI document. */
export const OPENAPI_PATH = '/openapi.yaml'
