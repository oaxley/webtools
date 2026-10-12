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
 */
import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { z } from "zod";
import { calculateCIDR, isRoutable } from "@webtools/core";

const mcp = new Hono();

/**
 * Build a fresh `McpServer` with the IP-calculator tool registered.
 *
 * A new instance per request is cheap and keeps the handler stateless;
 * it also sidesteps the "transport can only be connected once" rule in
 * the SDK. We swap the default AJV validator for `@cfworker/json-schema`
 * because AJV compiles schemas with `new Function`, which workerd
 * forbids.
 */
function buildServer(): McpServer {
  const server = new McpServer(
    { name: "webtools-ip", version: "1.0.0" },
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
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ...result, routable }),
            },
          ],
        };
      } catch (e) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: e instanceof Error ? e.message : "Invalid IPv4 CIDR",
            },
          ],
        };
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
