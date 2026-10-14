import { SELF } from "cloudflare:test";
import { describe, it, expect } from "vitest";

import { SAMPLE_CA, SAMPLE_RSA, pemToBase64Der } from "./fixtures";

describe("POST /api/v1/x509", () => {
	it("decodes a JSON body with a PEM certificate in `data`", async () => {
		const response = await SELF.fetch("http://example.com/api/v1/x509", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ data: SAMPLE_CA }),
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			certificate: {
				version: number;
				serialNumber: string;
				signatureAlgorithm: string;
				signatureAlgorithmOid: string;
				issuer: string;
				subject: string;
				validity: { notBefore: string; notAfter: string };
				subjectPublicKey: {
					algorithm: string;
					algorithmOid: string;
					sizeBits?: number;
				};
			};
			extensions: Record<string, Record<string, unknown>>;
			signatureValue: string;
			fingerprints: { sha1: string; sha256: string };
			analysis: {
				state: string;
				message: string;
				notBefore: string;
				notAfter: string;
			};
		};

		// Certificate block.
		expect(body.certificate.version).toBe(3);
		expect(body.certificate.signatureAlgorithm).toBe(
			"sha256WithRSAEncryption",
		);
		expect(body.certificate.signatureAlgorithmOid).toBe(
			"1.2.840.113549.1.1.11",
		);
		expect(body.certificate.subject).toBe(
			"CN=Example Root CA, O=Example, C=US",
		);
		expect(body.certificate.issuer).toBe(body.certificate.subject);
		expect(body.certificate.validity.notBefore).toBe(
			"2026-10-11T18:28:45.000Z",
		);
		expect(body.certificate.validity.notAfter).toBe(
			"2036-10-08T18:28:45.000Z",
		);
		expect(body.certificate.subjectPublicKey.algorithm).toBe("RSA");
		expect(body.certificate.subjectPublicKey.sizeBits).toBe(2048);

		// Extensions block — a CA cert should at minimum carry basic
		// constraints with ca=true.
		const bc = body.extensions["ext:basicConstraints"];
		expect(bc).toBeDefined();
		expect(bc.ca).toBe(true);
		expect(bc.critical).toBe(true);

		// Signature + fingerprints are always included.
		expect(body.signatureValue.length).toBeGreaterThan(0);
		// 2048-bit RSA → 256 bytes → 256 hex pairs separated by colons.
		expect(body.signatureValue.split(":")).toHaveLength(256);
		expect(body.fingerprints.sha256).toMatch(/^[0-9a-f]{2}(:[0-9a-f]{2}){31}$/);
		expect(body.fingerprints.sha1).toMatch(/^[0-9a-f]{2}(:[0-9a-f]{2}){19}$/);

		// Analysis block — the fixture is valid until 2036, so it should
		// be active with a forward-looking message.
		expect(body.analysis.state).toBe("active");
		expect(body.analysis.message).toMatch(
			/^Certificate is valid for another /,
		);
		expect(body.analysis.notBefore).toMatch(/UTC$/);
		expect(body.analysis.notAfter).toMatch(/UTC$/);
	});

	it("decodes a form-encoded body with the certificate in `data`", async () => {
		const form = new URLSearchParams({ data: SAMPLE_CA });
		const response = await SELF.fetch("http://example.com/api/v1/x509", {
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
			},
			body: form.toString(),
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			certificate: { subject: string };
			analysis: { state: string };
		};
		expect(body.certificate.subject).toBe(
			"CN=Example Root CA, O=Example, C=US",
		);
		expect(body.analysis.state).toBe("active");
	});

	it("decodes raw base64 DER input (no PEM header)", async () => {
		const der = pemToBase64Der(SAMPLE_CA);
		const response = await SELF.fetch("http://example.com/api/v1/x509", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ data: der }),
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			certificate: { subject: string };
			fingerprints: { sha256: string };
		};
		expect(body.certificate.subject).toBe(
			"CN=Example Root CA, O=Example, C=US",
		);
		expect(body.fingerprints.sha256).toMatch(/^[0-9a-f]{2}:/);
	});

	it("surfaces SAN + KeyUsage + ExtKeyUsage for the RSA server fixture", async () => {
		const response = await SELF.fetch("http://example.com/api/v1/x509", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ data: SAMPLE_RSA }),
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			extensions: Record<string, Record<string, unknown>>;
		};

		const san = body.extensions["ext:subjectAltName"];
		expect(san).toBeDefined();
		expect(san.names).toEqual([
			{ type: "DNS", value: "example.com" },
			{ type: "DNS", value: "www.example.com" },
			{ type: "IP", value: "192.0.2.1" },
		]);

		const ku = body.extensions["ext:keyUsage"];
		expect(ku).toBeDefined();
		expect(ku.usages).toEqual(["digitalSignature", "keyEncipherment"]);

		const eku = body.extensions["ext:extKeyUsage"];
		expect(eku).toBeDefined();
		expect(eku.usages).toEqual(["serverAuth", "clientAuth"]);
	});

	it("400s with a core parser error on malformed input", async () => {
		const response = await SELF.fetch("http://example.com/api/v1/x509", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ data: "!!!definitely-not-base64!!!" }),
		});
		expect(response.status).toBe(400);
		const body = (await response.json()) as { error: string };
		// Core surfaces either a base64 complaint or a DER-shape complaint
		// depending on what trips up the parser first. Both are 400s and
		// both carry a non-empty, human-readable error.
		expect(typeof body.error).toBe("string");
		expect(body.error.length).toBeGreaterThan(0);
	});

	it("400s when `data` is missing from a JSON body", async () => {
		const response = await SELF.fetch("http://example.com/api/v1/x509", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ cert: SAMPLE_CA }),
		});
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "Missing 'data' field containing the certificate.",
		});
	});

	it("400s when `data` is an empty string", async () => {
		const response = await SELF.fetch("http://example.com/api/v1/x509", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ data: "   " }),
		});
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "Missing 'data' field containing the certificate.",
		});
	});

	it("400s on malformed JSON", async () => {
		const response = await SELF.fetch("http://example.com/api/v1/x509", {
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
		const response = await SELF.fetch("http://example.com/api/v1/x509", {
			method: "POST",
			headers: { "content-type": "text/plain" },
			body: SAMPLE_CA,
		});
		expect(response.status).toBe(415);
		const body = (await response.json()) as { error: string };
		expect(body.error).toMatch(/Unsupported content type/);
	});
});
