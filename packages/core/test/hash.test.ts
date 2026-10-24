/**
 * Tests for the message digests (../src/hash.ts).
 *
 * Runner: Node built-in test runner, no dependencies.
 *   node --test test/
 *   pnpm --filter @webtools/core test
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
    computeAllHashes,
    computeHash,
    digest,
    HASH_ALGORITHMS,
    HASH_INFO,
    hmac,
    type HashAlgorithm,
} from "../src/hash.ts";
import { bytesToHex, textToBytes } from "../src/encoding.ts";

const hex = (algorithm: HashAlgorithm, input: string | Uint8Array) =>
    bytesToHex(digest(algorithm, typeof input === "string" ? textToBytes(input) : input));

/** node:crypto names for the cryptographic algorithms. */
const NODE_NAMES: Partial<Record<HashAlgorithm, string>> = {
    md5: "md5",
    sha1: "sha1",
    sha224: "sha224",
    sha256: "sha256",
    sha384: "sha384",
    sha512: "sha512",
    "sha3-256": "sha3-256",
    "sha3-512": "sha3-512",
};

function randomBytes(n: number): Uint8Array {
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i += 65_536) crypto.getRandomValues(bytes.subarray(i, i + 65_536));
    return bytes;
}

describe("published test vectors", () => {
    // RFC 1321 §A.5.
    it("MD5", () => {
        assert.equal(hex("md5", ""), "d41d8cd98f00b204e9800998ecf8427e");
        assert.equal(hex("md5", "a"), "0cc175b9c0f1b6a831c399e269772661");
        assert.equal(hex("md5", "abc"), "900150983cd24fb0d6963f7d28e17f72");
        assert.equal(hex("md5", "message digest"), "f96b697d7cb7938d525a2f31aaf161d0");
        assert.equal(
            hex("md5", "12345678901234567890123456789012345678901234567890123456789012345678901234567890"),
            "57edf4a22be3c955ac49da2e2107b67a",
        );
    });

    // FIPS 180 / NIST CSRC examples.
    const ABC = "abc";
    const TWO_BLOCK = "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq";
    it("SHA-1", () => {
        assert.equal(hex("sha1", ""), "da39a3ee5e6b4b0d3255bfef95601890afd80709");
        assert.equal(hex("sha1", ABC), "a9993e364706816aba3e25717850c26c9cd0d89d");
        assert.equal(hex("sha1", TWO_BLOCK), "84983e441c3bd26ebaae4aa1f95129e5e54670f1");
    });
    it("SHA-224", () => {
        assert.equal(hex("sha224", ABC), "23097d223405d8228642a477bda255b32aadbce4bda0b3f7e36c9da7");
        assert.equal(hex("sha224", ""), "d14a028c2a3a2bc9476102bb288234c415a2b01f828ea62ac5b3e42f");
    });
    it("SHA-256", () => {
        assert.equal(hex("sha256", ""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
        assert.equal(hex("sha256", ABC), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert.equal(hex("sha256", TWO_BLOCK), "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
    });
    it("SHA-384", () => {
        assert.equal(
            hex("sha384", ABC),
            "cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7",
        );
    });
    it("SHA-512", () => {
        assert.equal(
            hex("sha512", ABC),
            "ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f",
        );
        assert.equal(
            hex("sha512", ""),
            "cf83e1357eefb8bdf1542850d66d8007d620e4050b5715dc83f4a921d36ce9ce47d0d13c5d85f2b0ff8318d2877eec2f63b931bd47417a81a538327af927da3e",
        );
    });
    it("SHA3-256", () => {
        assert.equal(hex("sha3-256", ""), "a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a");
        assert.equal(hex("sha3-256", ABC), "3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532");
    });
    it("SHA3-512", () => {
        assert.equal(
            hex("sha3-512", ABC),
            "b751850b1a57168a5693cd924b6b096e08f621827444f70d884f5d0240d2712e10e116e9192af3c91a7ec57647e3934057340b4cf408d5a56592f8274eec53f0",
        );
    });
    it("one million 'a'", () => {
        const million = new Uint8Array(1_000_000).fill(0x61);
        assert.equal(hex("sha1", million), "34aa973cd4c4daa4f61eeb2bdbad27316534016f");
        assert.equal(hex("sha256", million), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
        assert.equal(
            hex("sha512", million),
            "e718483d0ce769644e2e42c7bc15b4638e1f98b13b2044285632a803afa973ebde0ff244877ea60a4cb0432ce577c31beb009c5c2c49aa2e4eadb217ad8cc09b",
        );
        assert.equal(hex("sha3-256", million), "5c8875ae474a3634ba4fd55ec85bffd661f32aca75c6d699d0cdcb6c115891c1");
    });
    it("CRC-32", () => {
        assert.equal(hex("crc32", ""), "00000000");
        assert.equal(hex("crc32", "123456789"), "cbf43926");
        assert.equal(hex("crc32", "The quick brown fox jumps over the lazy dog"), "414fa339");
    });
});

describe("matches node:crypto", () => {
    // Lengths around every padding boundary for 64-, 72-, 128- and 136-byte blocks.
    const lengths = [0, 1, 3, 54, 55, 56, 57, 63, 64, 65, 71, 72, 73, 111, 112, 113, 119, 120, 127, 128, 129, 135, 136, 137, 200, 1000, 4097];
    for (const [algorithm, nodeName] of Object.entries(NODE_NAMES) as [HashAlgorithm, string][]) {
        it(algorithm, () => {
            for (const length of lengths) {
                const bytes = randomBytes(length);
                assert.equal(hex(algorithm, bytes), createHash(nodeName).update(bytes).digest("hex"), `length ${length}`);
            }
        });
    }
    it("CRC-32 matches zlib's gzip trailer", () => {
        for (const length of lengths) {
            const bytes = randomBytes(length);
            // zlib's crc32 isn't exported everywhere; the gzip trailer carries it.
            const gz = gzipSync(bytes);
            const trailer = gz.subarray(gz.length - 8, gz.length - 4);
            const expected = bytesToHex(Uint8Array.from(trailer).reverse());
            assert.equal(hex("crc32", bytes), expected, `length ${length}`);
        }
    });
});

describe("HMAC", () => {
    // RFC 4231 test cases 1, 2 and 6 (key longer than the block).
    it("RFC 4231", () => {
        const key1 = new Uint8Array(20).fill(0x0b);
        const data1 = textToBytes("Hi There");
        assert.equal(
            bytesToHex(hmac("sha256", key1, data1)),
            "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7",
        );
        assert.equal(
            bytesToHex(hmac("sha512", key1, data1)),
            "87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854",
        );
        assert.equal(
            bytesToHex(hmac("sha256", textToBytes("Jefe"), textToBytes("what do ya want for nothing?"))),
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
        );
        const key6 = new Uint8Array(131).fill(0xaa);
        assert.equal(
            bytesToHex(hmac("sha256", key6, textToBytes("Test Using Larger Than Block-Size Key - Hash Key First"))),
            "60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54",
        );
    });
    // RFC 2202.
    it("RFC 2202", () => {
        assert.equal(
            bytesToHex(hmac("md5", textToBytes("Jefe"), textToBytes("what do ya want for nothing?"))),
            "750c783e6ab0b503eaa86e310a5db738",
        );
        assert.equal(
            bytesToHex(hmac("sha1", textToBytes("Jefe"), textToBytes("what do ya want for nothing?"))),
            "effcdf6ae5eb2fa2d27416d5f184df9c259a7c79",
        );
    });
    it("matches node:crypto for every algorithm and key size", () => {
        for (const [algorithm, nodeName] of Object.entries(NODE_NAMES) as [HashAlgorithm, string][]) {
            for (const keyLength of [0, 16, HASH_INFO[algorithm].blockBytes, HASH_INFO[algorithm].blockBytes + 1, 300]) {
                const key = randomBytes(keyLength);
                const data = randomBytes(100);
                assert.equal(
                    bytesToHex(hmac(algorithm, key, data)),
                    createHmac(nodeName, key).update(data).digest("hex"),
                    `${algorithm}, key ${keyLength}`,
                );
            }
        }
    });
    it("refuses CRC-32", () => {
        assert.throws(() => hmac("crc32", new Uint8Array(1), new Uint8Array(1)), /checksum/);
    });
});

describe("computeHash", () => {
    it("hashes UTF-8 text", () => {
        assert.deepEqual(computeHash({ algorithm: "sha256", input: "héllo 👋" }), {
            algorithm: "sha256",
            hmac: false,
            digest: createHash("sha256").update("héllo 👋").digest("hex"),
            format: "hex",
            bits: 256,
            inputBytes: 11,
        });
    });
    it("reads hex input", () => {
        assert.equal(computeHash({ algorithm: "md5", input: "61 62 63", inputFormat: "hex" }).digest, "900150983cd24fb0d6963f7d28e17f72");
    });
    it("formats the digest", () => {
        assert.equal(computeHash({ algorithm: "md5", input: "abc", uppercase: true }).digest, "900150983CD24FB0D6963F7D28E17F72");
        assert.equal(
            computeHash({ algorithm: "sha256", input: "abc", outputFormat: "base64" }).digest,
            "ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=",
        );
    });
    it("computes HMACs with text or hex keys", () => {
        const result = computeHash({ algorithm: "sha256", input: "Hi There", hmacKey: "0b".repeat(20), hmacKeyFormat: "hex" });
        assert.equal(result.hmac, true);
        assert.equal(result.digest, "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7");
        // An empty key is still an HMAC.
        assert.equal(
            computeHash({ algorithm: "sha1", input: "x", hmacKey: "" }).digest,
            createHmac("sha1", "").update("x").digest("hex"),
        );
    });
    it("rejects bad requests with readable messages", () => {
        assert.throws(() => computeHash({ algorithm: "sha0" as HashAlgorithm, input: "" }), /Unknown hash algorithm: sha0/);
        assert.throws(() => computeHash({ algorithm: "md5", input: "abc", inputFormat: "hex" }), /even number|hex digit/);
        assert.throws(() => computeHash({ algorithm: "md5", input: "", outputFormat: "b32" as "hex" }), /output format/);
        assert.throws(() => computeHash({ algorithm: "crc32", input: "", hmacKey: "k" }), /checksum/);
        assert.throws(() => computeHash({ algorithm: "md5", input: "", hmacKey: "zz", hmacKeyFormat: "hex" }), /HMAC key/);
        assert.throws(() => computeHash({ algorithm: "md5", input: "12345", maxBytes: 4 }), /too large/);
    });
});

describe("computeAllHashes", () => {
    it("returns every algorithm in order", () => {
        const result = computeAllHashes({ input: "abc" });
        assert.deepEqual(result.hashes.map((h) => h.algorithm), HASH_ALGORITHMS);
        assert.equal(result.hashes.find((h) => h.algorithm === "md5")?.digest, "900150983cd24fb0d6963f7d28e17f72");
        assert.equal(result.inputBytes, 3);
    });
    it("leaves checksums out of HMAC", () => {
        const result = computeAllHashes({ input: "abc", hmacKey: "key" });
        assert.equal(result.hmac, true);
        assert.ok(!result.hashes.some((h) => h.algorithm === "crc32"));
        assert.equal(result.hashes.length, HASH_ALGORITHMS.length - 1);
    });
});
