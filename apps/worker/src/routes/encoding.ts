/**
 * `/api/v1/base64`, `/api/v1/base32`, `/api/v1/base58` — encode text or
 * hex bytes, or decode an encoded string back to bytes.
 *
 * POST is used instead of GET so the payload (which may be a secret or a
 * key) never appears in query strings, access logs or referer headers.
 * Responses are marked `no-store` for the same reason.
 *
 * Body (JSON or form-encoded):
 * - `data`         the text/hex to encode, or the string to decode (required)
 * - `operation`    `encode` (default) or `decode`
 * - `inputFormat`  encode only: `text` (default, UTF-8) or `hex`
 * - `urlSafe`      base64 only: URL-safe alphabet `-_` (default false)
 * - `padding`      base64/base32: emit `=` padding (default true)
 * - `variant`      base32 only: `rfc4648` (default) or `crockford`
 *
 * Responses: encode → `{ encoding, operation, output, inputBytes }`,
 * decode → `{ encoding, operation, text, hex, bytes }` with `text: null`
 * when the bytes are not valid UTF-8. Same shapes as the MCP tools.
 */
import { Hono } from "hono";
import {
  convertEncoding,
  type BaseEncoding,
  type BytesFormat,
  type EncodingOperation,
  type Base32Variant,
} from "@webtools/core";
import { parseBodyFlag, parseBodyString, readBody } from "./params";

/**
 * Size caps for the HTTP API, in bytes of decoded data. Tighter than the
 * core defaults (which the browser uses) so a single request stays well
 * within the Workers CPU budget: base58 conversion is quadratic.
 */
export const API_MAX_BYTES: Record<BaseEncoding, number> = {
  base64: 262_144,
  base32: 262_144,
  base58: 1_024,
};

/** Raw body cap: hex input is twice the bytes, plus some whitespace. */
const MAX_BODY_BYTES = 1_048_576;

/** Build the router for one encoding. */
export function encodingRoute(encoding: BaseEncoding): Hono {
  const route = new Hono();

  route.post("/", async (c) => {
    c.header("Cache-Control", "no-store");

    const read = await readBody(c, {
      maxBytes: MAX_BODY_BYTES,
      example: '{ "data": "…", "operation": "encode" }',
    });
    if (!read.ok) return read.response;
    const body = read.body;

    if (typeof body.data !== "string") {
      return c.json({ error: "Missing 'data' field with the input to convert." }, 400);
    }

    try {
      const operation = (parseBodyString(body.operation, "operation") ??
        "encode") as EncodingOperation;
      const inputFormat = parseBodyString(body.inputFormat, "inputFormat") as
        | BytesFormat
        | undefined;
      const variant = parseBodyString(body.variant, "variant") as
        | Base32Variant
        | undefined;
      const result = convertEncoding({
        encoding,
        operation,
        input: body.data,
        inputFormat,
        options: {
          urlSafe: parseBodyFlag(body.urlSafe, "urlSafe"),
          padding: parseBodyFlag(body.padding, "padding"),
          variant,
        },
        maxBytes: API_MAX_BYTES[encoding],
      });
      return c.json(result);
    } catch (e) {
      return c.json(
        { error: e instanceof Error ? e.message : "Invalid request" },
        400,
      );
    }
  });

  return route;
}

export const base64 = encodingRoute("base64");
export const base32 = encodingRoute("base32");
export const base58 = encodingRoute("base58");
