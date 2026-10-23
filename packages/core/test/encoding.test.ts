/**
 * Tests for the base64 / base32 / base58 codecs (../src/encoding.ts).
 *
 * Runner: Node built-in test runner, no dependencies.
 *   node --test test/
 *   pnpm --filter @webtools/core test
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    bytesToHex,
    bytesToText,
    convertEncoding,
    decodeBase32,
    decodeBase58,
    decodeBase64,
    encodeBase32,
    encodeBase58,
    encodeBase64,
    hexToBytes,
    MAX_BASE58_BYTES,
    MAX_ENCODING_BYTES,
    textToBytes,
} from "../src/encoding.ts";

const ascii = (s: string) => textToBytes(s);
const str = (b: Uint8Array) => new TextDecoder().decode(b);

function randomBytes(n: number): Uint8Array {
    const bytes = new Uint8Array(n);
    // getRandomValues fills at most 65,536 bytes per call.
    for (let i = 0; i < n; i += 65_536) {
        crypto.getRandomValues(bytes.subarray(i, i + 65_536));
    }
    return bytes;
}

// RFC 4648 §10 test vectors.
const RFC_BASE64: [string, string][] = [
    ["", ""],
    ["f", "Zg=="],
    ["fo", "Zm8="],
    ["foo", "Zm9v"],
    ["foob", "Zm9vYg=="],
    ["fooba", "Zm9vYmE="],
    ["foobar", "Zm9vYmFy"],
];

const RFC_BASE32: [string, string][] = [
    ["", ""],
    ["f", "MY======"],
    ["fo", "MZXQ===="],
    ["foo", "MZXW6==="],
    ["foob", "MZXW6YQ="],
    ["fooba", "MZXW6YTB"],
    ["foobar", "MZXW6YTBOI======"],
];

describe("hex helpers", () => {
    it("round-trips bytes", () => {
        const bytes = randomBytes(64);
        assert.deepEqual(hexToBytes(bytesToHex(bytes)), bytes);
    });

    it("accepts 0x, whitespace, colons and dashes", () => {
        assert.deepEqual(hexToBytes("0xDE AD:be-ef"), new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    });

    it("rejects bad hex", () => {
        assert.throws(() => hexToBytes("abc"), /even number of digits, got 3/);
        assert.throws(() => hexToBytes("zz"), /'z' is not a hex digit \(position 1\)/);
    });

    it("tells UTF-8 text from binary", () => {
        assert.equal(bytesToText(ascii("héllo ✓")), "héllo ✓");
        assert.equal(bytesToText(new Uint8Array([0xff, 0xfe])), null);
    });
});

describe("base64", () => {
    for (const [plain, encoded] of RFC_BASE64) {
        it(`encodes and decodes ${JSON.stringify(plain)}`, () => {
            assert.equal(encodeBase64(ascii(plain)), encoded);
            assert.equal(str(decodeBase64(encoded)), plain);
        });
    }

    it("matches the platform encoder on random bytes", () => {
        for (let n = 0; n < 50; n++) {
            const bytes = randomBytes(n);
            const expected = btoa(String.fromCharCode(...bytes));
            assert.equal(encodeBase64(bytes), expected);
            assert.deepEqual(decodeBase64(expected), bytes);
        }
    });

    it("supports the URL-safe alphabet and no padding", () => {
        const bytes = new Uint8Array([0xfb, 0xff, 0xbf]);
        assert.equal(encodeBase64(bytes), "+/+/");
        assert.equal(encodeBase64(bytes, { urlSafe: true }), "-_-_");
        assert.equal(encodeBase64(ascii("f"), { padding: false }), "Zg");
    });

    it("decodes leniently: either alphabet, no padding, whitespace", () => {
        assert.deepEqual(decodeBase64("-_-_"), new Uint8Array([0xfb, 0xff, 0xbf]));
        assert.equal(str(decodeBase64("Zm9v\nYg")), "foob");
        assert.equal(str(decodeBase64("  Zm9vYmE= \r\n")), "fooba");
    });

    it("decodes large input without overflowing", () => {
        const bytes = randomBytes(100_000);
        assert.deepEqual(decodeBase64(encodeBase64(bytes)), bytes);
    });

    it("rejects invalid input with a position", () => {
        assert.throws(() => decodeBase64("Zm9v!"), /'!' is not in the alphabet \(position 5\)/);
        assert.throws(() => decodeBase64("Zg==Zg"), /after the '=' padding \(position 3\)/);
        assert.throws(() => decodeBase64("Zm9vY"), /length is not valid/);
        assert.throws(() => decodeBase64("Zh=="), /non-zero unused bits/);
    });
});

describe("base32", () => {
    for (const [plain, encoded] of RFC_BASE32) {
        it(`encodes and decodes ${JSON.stringify(plain)}`, () => {
            assert.equal(encodeBase32(ascii(plain)), encoded);
            assert.equal(str(decodeBase32(encoded)), plain);
        });
    }

    it("can omit padding", () => {
        assert.equal(encodeBase32(ascii("f"), { padding: false }), "MY");
    });

    it("decodes leniently: lower case, no padding, whitespace", () => {
        assert.equal(str(decodeBase32("mzxw6\nytboi")), "foobar");
    });

    it("encodes Crockford without padding", () => {
        // Same bits as RFC 4648, different alphabet.
        assert.equal(encodeBase32(ascii("foobar"), { variant: "crockford" }), "CSQPYRK1E8");
        assert.equal(
            encodeBase32(ascii("f"), { variant: "crockford", padding: true }),
            "CR",
        );
    });

    it("decodes Crockford leniently: O→0, I/L→1, hyphens, lower case", () => {
        const bytes = decodeBase32("csqp-yrk1-e8", { variant: "crockford" });
        assert.equal(str(bytes), "foobar");
        // 8 characters = 40 bits = 5 whole bytes, no unused bits.
        const one = new Uint8Array([0, 0, 0, 0, 1]);
        assert.deepEqual(decodeBase32("OOOOOOOI", { variant: "crockford" }), one);
        assert.deepEqual(decodeBase32("0000000L", { variant: "crockford" }), one);
        assert.deepEqual(decodeBase32("0000000i", { variant: "crockford" }), one);
    });

    it("round-trips random bytes in both variants", () => {
        for (let n = 0; n < 40; n++) {
            const bytes = randomBytes(n);
            assert.deepEqual(decodeBase32(encodeBase32(bytes)), bytes);
            const crockford = encodeBase32(bytes, { variant: "crockford" });
            assert.deepEqual(decodeBase32(crockford, { variant: "crockford" }), bytes);
        }
    });

    it("rejects invalid input with a position", () => {
        assert.throws(() => decodeBase32("MZXW1"), /'1' is not in the alphabet \(position 5\)/);
        assert.throws(() => decodeBase32("MZXU", { variant: "crockford" }), /'U' is not in the alphabet/);
        assert.throws(() => decodeBase32("M"), /length is not valid/);
        assert.throws(() => decodeBase32("MZ======"), /non-zero unused bits/);
    });
});

describe("base58", () => {
    const VECTORS: [string, string][] = [
        ["", ""],
        ["61", "2g"],
        ["626262", "a3gV"],
        ["636363", "aPEr"],
        ["00000000000000000000", "1111111111"],
        ["00eb15231dfceb60925886b67d065299925915aeb172c06647", "1NS17iag9jJgTHD1VXjvLCEnZuQ3rJDE9L"],
        ["516b6fcd0f", "ABnLTmg"],
        ["572e4794", "3EFU7m"],
        ["10c8511e", "Rt5zm"],
    ];

    for (const [hex, encoded] of VECTORS) {
        it(`encodes and decodes 0x${hex || "(empty)"}`, () => {
            assert.equal(encodeBase58(hexToBytes(hex)), encoded);
            assert.equal(bytesToHex(decodeBase58(encoded)), hex);
        });
    }

    it("encodes text", () => {
        assert.equal(encodeBase58(ascii("Hello World!")), "2NEpo7TZRRrLZSi2U");
    });

    it("round-trips random bytes, including leading zeros", () => {
        for (let n = 0; n < 60; n++) {
            const bytes = randomBytes(n);
            if (n > 2) bytes[0] = bytes[1] = 0;
            assert.deepEqual(decodeBase58(encodeBase58(bytes)), bytes);
        }
    });

    it("ignores whitespace and rejects look-alikes", () => {
        assert.equal(str(decodeBase58(" 2NEpo7TZ\nRRrLZSi2U ")), "Hello World!");
        assert.throws(() => decodeBase58("2NE0"), /'0' is not in the alphabet \(position 4\)/);
        assert.throws(() => decodeBase58("abl"), /'l' is not in the alphabet \(position 3\)/);
    });
});

describe("convertEncoding", () => {
    it("encodes text and reports its size", () => {
        assert.deepEqual(
            convertEncoding({ encoding: "base64", operation: "encode", input: "héllo" }),
            { encoding: "base64", operation: "encode", output: "aMOpbGxv", inputBytes: 6 },
        );
    });

    it("encodes hex input", () => {
        const result = convertEncoding({
            encoding: "base58",
            operation: "encode",
            input: "00 eb 15",
            inputFormat: "hex",
        });
        assert.equal(result.operation === "encode" && result.output, encodeBase58(hexToBytes("00eb15")));
    });

    it("passes options through", () => {
        const url = convertEncoding({
            encoding: "base64",
            operation: "encode",
            input: "fbffbf",
            inputFormat: "hex",
            options: { urlSafe: true, padding: false },
        });
        assert.equal(url.operation === "encode" && url.output, "-_-_");
        const crockford = convertEncoding({
            encoding: "base32",
            operation: "encode",
            input: "foobar",
            options: { variant: "crockford" },
        });
        assert.equal(crockford.operation === "encode" && crockford.output, "CSQPYRK1E8");
    });

    it("decodes to text and hex", () => {
        assert.deepEqual(
            convertEncoding({ encoding: "base32", operation: "decode", input: "MZXW6===" }),
            { encoding: "base32", operation: "decode", text: "foo", hex: "666f6f", bytes: 3 },
        );
    });

    it("returns text: null for binary output", () => {
        const result = convertEncoding({ encoding: "base64", operation: "decode", input: "//79" });
        assert.equal(result.operation === "decode" && result.text, null);
        assert.equal(result.operation === "decode" && result.hex, "fffefd");
    });

    it("enforces the size limits", () => {
        assert.throws(
            () =>
                convertEncoding({
                    encoding: "base58",
                    operation: "encode",
                    input: "a".repeat(MAX_BASE58_BYTES + 1),
                }),
            /exceeds the 4096-byte limit for Base58/,
        );
        assert.throws(
            () =>
                convertEncoding({
                    encoding: "base58",
                    operation: "decode",
                    input: "2".repeat(MAX_BASE58_BYTES * 2),
                }),
            /limit for Base58/,
        );
        assert.throws(
            () =>
                convertEncoding({
                    encoding: "base64",
                    operation: "encode",
                    input: "a".repeat(MAX_ENCODING_BYTES + 1),
                }),
            /limit for Base64/,
        );
    });

    it("does not count padding or whitespace towards the limit", () => {
        const bytes = randomBytes(MAX_ENCODING_BYTES);
        const encoded = encodeBase64(bytes).replace(/(.{76})/g, "$1\n");
        const result = convertEncoding({ encoding: "base64", operation: "decode", input: encoded });
        assert.equal(result.operation === "decode" && result.bytes, MAX_ENCODING_BYTES);
    });

    it("accepts a tighter maxBytes", () => {
        const request = { encoding: "base32", operation: "encode", input: "abcde" } as const;
        assert.doesNotThrow(() => convertEncoding({ ...request, maxBytes: 5 }));
        assert.throws(
            () => convertEncoding({ ...request, maxBytes: 4 }),
            /5 bytes exceeds the 4-byte limit for Base32/,
        );
    });

    it("encodes the largest base58 input quickly", () => {
        const start = performance.now();
        const bytes = randomBytes(MAX_BASE58_BYTES);
        assert.deepEqual(decodeBase58(encodeBase58(bytes)), bytes);
        assert.ok(performance.now() - start < 2_000);
    });

    it("rejects unknown options", () => {
        const base = { encoding: "base64", operation: "encode", input: "x" } as const;
        assert.throws(
            // @ts-expect-error — deliberately invalid input.
            () => convertEncoding({ ...base, encoding: "base16" }),
            /Unknown encoding: base16/,
        );
        assert.throws(
            // @ts-expect-error — deliberately invalid input.
            () => convertEncoding({ ...base, operation: "reverse" }),
            /Unknown operation: reverse/,
        );
        assert.throws(
            // @ts-expect-error — deliberately invalid input.
            () => convertEncoding({ ...base, inputFormat: "binary" }),
            /Unknown input format: binary/,
        );
        assert.throws(
            // @ts-expect-error — deliberately invalid input.
            () => convertEncoding({ ...base, options: { variant: "zbase32" } }),
            /Unknown Base32 variant: zbase32/,
        );
        assert.throws(
            // @ts-expect-error — deliberately invalid input.
            () => convertEncoding({ ...base, options: { padding: "no" } }),
            /padding must be true or false/,
        );
    });
});
