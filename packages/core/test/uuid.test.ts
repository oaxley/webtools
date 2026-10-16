/**
 * Tests for the UUID generators (../src/uuid.ts).
 *
 * Runner: Node built-in test runner, no dependencies.
 *   node --test test/
 *   pnpm --filter @webtools/core test
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    generateUUIDs,
    generateUUIDv4,
    generateUUIDv7,
    MAX_UUID_COUNT,
} from "../src/uuid.ts";

const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-([0-9a-f])[0-9a-f]{3}-([0-9a-f])[0-9a-f]{3}-[0-9a-f]{12}$/;

function versionOf(uuid: string): string {
    const m = UUID_RE.exec(uuid);
    assert.ok(m, `not a canonical UUID: ${uuid}`);
    return m[1];
}

function variantOf(uuid: string): string {
    return UUID_RE.exec(uuid)![2];
}

describe("generateUUIDv4", () => {
    it("produces a canonical version-4 UUID with the RFC variant", () => {
        const uuid = generateUUIDv4();
        assert.equal(versionOf(uuid), "4");
        assert.match(variantOf(uuid), /[89ab]/);
    });

    it("does not repeat over 10k draws", () => {
        const seen = new Set<string>();
        for (let i = 0; i < 10_000; i++) seen.add(generateUUIDv4());
        assert.equal(seen.size, 10_000);
    });
});

describe("generateUUIDv7", () => {
    it("produces a canonical version-7 UUID with the RFC variant", () => {
        const uuid = generateUUIDv7();
        assert.equal(versionOf(uuid), "7");
        assert.match(variantOf(uuid), /[89ab]/);
    });

    it("encodes the timestamp in the first 48 bits", () => {
        // Far in the future so the monotonic state can't hold it back.
        const now = Date.UTC(2100, 0, 1);
        const uuid = generateUUIDv7(now);
        const hex = uuid.replace(/-/g, "").slice(0, 12);
        assert.equal(parseInt(hex, 16), now);
    });

    it("stays strictly increasing within the same millisecond", () => {
        const now = Date.UTC(2101, 0, 1);
        const ids = Array.from({ length: 5_000 }, () => generateUUIDv7(now));
        for (let i = 1; i < ids.length; i++) {
            assert.ok(ids[i] > ids[i - 1], `${ids[i]} <= ${ids[i - 1]}`);
        }
    });

    it("stays strictly increasing when the clock goes backwards", () => {
        const a = generateUUIDv7(Date.UTC(2102, 0, 1));
        const b = generateUUIDv7(Date.UTC(2000, 0, 1));
        assert.ok(b > a);
    });

    it("does not repeat over 10k draws", () => {
        const seen = new Set<string>();
        for (let i = 0; i < 10_000; i++) seen.add(generateUUIDv7());
        assert.equal(seen.size, 10_000);
    });
});

describe("generateUUIDs", () => {
    it("defaults to a single v7 UUID", () => {
        const ids = generateUUIDs();
        assert.equal(ids.length, 1);
        assert.equal(versionOf(ids[0]), "7");
    });

    it("generates the requested version and count", () => {
        const ids = generateUUIDs({ version: 4, count: MAX_UUID_COUNT });
        assert.equal(ids.length, MAX_UUID_COUNT);
        for (const id of ids) assert.equal(versionOf(id), "4");
    });

    it("supports upper-case and hyphen-less output", () => {
        const [id] = generateUUIDs({ uppercase: true, hyphens: false });
        assert.match(id, /^[0-9A-F]{32}$/);
        assert.equal(id[12], "7");
    });

    it("caps the batch size at 10", () => {
        assert.equal(MAX_UUID_COUNT, 10);
    });

    for (const count of [0, MAX_UUID_COUNT + 1, 1.5, Number.NaN, -1]) {
        it(`rejects count=${count}`, () => {
            assert.throws(
                () => generateUUIDs({ count }),
                /count must be an integer between 1 and 10/,
            );
        });
    }

    it("rejects an unsupported version", () => {
        assert.throws(
            // @ts-expect-error — deliberately invalid input.
            () => generateUUIDs({ version: 1 }),
            /Unsupported UUID version: 1/,
        );
    });
});
