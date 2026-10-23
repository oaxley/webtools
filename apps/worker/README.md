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
| `GET /api/v1/uuid?version=4\|7&count=1..10&uppercase=true&hyphens=false` | UUID generator — returns `{ version, count, uuids }`. Defaults to one v7 UUID; at most 10 per batch. Responses are `Cache-Control: no-store`. |
| `GET /api/v1/nanoid?count=1..10&size=2..255&alphabet=<name>&safeEnds=true` | NanoID generator — returns `{ alphabet, size, safeEnds, count, ids }`. Defaults to one 21-character ID from the `url` alphabet (`A-Za-z0-9_-`); other alphabets: `alphanumeric`, `lowercase`, `numbers`, `hex`, `nolookalikes`. `safeEnds=true` keeps the first and last characters alphanumeric (never `-` or `_`). At most 10 per batch. Responses are `Cache-Control: no-store`. |
| `GET /api/v1/ulid?count=1..10&monotonic=false&lowercase=true` | ULID generator — returns `{ monotonic, lowercase, count, ulids }`. Defaults to one upper-case ULID in monotonic mode (IDs from the same millisecond keep strictly increasing). At most 10 per batch. Responses are `Cache-Control: no-store`. |
| `POST /api/v1/base64` · `/api/v1/base32` · `/api/v1/base58` | Base encoders / decoders. JSON or form body: `{ data, operation?: "encode" \| "decode", inputFormat?: "text" \| "hex", urlSafe?, padding?, variant?: "rfc4648" \| "crockford" }` (`urlSafe` is Base64 only, `padding` Base64/Base32, `variant` Base32). Encode returns `{ encoding, operation, output, inputBytes }`; decode returns `{ encoding, operation, text, hex, bytes }` with `text: null` when the bytes aren't valid UTF-8. Decoding ignores whitespace and missing padding. Input is capped at 256 KiB (Base64/Base32) or 1 KiB (Base58, whose conversion is quadratic), bodies at 1 MiB. POST keeps the payload out of URLs and logs; responses are `Cache-Control: no-store`. |

## MCP endpoint

`POST /mcp` exposes the IP subnet calculator, the JWT decoder, the
X.509 certificate decoder, the UUID, NanoID and ULID generators, and the Base64 / Base32 / Base58 encoders as Model Context Protocol tools. The transport is **Streamable HTTP** in **stateless, JSON-response
mode** — each request is self-contained, no session id, no SSE replay.
No auth; the endpoint is public, same posture as `/api/v1/*`.

### Tools

| Name | Arguments | Returns |
|------|-----------|---------|
| `calculate_cidr` | `{ cidr: string }` (IPv4 CIDR, e.g. `192.168.1.0/24`) | JSON text block with the same shape as `/api/v1/ip`, including `routable`. Core errors surface verbatim as `isError: true` tool results. |
| `decode_jwt` | `{ token: string }` (compact JWT) | JSON text block with the same shape as `POST /api/v1/jwt` (`header`, `payload`, `signature`, `analysis`). The signature is **not** verified and the token is never echoed back. Decode errors surface verbatim as `isError: true` tool results. |
| `decode_x509` | `{ certificate: string }` (PEM or raw base64 DER) | JSON text block with the same shape as `POST /api/v1/x509` (`certificate`, `extensions`, `fingerprints`, `analysis`) **minus `signatureValue`** — the raw signature hex is long and of no use to a model. Neither the signature nor the chain is verified. Decode errors surface verbatim as `isError: true` tool results. |
| `generate_uuid` | `{ version?: 4 \| 7, count?: number, uppercase?: boolean }` (defaults: v7, 1 UUID; `count` is 1–10) | JSON text block with the same shape as `GET /api/v1/uuid` (`version`, `count`, `uuids`). |
| `generate_nanoid` | `{ count?: number, size?: number, alphabet?: "url" \| "alphanumeric" \| "lowercase" \| "numbers" \| "hex" \| "nolookalikes", safeEnds?: boolean }` (defaults: 1 ID, 21 characters, `url`, `safeEnds` false; `count` is 1–10, `size` 2–255) | JSON text block with the same shape as `GET /api/v1/nanoid` (`alphabet`, `size`, `safeEnds`, `count`, `ids`). |
| `generate_ulid` | `{ count?: number, monotonic?: boolean, lowercase?: boolean }` (defaults: 1 ULID, monotonic, upper case; `count` is 1–10) | JSON text block with the same shape as `GET /api/v1/ulid` (`monotonic`, `lowercase`, `count`, `ulids`). |
| `convert_base64` | `{ operation: "encode" \| "decode", data: string, inputFormat?: "text" \| "hex", urlSafe?: boolean, padding?: boolean }` | Same shapes and limits as `POST /api/v1/base64`. Invalid input surfaces verbatim as `isError: true`. |
| `convert_base32` | `{ operation, data, inputFormat?, variant?: "rfc4648" \| "crockford", padding?: boolean }` | Same shapes and limits as `POST /api/v1/base32`. |
| `convert_base58` | `{ operation, data, inputFormat? }` (Bitcoin alphabet) | Same shapes and limits as `POST /api/v1/base58`. |

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
