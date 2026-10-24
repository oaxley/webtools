import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

type PasswordBody = {
	mode: "random" | "passphrase";
	length?: number;
	sets?: string[];
	excludeAmbiguous?: boolean;
	requireEachSet?: boolean;
	words?: number;
	separator?: string;
	capitalize?: boolean;
	includeNumber?: boolean;
	entropyBits: number;
	count: number;
	passwords: string[];
	error?: string;
};

async function get(query = ""): Promise<Response> {
	return SELF.fetch(`http://example.com/api/v1/password${query}`);
}

async function body(query = ""): Promise<PasswordBody> {
	return (await (await get(query)).json()) as PasswordBody;
}

describe("GET /api/v1/password", () => {
	it("defaults to one 20-character password from every set", async () => {
		const response = await get();
		expect(response.status).toBe(200);
		const b = (await response.json()) as PasswordBody;
		expect(b).toMatchObject({
			mode: "random",
			length: 20,
			sets: ["lower", "upper", "digits", "symbols"],
			excludeAmbiguous: false,
			requireEachSet: true,
			count: 1,
		});
		expect(b.passwords).toHaveLength(1);
		expect(b.passwords[0]).toHaveLength(20);
		expect(b.entropyBits).toBeGreaterThan(130);
		expect(b.entropyBits).toBeLessThan(131.1);
	});

	it("is never cached", async () => {
		const response = await get();
		expect(response.headers.get("cache-control")).toBe("no-store");
	});

	it("honours length, sets, look-alikes and count", async () => {
		const b = await body(
			"?length=32&sets=lower,digits&excludeAmbiguous=true&count=20",
		);
		expect(b).toMatchObject({ length: 32, sets: ["lower", "digits"], count: 20 });
		expect(new Set(b.passwords).size).toBe(20);
		for (const p of b.passwords) expect(p).toMatch(/^[a-km-z2-9]{32}$/);
	});

	it("generates passphrases", async () => {
		const b = await body(
			"?mode=passphrase&words=4&separator=.&capitalize=true&includeNumber=1&count=5",
		);
		expect(b).toMatchObject({
			mode: "passphrase",
			words: 4,
			separator: ".",
			capitalize: true,
			includeNumber: true,
			count: 5,
		});
		// 4 × log2(7776) + log2(40)
		expect(b.entropyBits).toBe(57.02);
		for (const p of b.passwords) {
			expect(p.split(".")).toHaveLength(4);
			expect(p).toMatch(/^([A-Z][a-z-]+\d?\.){3}[A-Z][a-z-]+\d?$/);
			expect(p.match(/\d/g)).toHaveLength(1);
		}
	});

	it.each([
		"?length=3",
		"?length=129",
		"?length=abc",
		"?sets=emoji",
		"?sets=",
		"?count=0",
		"?count=21",
		"?mode=pin",
		"?excludeAmbiguous=maybe",
		"?mode=passphrase&words=2",
		"?mode=passphrase&separator=x",
		"?mode=passphrase&separator=----",
	])("rejects %s with a 400 and a message", async (query) => {
		const response = await get(query);
		expect(response.status).toBe(400);
		const b = (await response.json()) as PasswordBody;
		expect(b.error).toBeTruthy();
	});
});
