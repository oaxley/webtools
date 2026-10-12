/**
 * `/api/v1/x509` — decode a PEM or raw base64 DER X.509 certificate
 * and annotate its validity window.
 *
 * POST (same reasoning as `/api/v1/jwt`): certificates can be large,
 * contain newlines, and may be mildly sensitive — none of which play
 * well with query strings, access logs or referer headers. The response
 * does NOT echo the input.
 *
 * The response body is the shared {@link X509JsonSummary} shape produced
 * by `@webtools/core`, with an additional `analysis` block mirroring
 * the JWT route's shape (state + message + human-readable notBefore /
 * notAfter). Using the shared summary keeps the UI, this API and the
 * future MCP server lock-step on key names.
 */
import { Hono, type Context } from "hono";
import {
  computeFingerprints,
  decodeX509,
  describeValidity,
  toX509JsonSummary,
} from "@webtools/core";

const x509 = new Hono();

/**
 * Pull the `data` field out of a JSON or form-encoded body. Mirrors the
 * same helper in `routes/jwt.ts` — kept as a near-duplicate for now so
 * each route stays self-contained; happy to lift it into a shared
 * `_body.ts` once a third decoder route needs it.
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
            "Unsupported content type. Send application/json with { \"data\": \"<PEM or base64 DER>\" } or form-encoded data=<certificate>.",
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

x509.post("/", async (c) => {
  const extracted = await extractData(c);
  if (!extracted.ok) return extracted.response;
  const { data } = extracted;

  if (typeof data !== "string" || data.trim() === "") {
    return c.json(
      { error: "Missing 'data' field containing the certificate." },
      400,
    );
  }

  try {
    const cert = decodeX509(data);
    // Fingerprints are computed server-side via `crypto.subtle` so one
    // request = full picture, no second roundtrip required.
    const fingerprints = await computeFingerprints(cert);
    const summary = toX509JsonSummary(cert, fingerprints);
    const validity = describeValidity(cert);

    return c.json({
      ...summary,
      analysis: {
        state: validity.state,
        message: validity.message,
        notBefore: validity.notBeforeText,
        notAfter: validity.notAfterText,
      },
    });
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "Invalid certificate" },
      400,
    );
  }
});

export default x509;
