import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

import { SAMPLE_CA, SAMPLE_RSA, pemToBase64Der } from "./fixtures";

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
      name: "webtools",
      version: "1.0.0",
    });
    expect(typeof body.result.protocolVersion).toBe("string");
  });

  it("`tools/list` returns every webtools tool", async () => {
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
    const byName = Object.fromEntries(
      body.result.tools.map((t) => [t.name, t]),
    );
    expect(Object.keys(byName).sort()).toEqual([
      "calculate_cidr",
      "decode_jwt",
      "decode_x509",
      "generate_uuid",
    ]);
    expect(byName.generate_uuid.description).toMatch(/UUID/);
    expect(byName.generate_uuid.inputSchema.properties).toHaveProperty("count");
    expect(byName.calculate_cidr.description).toMatch(/IPv4 CIDR/);
    expect(byName.calculate_cidr.inputSchema.properties).toHaveProperty("cidr");
    expect(byName.decode_jwt.description).toMatch(/JWT/);
    expect(byName.decode_jwt.inputSchema.properties).toHaveProperty("token");
    expect(byName.decode_x509.description).toMatch(/X\.509/);
    expect(byName.decode_x509.inputSchema.properties).toHaveProperty(
      "certificate",
    );
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

// Canonical jwt.io sample — HS256 header, 3-claim payload, known signature.
const SAMPLE_JWT =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ." +
  "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

const b64url = (obj: Record<string, unknown>) =>
  Buffer.from(JSON.stringify(obj), "utf-8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

type ToolCallBody = {
  error?: { message: string };
  result?: {
    isError?: boolean;
    content?: Array<{ type: string; text: string }>;
  };
};

async function callDecodeJwt(args: Record<string, unknown>) {
  const response = await rpc({
    jsonrpc: "2.0",
    id: 10,
    method: "tools/call",
    params: { name: "decode_jwt", arguments: args },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as ToolCallBody;
}

describe("POST /mcp — decode_jwt", () => {
  it("returns the same shape as /api/v1/jwt", async () => {
    const body = await callDecodeJwt({ token: SAMPLE_JWT });
    expect(body.result?.isError).toBeFalsy();
    expect(body.result?.content?.[0].type).toBe("text");
    const payload = JSON.parse(body.result!.content![0].text);
    expect(payload.header).toEqual({ alg: "HS256", typ: "JWT" });
    expect(payload.payload).toEqual({
      sub: "1234567890",
      name: "John Doe",
      iat: 1516239022,
    });
    expect(payload.signature).toBe(
      "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
    );
    expect(payload.analysis.state).toBe("no_expiry");
    expect(payload.analysis.iat).toMatch(/18 January 2018/);
    // The token itself is never echoed back.
    expect(body.result!.content![0].text).not.toContain(SAMPLE_JWT);
  });

  it("matches the HTTP API response byte-for-byte", async () => {
    const [mcpBody, httpResponse] = await Promise.all([
      callDecodeJwt({ token: SAMPLE_JWT }),
      SELF.fetch("http://example.com/api/v1/jwt", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: SAMPLE_JWT }),
      }),
    ]);
    expect(JSON.parse(mcpBody.result!.content![0].text)).toEqual(
      await httpResponse.json(),
    );
  });

  it("reports an expired token", async () => {
    const past = Math.floor(Date.now() / 1000) - 7200;
    const token = `${b64url({ alg: "HS256" })}.${b64url({ exp: past })}.sig`;
    const body = await callDecodeJwt({ token });
    const payload = JSON.parse(body.result!.content![0].text);
    expect(payload.analysis.state).toBe("expired");
    expect(payload.analysis.message).toMatch(/^Token expired/);
    expect(payload.analysis.exp).toMatch(/UTC/);
    expect(payload.payload.exp).toBe(past);
  });

  it("surfaces core errors verbatim as isError tool results", async () => {
    const body = await callDecodeJwt({ token: "not.a.jwt.at.all" });
    expect(body.result?.isError).toBe(true);
    expect(body.result?.content?.[0].text).toBe(
      "Invalid JWT: expected 3 dot-separated segments, got 5.",
    );
  });

  it("rejects a call missing the `token` argument", async () => {
    const body = await callDecodeJwt({});
    const message =
      body.error?.message ?? body.result?.content?.[0]?.text ?? "";
    expect(message.toLowerCase()).toContain("token");
  });
});

async function callDecodeX509(args: Record<string, unknown>) {
  const response = await rpc({
    jsonrpc: "2.0",
    id: 20,
    method: "tools/call",
    params: { name: "decode_x509", arguments: args },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as ToolCallBody;
}

describe("POST /mcp — decode_x509", () => {
  it("decodes a PEM certificate with fingerprints and analysis", async () => {
    const body = await callDecodeX509({ certificate: SAMPLE_CA });
    expect(body.result?.isError).toBeFalsy();
    expect(body.result?.content?.[0].type).toBe("text");
    const payload = JSON.parse(body.result!.content![0].text);
    expect(payload.certificate.subject).toBe(
      "CN=Example Root CA, O=Example, C=US",
    );
    expect(payload.certificate.issuer).toBe(
      "CN=Example Root CA, O=Example, C=US",
    );
    expect(payload.extensions["ext:basicConstraints"].ca).toBe(true);
    expect(payload.fingerprints.sha256).toMatch(
      /^[0-9a-f]{2}(:[0-9a-f]{2}){31}$/,
    );
    expect(payload.fingerprints.sha1).toMatch(
      /^[0-9a-f]{2}(:[0-9a-f]{2}){19}$/,
    );
    // Fixture is valid until 2036.
    expect(payload.analysis.state).toBe("active");
    expect(payload.analysis.message).toMatch(
      /^Certificate is valid for another /,
    );
    expect(payload.analysis.notAfter).toMatch(/UTC$/);
  });

  it("drops the raw signature hex from the output", async () => {
    const body = await callDecodeX509({ certificate: SAMPLE_CA });
    const payload = JSON.parse(body.result!.content![0].text);
    expect(payload).not.toHaveProperty("signatureValue");
  });

  it("matches the HTTP API response except for `signatureValue`", async () => {
    const [mcpBody, httpResponse] = await Promise.all([
      callDecodeX509({ certificate: SAMPLE_RSA }),
      SELF.fetch("http://example.com/api/v1/x509", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: SAMPLE_RSA }),
      }),
    ]);
    const { signatureValue, ...httpRest } = (await httpResponse.json()) as {
      signatureValue: string;
    } & Record<string, unknown>;
    expect(signatureValue.length).toBeGreaterThan(0);
    expect(JSON.parse(mcpBody.result!.content![0].text)).toEqual(httpRest);
  });

  it("surfaces SAN / KeyUsage / ExtKeyUsage", async () => {
    const body = await callDecodeX509({ certificate: SAMPLE_RSA });
    const { extensions } = JSON.parse(body.result!.content![0].text);
    expect(extensions["ext:subjectAltName"].names).toEqual([
      { type: "DNS", value: "example.com" },
      { type: "DNS", value: "www.example.com" },
      { type: "IP", value: "192.0.2.1" },
    ]);
    expect(extensions["ext:keyUsage"].usages).toEqual([
      "digitalSignature",
      "keyEncipherment",
    ]);
    expect(extensions["ext:extKeyUsage"].usages).toEqual([
      "serverAuth",
      "clientAuth",
    ]);
  });

  it("accepts raw base64 DER input (no PEM header)", async () => {
    const body = await callDecodeX509({
      certificate: pemToBase64Der(SAMPLE_CA),
    });
    expect(body.result?.isError).toBeFalsy();
    const payload = JSON.parse(body.result!.content![0].text);
    expect(payload.certificate.subject).toBe(
      "CN=Example Root CA, O=Example, C=US",
    );
  });

  it("surfaces core errors verbatim as isError tool results", async () => {
    const input = "!!!definitely-not-base64!!!";
    const [mcpBody, httpResponse] = await Promise.all([
      callDecodeX509({ certificate: input }),
      SELF.fetch("http://example.com/api/v1/x509", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ data: input }),
      }),
    ]);
    expect(mcpBody.result?.isError).toBe(true);
    const { error } = (await httpResponse.json()) as { error: string };
    expect(error.length).toBeGreaterThan(0);
    expect(mcpBody.result?.content?.[0].text).toBe(error);
  });

  it("rejects a call missing the `certificate` argument", async () => {
    const body = await callDecodeX509({});
    const message =
      body.error?.message ?? body.result?.content?.[0]?.text ?? "";
    expect(message.toLowerCase()).toContain("certificate");
  });
});

async function callGenerateUuid(args: Record<string, unknown>) {
  const response = await rpc({
    jsonrpc: "2.0",
    id: 30,
    method: "tools/call",
    params: { name: "generate_uuid", arguments: args },
  });
  expect(response.status).toBe(200);
  return (await response.json()) as ToolCallBody;
}

describe("POST /mcp — generate_uuid", () => {
  it("defaults to a single v7 UUID", async () => {
    const body = await callGenerateUuid({});
    expect(body.result?.isError).toBeFalsy();
    const payload = JSON.parse(body.result!.content![0].text);
    expect(payload.version).toBe(7);
    expect(payload.count).toBe(1);
    expect(payload.uuids).toHaveLength(1);
    expect(payload.uuids[0]).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it("generates the requested v4 batch in upper case", async () => {
    const body = await callGenerateUuid({
      version: 4,
      count: 10,
      uppercase: true,
    });
    const payload = JSON.parse(body.result!.content![0].text);
    expect(payload).toMatchObject({ version: 4, count: 10 });
    for (const id of payload.uuids) {
      expect(id).toMatch(
        /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/,
      );
    }
  });

  it("rejects a count above 10", async () => {
    const body = await callGenerateUuid({ count: 11 });
    const failed = body.error !== undefined || body.result?.isError === true;
    expect(failed).toBe(true);
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
