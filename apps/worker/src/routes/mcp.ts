/**
 * `/mcp` — Model Context Protocol endpoint (stateless Streamable HTTP).
 *
 * Thin Hono wrapper around `@modelcontextprotocol/sdk`'s
 * `WebStandardStreamableHTTPServerTransport`, which speaks Web-standard
 * Request/Response and runs unmodified on Workers. Each POST builds a
 * fresh `McpServer`, registers tools, and pipes the request through — no
 * session state, no Durable Objects, no SSE replay. The MCP SDK still
 * frames each response as a one-shot SSE stream (`text/event-stream`
 * with a single `data:` line), which is compliant Streamable HTTP; it
 * just skips the resumability bookkeeping.
 *
 * Tools exposed:
 * - `calculate_cidr(cidr)` — mirrors `/api/v1/ip`. Returns the
 *   `calculateCIDR` result enriched with `routable: isRoutable(cidr)`.
 *   Core errors (invalid CIDR, bad prefix, etc.) are surfaced verbatim
 *   as `isError: true` tool results, same contract as the HTTP route.
 * - `decode_jwt(token)` — mirrors `/api/v1/jwt`. Returns the shared
 *   `toJwtJsonSummary` shape (header, payload, signature, analysis).
 *   No signature verification. Core errors surface as `isError: true`.
 * - `decode_x509(certificate)` — mirrors `/api/v1/x509` (PEM or raw
 *   base64 DER). Returns the shared `toX509ApiResponse` shape minus
 *   `signatureValue`: the raw signature hex is hundreds of characters
 *   an LLM has no use for, so we don't spend tokens on it. No chain or
 *   signature verification. Core errors surface as `isError: true`.
 * - `generate_uuid(version?, count?, uppercase?)` — mirrors
 *   `/api/v1/uuid`. Returns `{ version, count, uuids }` with 1..10 v4 or
 *   v7 (default) UUIDs.
 * - `generate_nanoid(count?, size?, alphabet?, safeEnds?)` — mirrors
 *   `/api/v1/nanoid`. Returns `{ alphabet, size, safeEnds, count, ids }`
 *   with 1..10 NanoIDs (default: 21 characters, `url` alphabet).
 * - `generate_ulid(count?, monotonic?, lowercase?)` — mirrors
 *   `/api/v1/ulid`. Returns `{ monotonic, lowercase, count, ulids }` with
 *   1..10 ULIDs (default: monotonic, upper case).
 * - `convert_base64` / `convert_base32` / `convert_base58`
 *   `(operation, data, inputFormat?, …options)` — mirror
 *   `/api/v1/base64|base32|base58`, same size caps and result shapes
 *   (`{ encoding, operation, output, inputBytes }` or
 *   `{ encoding, operation, text, hex, bytes }`).
 * - `compute_hash(data, algorithm?, inputFormat?, outputFormat?,
 *   uppercase?, hmacKey?, hmacKeyFormat?)` — mirrors `/api/v1/hash`:
 *   MD5, SHA-1/2/3 or CRC-32 digests (or HMAC), one algorithm or `all`.
 * - `generate_password(mode?, count?, length?, sets?, excludeAmbiguous?,
 *   requireEachSet?, words?, separator?, capitalize?, includeNumber?)` —
 *   mirrors `/api/v1/password`: random passwords or EFF passphrases, with
 *   their exact entropy. Generation only; there is no strength check, so
 *   agents never get into the habit of sending real passwords anywhere.
 */
import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { z } from "zod";
import { API_MAX_BYTES } from "./encoding";
import { API_MAX_HASH_BYTES, runHash } from "./hash";
import { runPassword } from "./password";
import {
  calculateCIDR,
  convertEncoding,
  decodeJWT,
  decodeX509,
  generateNanoIds,
  generateULIDs,
  generateUUIDs,
  HASH_ALGORITHMS,
  isRoutable,
  MAX_NANOID_COUNT,
  MAX_PASSWORD_COUNT,
  MAX_ULID_COUNT,
  MAX_UUID_COUNT,
  NANOID_ALPHABET_NAMES,
  NANOID_DEFAULT_SIZE,
  NANOID_MAX_SIZE,
  NANOID_MIN_SIZE,
  type NanoIdAlphabet,
  PASSPHRASE_DEFAULT_WORDS,
  PASSPHRASE_MAX_SEPARATOR,
  PASSPHRASE_MAX_WORDS,
  PASSPHRASE_MIN_WORDS,
  PASSWORD_CHARSET_NAMES,
  PASSWORD_DEFAULT_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  type PasswordCharset,
  type PasswordOptions,
  toJwtJsonSummary,
  toX509ApiResponse,
} from "@webtools/core";

const mcp = new Hono();

/** Wrap a JSON-serialisable value as a successful text tool result. */
function jsonResult(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
  };
}

/**
 * Turn a thrown core error into an `isError: true` tool result, passing
 * the message through verbatim (same contract as the HTTP routes).
 */
function errorResult(e: unknown, fallback: string) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: e instanceof Error ? e.message : fallback,
      },
    ],
  };
}

/**
 * Build a fresh `McpServer` with every webtools tool registered.
 *
 * A new instance per request is cheap and keeps the handler stateless;
 * it also sidesteps the "transport can only be connected once" rule in
 * the SDK. We swap the default AJV validator for `@cfworker/json-schema`
 * because AJV compiles schemas with `new Function`, which workerd
 * forbids.
 */
function buildServer(): McpServer {
  const server = new McpServer(
    { name: "webtools", version: "1.0.0" },
    { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
  );

  server.registerTool(
    "calculate_cidr",
    {
      title: "IP Subnet Calculator",
      description:
        "Compute network/broadcast/mask/host range for an IPv4 CIDR and report whether it's publicly routable.",
      inputSchema: {
        cidr: z
          .string()
          .describe("IPv4 CIDR, e.g. 192.168.1.0/24"),
      },
    },
    ({ cidr }) => {
      try {
        const result = calculateCIDR(cidr);
        const routable = isRoutable(cidr);
        return jsonResult({ ...result, routable });
      } catch (e) {
        return errorResult(e, "Invalid IPv4 CIDR");
      }
    },
  );

  server.registerTool(
    "decode_jwt",
    {
      title: "JWT Decoder",
      description:
        "Decode a compact JWT (header.payload.signature) and report whether it is expired, not yet valid, or still valid. " +
        "Time claims (exp, nbf, iat, auth_time) are also rendered as human-readable UTC dates under `analysis`. " +
        "Does NOT verify the signature.",
      inputSchema: {
        token: z
          .string()
          .min(1)
          .describe("Compact JWT, e.g. eyJhbGciOi...<payload>.<signature>"),
      },
    },
    ({ token }) => {
      try {
        // Same shape as POST /api/v1/jwt; the token is never echoed back.
        return jsonResult(toJwtJsonSummary(decodeJWT(token)));
      } catch (e) {
        return errorResult(e, "Invalid JWT");
      }
    },
  );

  server.registerTool(
    "decode_x509",
    {
      title: "X.509 Certificate Decoder",
      description:
        "Decode an X.509 certificate (PEM or raw base64 DER) and report its subject, issuer, validity window, " +
        "public key, extensions (SAN, KeyUsage, ExtKeyUsage, BasicConstraints, …) and SHA-1/SHA-256 fingerprints. " +
        "The `analysis` block says whether it is pending, active or expired, with human-readable UTC dates. " +
        "Does NOT verify the signature or the certificate chain.",
      inputSchema: {
        certificate: z
          .string()
          .min(1)
          .describe(
            "PEM certificate (-----BEGIN CERTIFICATE----- …) or raw base64 DER",
          ),
      },
    },
    async ({ certificate }) => {
      try {
        // Same shape as POST /api/v1/x509, minus the raw signature hex
        // (long, and useless to a model). The input is never echoed back.
        const { signatureValue: _signature, ...rest } =
          await toX509ApiResponse(decodeX509(certificate));
        return jsonResult(rest);
      } catch (e) {
        return errorResult(e, "Invalid certificate");
      }
    },
  );

  server.registerTool(
    "generate_uuid",
    {
      title: "UUID Generator",
      description:
        `Generate 1 to ${MAX_UUID_COUNT} RFC 9562 UUIDs. ` +
        "Version 7 (default) is time-ordered and sorts by creation time, a good fit for database keys; " +
        "version 4 is fully random.",
      inputSchema: {
        version: z
          .union([z.literal(4), z.literal(7)])
          .optional()
          .describe("UUID version: 4 (random) or 7 (time-ordered, default)"),
        count: z
          .number()
          .int()
          .min(1)
          .max(MAX_UUID_COUNT)
          .optional()
          .describe(`How many UUIDs to generate, 1 to ${MAX_UUID_COUNT} (default 1)`),
        uppercase: z
          .boolean()
          .optional()
          .describe("Use upper-case hex digits (default false)"),
      },
    },
    ({ version = 7, count = 1, uppercase }) => {
      try {
        // Same shape as GET /api/v1/uuid.
        const uuids = generateUUIDs({ version, count, uppercase });
        return jsonResult({ version, count: uuids.length, uuids });
      } catch (e) {
        return errorResult(e, "Invalid UUID request");
      }
    },
  );

  server.registerTool(
    "generate_nanoid",
    {
      title: "NanoID Generator",
      description:
        `Generate 1 to ${MAX_NANOID_COUNT} NanoIDs: compact, URL-friendly random identifiers. ` +
        `Default is ${NANOID_DEFAULT_SIZE} characters from the URL-safe alphabet (A-Za-z0-9_-), ` +
        "about as collision-resistant as a v4 UUID.",
      inputSchema: {
        count: z
          .number()
          .int()
          .min(1)
          .max(MAX_NANOID_COUNT)
          .optional()
          .describe(`How many IDs to generate, 1 to ${MAX_NANOID_COUNT} (default 1)`),
        size: z
          .number()
          .int()
          .min(NANOID_MIN_SIZE)
          .max(NANOID_MAX_SIZE)
          .optional()
          .describe(
            `ID length in characters, ${NANOID_MIN_SIZE} to ${NANOID_MAX_SIZE} (default ${NANOID_DEFAULT_SIZE})`,
          ),
        alphabet: z
          .enum(NANOID_ALPHABET_NAMES as [NanoIdAlphabet, ...NanoIdAlphabet[]])
          .optional()
          .describe(
            "Named alphabet: url (A-Za-z0-9_-, default), alphanumeric, lowercase (a-z0-9), " +
              "numbers, hex, or nolookalikes (alphanumeric without 0 O 1 l I)",
          ),
        safeEnds: z
          .boolean()
          .optional()
          .describe(
            "Keep the first and last characters alphanumeric, never '-' or '_' " +
              "(avoids IDs being read as CLI flags; default false)",
          ),
      },
    },
    ({
      count = 1,
      size = NANOID_DEFAULT_SIZE,
      alphabet = "url",
      safeEnds = false,
    }) => {
      try {
        // Same shape as GET /api/v1/nanoid.
        const ids = generateNanoIds({ count, size, alphabet, safeEnds });
        return jsonResult({ alphabet, size, safeEnds, count: ids.length, ids });
      } catch (e) {
        return errorResult(e, "Invalid NanoID request");
      }
    },
  );

  server.registerTool(
    "generate_ulid",
    {
      title: "ULID Generator",
      description:
        `Generate 1 to ${MAX_ULID_COUNT} ULIDs: 26-character, case-insensitive identifiers ` +
        "(Crockford base32) that start with a millisecond timestamp, so they sort by creation time " +
        "even as plain strings. A good fit for database keys and log or event IDs.",
      inputSchema: {
        count: z
          .number()
          .int()
          .min(1)
          .max(MAX_ULID_COUNT)
          .optional()
          .describe(`How many ULIDs to generate, 1 to ${MAX_ULID_COUNT} (default 1)`),
        monotonic: z
          .boolean()
          .optional()
          .describe(
            "Keep IDs strictly increasing even within the same millisecond " +
              "by incrementing the random part (default true)",
          ),
        lowercase: z
          .boolean()
          .optional()
          .describe("Use lower-case letters instead of the canonical upper case (default false)"),
      },
    },
    ({ count = 1, monotonic = true, lowercase = false }) => {
      try {
        // Same shape as GET /api/v1/ulid.
        const ulids = generateULIDs({ count, monotonic, lowercase });
        return jsonResult({ monotonic, lowercase, count: ulids.length, ulids });
      } catch (e) {
        return errorResult(e, "Invalid ULID request");
      }
    },
  );

  // Base64 / Base32 / Base58: one tool per encoding, with an `operation`
  // argument, mirroring the three REST endpoints.
  const encodingArgs = {
    operation: z
      .enum(["encode", "decode"])
      .describe("`encode` the input, or `decode` an encoded string back to bytes"),
    data: z
      .string()
      .describe("Text (or hex, see inputFormat) to encode, or the encoded string to decode"),
    inputFormat: z
      .enum(["text", "hex"])
      .optional()
      .describe("Encode only: read `data` as UTF-8 `text` (default) or as `hex` bytes"),
  };
  const RESULT_SHAPES =
    "Encode returns `{ encoding, operation, output, inputBytes }`. Decode returns " +
    "`{ encoding, operation, text, hex, bytes }`, where `text` is null when the bytes are not valid UTF-8.";

  server.registerTool(
    "convert_base64",
    {
      title: "Base64 Encoder / Decoder",
      description:
        "Encode text or hex bytes as Base64, or decode Base64 (standard or URL-safe, padding " +
        `optional, whitespace ignored). Up to ${API_MAX_BYTES.base64} bytes. ${RESULT_SHAPES}`,
      inputSchema: {
        ...encodingArgs,
        urlSafe: z
          .boolean()
          .optional()
          .describe("Encode only: URL-safe alphabet with `-` and `_` (default false)"),
        padding: z
          .boolean()
          .optional()
          .describe("Encode only: emit `=` padding (default true)"),
      },
    },
    ({ operation, data, inputFormat, urlSafe, padding }) => {
      try {
        return jsonResult(
          convertEncoding({
            encoding: "base64",
            operation,
            input: data,
            inputFormat,
            options: { urlSafe, padding },
            maxBytes: API_MAX_BYTES.base64,
          }),
        );
      } catch (e) {
        return errorResult(e, "Invalid Base64 request");
      }
    },
  );

  server.registerTool(
    "convert_base32",
    {
      title: "Base32 Encoder / Decoder",
      description:
        "Encode text or hex bytes as Base32, or decode Base32. Supports the RFC 4648 alphabet " +
        "(TOTP secrets) and Crockford's (case-insensitive, no I/L/O/U). " +
        `Up to ${API_MAX_BYTES.base32} bytes. ${RESULT_SHAPES}`,
      inputSchema: {
        ...encodingArgs,
        variant: z
          .enum(["rfc4648", "crockford"])
          .optional()
          .describe("Alphabet: `rfc4648` (default) or `crockford`"),
        padding: z
          .boolean()
          .optional()
          .describe("Encode only, RFC 4648 only: emit `=` padding (default true)"),
      },
    },
    ({ operation, data, inputFormat, variant, padding }) => {
      try {
        return jsonResult(
          convertEncoding({
            encoding: "base32",
            operation,
            input: data,
            inputFormat,
            options: { variant, padding },
            maxBytes: API_MAX_BYTES.base32,
          }),
        );
      } catch (e) {
        return errorResult(e, "Invalid Base32 request");
      }
    },
  );

  server.registerTool(
    "convert_base58",
    {
      title: "Base58 Encoder / Decoder",
      description:
        "Encode text or hex bytes as Base58 (Bitcoin alphabet, no 0/O/I/l), or decode Base58. " +
        "Used for Bitcoin addresses, IPFS CIDs and Solana keys; pass `inputFormat: \"hex\"` " +
        `to encode raw bytes. Up to ${API_MAX_BYTES.base58} bytes. ${RESULT_SHAPES}`,
      inputSchema: encodingArgs,
    },
    ({ operation, data, inputFormat }) => {
      try {
        return jsonResult(
          convertEncoding({
            encoding: "base58",
            operation,
            input: data,
            inputFormat,
            maxBytes: API_MAX_BYTES.base58,
          }),
        );
      } catch (e) {
        return errorResult(e, "Invalid Base58 request");
      }
    },
  );

  server.registerTool(
    "compute_hash",
    {
      title: "Hash Generator",
      description:
        "Compute a message digest of text or hex bytes: MD5, SHA-1, SHA-224, SHA-256, SHA-384, " +
        "SHA-512, SHA3-256, SHA3-512 or CRC-32, or `all` of them at once. Pass `hmacKey` to get " +
        "an HMAC instead (not available for CRC-32). " +
        `Up to ${API_MAX_HASH_BYTES} bytes. One algorithm returns ` +
        "`{ algorithm, hmac, digest, format, bits, inputBytes }`; `all` returns " +
        "`{ hmac, format, inputBytes, hashes: [{ algorithm, digest, bits }] }`.",
      inputSchema: {
        data: z.string().describe("The text (or hex bytes) to hash"),
        algorithm: z
          .enum(["all", ...HASH_ALGORITHMS])
          .optional()
          .describe("Hash algorithm (default `sha256`), or `all`"),
        inputFormat: z
          .enum(["text", "hex"])
          .optional()
          .describe("Read `data` as UTF-8 `text` (default) or as `hex` bytes"),
        outputFormat: z
          .enum(["hex", "base64"])
          .optional()
          .describe("Digest encoding: `hex` (default) or `base64`"),
        uppercase: z.boolean().optional().describe("Upper-case hex digits (default false)"),
        hmacKey: z.string().optional().describe("Secret key: compute an HMAC instead of a plain hash"),
        hmacKeyFormat: z
          .enum(["text", "hex"])
          .optional()
          .describe("Read `hmacKey` as UTF-8 `text` (default) or as `hex` bytes"),
      },
    },
    ({ data, algorithm, inputFormat, outputFormat, uppercase, hmacKey, hmacKeyFormat }) => {
      try {
        return jsonResult(
          runHash((algorithm ?? "sha256") as Parameters<typeof runHash>[0], {
            input: data,
            inputFormat,
            outputFormat,
            uppercase,
            hmacKey,
            hmacKeyFormat,
          }),
        );
      } catch (e) {
        return errorResult(e, "Invalid hash request");
      }
    },
  );

  server.registerTool(
    "generate_password",
    {
      title: "Password Generator",
      description:
        `Generate 1 to ${MAX_PASSWORD_COUNT} strong passwords with a cryptographic RNG: random ` +
        `characters (default ${PASSWORD_DEFAULT_LENGTH} from lower, upper, digits and symbols, at least ` +
        `one of each) or a passphrase of words from the EFF large wordlist (default ` +
        `${PASSPHRASE_DEFAULT_WORDS} words, ~12.9 bits each). Returns the resolved settings, the exact ` +
        "`entropyBits` of each password, `count` and `passwords`. Useful for test fixtures and dev " +
        "configuration; for real accounts, prefer the user's password manager.",
      inputSchema: {
        mode: z
          .enum(["random", "passphrase"])
          .optional()
          .describe("`random` characters (default) or a `passphrase` of words"),
        count: z
          .number()
          .int()
          .min(1)
          .max(MAX_PASSWORD_COUNT)
          .optional()
          .describe(`How many to generate, 1 to ${MAX_PASSWORD_COUNT} (default 1)`),
        length: z
          .number()
          .int()
          .min(PASSWORD_MIN_LENGTH)
          .max(PASSWORD_MAX_LENGTH)
          .optional()
          .describe(
            `Random mode: characters, ${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} (default ${PASSWORD_DEFAULT_LENGTH})`,
          ),
        sets: z
          .array(z.enum(PASSWORD_CHARSET_NAMES as [PasswordCharset, ...PasswordCharset[]]))
          .min(1)
          .optional()
          .describe("Random mode: character sets to use (default all of lower, upper, digits, symbols)"),
        excludeAmbiguous: z
          .boolean()
          .optional()
          .describe("Random mode: leave out look-alikes 0 O 1 l I | (default false)"),
        requireEachSet: z
          .boolean()
          .optional()
          .describe("Random mode: at least one character from each set (default true)"),
        words: z
          .number()
          .int()
          .min(PASSPHRASE_MIN_WORDS)
          .max(PASSPHRASE_MAX_WORDS)
          .optional()
          .describe(
            `Passphrase mode: words, ${PASSPHRASE_MIN_WORDS} to ${PASSPHRASE_MAX_WORDS} (default ${PASSPHRASE_DEFAULT_WORDS})`,
          ),
        separator: z
          .string()
          .min(1)
          .max(PASSPHRASE_MAX_SEPARATOR)
          .optional()
          .describe("Passphrase mode: between words, 1 to 3 characters, no letters or digits (default '-')"),
        capitalize: z.boolean().optional().describe("Passphrase mode: capitalise each word (default false)"),
        includeNumber: z
          .boolean()
          .optional()
          .describe("Passphrase mode: append one random digit to one word (default false)"),
      },
    },
    (args) => {
      try {
        // Same shape as GET /api/v1/password. Options that don't apply to
        // the chosen mode are ignored, like the route's query parameters.
        const options: PasswordOptions =
          args.mode === "passphrase"
            ? {
                mode: "passphrase",
                count: args.count,
                words: args.words,
                separator: args.separator,
                capitalize: args.capitalize,
                includeNumber: args.includeNumber,
              }
            : {
                mode: "random",
                count: args.count,
                length: args.length,
                sets: args.sets,
                excludeAmbiguous: args.excludeAmbiguous,
                requireEachSet: args.requireEachSet,
              };
        return jsonResult(runPassword(options));
      } catch (e) {
        return errorResult(e, "Invalid password request");
      }
    },
  );

  return server;
}

mcp.post("/", async (c) => {
  const transport = new WebStandardStreamableHTTPServerTransport({
    // Stateless: no session id, no cross-request state. Each request is
    // self-contained; `initialize` is answered inline and the transport
    // is discarded with the request.
    sessionIdGenerator: undefined,
    // Reply with plain `application/json` instead of a single-event SSE
    // stream. Our tools don't stream progress or server-initiated
    // notifications, so the SSE framing would just be overhead for
    // clients and a minor headache for tests. Streamable-HTTP-compliant
    // clients still accept both.
    enableJsonResponse: true,
  });

  const server = buildServer();
  await server.connect(transport);

  // The transport reads the body + headers off the Request directly and
  // returns a Web-standard Response — exactly what Hono wants back.
  return transport.handleRequest(c.req.raw);
});

// Stateless Streamable HTTP has no server-initiated stream (GET) and no
// session teardown (DELETE); reject them early so clients get a clear
// signal instead of hanging on an unsupported upgrade.
mcp.on(["GET", "DELETE"], "/", (c) =>
  c.json({ error: "Method Not Allowed" }, 405),
);

export default mcp;
