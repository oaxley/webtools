import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

type NanoIdBody = {
	alphabet: string;
	size: number;
	count: number;
	ids: string[];
};

async function get(query = ""): Promise<Response> {
	return SELF.fetch(`http://example.com/api/v1/nanoid${query}`);
}

describe("GET /api/v1/nanoid", () => {
	it("defaults to a single 21-character url ID", async () => {
		const response = await get();
		expect(response.status).toBe(200);
		const body = (await response.json()) as NanoIdBody;
		expect(body).toMatchObject({ alphabet: "url", size: 21, count: 1 });
		expect(body.ids).toHaveLength(1);
		expect(body.ids[0]).toMatch(/^[A-Za-z0-9_-]{21}$/);
	});

	it("is never cached", async () => {
		const response = await get();
		expect(response.headers.get("cache-control")).toBe("no-store");
	});

	it("honours count, size and alphabet", async () => {
		const body = (await (
			await get("?count=10&size=8&alphabet=hex")
		).json()) as NanoIdBody;
		expect(body).toMatchObject({ alphabet: "hex", size: 8, count: 10 });
		expect(body.ids).toHaveLength(10);
		for (const id of body.ids) expect(id).toMatch(/^[0-9a-f]{8}$/);
		expect(new Set(body.ids).size).toBe(10);
	});

	it("excludes look-alike characters on request", async () => {
		const body = (await (
			await get("?size=255&alphabet=nolookalikes")
		).json()) as NanoIdBody;
		expect(body.ids[0]).toHaveLength(255);
		expect(body.ids[0]).not.toMatch(/[0O1lI_-]/);
	});

	it.each([
		["?count=0", /count must be an integer between 1 and 10/],
		["?count=11", /count must be an integer between 1 and 10/],
		["?count=abc", /count must be an integer between 1 and 10/],
		["?size=1", /size must be an integer between 2 and 255/],
		["?size=256", /size must be an integer between 2 and 255/],
		["?size=", /size must be an integer between 2 and 255/],
		["?alphabet=emoji", /Unknown alphabet: emoji/],
		["?alphabet=constructor", /Unknown alphabet: constructor/],
	])("rejects %s with 400", async (query, message) => {
		const response = await get(query);
		expect(response.status).toBe(400);
		const body = (await response.json()) as { error: string };
		expect(body.error).toMatch(message);
	});
});
