/**
 * Keeps the hand-written `src/openapi.yaml` honest:
 *
 * - every `/api/v1` route mounted in `src/index.ts` is documented, with the
 *   right method, and the document lists no route that doesn't exist;
 * - every request example is sent to the real handler, and the reply must
 *   match the documented schema and the response example of the same name
 *   (exactly, unless it is marked `x-varies` or `x-abridged`);
 * - every response example matches its own schema;
 * - each GET parameter's `default`, `enum` and `examples` values are
 *   accepted, and an out-of-range value gets the documented 400.
 *
 * Validity against the OpenAPI 3.1 meta-schema is checked in Node by
 * `pnpm run lint:openapi` (the validator reads its schemas from disk, which
 * workerd can't).
 */
import { SELF } from "cloudflare:test";
import { Validator, type Schema } from "@cfworker/json-schema";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import app from "../src/index";
import spec from "../src/openapi.yaml";

type Json = Record<string, unknown>;

interface Example {
	value: unknown;
	summary?: string;
	"x-varies"?: boolean;
	"x-abridged"?: boolean;
}
interface Parameter {
	name: string;
	in: string;
	required?: boolean;
	description?: string;
	schema: Json;
	examples?: Record<string, Example>;
}
interface MediaType {
	schema: Json;
	examples?: Record<string, Example>;
}
interface ResponseObject {
	content?: Record<string, MediaType>;
}
interface Operation {
	parameters?: Parameter[];
	requestBody?: { content: Record<string, MediaType> };
	responses: Record<string, ResponseObject | { $ref: string }>;
}

const doc = parse(spec) as {
	paths: Record<string, Record<string, Operation>>;
	components: { responses: Record<string, ResponseObject> };
};

function resolveResponse(r: ResponseObject | { $ref: string }): ResponseObject {
	return "$ref" in r ? doc.components.responses[r.$ref.split("/").pop()!] : r;
}

/** JSON body schema and examples of one response code. */
function jsonResponse(op: Operation, code: string): MediaType {
	return resolveResponse(op.responses[code]).content!["application/json"];
}

/** Validate against a schema whose `$ref`s point into `components`. */
function expectMatches(schema: Json, value: unknown, where: string): void {
	const validator = new Validator(
		{ ...schema, components: doc.components } as Schema,
		"2020-12",
		false,
	);
	const { errors } = validator.validate(value);
	expect(errors, `${where}: ${JSON.stringify(errors, null, 2)}`).toEqual([]);
}

/** Check a live reply against the response example paired with a request. */
function expectPaired(ok: MediaType, name: string, body: unknown): void {
	expectMatches(ok.schema, body, `reply to '${name}'`);
	const example = ok.examples?.[name];
	if (!example || example["x-varies"]) return;
	if (example["x-abridged"]) {
		// Abridged examples drop entries, but whatever they keep is real.
		expect(body).toMatchObject(abridgedShape(example.value) as object);
	} else {
		expect(body).toEqual(example.value);
	}
}

/**
 * The parts of an abridged example that must still match: scalars that
 * aren't cut short with `…`, and objects recursively. Arrays are skipped
 * (an abridged array keeps only some of its entries).
 */
function abridgedShape(value: unknown): unknown {
	if (Array.isArray(value)) return expect.any(Array);
	if (typeof value === "string" && value.includes("…")) return expect.any(String);
	if (value === null || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value).map(([k, v]) => [k, abridgedShape(v)]),
	);
}

/**
 * Cloudflare's edge always sets the client address; the test runtime
 * doesn't, so GETs carry one (a public IPv4) for `/myip`.
 */
const CLIENT = { headers: { "CF-Connecting-IP": "90.12.34.56" } };

const operations = Object.entries(doc.paths).flatMap(([path, methods]) =>
	Object.entries(methods).map(([method, op]) => ({ path, method: method.toUpperCase(), op })),
);
const apiOperations = operations.filter((o) => o.path !== "/api/v1/openapi.yaml");

describe("openapi.yaml", () => {
	it("documents exactly the mounted /api/v1 routes", () => {
		const mounted = app.routes
			// `ALL …/*` entries are middleware (e.g. CORS), not endpoints.
			.filter((r) => r.path.startsWith("/api/v1/") && r.method !== "ALL")
			.map((r) => `${r.method} ${r.path}`)
			.sort();
		const documented = operations.map((o) => `${o.method} ${o.path}`).sort();
		expect(documented).toEqual(mounted);
	});

	it("is served with the request's origin as its server", async () => {
		const response = await SELF.fetch("https://api.test.example/api/v1/openapi.yaml");
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("application/yaml");
		expect(response.headers.get("access-control-allow-origin")).toBe("*");
		const text = await response.text();
		expect(text).not.toContain("@@API_BASE@@");
		const served = parse(text) as { servers: { url: string }[] };
		expect(served.servers[0].url).toBe("https://api.test.example");
	});

	describe.each(apiOperations)("$method $path", ({ path, method, op }) => {
		const ok = jsonResponse(op, "200");

		it("has response examples that match their schema", () => {
			for (const code of Object.keys(op.responses)) {
				const media = jsonResponse(op, code);
				for (const [name, ex] of Object.entries(media?.examples ?? {})) {
					expectMatches(media.schema, ex.value, `${code} example '${name}'`);
				}
			}
		});

		if (method === "POST") {
			const examples = op.requestBody!.content["application/json"].examples ?? {};

			it("has request examples, each with a response example", () => {
				expect(Object.keys(examples).length).toBeGreaterThan(0);
				for (const name of Object.keys(examples)) {
					expect(ok.examples, `response example '${name}'`).toHaveProperty(name);
				}
			});

			it.each(Object.entries(examples))("request example '%s' gets its response", async (name, ex) => {
				const response = await SELF.fetch(`http://example.com${path}`, {
					method,
					headers: { "content-type": "application/json" },
					body: JSON.stringify(ex.value),
				});
				expect(response.status).toBe(200);
				expectPaired(ok, name, await response.json());
			});

			it("is documented to answer 415 to other content types, and does", async () => {
				expect(op.responses["415"]).toBeDefined();
				const response = await SELF.fetch(`http://example.com${path}`, {
					method,
					headers: { "content-type": "text/plain" },
					body: "x",
				});
				expect(response.status).toBe(415);
			});
			return;
		}

		// GET: a request example is the set of parameter examples sharing a
		// name, plus the first example of each required parameter.
		const params = op.parameters ?? [];
		const required = params.filter((p) => p.required);
		const firstExample = (p: Parameter) =>
			Object.values(p.examples ?? {})[0]?.value ?? (p.schema.examples as unknown[])[0];
		const base = () =>
			new URLSearchParams(required.map((p) => [p.name, String(firstExample(p))]));
		const names = Object.keys(ok.examples ?? {});

		it.each(names)("response example '%s' is what its request returns", async (name) => {
			const q = base();
			for (const p of params) {
				const ex = p.examples?.[name];
				if (ex) q.set(p.name, String(ex.value));
			}
			const response = await SELF.fetch(`http://example.com${path}?${q}`, CLIENT);
			expect(response.status).toBe(200);
			expectPaired(ok, name, await response.json());
		});

		const variants: string[] = [base().toString()];
		for (const p of params) {
			const values = [
				...(p.schema.default !== undefined ? [p.schema.default] : []),
				...((p.schema.enum as unknown[] | undefined) ?? []),
				...((p.schema.examples as unknown[] | undefined) ?? []),
			];
			for (const value of values) {
				const q = base();
				q.set(p.name, String(value));
				// Passphrase settings only apply in passphrase mode.
				if (p.description?.startsWith("`passphrase` mode")) {
					q.set("mode", "passphrase");
				}
				variants.push(q.toString());
			}
		}

		it.each(variants)("?%s is accepted", async (query) => {
			const response = await SELF.fetch(`http://example.com${path}?${query}`, CLIENT);
			expect(response.status, await response.clone().text()).toBe(200);
			expectMatches(ok.schema, await response.json(), "reply");
		});

		// Endpoints without parameters have nothing to get out of range.
		if (params.length === 0) return;

		it("is documented to answer 400 to an out-of-range value, and does", async () => {
			const bad = params.find((p) => p.schema.maximum !== undefined) ?? required[0];
			const q = base();
			q.set(bad.name, bad.schema.maximum !== undefined ? String(Number(bad.schema.maximum) + 1) : "nope");
			const response = await SELF.fetch(`http://example.com${path}?${q}`);
			expect(response.status).toBe(400);
			expectMatches(jsonResponse(op, "400").schema, await response.json(), "400");
		});
	});
});
