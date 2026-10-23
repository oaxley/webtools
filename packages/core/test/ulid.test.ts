/**
 * Tests for the ULID generator (../src/ulid.ts).
 *
 * Runner: Node built-in test runner, no dependencies.
 *   node --test test/
 *   pnpm --filter @webtools/core test
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    generateULID,
    generateULIDs,
    MAX_ULID_COUNT,
    ULID_ALPHABET,
    ULID_LENGTH,
    ULID_MAX_TIME,
} from "../src/ulid.ts";

const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;

/** Decode a run of base32 characters to a BigInt (test-side reference). */
function base32ToBigInt(s: string): bigint {
    let n = 0n;
    for (const ch of s.toUpperCase()) {
        const v = ULID_ALPHABET.indexOf(ch);
        assert.ok(v >= 0, `invalid character ${ch}`);
        n = n * 32n + BigInt(v);
    }
    return n;
}

const timeOf = (ulid: string) => Number(base32ToBigInt(ulid.slice(0, 10)));
const randomOf = (ulid: string) => base32ToBigInt(ulid.slice(10));

describe("ULID_ALPHABET", () => {
    it("is Crockford base32 in ASCII order", () => {
        assert.equal(ULID_ALPHABET.length, 32);
        assert.doesNotMatch(ULID_ALPHABET, /[ILOU]/);
        assert.equal([...ULID_ALPHABET].sort().join(""), ULID_ALPHABET);
    });
});

describe("generateULID", () => {
    it("produces a 26-character Crockford base32 string", () => {
        const ulid = generateULID();
        assert.equal(ulid.length, ULID_LENGTH);
        assert.match(ulid, ULID_RE);
    });

    it("encodes the timestamp like the spec's example", () => {
        // https://github.com/ulid/spec: 1469918176385 → 01ARYZ6S41…
        assert.equal(generateULID(false, 1469918176385).slice(0, 10), "01ARYZ6S41");
    });

    it("round-trips the timestamp, including the extremes", () => {
        for (const ms of [0, 1, Date.UTC(2026, 9, 22), ULID_MAX_TIME]) {
            const ulid = generateULID(false, ms);
            assert.equal(timeOf(ulid), ms);
        }
        assert.equal(generateULID(false, ULID_MAX_TIME).slice(0, 10), "7ZZZZZZZZZ");
    });

    it("rejects timestamps outside 48 bits", () => {
        for (const ms of [-1, ULID_MAX_TIME + 1, Number.NaN]) {
            assert.throws(() => generateULID(false, ms), /Timestamp out of range/);
        }
    });

    it("draws fresh randomness when not monotonic", () => {
        const now = Date.UTC(2030, 0, 1);
        const a = generateULID(false, now);
        const b = generateULID(false, now);
        assert.equal(a.slice(0, 10), b.slice(0, 10));
        assert.notEqual(randomOf(b), randomOf(a) + 1n);
    });

    it("increments the random part within the same millisecond", () => {
        // Far in the future so earlier tests' state can't hold it back.
        // 5000 IDs force carries across the low bytes along the way.
        const now = Date.UTC(2100, 0, 1);
        const ids = Array.from({ length: 5_000 }, () => generateULID(true, now));
        for (let i = 1; i < ids.length; i++) {
            assert.ok(ids[i] > ids[i - 1], `${ids[i]} <= ${ids[i - 1]}`);
            assert.equal(timeOf(ids[i]), now);
            assert.equal(randomOf(ids[i]), randomOf(ids[i - 1]) + 1n);
        }
    });

    it("stays strictly increasing when the clock goes backwards", () => {
        const a = generateULID(true, Date.UTC(2102, 0, 1));
        const b = generateULID(true, Date.UTC(2000, 0, 1));
        assert.ok(b > a);
        assert.equal(timeOf(b), timeOf(a));
    });

    it("does not repeat over 10k draws", () => {
        const seen = new Set<string>();
        for (let i = 0; i < 10_000; i++) seen.add(generateULID());
        assert.equal(seen.size, 10_000);
    });
});

describe("generateULIDs", () => {
    it("defaults to a single upper-case ULID for the current time", () => {
        const before = Date.now();
        const ids = generateULIDs();
        assert.equal(ids.length, 1);
        assert.match(ids[0], ULID_RE);
        // Monotonic state from earlier tests may have pushed it ahead.
        assert.ok(timeOf(ids[0]) >= before);
    });

    it("returns sorted batches in monotonic mode", () => {
        const ids = generateULIDs({ count: MAX_ULID_COUNT });
        assert.equal(ids.length, MAX_ULID_COUNT);
        assert.deepEqual([...ids].sort(), ids);
        assert.equal(new Set(ids).size, ids.length);
    });

    it("generates non-monotonic batches", () => {
        const ids = generateULIDs({ count: MAX_ULID_COUNT, monotonic: false });
        assert.equal(new Set(ids).size, MAX_ULID_COUNT);
        for (const id of ids) assert.match(id, ULID_RE);
    });

    it("supports lower-case output", () => {
        const [id] = generateULIDs({ lowercase: true });
        assert.match(id, /^[0-7][0-9a-hjkmnp-tv-z]{25}$/);
    });

    it("caps the batch size at 10", () => {
        assert.equal(MAX_ULID_COUNT, 10);
    });

    for (const count of [0, MAX_ULID_COUNT + 1, 1.5, Number.NaN, -1]) {
        it(`rejects count=${count}`, () => {
            assert.throws(
                () => generateULIDs({ count }),
                /count must be an integer between 1 and 10/,
            );
        });
    }

    it("rejects non-boolean flags", () => {
        assert.throws(
            // @ts-expect-error — deliberately invalid input.
            () => generateULIDs({ monotonic: "yes" }),
            /monotonic must be true or false/,
        );
        assert.throws(
            // @ts-expect-error — deliberately invalid input.
            () => generateULIDs({ lowercase: 1 }),
            /lowercase must be true or false/,
        );
    });
});
