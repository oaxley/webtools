/**
 * `/api/v1/hash` — MD5, SHA-1, SHA-2, SHA-3 and CRC-32 digests, or an
 * HMAC when a key is given.
 *
 * POST is used instead of GET so the payload and the HMAC key never
 * appear in query strings, access logs or referer headers. Responses are
 * marked `no-store` for the same reason.
 *
 * Body (JSON or form-encoded):
 * - `data`           the text/hex to hash (required)
 * - `algorithm`      `md5`, `sha1`, `sha224`, `sha256` (default), `sha384`,
 *                    `sha512`, `sha3-256`, `sha3-512`, `crc32`, or `all`
 * - `inputFormat`    `text` (default, UTF-8) or `hex`
 * - `outputFormat`   `hex` (default) or `base64`
 * - `uppercase`      upper-case hex digits (default false)
 * - `hmacKey`        compute an HMAC under this key (not with `crc32`)
 * - `hmacKeyFormat`  `text` (default) or `hex`
 *
 * Responses: one algorithm → `{ algorithm, hmac, digest, format, bits,
 * inputBytes }`; `all` → `{ hmac, format, inputBytes, hashes: [{
 * algorithm, digest, bits }] }`. Same shapes as the MCP tool.
 */
import { Hono } from "hono";
import {
  computeAllHashes,
  computeHash,
  type BytesFormat,
  type DigestFormat,
  type HashAlgorithm,
  type HashOptions,
} from "@webtools/core";
import { parseBodyFlag, parseBodyString, readBody } from "./params";

/**
 * Input cap for the HTTP API and MCP tool, in bytes. Much tighter than
 * the browser's: SHA-3 and `all` cost a few milliseconds of CPU per
 * 10 KiB, and a request should stay well within the Workers budget.
 */
export const API_MAX_HASH_BYTES = 65_536;

/** Raw body cap: hex input is twice the bytes, plus JSON overhead. */
const MAX_BODY_BYTES = 262_144;

/** Shared by the route and the MCP tool. */
export function runHash(algorithm: HashAlgorithm | "all", options: HashOptions) {
  const request = { ...options, maxBytes: API_MAX_HASH_BYTES };
  return algorithm === "all" ? computeAllHashes(request) : computeHash({ ...request, algorithm });
}

const hash = new Hono();

hash.post("/", async (c) => {
  c.header("Cache-Control", "no-store");

  const read = await readBody(c, {
    maxBytes: MAX_BODY_BYTES,
    example: '{ "data": "…", "algorithm": "sha256" }',
  });
  if (!read.ok) return read.response;
  const body = read.body;

  if (typeof body.data !== "string") {
    return c.json({ error: "Missing 'data' field with the input to hash." }, 400);
  }

  try {
    const algorithm = (parseBodyString(body.algorithm, "algorithm") ?? "sha256") as
      | HashAlgorithm
      | "all";
    return c.json(
      runHash(algorithm, {
        input: body.data,
        inputFormat: parseBodyString(body.inputFormat, "inputFormat") as BytesFormat | undefined,
        outputFormat: parseBodyString(body.outputFormat, "outputFormat") as
          | DigestFormat
          | undefined,
        uppercase: parseBodyFlag(body.uppercase, "uppercase"),
        hmacKey: parseBodyString(body.hmacKey, "hmacKey"),
        hmacKeyFormat: parseBodyString(body.hmacKeyFormat, "hmacKeyFormat") as
          | BytesFormat
          | undefined,
      }),
    );
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Invalid request" }, 400);
  }
});

export default hash;
