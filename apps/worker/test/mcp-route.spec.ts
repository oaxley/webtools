import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

/**
 * JSON-RPC envelope helper. The MCP Streamable HTTP transport demands
 * both media types in `Accept` (even in JSON-response mode), so every
 * test routes through here to keep the headers consistent.
 */
async function rpc(body: unknown): Promise<Response> {
  return SELF.fetch("http://example.com/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(body),
  });
}

const INIT = {
  jsonrpc: "2.0",
  id: 0,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "vitest", version: "0.0.0" },
  },
};

describe("POST /mcp", () => {
  it("responds to `initialize` with server info", async () => {
    const response = await rpc(INIT);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: {
        serverInfo: { name: string; version: string };
        protocolVersion: string;
      };
    };
    expect(body.result.serverInfo).toMatchObject({
      name: "webtools-ip",
      version: "1.0.0",
    });
    expect(typeof body.result.protocolVersion).toBe("string");
  });

  it("`tools/list` returns the single `calculate_cidr` tool", async () => {
    const response = await rpc({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: {},
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: {
        tools: Array<{
          name: string;
          description?: string;
          inputSchema: { properties?: Record<string, unknown> };
        }>;
      };
    };
    expect(body.result.tools).toHaveLength(1);
    const [tool] = body.result.tools;
    expect(tool.name).toBe("calculate_cidr");
    expect(tool.description).toMatch(/IPv4 CIDR/);
    expect(tool.inputSchema.properties).toHaveProperty("cidr");
  });

  it("`tools/call calculate_cidr` on 192.168.1.0/24 returns the same shape as /api/v1/ip (non-routable)", async () => {
    const response = await rpc({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "calculate_cidr",
        arguments: { cidr: "192.168.1.0/24" },
      },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: {
        isError?: boolean;
        content: Array<{ type: string; text: string }>;
      };
    };
    expect(body.result.isError).toBeFalsy();
    expect(body.result.content[0].type).toBe("text");
    const payload = JSON.parse(body.result.content[0].text);
    expect(payload).toMatchObject({
      network: "192.168.1.0",
      broadcast: "192.168.1.255",
      prefix: 24,
      subnetMask: "255.255.255.0",
      firstHost: "192.168.1.1",
      lastHost: "192.168.1.254",
      totalAddresses: 256,
      usableHosts: 254,
      routable: false,
    });
  });

  it("marks public space as routable", async () => {
    const response = await rpc({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "calculate_cidr", arguments: { cidr: "8.8.8.0/24" } },
    });
    const body = (await response.json()) as {
      result: { content: Array<{ text: string }> };
    };
    expect(JSON.parse(body.result.content[0].text)).toMatchObject({
      network: "8.8.8.0",
      routable: true,
    });
  });

  it("surfaces core errors verbatim as isError tool results", async () => {
    const response = await rpc({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "calculate_cidr",
        arguments: { cidr: "256.0.0.0/24" },
      },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      result: {
        isError: boolean;
        content: Array<{ type: string; text: string }>;
      };
    };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toBe(
      "Invalid IPv4 address: '256.0.0.0'. Octet '256' must be between 0 and 255.",
    );
  });

  it("rejects a call missing the `cidr` argument with a schema validation error", async () => {
    const response = await rpc({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "calculate_cidr", arguments: {} },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      error?: { message: string };
      result?: { isError?: boolean; content?: Array<{ text: string }> };
    };
    // The MCP SDK can report input validation failures either as a
    // JSON-RPC error (`error.message`) or as a tool error result
    // (`result.isError`); accept either shape as long as the message
    // points at the missing `cidr` argument.
    const message =
      body.error?.message ?? body.result?.content?.[0]?.text ?? "";
    expect(message.toLowerCase()).toContain("cidr");
  });
});

describe("Unsupported methods on /mcp", () => {
  it("405s on GET", async () => {
    const response = await SELF.fetch("http://example.com/mcp");
    expect(response.status).toBe(405);
  });

  it("405s on DELETE", async () => {
    const response = await SELF.fetch("http://example.com/mcp", {
      method: "DELETE",
    });
    expect(response.status).toBe(405);
  });
});
