/**
 * Tests for HOTP / TOTP and otpauth:// URIs (../src/totp.ts).
 *
 * Runner: Node built-in test runner, no dependencies.
 *   node --test test/
 *   pnpm --filter @webtools/core test
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    buildOtpauthUri,
    decodeTotpSecret,
    generateTotpSecret,
    hotp,
    hotpDetails,
    parseOtpauthUri,
    totp,
    totpCounter,
    totpSecondsRemaining,
    verifyTotp,
    type TotpAlgorithm,
} from "../src/totp.ts";
import { bytesToHex, textToBytes } from "../src/encoding.ts";

// RFC 6238 Appendix B uses a different ASCII seed per algorithm.
const SEEDS: Record<TotpAlgorithm, Uint8Array> = {
    sha1: textToBytes("12345678901234567890"),
    sha256: textToBytes("12345678901234567890123456789012"),
    sha512: textToBytes("1234567890123456789012345678901234567890123456789012345678901234"),
};

describe("hotp (RFC 4226 Appendix D)", () => {
    const expected = [
        "755224", "287082", "359152", "969429", "338314",
        "254676", "287922", "162583", "399871", "520489",
    ];
    for (const [counter, code] of expected.entries()) {
        it(`counter ${counter} → ${code}`, () => {
            assert.equal(hotp(SEEDS.sha1, counter), code);
        });
    }

    it("exposes the intermediate values for counter 0", () => {
        const d = hotpDetails(SEEDS.sha1, 0);
        assert.equal(bytesToHex(d.counterBytes), "0000000000000000");
        assert.equal(bytesToHex(d.hmac), "cc93cf18508d94934c64b65d8ba7667fb7cde4b0");
        assert.equal(d.offset, 0);
        assert.equal(d.binary, 0x4c93cf18);
        assert.equal(d.code, "755224");
    });

    it("encodes counters above 2^32", () => {
        assert.equal(bytesToHex(hotpDetails(SEEDS.sha1, 2 ** 32 + 1).counterBytes), "0000000100000001");
    });

    it("rejects bad options", () => {
        assert.throws(() => hotp(SEEDS.sha1, -1));
        assert.throws(() => hotp(SEEDS.sha1, 0, { digits: 5 }));
        assert.throws(() => hotp(SEEDS.sha1, 0, { digits: 9 }));
        assert.throws(() => hotp(SEEDS.sha1, 0, { algorithm: "md5" as TotpAlgorithm }));
    });
});

describe("totp (RFC 6238 Appendix B)", () => {
    const rows: [number, string, string, string][] = [
        [59, "94287082", "46119246", "90693936"],
        [1111111109, "07081804", "68084774", "25091201"],
        [1111111111, "14050471", "67062674", "99943326"],
        [1234567890, "89005924", "91819424", "93441116"],
        [2000000000, "69279037", "90698825", "38618901"],
        [20000000000, "65353130", "77737706", "47863826"],
    ];
    for (const [time, sha1, sha256, sha512] of rows) {
        it(`T=${time}`, () => {
            assert.equal(totp(SEEDS.sha1, { time, digits: 8 }), sha1);
            assert.equal(totp(SEEDS.sha256, { time, digits: 8, algorithm: "sha256" }), sha256);
            assert.equal(totp(SEEDS.sha512, { time, digits: 8, algorithm: "sha512" }), sha512);
        });
    }

    it("computes the counter and the time left", () => {
        assert.equal(totpCounter(59), 1);
        assert.equal(totpCounter(60), 2);
        assert.equal(totpCounter(59, 60), 0);
        assert.equal(totpSecondsRemaining(59), 1);
        assert.equal(totpSecondsRemaining(60), 30);
    });
});

describe("verifyTotp", () => {
    const time = 1111111111; // step 37037037
    const at = (offset: number) => totp(SEEDS.sha1, { time: time + offset });

    it("accepts the current, previous and next codes", () => {
        assert.deepEqual(verifyTotp(SEEDS.sha1, at(0), { time }), { counter: 37037037, delta: 0 });
        assert.deepEqual(verifyTotp(SEEDS.sha1, at(-30), { time }), { counter: 37037036, delta: -1 });
        assert.deepEqual(verifyTotp(SEEDS.sha1, at(30), { time }), { counter: 37037038, delta: 1 });
    });

    it("rejects codes outside the window", () => {
        assert.equal(verifyTotp(SEEDS.sha1, at(-60), { time }), null);
        assert.equal(verifyTotp(SEEDS.sha1, at(-30), { time, window: 0 }), null);
        assert.deepEqual(verifyTotp(SEEDS.sha1, at(-60), { time, window: 2 })?.delta, -2);
    });

    it("ignores spaces and rejects wrong lengths", () => {
        const code = at(0);
        assert.ok(verifyTotp(SEEDS.sha1, `${code.slice(0, 3)} ${code.slice(3)}`, { time }));
        assert.equal(verifyTotp(SEEDS.sha1, code.slice(1), { time }), null);
        assert.equal(verifyTotp(SEEDS.sha1, "", { time }), null);
    });
});

describe("secrets", () => {
    it("generates 160-bit Base32 secrets by default", () => {
        const secret = generateTotpSecret();
        assert.match(secret, /^[A-Z2-7]{32}$/);
        assert.equal(decodeTotpSecret(secret).length, 20);
        assert.notEqual(generateTotpSecret(), secret);
    });

    it("decodes leniently, like authenticator apps", () => {
        const expected = bytesToHex(textToBytes("Hello!"));
        assert.equal(bytesToHex(decodeTotpSecret("JBSWY3DPEE")), expected);
        assert.equal(bytesToHex(decodeTotpSecret("jbsw y3dp-ee======")), expected);
        // 16 characters = 80 bits = 10 bytes, the classic demo secret.
        assert.equal(decodeTotpSecret("JBSWY3DPEHPK3PXP").length, 10);
    });

    it("rejects invalid secrets", () => {
        assert.throws(() => decodeTotpSecret(""), /empty/);
        assert.throws(() => decodeTotpSecret("ABC1"), /'1'/);
        assert.throws(() => decodeTotpSecret("A"), /too short/);
    });
});

describe("otpauth URIs", () => {
    it("builds the minimal URI with defaults left out", () => {
        assert.equal(
            buildOtpauthUri({ secret: "jbsw y3dp ehpk 3pxp", issuer: "WebTools", account: "alice@example.com" }),
            "otpauth://totp/WebTools:alice%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=WebTools",
        );
    });

    it("writes non-default parameters", () => {
        assert.equal(
            buildOtpauthUri({ secret: "JBSWY3DPEHPK3PXP", account: "bob", algorithm: "sha256", digits: 8, period: 60 }),
            "otpauth://totp/bob?secret=JBSWY3DPEHPK3PXP&algorithm=SHA256&digits=8&period=60",
        );
    });

    it("round-trips", () => {
        const params = {
            secret: "JBSWY3DPEHPK3PXP",
            issuer: "ACME Co",
            account: "jane doe",
            algorithm: "sha512" as const,
            digits: 8,
            period: 30,
        };
        assert.deepEqual(parseOtpauthUri(buildOtpauthUri(params)), params);
    });

    it("prefers the issuer parameter and tolerates a bare label", () => {
        const p = parseOtpauthUri("otpauth://totp/Old:me?secret=JBSWY3DPEHPK3PXP&issuer=New");
        assert.equal(p.issuer, "New");
        assert.equal(p.account, "me");
        const q = parseOtpauthUri("otpauth://totp/me?secret=JBSWY3DPEHPK3PXP");
        assert.equal(q.issuer, "");
        assert.equal(q.algorithm, "sha1");
    });

    it("explains what is wrong", () => {
        assert.throws(() => parseOtpauthUri("https://example.com"), /Not an otpauth/);
        assert.throws(() => parseOtpauthUri("otpauth://hotp/x?secret=AAAA&counter=1"), /HOTP/);
        assert.throws(() => parseOtpauthUri("otpauth://totp/x"), /no secret/);
        assert.throws(() => parseOtpauthUri("otpauth://totp/x?secret=AAAAAAAA&algorithm=MD5"), /MD5/);
        assert.throws(() => parseOtpauthUri("otpauth://totp/x?secret=AAAAAAAA&digits=4"), /Digits/);
    });
});
