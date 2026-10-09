import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

describe("GET /api/v1/ip", () => {
	it("returns subnet details plus the routable flag (private space)", async () => {
		const response = await SELF.fetch(
			"http://example.com/api/v1/ip?cidr=192.168.1.0/24",
		);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body).toMatchObject({
			network: "192.168.1.0",
			broadcast: "192.168.1.255",
			prefix: 24,
			subnetMask: "255.255.255.0",
			firstHost: "192.168.1.1",
			lastHost: "192.168.1.254",
			totalAddresses: 256,
			usableHosts: 254,
			routable: false,
		});
	});

	it("marks public space as routable", async () => {
		const response = await SELF.fetch(
			"http://example.com/api/v1/ip?cidr=8.8.8.0/24",
		);
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body).toMatchObject({ network: "8.8.8.0", routable: true });
	});

	it("400s with the core error message on invalid input", async () => {
		const response = await SELF.fetch(
			"http://example.com/api/v1/ip?cidr=256.0.0.0/24",
		);
		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body).toMatchObject({
			error:
				"Invalid IPv4 address: '256.0.0.0'. Octet '256' must be between 0 and 255.",
		});
	});

	it("400s when the cidr parameter is missing", async () => {
		const response = await SELF.fetch("http://example.com/api/v1/ip");
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "Missing cidr parameter",
		});
	});
});
