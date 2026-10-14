# @webtools/worker

Cloudflare Worker that fronts the WebTools APIs. Each tool is a thin
HTTP wrapper around pure helpers in `@webtools/core`; routing lives in
`src/routes/<tool>.ts` and is mounted from `src/index.ts`.

## HTTP endpoints

All versioned under `/api/v1`:

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/ip?cidr=<ipv4/prefix>` | IP subnet calculator — returns network, broadcast, mask, host range, and routable flag. |
| `GET /api/v1/jwt?...` | JWT decoder / inspector. |
| `GET /api/v1/x509?...` | X.509 certificate decoder. |

## MCP endpoint

`POST /mcp` exposes the IP subnet calculator and the JWT decoder as
Model Context Protocol tools. The transport is **Streamable HTTP** in **stateless, JSON-response
mode** — each request is self-contained, no session id, no SSE replay.
No auth; the endpoint is public, same posture as `/api/v1/*`.

### Tools

| Name | Arguments | Returns |
|------|-----------|---------|
| `calculate_cidr` | `{ cidr: string }` (IPv4 CIDR, e.g. `192.168.1.0/24`) | JSON text block with the same shape as `/api/v1/ip`, including `routable`. Core errors surface verbatim as `isError: true` tool results. |
| `decode_jwt` | `{ token: string }` (compact JWT) | JSON text block with the same shape as `POST /api/v1/jwt` (`header`, `payload`, `signature`, `analysis`). The signature is **not** verified and the token is never echoed back. Decode errors surface verbatim as `isError: true` tool results. |

### Hooking it up in an MCP client

For example, in `mcp.json` / `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "webtools": {
      "transport": "http",
      "url": "https://<your-worker-host>/mcp"
    }
  }
}
```

For local development point the client at `http://127.0.0.1:8787/mcp`
(the default `wrangler dev` origin).

### Quick smoke test with `curl`

```bash
curl -sS http://127.0.0.1:8787/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{
    "jsonrpc":"2.0","id":1,"method":"tools/call",
    "params":{"name":"calculate_cidr","arguments":{"cidr":"192.168.1.0/24"}}
  }'
```

## Dev / deploy

See `AGENTS.md` for the Cloudflare-specific commands and Local Explorer
debugging tips.
