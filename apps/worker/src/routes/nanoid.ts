/**
 * `/api/v1/nanoid` — generate compact, URL-friendly NanoIDs.
 *
 * GET is fine here: the request carries nothing sensitive. Responses
 * are marked `no-store` so no browser or CDN cache ever replays a
 * previously issued identifier.
 *
 * Query parameters (all optional):
 * - `count`    1..10 (default `1`)
 * - `size`     2..255 characters (default `21`)
 * - `alphabet` one of `url` (default), `alphanumeric`, `lowercase`,
 *              `numbers`, `hex`, `nolookalikes`
 */
import { Hono } from "hono";
import {
  generateNanoIds,
  NANOID_DEFAULT_SIZE,
  type NanoIdAlphabet,
} from "@webtools/core";

const nanoid = new Hono();

nanoid.get("/", (c) => {
  c.header("Cache-Control", "no-store");

  const countParam = c.req.query("count");
  const sizeParam = c.req.query("size");

  try {
    const alphabet = (c.req.query("alphabet") ?? "url") as NanoIdAlphabet;
    const size =
      sizeParam === undefined ? NANOID_DEFAULT_SIZE : Number(sizeParam);
    const count = countParam === undefined ? 1 : Number(countParam);
    const ids = generateNanoIds({ count, size, alphabet });
    // Same shape as the MCP `generate_nanoid` tool.
    return c.json({ alphabet, size, count: ids.length, ids });
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "Invalid request" },
      400,
    );
  }
});

export default nanoid;
