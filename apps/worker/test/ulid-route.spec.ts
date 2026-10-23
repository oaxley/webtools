import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

type UlidBody = {
	monotonic: boolean;
	lowercase: boolean;
	count: number;
	ulids: string[];
};

async function get(query = ""): Promise<Response> {
	return SELF.fetch(`http://example.com/api/v1/ulid${query}`);
}

describe("GET /api/v1/ulid", () => {
	it("defaults to a single monotonic upper-case ULID", async () => {
		const response = await get();
		expect(response.status).toBe(200);
		const body = (await response.json()) as UlidBody;
		expect(body).toMatchObject({ monotonic: true, lowercase: false, count: 1 });
		expect(body.ulids).toHaveLength(1);
		expect(body.ulids[0]).toMatch(ULID_RE);
	});

	it("is never cached", async () => {
		const response = await get();
		expect(response.headers.get("cache-control")).toBe("no-store");
	});

	it("returns sorted, unique batches", async () => {
		const body = (await (await get("?count=10")).json()) as UlidBody;
		expect(body.ulids).toHaveLength(10);
		expect([...body.ulids].sort()).toEqual(body.ulids);
		expect(new Set(body.ulids).size).toBe(10);
	});

	it("honours monotonic and lowercase flags", async () => {
		const body = (await (
			await get("?count=3&monotonic=false&lowercase=true")
		).json()) as UlidBody;
		expect(body).toMatchObject({ monotonic: false, lowercase: true, count: 3 });
		for (const id of body.ulids) {
			expect(id).toMatch(/^[0-7][0-9a-hjkmnp-tv-z]{25}$/);
		}
	});

	it.each([
		["?count=0", /count must be an integer between 1 and 10/],
		["?count=11", /count must be an integer between 1 and 10/],
		["?count=abc", /count must be an integer between 1 and 10/],
		["?monotonic=maybe", /'monotonic' must be true or false/],
		["?lowercase=yes", /'lowercase' must be true or false/],
	])("rejects %s with 400", async (query, message) => {
		const response = await get(query);
		expect(response.status).toBe(400);
		const body = (await response.json()) as { error: string };
		expect(body.error).toMatch(message);
	});
});
