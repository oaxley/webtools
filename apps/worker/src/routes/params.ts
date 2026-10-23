/** Request helpers shared by the `/api/v1/*` routes. */
import type { Context } from "hono";

/** Parse an optional boolean query flag; `undefined` when absent. */
export function parseFlag(
  value: string | undefined,
  name: string,
): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error(`'${name}' must be true or false.`);
}

/**
 * Optional boolean body field: JSON booleans, or the same strings as
 * `parseFlag` (form-encoded bodies only carry strings).
 */
export function parseBodyFlag(value: unknown, name: string): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return parseFlag(value, name);
  throw new Error(`'${name}' must be true or false.`);
}

/** Optional string body field; `undefined` when absent. */
export function parseBodyString(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  throw new Error(`'${name}' must be a string.`);
}

export type BodyResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: Response };

/**
 * Read a JSON or form-encoded body into a plain object of fields.
 * Returns `{ ok: false, response }` when the body is too large,
 * unparseable or of an unsupported type, so handlers can return it
 * directly without sprinkling early returns through their happy path.
 *
 * @param maxBytes Reject bodies larger than this (413) before parsing.
 * @param example  Shown in the 415 message, e.g. `{ "data": "<jwt>" }`.
 */
export async function readBody(
  c: Context,
  options: { maxBytes?: number; example: string },
): Promise<BodyResult> {
  const { maxBytes, example } = options;
  const contentType = c.req.header("content-type")?.toLowerCase() ?? "";

  const tooLarge = (): BodyResult => ({
    ok: false,
    response: c.json(
      { error: `Request body is too large (limit: ${maxBytes} bytes).` },
      413,
    ),
  });

  try {
    if (contentType.includes("application/json")) {
      if (maxBytes === undefined) {
        const body = (await c.req.json()) as unknown;
        return { ok: true, body: isRecord(body) ? body : {} };
      }
      // Content-Length may be missing (chunked), so check the bytes too.
      const declared = Number(c.req.header("content-length"));
      if (declared > maxBytes) return tooLarge();
      const raw = await c.req.arrayBuffer();
      if (raw.byteLength > maxBytes) return tooLarge();
      const body = JSON.parse(new TextDecoder().decode(raw)) as unknown;
      return { ok: true, body: isRecord(body) ? body : {} };
    }
    if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      if (maxBytes !== undefined) {
        const declared = Number(c.req.header("content-length"));
        if (declared > maxBytes) return tooLarge();
      }
      const form = await c.req.formData();
      const body: Record<string, unknown> = {};
      form.forEach((value, key) => {
        if (typeof value === "string") body[key] = value;
      });
      return { ok: true, body };
    }
    return {
      ok: false,
      response: c.json(
        {
          error: `Unsupported content type. Send application/json with ${example} or form-encoded fields.`,
        },
        415,
      ),
    };
  } catch {
    return {
      ok: false,
      response: c.json({ error: "Malformed request body." }, 400),
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
