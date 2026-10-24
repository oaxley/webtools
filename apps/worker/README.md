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
| `POST /api/v1/hash` | Hash generator. JSON or form body: `{ data, algorithm?: "md5" \| "sha1" \| "sha224" \| "sha256" \| "sha384" \| "sha512" \| "sha3-256" \| "sha3-512" \| "crc32" \| "all", inputFormat?: "text" \| "hex", outputFormat?: "hex" \| "base64", uppercase?, hmacKey?, hmacKeyFormat?: "text" \| "hex" }` (default `sha256`). One algorithm returns `{ algorithm, hmac, digest, format, bits, inputBytes }`; `all` returns `{ hmac, format, inputBytes, hashes: [{ algorithm, digest, bits }] }`. With `hmacKey` the result is an HMAC (not available for CRC-32, which `all` then skips). Input is capped at 64 KiB, bodies at 256 KiB. POST keeps the payload and key out of URLs and logs; responses are `Cache-Control: no-store`. |
| `GET /api/v1/password?mode=random\|passphrase&count=1..20&…` | Password generator — returns the resolved settings plus `{ entropyBits, count, passwords }`. **Random** (default): `length=4..128` (default 20), `sets=lower,upper,digits,symbols` (any subset, default all), `excludeAmbiguous=true` drops `0 O 1 l I \|`, `requireEachSet=false` allows passwords missing a set (default: at least one of each). **Passphrase**: `words=3..12` (default 6) from the EFF large wordlist, `separator` (1–3 characters, no letters or digits, default `-`), `capitalize=true`, `includeNumber=true`. `entropyBits` is exact, since every choice is uniform. At most 20 per batch; responses are `Cache-Control: no-store`. There is deliberately no strength-check endpoint: passwords people chose should never be sent to a server. |

## MCP endpoint

`POST /mcp` exposes the IP subnet calculator, the JWT decoder, the
X.509 certificate decoder, the UUID, NanoID and ULID generators, the Base64 / Base32 / Base58 encoders, the hash generator and the password generator as Model Context Protocol tools. The transport is **Streamable HTTP** in **stateless, JSON-response
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
| `compute_hash` | `{ data: string, algorithm?: "md5" \| … \| "crc32" \| "all", inputFormat?, outputFormat?: "hex" \| "base64", uppercase?, hmacKey?, hmacKeyFormat? }` | Same shapes and limits as `POST /api/v1/hash`. Invalid input surfaces verbatim as `isError: true`. |
| `generate_password` | `{ mode?: "random" \| "passphrase", count?, length?, sets?: ("lower" \| "upper" \| "digits" \| "symbols")[], excludeAmbiguous?, requireEachSet?, words?, separator?, capitalize?, includeNumber? }` (options of the other mode are ignored) | Same shape and limits as `GET /api/v1/password`. Generation only. |

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
