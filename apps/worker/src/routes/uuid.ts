/**
 * `/api/v1/uuid` — generate RFC 9562 version 4 or version 7 UUIDs.
 *
 * GET is fine here: the request carries nothing sensitive. Responses
 * are marked `no-store` so no browser or CDN cache ever replays a
 * previously issued identifier.
 *
 * Query parameters (all optional):
 * - `version`   `4` or `7` (default `7`)
 * - `count`     1..10 (default `1`)
 * - `uppercase` `true` for upper-case hex (default `false`)
 * - `hyphens`   `false` to drop the hyphens (default `true`)
 */
import { Hono } from "hono";
import { generateUUIDs, type UuidVersion } from "@webtools/core";
import { parseFlag } from "./params";

const uuid = new Hono();

uuid.get("/", (c) => {
  c.header("Cache-Control", "no-store");

  const versionParam = c.req.query("version");
  const countParam = c.req.query("count");

  try {
    const version = (versionParam === undefined
      ? 7
      : Number(versionParam)) as UuidVersion;
    const count = countParam === undefined ? 1 : Number(countParam);
    const uuids = generateUUIDs({
      version,
      count,
      uppercase: parseFlag(c.req.query("uppercase"), "uppercase"),
      hyphens: parseFlag(c.req.query("hyphens"), "hyphens"),
    });
    // Same shape as the MCP `generate_uuid` tool.
    return c.json({ version, count: uuids.length, uuids });
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "Invalid request" },
      400,
    );
  }
});

export default uuid;
