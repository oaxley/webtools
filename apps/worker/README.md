# @webtools/worker

Cloudflare Worker that fronts the WebTools APIs. Each tool is a thin
HTTP wrapper around pure helpers in `@webtools/core`; routing lives in
`src/routes/<tool>.ts` and is mounted from `src/index.ts`.

## HTTP endpoints

All versioned under `/api/v1`, and described by a hand-written OpenAPI 3.1
document, `src/openapi.yaml`, served at `GET /api/v1/openapi.yaml` (with
`servers` set to the requesting origin, and CORS open).
`test/openapi-route.spec.ts` replays its examples against the real handlers;
`pnpm run lint:openapi` validates it against the OAS 3.1 schema. Update it
with any route change.

| Endpoint | Purpose |
|----------|---------|
| `GET /api/v1/ip?cidr=<ipv4/prefix>` | IP subnet calculator — returns network, broadcast, mask, host range, and routable flag. |
| `GET /api/v1/myip` | "What's my IP" — returns the caller's public IPv4 (`CF-Connecting-IP`) with an **approximate** `location` (city, region, country, timezone, lat/long) and `isp` (`asn`, `organization`), all from `request.cf`. Any field may be `null`. IPv6 clients get a `422`. `Cache-Control: no-store`. CORS is limited to the origins in `ALLOWED_ORIGINS` (see below). |
| `GET /api/v1/jwt?...` | JWT decoder / inspector. |
| `GET /api/v1/x509?...` | X.509 certificate decoder. |
| `GET /api/v1/uuid?version=4\|7&count=1..10&uppercase=true&hyphens=false` | UUID generator — returns `{ version, count, uuids }`. Defaults to one v7 UUID; at most 10 per batch. Responses are `Cache-Control: no-store`. |
| `GET /api/v1/nanoid?count=1..10&size=2..255&alphabet=<name>&safeEnds=true` | NanoID generator — returns `{ alphabet, size, safeEnds, count, ids }`. Defaults to one 21-character ID from the `url` alphabet (`A-Za-z0-9_-`); other alphabets: `alphanumeric`, `lowercase`, `numbers`, `hex`, `nolookalikes`. `safeEnds=true` keeps the first and last characters alphanumeric (never `-` or `_`). At most 10 per batch. Responses are `Cache-Control: no-store`. |
| `GET /api/v1/ulid?count=1..10&monotonic=false&lowercase=true` | ULID generator — returns `{ monotonic, lowercase, count, ulids }`. Defaults to one upper-case ULID in monotonic mode (IDs from the same millisecond keep strictly increasing). At most 10 per batch. Responses are `Cache-Control: no-store`. |
| `GET /api/v1/fake-data?fields=<ids>&count=1..100&seed=<n>` | Fake data generator (Faker) — returns `{ fields, count, seed, records }`. `fields` (required) is a comma-separated list of groups (`person`, `location`, `company`, `internet`, `finance`, `commerce`, `date`, `misc`) and/or fields (`person.email`, `location.city`, …); it may also be repeated. Records are flat objects in catalog order; fields of a group agree within a record (email built from the name, ZIP matching the state). `seed` (0–4294967295) makes the output reproducible, dates included. At most 100 records per batch, and at most 1,000 values (fields × count, groups expanded) so a request stays within the free plan's 10 ms CPU budget; larger requests get a 400 that gives the maximum count for those fields. Responses are `Cache-Control: no-store`. |
| `POST /api/v1/base64` · `/api/v1/base32` · `/api/v1/base58` | Base encoders / decoders. JSON or form body: `{ data, operation?: "encode" \| "decode", inputFormat?: "text" \| "hex", urlSafe?, padding?, variant?: "rfc4648" \| "crockford" }` (`urlSafe` is Base64 only, `padding` Base64/Base32, `variant` Base32). Encode returns `{ encoding, operation, output, inputBytes }`; decode returns `{ encoding, operation, text, hex, bytes }` with `text: null` when the bytes aren't valid UTF-8. Decoding ignores whitespace and missing padding. Input is capped at 256 KiB (Base64/Base32) or 1 KiB (Base58, whose conversion is quadratic), bodies at 1 MiB. POST keeps the payload out of URLs and logs; responses are `Cache-Control: no-store`. |
| `POST /api/v1/hash` | Hash generator. JSON or form body: `{ data, algorithm?: "md5" \| "sha1" \| "sha224" \| "sha256" \| "sha384" \| "sha512" \| "sha3-256" \| "sha3-512" \| "crc32" \| "all", inputFormat?: "text" \| "hex", outputFormat?: "hex" \| "base64", uppercase?, hmacKey?, hmacKeyFormat?: "text" \| "hex" }` (default `sha256`). One algorithm returns `{ algorithm, hmac, digest, format, bits, inputBytes }`; `all` returns `{ hmac, format, inputBytes, hashes: [{ algorithm, digest, bits }] }`. With `hmacKey` the result is an HMAC (not available for CRC-32, which `all` then skips). Input is capped at 64 KiB, bodies at 256 KiB. POST keeps the payload and key out of URLs and logs; responses are `Cache-Control: no-store`. |
| `GET /api/v1/password?mode=random\|passphrase&count=1..20&…` | Password generator — returns the resolved settings plus `{ entropyBits, count, passwords }`. **Random** (default): `length=4..128` (default 20), `sets=lower,upper,digits,symbols` (any subset, default all), `excludeAmbiguous=true` drops `0 O 1 l I \|`, `requireEachSet=false` allows passwords missing a set (default: at least one of each). **Passphrase**: `words=3..12` (default 6) from the EFF large wordlist, `separator` (1–3 characters, no letters or digits, default `-`), `capitalize=true`, `includeNumber=true`. `entropyBits` is exact, since every choice is uniform. At most 20 per batch; responses are `Cache-Control: no-store`. There is deliberately no strength-check endpoint: passwords people chose should never be sent to a server. |

## MCP endpoint

`POST /mcp` exposes the IP subnet calculator, the JWT decoder, the
X.509 certificate decoder, the UUID, NanoID and ULID generators, the fake data generator, the Base64 / Base32 / Base58 encoders, the hash generator and the password generator as Model Context Protocol tools. The transport is **Streamable HTTP** in **stateless, JSON-response
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
| `generate_fake_data` | `{ fields: string[], count?: number, seed?: number }` (`fields` lists group and/or field ids, at least one; `count` is 1–100, default 1, with fields × count ≤ 1,000; `seed` 0–4294967295) | JSON text block with the same shape as `GET /api/v1/fake-data` (`fields`, `count`, `seed`, `records`). |
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

## CORS and `ALLOWED_ORIGINS`

`/api/v1/myip` is the only endpoint the website calls from the browser.
If the site and the Worker share an origin, nothing is needed. If they
live on different hosts, the site's origin must be listed in the
`ALLOWED_ORIGINS` var (comma-separated, in `wrangler.jsonc`): only those
origins get `Access-Control-Allow-Origin` back, and browsers block every
other site from reading the answer. (CORS only binds browsers: `curl`
still works, which is fine for an endpoint that returns the caller's own
IP.)

Locally, just run `pnpm dev:worker` and `pnpm dev:web`: the Vite dev
server proxies `/api/v1/*` to `wrangler dev` (`http://127.0.0.1:8787`, or
`VITE_WORKER_URL`), so the site and the API share an origin and no CORS
is involved, from this machine or another device on the LAN. The proxy
passes the browser's address as `CF-Connecting-IP`, so `/my-ip` shows
`127.0.0.1` or your LAN address, with the location and ISP of your
machine's internet connection: Wrangler looks them up once at start-up and
caches them in `node_modules/.mf/cf.json` (git-ignored, never committed).

Only if you point the site straight at the Worker
(`VITE_API_BASE_URL=http://127.0.0.1:8787 pnpm dev:web`) do the two become
separate origins: then copy `.dev.vars.example` to `.dev.vars` so
`localhost:5173` is allowed.

## Dev / deploy

See `AGENTS.md` for the Cloudflare-specific commands and Local Explorer
debugging tips.
