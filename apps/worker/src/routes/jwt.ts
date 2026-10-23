/**
 * `/api/v1/jwt` — decode a compact JWT and annotate time claims.
 *
 * POST is used instead of GET so the token never appears in query
 * strings, access logs or referer headers. The response does NOT
 * echo the original token for the same reason.
 */
import { Hono } from "hono";
import { decodeJWT, toJwtJsonSummary } from "@webtools/core";
import { readBody } from "./params";

const jwt = new Hono();

jwt.post("/", async (c) => {
  const read = await readBody(c, { example: '{ "data": "<jwt>" }' });
  if (!read.ok) return read.response;
  const { data } = read.body;

  if (typeof data !== "string" || data.trim() === "") {
    return c.json({ error: "Missing 'data' field containing the JWT." }, 400);
  }

  try {
    // The shared summary renders known time claims as human-readable
    // UTC strings under `analysis.<claim>` (raw numeric values stay in
    // `payload`) and deliberately omits the original token. Same shape
    // as the MCP `decode_jwt` tool.
    return c.json(toJwtJsonSummary(decodeJWT(data)));
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "Invalid JWT" },
      400,
    );
  }
});

export default jwt;
