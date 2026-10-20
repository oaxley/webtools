/**
 * Tests for the NanoID generator (../src/nanoid.ts).
 *
 * Runner: Node built-in test runner, no dependencies.
 *   node --test test/
 *   pnpm --filter @webtools/core test
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    generateNanoId,
    generateNanoIds,
    MAX_NANOID_COUNT,
    NANOID_ALPHABET_NAMES,
    NANOID_ALPHABETS,
    NANOID_DEFAULT_SIZE,
    NANOID_MAX_SIZE,
    NANOID_MIN_SIZE,
    nanoIdEntropyBits,
} from "../src/nanoid.ts";

function assertDrawnFrom(id: string, chars: string): void {
    for (const ch of id) {
        assert.ok(chars.includes(ch), `'${ch}' not in alphabet of ${id}`);
    }
}

describe("NANOID_ALPHABETS", () => {
    for (const name of NANOID_ALPHABET_NAMES) {
        it(`${name} has no duplicate characters and fits in a byte`, () => {
            const chars = NANOID_ALPHABETS[name];
            assert.equal(new Set(chars).size, chars.length);
            assert.ok(chars.length >= 2 && chars.length <= 256);
        });
    }

    it("has the expected sizes", () => {
        assert.equal(NANOID_ALPHABETS.url.length, 64);
        assert.equal(NANOID_ALPHABETS.alphanumeric.length, 62);
        assert.equal(NANOID_ALPHABETS.lowercase.length, 36);
        assert.equal(NANOID_ALPHABETS.numbers.length, 10);
        assert.equal(NANOID_ALPHABETS.hex.length, 16);
        assert.equal(NANOID_ALPHABETS.nolookalikes.length, 57);
        assert.doesNotMatch(NANOID_ALPHABETS.nolookalikes, /[0O1lI]/);
    });
});

describe("generateNanoId", () => {
    it("defaults to 21 URL-safe characters", () => {
        const id = generateNanoId();
        assert.equal(id.length, NANOID_DEFAULT_SIZE);
        assert.match(id, /^[A-Za-z0-9_-]{21}$/);
    });

    it("honours size and alphabet", () => {
        const id = generateNanoId(8, "hex");
        assert.match(id, /^[0-9a-f]{8}$/);
    });

    it("does not repeat over 10k draws", () => {
        const seen = new Set<string>();
        for (let i = 0; i < 10_000; i++) seen.add(generateNanoId());
        assert.equal(seen.size, 10_000);
    });
});

describe("generateNanoIds", () => {
    it("defaults to a single default-size url ID", () => {
        const ids = generateNanoIds();
        assert.equal(ids.length, 1);
        assert.equal(ids[0].length, NANOID_DEFAULT_SIZE);
        assertDrawnFrom(ids[0], NANOID_ALPHABETS.url);
    });

    for (const alphabet of NANOID_ALPHABET_NAMES) {
        it(`draws only from the ${alphabet} alphabet`, () => {
            const ids = generateNanoIds({
                alphabet,
                size: NANOID_MAX_SIZE,
                count: MAX_NANOID_COUNT,
            });
            assert.equal(ids.length, MAX_NANOID_COUNT);
            for (const id of ids) {
                assert.equal(id.length, NANOID_MAX_SIZE);
                assertDrawnFrom(id, NANOID_ALPHABETS[alphabet]);
            }
        });
    }

    it("accepts the minimum size", () => {
        const [id] = generateNanoIds({ size: NANOID_MIN_SIZE });
        assert.equal(id.length, NANOID_MIN_SIZE);
    });

    it("spreads characters evenly over a non power-of-two alphabet", () => {
        // 10 digits: a naive `byte % 10` would favour 0..5 by ~4%.
        const counts = new Map<string, number>();
        const draws = 200;
        for (let i = 0; i < draws; i++) {
            for (const ch of generateNanoIds({
                alphabet: "numbers",
                size: NANOID_MAX_SIZE,
            })[0]) {
                counts.set(ch, (counts.get(ch) ?? 0) + 1);
            }
        }
        const total = draws * NANOID_MAX_SIZE;
        const expected = total / 10;
        assert.equal(counts.size, 10);
        for (const [ch, n] of counts) {
            // ~51k samples: 5% tolerance is > 10 standard deviations.
            assert.ok(
                Math.abs(n - expected) / expected < 0.05,
                `'${ch}' drawn ${n} times, expected ~${expected}`,
            );
        }
    });

    it("caps the batch size at 10", () => {
        assert.equal(MAX_NANOID_COUNT, 10);
    });

    for (const count of [0, MAX_NANOID_COUNT + 1, 1.5, Number.NaN, -1]) {
        it(`rejects count=${count}`, () => {
            assert.throws(
                () => generateNanoIds({ count }),
                /count must be an integer between 1 and 10/,
            );
        });
    }

    for (const size of [1, NANOID_MAX_SIZE + 1, 2.5, Number.NaN]) {
        it(`rejects size=${size}`, () => {
            assert.throws(
                () => generateNanoIds({ size }),
                /size must be an integer between 2 and 255/,
            );
        });
    }

    it("rejects an unknown alphabet", () => {
        assert.throws(
            // @ts-expect-error — deliberately invalid input.
            () => generateNanoIds({ alphabet: "emoji" }),
            /Unknown alphabet: emoji\. Use one of: url, alphanumeric/,
        );
    });

    it("does not treat prototype keys as alphabets", () => {
        assert.throws(
            // @ts-expect-error — deliberately invalid input.
            () => generateNanoIds({ alphabet: "toString" }),
            /Unknown alphabet/,
        );
    });
});

describe("generateNanoIds — safeEnds", () => {
    it("never starts or ends with '-' or '_'", () => {
        // 2,000 IDs: without safeEnds ~3% of each end would be unsafe.
        for (let i = 0; i < 200; i++) {
            for (const id of generateNanoIds({
                count: MAX_NANOID_COUNT,
                safeEnds: true,
            })) {
                assert.equal(id.length, NANOID_DEFAULT_SIZE);
                assert.match(id, /^[A-Za-z0-9][A-Za-z0-9_-]*[A-Za-z0-9]$/);
            }
        }
    });

    it("still uses '-' and '_' in the middle", () => {
        const middle = generateNanoIds({
            size: NANOID_MAX_SIZE,
            count: MAX_NANOID_COUNT,
            safeEnds: true,
        })
            .map((id) => id.slice(1, -1))
            .join("");
        // P(no '-' in ~2.5k draws) ≈ (63/64)^2530, effectively zero.
        assert.match(middle, /-/);
        assert.match(middle, /_/);
    });

    it("works at the minimum size", () => {
        for (let i = 0; i < 500; i++) {
            const [id] = generateNanoIds({
                size: NANOID_MIN_SIZE,
                safeEnds: true,
            });
            assert.match(id, /^[A-Za-z0-9]{2}$/);
        }
    });

    it("leaves alphabets without '-' or '_' unchanged", () => {
        const [id] = generateNanoIds({ alphabet: "hex", safeEnds: true });
        assert.match(id, /^[0-9a-f]{21}$/);
    });

    it("is available on generateNanoId", () => {
        assert.match(generateNanoId(10, "url", true), /^[A-Za-z0-9].{8}[A-Za-z0-9]$/);
    });

    it("rejects a non-boolean value", () => {
        assert.throws(
            // @ts-expect-error — deliberately invalid input.
            () => generateNanoIds({ safeEnds: "yes" }),
            /safeEnds must be true or false/,
        );
    });
});

describe("nanoIdEntropyBits", () => {
    it("computes size * log2(alphabet length)", () => {
        assert.equal(nanoIdEntropyBits(), 126);
        assert.equal(nanoIdEntropyBits(8, "hex"), 32);
    });

    it("accounts for the smaller edge alphabet with safeEnds", () => {
        // 2 * log2(62) + 19 * log2(64) ≈ 125.91
        const bits = nanoIdEntropyBits(21, "url", true);
        assert.ok(Math.abs(bits - (2 * Math.log2(62) + 19 * 6)) < 1e-9);
        assert.equal(nanoIdEntropyBits(8, "hex", true), 32);
    });
});
