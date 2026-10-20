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
 * - `generate_nanoid(count?, size?, alphabet?)` — mirrors
 *   `/api/v1/nanoid`. Returns `{ alphabet, size, count, ids }` with 1..10
 *   NanoIDs (default: 21 characters, `url` alphabet).
 */
import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { z } from "zod";
import {
  calculateCIDR,
  decodeJWT,
  decodeX509,
  generateNanoIds,
  generateUUIDs,
  isRoutable,
  MAX_NANOID_COUNT,
  MAX_UUID_COUNT,
  NANOID_ALPHABET_NAMES,
  NANOID_DEFAULT_SIZE,
  NANOID_MAX_SIZE,
  NANOID_MIN_SIZE,
  type NanoIdAlphabet,
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
      },
    },
    ({ count = 1, size = NANOID_DEFAULT_SIZE, alphabet = "url" }) => {
      try {
        // Same shape as GET /api/v1/nanoid.
        const ids = generateNanoIds({ count, size, alphabet });
        return jsonResult({ alphabet, size, count: ids.length, ids });
      } catch (e) {
        return errorResult(e, "Invalid NanoID request");
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
