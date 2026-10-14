/**
 * `/api/v1/jwt` — decode a compact JWT and annotate time claims.
 *
 * POST is used instead of GET so the token never appears in query
 * strings, access logs or referer headers. The response does NOT
 * echo the original token for the same reason.
 */
import { Hono, type Context } from "hono";
import { decodeJWT, toJwtJsonSummary } from "@webtools/core";

const jwt = new Hono();

/**
 * Pull the `data` field out of a JSON or form-encoded body. Returns
 * `{ ok: false, response }` if the body is unparseable or the content
 * type isn't supported, so the handler can return directly without
 * sprinkling early returns through its happy path.
 */
async function extractData(
  c: Context,
): Promise<
  | { ok: true; data: unknown }
  | { ok: false; response: Response }
> {
  const contentType = c.req.header("content-type")?.toLowerCase() ?? "";

  try {
    if (contentType.includes("application/json")) {
      const body = (await c.req.json()) as Record<string, unknown> | null;
      return { ok: true, data: body?.data };
    }
    if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      const form = await c.req.formData();
      return { ok: true, data: form.get("data") };
    }
    return {
      ok: false,
      response: c.json(
        {
          error:
            "Unsupported content type. Send application/json with { \"data\": \"<jwt>\" } or form-encoded data=<jwt>.",
        },
        415,
      ),
    };
  } catch {
    return {
      ok: false,
      response: c.json({ error: "Malformed request body." }, 400),
    };
  }
}

jwt.post("/", async (c) => {
  const extracted = await extractData(c);
  if (!extracted.ok) return extracted.response;
  const { data } = extracted;

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
