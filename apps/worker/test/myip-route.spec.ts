import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { allowedOrigins } from "../src/routes/myip";

const URL = "http://example.com/api/v1/myip";

/** What Cloudflare's edge attaches to a request from a French ISP. */
const PARIS_CF = {
	city: "Paris",
	region: "Île-de-France",
	regionCode: "IDF",
	country: "FR",
	postalCode: "75001",
	continent: "EU",
	timezone: "Europe/Paris",
	latitude: "48.85660",
	longitude: "2.35220",
	asn: 3215,
	asOrganization: "Orange",
};

function fetchAs(ip: string | undefined, init: RequestInit & { cf?: object } = {}) {
	const headers = new Headers(init.headers);
	if (ip) headers.set("CF-Connecting-IP", ip);
	return SELF.fetch(URL, { ...init, headers } as RequestInit);
}

describe("GET /api/v1/myip", () => {
	it("echoes the client IPv4 with its approximate location and ISP", async () => {
		const response = await fetchAs("90.12.34.56", { cf: PARIS_CF });
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(await response.json()).toEqual({
			ip: "90.12.34.56",
			version: 4,
			routable: true,
			location: {
				approximate: true,
				city: "Paris",
				region: "Île-de-France",
				regionCode: "IDF",
				country: "FR",
				postalCode: "75001",
				continent: "EU",
				timezone: "Europe/Paris",
				latitude: 48.8566,
				longitude: 2.3522,
			},
			isp: { asn: 3215, organization: "Orange" },
		});
	});

	it("returns nulls when the edge has no geo data", async () => {
		const response = await fetchAs("90.12.34.56");
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			ip: "90.12.34.56",
			routable: true,
			location: { approximate: true, city: null, country: null, latitude: null },
			isp: { asn: null, organization: null },
		});
	});

	it("flags private addresses as not routable, keeping the edge data", async () => {
		const response = await fetchAs("192.168.1.20", { cf: PARIS_CF });
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			ip: "192.168.1.20",
			routable: false,
			location: { city: "Paris", country: "FR" },
			isp: { asn: 3215, organization: "Orange" },
		});
	});

	it("422s over IPv6", async () => {
		const response = await fetchAs("2001:db8::1");
		expect(response.status).toBe(422);
		expect(await response.json()).toEqual({
			error: "You are connected over IPv6. Only IPv4 addresses are supported for now.",
		});
	});

	it("500s when the client IP is unknown", async () => {
		const response = await fetchAs(undefined);
		expect(response.status).toBe(500);
		expect(await response.json()).toHaveProperty("error");
	});

	describe("CORS", () => {
		const allowed = allowedOrigins(env.ALLOWED_ORIGINS)[0];

		it("sends no CORS headers to a same-origin request", async () => {
			const response = await fetchAs("90.12.34.56");
			expect(response.headers.get("access-control-allow-origin")).toBeNull();
		});

		it("lets the configured site origin read the answer", async () => {
			expect(allowed).toBeTruthy();
			const response = await fetchAs("90.12.34.56", { headers: { Origin: allowed } });
			expect(response.status).toBe(200);
			expect(response.headers.get("access-control-allow-origin")).toBe(allowed);
		});

		it("refuses any other origin", async () => {
			const response = await fetchAs("90.12.34.56", {
				headers: { Origin: "https://evil.example" },
			});
			expect(response.headers.get("access-control-allow-origin")).toBeNull();
		});

		it("answers the preflight only for the configured origin", async () => {
			const ok = await fetchAs(undefined, {
				method: "OPTIONS",
				headers: { Origin: allowed, "Access-Control-Request-Method": "GET" },
			});
			expect(ok.status).toBe(204);
			expect(ok.headers.get("access-control-allow-origin")).toBe(allowed);

			const ko = await fetchAs(undefined, {
				method: "OPTIONS",
				headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "GET" },
			});
			expect(ko.headers.get("access-control-allow-origin")).toBeNull();
		});
	});
});

describe("allowedOrigins", () => {
	it("splits, trims and drops trailing slashes and empties", () => {
		expect(allowedOrigins(" https://a.example/ , http://localhost:5173,,")).toEqual([
			"https://a.example",
			"http://localhost:5173",
		]);
		expect(allowedOrigins(undefined)).toEqual([]);
	});
});
