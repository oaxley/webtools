import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

async function post(
	path: string,
	body: unknown,
	contentType = "application/json",
): Promise<Response> {
	return SELF.fetch(`http://example.com/api/v1/${path}`, {
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

describe("POST /api/v1/base64", () => {
	it("encodes text by default and is never cached", async () => {
		const response = await post("base64", { data: "héllo" });
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await json(response)).toEqual({
			encoding: "base64",
			operation: "encode",
			output: "aMOpbGxv",
			inputBytes: 6,
		});
	});

	it("supports URL-safe output without padding", async () => {
		const body = await json(
			await post("base64", {
				data: "fbffbf",
				inputFormat: "hex",
				urlSafe: true,
				padding: false,
			}),
		);
		expect(body.output).toBe("-_-_");
	});

	it("decodes to text and hex", async () => {
		const body = await json(
			await post("base64", { data: "Zm9v", operation: "decode" }),
		);
		expect(body).toEqual({
			encoding: "base64",
			operation: "decode",
			text: "foo",
			hex: "666f6f",
			bytes: 3,
		});
	});

	it("accepts form-encoded bodies with string flags", async () => {
		const body = await json(
			await post(
				"base64",
				{ data: "f", padding: "false" },
				"application/x-www-form-urlencoded",
			),
		);
		expect(body.output).toBe("Zg");
	});

	it.each([
		[{}, /Missing 'data'/],
		[{ data: "x", operation: "reverse" }, /Unknown operation/],
		[{ data: "x", padding: "maybe" }, /'padding' must be true or false/],
		[{ data: "Zm9v!", operation: "decode" }, /'!' is not in the alphabet \(position 5\)/],
	])("rejects %o with 400", async (input, message) => {
		const response = await post("base64", input);
		expect(response.status).toBe(400);
		expect((await json(response)).error).toMatch(message);
	});

	it("415s on an unsupported content type", async () => {
		const response = await SELF.fetch("http://example.com/api/v1/base64", {
			method: "POST",
			headers: { "Content-Type": "text/plain" },
			body: "hello",
		});
		expect(response.status).toBe(415);
	});

	it("413s on an oversized body", async () => {
		const response = await post("base64", { data: "a".repeat(1_100_000) });
		expect(response.status).toBe(413);
	});

	it("caps the decoded size", async () => {
		const response = await post("base64", { data: "a".repeat(300_000) });
		expect(response.status).toBe(400);
		expect((await json(response)).error).toMatch(/262144-byte limit/);
	});
});

describe("POST /api/v1/base32", () => {
	it("encodes RFC 4648 with padding by default", async () => {
		const body = await json(await post("base32", { data: "foo" }));
		expect(body.output).toBe("MZXW6===");
	});

	it("encodes and decodes Crockford", async () => {
		const enc = await json(
			await post("base32", { data: "foobar", variant: "crockford" }),
		);
		expect(enc.output).toBe("CSQPYRK1E8");
		const dec = await json(
			await post("base32", {
				data: "csqp-yrk1-e8",
				variant: "crockford",
				operation: "decode",
			}),
		);
		expect(dec.text).toBe("foobar");
	});

	it("rejects an unknown variant", async () => {
		const response = await post("base32", { data: "x", variant: "zbase32" });
		expect(response.status).toBe(400);
	});
});

describe("POST /api/v1/base58", () => {
	it("encodes text", async () => {
		const body = await json(await post("base58", { data: "Hello World!" }));
		expect(body.output).toBe("2NEpo7TZRRrLZSi2U");
	});

	it("keeps leading zero bytes and reports binary output", async () => {
		const body = await json(
			await post("base58", { data: "11Rt5zm", operation: "decode" }),
		);
		expect(body).toMatchObject({ text: null, hex: "000010c8511e", bytes: 6 });
	});

	it("rejects look-alike characters", async () => {
		const response = await post("base58", { data: "2NE0", operation: "decode" });
		expect(response.status).toBe(400);
		expect((await json(response)).error).toMatch(/'0' is not in the alphabet/);
	});

	it("caps input at 1024 bytes", async () => {
		const response = await post("base58", { data: "a".repeat(1025) });
		expect(response.status).toBe(400);
		expect((await json(response)).error).toMatch(/1024-byte limit for Base58/);
	});
});
