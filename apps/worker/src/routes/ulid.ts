/**
 * `/api/v1/ulid` — generate ULIDs (sortable, 26-character identifiers).
 *
 * GET is fine here: the request carries nothing sensitive. Responses
 * are marked `no-store` so no browser or CDN cache ever replays a
 * previously issued identifier.
 *
 * Query parameters (all optional):
 * - `count`      1..10 (default `1`)
 * - `monotonic`  `false` to draw fresh randomness for every ID instead of
 *                incrementing within the same millisecond (default `true`)
 * - `lowercase`  `true` for lower-case letters (default `false`)
 */
import { Hono } from "hono";
import { generateULIDs } from "@webtools/core";
import { parseFlag } from "./params";

const ulid = new Hono();

ulid.get("/", (c) => {
  c.header("Cache-Control", "no-store");

  const countParam = c.req.query("count");

  try {
    const count = countParam === undefined ? 1 : Number(countParam);
    const monotonic = parseFlag(c.req.query("monotonic"), "monotonic") ?? true;
    const lowercase = parseFlag(c.req.query("lowercase"), "lowercase") ?? false;
    const ulids = generateULIDs({ count, monotonic, lowercase });
    // Same shape as the MCP `generate_ulid` tool.
    return c.json({ monotonic, lowercase, count: ulids.length, ulids });
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "Invalid request" },
      400,
    );
  }
});

export default ulid;
