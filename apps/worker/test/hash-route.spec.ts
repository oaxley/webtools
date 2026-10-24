import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

async function post(
	body: unknown,
	contentType = "application/json",
): Promise<Response> {
	return SELF.fetch("http://example.com/api/v1/hash", {
		method: "POST",
		headers: { "Content-Type": contentType },
		body:
			contentType === "application/json"
				? JSON.stringify(body)
				: new URLSearchParams(body as Record<string, string>).toString(),
	});
}

async function json(response: Response): Promise<Record<string, unknown>> {
	return (await response.json()) as Record<string, unknown>;
}

describe("POST /api/v1/hash", () => {
	it("defaults to SHA-256 of UTF-8 text and is never cached", async () => {
		const response = await post({ data: "abc" });
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await json(response)).toEqual({
			algorithm: "sha256",
			hmac: false,
			digest: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
			format: "hex",
			bits: 256,
			inputBytes: 3,
		});
	});

	it("supports hex input, base64 output and upper case", async () => {
		expect(
			(await json(await post({ data: "616263", inputFormat: "hex", algorithm: "md5", uppercase: true })))
				.digest,
		).toBe("900150983CD24FB0D6963F7D28E17F72");
		expect(
			(await json(await post({ data: "abc", outputFormat: "base64" }))).digest,
		).toBe("ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=");
	});

	it("computes an HMAC (RFC 4231 case 2), form-encoded", async () => {
		const body = await json(
			await post(
				{ data: "what do ya want for nothing?", hmacKey: "Jefe", algorithm: "sha256" },
				"application/x-www-form-urlencoded",
			),
		);
		expect(body.hmac).toBe(true);
		expect(body.digest).toBe("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
	});

	it("returns every algorithm with `all`", async () => {
		const body = await json(await post({ data: "123456789", algorithm: "all" }));
		const hashes = body.hashes as { algorithm: string; digest: string }[];
		expect(hashes).toHaveLength(9);
		expect(hashes.find((h) => h.algorithm === "crc32")?.digest).toBe("cbf43926");
	});

	it("rejects bad input with a 400 and a readable message", async () => {
		const missing = await post({ algorithm: "md5" });
		expect(missing.status).toBe(400);
		expect((await json(missing)).error).toMatch(/data/);

		const unknown = await post({ data: "x", algorithm: "sha0" });
		expect(unknown.status).toBe(400);
		expect((await json(unknown)).error).toMatch(/Unknown hash algorithm/);

		const crc = await post({ data: "x", algorithm: "crc32", hmacKey: "k" });
		expect(crc.status).toBe(400);
		expect((await json(crc)).error).toMatch(/checksum/);
	});

	it("caps the input size", async () => {
		const response = await post({ data: "a".repeat(65_537) });
		expect(response.status).toBe(400);
		expect((await json(response)).error).toMatch(/too large/);
	});
});
