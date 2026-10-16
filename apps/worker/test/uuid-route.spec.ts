import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[47][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

type UuidBody = { version: number; count: number; uuids: string[] };

async function get(query = ""): Promise<Response> {
	return SELF.fetch(`http://example.com/api/v1/uuid${query}`);
}

describe("GET /api/v1/uuid", () => {
	it("defaults to a single v7 UUID", async () => {
		const response = await get();
		expect(response.status).toBe(200);
		const body = (await response.json()) as UuidBody;
		expect(body.version).toBe(7);
		expect(body.count).toBe(1);
		expect(body.uuids).toHaveLength(1);
		expect(body.uuids[0]).toMatch(UUID_RE);
		expect(body.uuids[0][14]).toBe("7");
	});

	it("is never cached", async () => {
		const response = await get();
		expect(response.headers.get("cache-control")).toBe("no-store");
	});

	it("generates v4 UUIDs on request", async () => {
		const body = (await (await get("?version=4&count=3")).json()) as UuidBody;
		expect(body.version).toBe(4);
		expect(body.count).toBe(3);
		for (const id of body.uuids) {
			expect(id).toMatch(UUID_RE);
			expect(id[14]).toBe("4");
		}
	});

	it("returns time-ordered v7 batches", async () => {
		const body = (await (await get("?count=10")).json()) as UuidBody;
		expect(body.uuids).toHaveLength(10);
		expect([...body.uuids].sort()).toEqual(body.uuids);
	});

	it("honours uppercase and hyphens flags", async () => {
		const body = (await (
			await get("?uppercase=true&hyphens=false")
		).json()) as UuidBody;
		expect(body.uuids[0]).toMatch(/^[0-9A-F]{32}$/);
	});

	it.each([
		["?count=0", /count must be an integer between 1 and 10/],
		["?count=11", /count must be an integer between 1 and 10/],
		["?count=abc", /count must be an integer between 1 and 10/],
		["?version=1", /Unsupported UUID version: 1/],
		["?uppercase=maybe", /'uppercase' must be true or false/],
	])("rejects %s with 400", async (query, message) => {
		const response = await get(query);
		expect(response.status).toBe(400);
		const body = (await response.json()) as { error: string };
		expect(body.error).toMatch(message);
	});
});
