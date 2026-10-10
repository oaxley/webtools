import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

// Canonical jwt.io sample — HS256 header, 3-claim payload, known signature.
const SAMPLE_JWT =
	"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
	"eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ." +
	"SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

describe("POST /api/v1/jwt", () => {
	it("decodes a JSON body with the token in `data`", async () => {
		const response = await SELF.fetch("http://example.com/api/v1/jwt", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ data: SAMPLE_JWT }),
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			header: unknown;
			payload: Record<string, unknown>;
			signature: string;
			analysis: Record<string, unknown>;
		};
		expect(body.header).toEqual({ alg: "HS256", typ: "JWT" });
		expect(body.signature).toBe(
			"SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
		);
		// Raw payload claims are preserved untouched…
		expect(body.payload.sub).toBe("1234567890");
		expect(body.payload.iat).toBe(1516239022);
		// …no `-text` suffix in payload any more.
		expect(body.payload["iat-text"]).toBeUndefined();
		// Human-readable date is in `analysis.iat` under its original key.
		expect(body.analysis.iat).toMatch(/18 January 2018/);
		expect(body.analysis.state).toBe("no_expiry");
		expect(body.analysis.message).toMatch(/no 'exp' claim/);
		// No stale `expiry` block, no top-level `message`.
		expect(("expiry" in body) as boolean).toBe(false);
		expect(("message" in body) as boolean).toBe(false);
	});

	it("decodes a form-encoded body with the token in `data`", async () => {
		const form = new URLSearchParams({ data: SAMPLE_JWT });
		const response = await SELF.fetch("http://example.com/api/v1/jwt", {
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
			},
			body: form.toString(),
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			header: unknown;
			analysis: Record<string, unknown>;
		};
		expect(body.header).toEqual({ alg: "HS256", typ: "JWT" });
		expect(body.analysis.message).toMatch(/no 'exp' claim/);
	});

	it("reports 'expired' with a past exp claim", async () => {
		// Build a token on the fly with an exp in the past.
		const b64 = (obj: Record<string, unknown>) =>
			Buffer.from(JSON.stringify(obj), "utf-8")
				.toString("base64")
				.replace(/\+/g, "-")
				.replace(/\//g, "_")
				.replace(/=+$/, "");
		const past = Math.floor(Date.now() / 1000) - 7200; // 2 hours ago
		const token =
			`${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u", exp: past })}.sig`;
		const response = await SELF.fetch("http://example.com/api/v1/jwt", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ data: token }),
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			payload: Record<string, unknown>;
			analysis: Record<string, unknown>;
		};
		expect(body.analysis.state).toBe("expired");
		expect(body.analysis.message).toMatch(/^Token expired/);
		expect(body.analysis.exp).toMatch(/UTC/);
		// Raw numeric exp is still in payload.
		expect(typeof body.payload.exp).toBe("number");
	});

	it("reports 'valid' with an exp claim in the future", async () => {
		const b64 = (obj: Record<string, unknown>) =>
			Buffer.from(JSON.stringify(obj), "utf-8")
				.toString("base64")
				.replace(/\+/g, "-")
				.replace(/\//g, "_")
				.replace(/=+$/, "");
		// Non-round delta → exercises the verbose "X hours, Y minutes
		// and Z seconds" formatting rather than a bare "1 hour".
		const future = Math.floor(Date.now() / 1000) + 2 * 3600 + 4 * 60 + 34;
		const token =
			`${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "u", exp: future })}.sig`;
		const response = await SELF.fetch("http://example.com/api/v1/jwt", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ data: token }),
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			analysis: Record<string, unknown>;
		};
		expect(body.analysis.state).toBe("valid");
		expect(body.analysis.message).toMatch(/^Token will expire in /);
		// Message mentions hours, minutes and seconds (joined by commas +
		// "and") and ends with a period. The absolute UTC date is NOT in
		// the message any more — it's available separately as
		// `analysis.exp`.
		expect(body.analysis.message).toMatch(
			/hours?, \d+ minutes? and \d+ seconds?\.$/,
		);
		expect(body.analysis.message).not.toMatch(/UTC/);
		expect(body.analysis.exp).toMatch(/UTC/);
	});

	it("400s with the core error message on malformed JWT", async () => {
		const response = await SELF.fetch("http://example.com/api/v1/jwt", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ data: "not.a.jwt.at.all" }),
		});
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "Invalid JWT: expected 3 dot-separated segments, got 5.",
		});
	});

	it("400s when `data` is missing from a JSON body", async () => {
		const response = await SELF.fetch("http://example.com/api/v1/jwt", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ token: SAMPLE_JWT }),
		});
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "Missing 'data' field containing the JWT.",
		});
	});

	it("400s when `data` is an empty string", async () => {
		const response = await SELF.fetch("http://example.com/api/v1/jwt", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ data: "   " }),
		});
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "Missing 'data' field containing the JWT.",
		});
	});

	it("400s on malformed JSON", async () => {
		const response = await SELF.fetch("http://example.com/api/v1/jwt", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{not json",
		});
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "Malformed request body.",
		});
	});

	it("415s when no supported content type is provided", async () => {
		const response = await SELF.fetch("http://example.com/api/v1/jwt", {
			method: "POST",
			headers: { "content-type": "text/plain" },
			body: SAMPLE_JWT,
		});
		expect(response.status).toBe(415);
		const body = (await response.json()) as { error: string };
		expect(body.error).toMatch(/Unsupported content type/);
	});
});
