import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

type FakeDataBody = {
	fields: string[];
	count: number;
	seed: number | null;
	records: Record<string, string | number | boolean>[];
};

async function get(query = ""): Promise<Response> {
	return SELF.fetch(`http://example.com/api/v1/fake-data${query}`);
}

describe("GET /api/v1/fake-data", () => {
	it("returns one record with the requested fields", async () => {
		const response = await get("?fields=person.firstName,person.email");
		expect(response.status).toBe(200);
		const body = (await response.json()) as FakeDataBody;
		expect(body).toMatchObject({
			fields: ["person.firstName", "person.email"],
			count: 1,
			seed: null,
		});
		expect(body.records).toHaveLength(1);
		expect(Object.keys(body.records[0])).toEqual(["firstName", "email"]);
		expect(body.records[0].email).toMatch(/@/);
	});

	it("is never cached", async () => {
		const response = await get("?fields=person");
		expect(response.headers.get("cache-control")).toBe("no-store");
	});

	it("expands groups and accepts repeated fields params", async () => {
		const body = (await (
			await get("?fields=location.city&fields=person&count=90")
		).json()) as FakeDataBody;
		expect(body.count).toBe(90);
		expect(body.records).toHaveLength(90);
		expect(body.fields).toContain("person.fullName");
		expect(body.fields.at(-1)).toBe("location.city");
		for (const r of body.records) {
			expect(r.fullName).toBe(`${r.firstName} ${r.lastName}`);
		}
	});

	it("allows 100 records of a whole person (1,000 values)", async () => {
		const response = await get("?fields=person&count=100");
		expect(response.status).toBe(200);
		const body = (await response.json()) as FakeDataBody;
		expect(body.records).toHaveLength(100);
	});

	it("is reproducible with a seed", async () => {
		const query = "?fields=person,location,date&count=5&seed=42";
		const a = (await (await get(query)).json()) as FakeDataBody;
		const b = (await (await get(query)).json()) as FakeDataBody;
		expect(a.seed).toBe(42);
		expect(a.records).toEqual(b.records);
	});

	it.each([
		["", /fields must list at least one field/],
		["?fields=", /fields must list at least one field/],
		["?fields=nope", /Unknown field: nope/],
		["?fields=person.nope", /Unknown field: person.nope/],
		["?fields=person&count=0", /count must be an integer between 1 and 100/],
		["?fields=person&count=101", /count must be an integer between 1 and 100/],
		["?fields=person&count=abc", /count must be an integer between 1 and 100/],
		["?fields=person&seed=-1", /seed must be an integer between 0 and/],
		["?fields=person&seed=", /seed must be an integer between 0 and/],
		["?fields=person&seed=1.5", /seed must be an integer between 0 and/],
		[
			"?fields=person,location.city&count=91",
			/fields × count must be at most 1000 values \(got 11 × 91 = 1001\)/,
		],
		["?fields=person,location,company&count=100", /ask for at most 45 records/],
	])("rejects %s with 400", async (query, message) => {
		const response = await get(query);
		expect(response.status).toBe(400);
		const body = (await response.json()) as { error: string };
		expect(body.error).toMatch(message);
	});
});
