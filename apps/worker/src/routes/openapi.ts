/**
 * `/api/v1/openapi.yaml` — the hand-written OpenAPI 3.1 description of
 * this API (`src/openapi.yaml`), for Postman, Bruno, Insomnia and friends.
 *
 * The file is bundled as a Text module (see `rules` in `wrangler.jsonc`)
 * and served as-is, except for its `@@API_BASE@@` placeholder: that
 * becomes the origin answering the request, so the `servers` entry of a
 * downloaded copy already points at the right host — production, a
 * preview deployment or `wrangler dev`.
 *
 * The only route with CORS: the document is public and harmless, and
 * browser-based clients need it to load the spec from another origin.
 */
import { Hono } from "hono";
import spec from "../openapi.yaml";

/** Placeholder for the API origin, shared with the web build. */
export const API_BASE_TOKEN = "@@API_BASE@@";

/** The OpenAPI document with `servers` pointed at `origin`. */
export function openApiDocument(origin: string): string {
  return spec.replaceAll(API_BASE_TOKEN, origin);
}

const openapi = new Hono();

openapi.get("/", (c) => {
  c.header("Access-Control-Allow-Origin", "*");
  c.header("Cache-Control", "public, max-age=3600");
  c.header("Content-Type", "application/yaml; charset=utf-8");
  return c.body(openApiDocument(new URL(c.req.url).origin));
});

export default openapi;
