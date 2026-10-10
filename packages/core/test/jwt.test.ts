/**
 * Tests for `decodeJWT` and the known-claim helpers (../src/jwt.ts).
 *
 * Runner: Node built-in test runner, no dependencies.
 *   node --test test/
 *   pnpm --filter @webtools/core test
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    customPayloadClaims,
    decodeJWT,
    describeExpiry,
    formatUtcDateTime,
    hasClaim,
    KNOWN_CLAIMS,
    relativeDuration,
    timeClaimTexts,
    verboseDuration,
} from "../src/jwt.ts";

/** Build a JWT from JSON header / payload with a fake signature. */
function mkToken(
    header: Record<string, unknown>,
    payload: Record<string, unknown>,
    signature = "sig",
): string {
    const b64 = (obj: Record<string, unknown>) =>
        Buffer.from(JSON.stringify(obj), "utf-8")
            .toString("base64")
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, "");
    return `${b64(header)}.${b64(payload)}.${signature}`;
}

describe("decodeJWT - valid tokens", () => {
    it("decodes an HS256 token", () => {
        // Canonical jwt.io sample.
        const token =
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
            "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ." +
            "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
        const decoded = decodeJWT(token);
        assert.deepEqual(decoded.header.json, { alg: "HS256", typ: "JWT" });
        assert.deepEqual(decoded.payload.json, {
            sub: "1234567890",
            name: "John Doe",
            iat: 1516239022,
        });
        assert.equal(
            decoded.signature,
            "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c",
        );
        assert.equal(decoded.claims, decoded.payload.json);
    });

    it("decodes aud as an array", () => {
        const token = mkToken({ alg: "RS256" }, {
            iss: "https://issuer.example",
            aud: ["a", "b"],
            exp: 9999999999,
        });
        const decoded = decodeJWT(token);
        assert.deepEqual(decoded.payload.json.aud, ["a", "b"]);
    });

    it("decodes a token with UTF-8 claims", () => {
        const token = mkToken({ alg: "HS256" }, {
            name: "Zoë — 中文 — café",
            emoji: "👩‍💻",
        });
        const decoded = decodeJWT(token);
        assert.equal(decoded.payload.json.name, "Zoë — 中文 — café");
        assert.equal(decoded.payload.json.emoji, "👩‍💻");
    });

    it("accepts an empty signature segment", () => {
        const token = mkToken({ alg: "none" }, { sub: "anon" }, "");
        const decoded = decodeJWT(token);
        assert.equal(decoded.signature, "");
        assert.equal(decoded.header.json.alg, "none");
    });

    it("trims surrounding whitespace", () => {
        const token = "   " +
            mkToken({ alg: "HS256" }, { sub: "x" }) +
            "\n";
        const decoded = decodeJWT(token);
        assert.equal(decoded.payload.json.sub, "x");
    });
});

describe("decodeJWT - invalid input", () => {
    it("rejects empty input", () => {
        assert.throws(() => decodeJWT(""), /Empty token/);
    });

    it("rejects wrong segment count", () => {
        assert.throws(() => decodeJWT("a.b"), /3 dot-separated segments/);
        assert.throws(() => decodeJWT("a.b.c.d"), /3 dot-separated segments/);
    });

    it("rejects empty header segment", () => {
        assert.throws(
            () => decodeJWT(".eyJzdWIiOiJhIn0.sig"),
            /header segment is empty/,
        );
    });

    it("rejects empty payload segment", () => {
        assert.throws(
            () => decodeJWT("eyJhbGciOiJIUzI1NiJ9..sig"),
            /payload segment is empty/,
        );
    });

    it("rejects non-base64url characters", () => {
        assert.throws(
            () => decodeJWT("***.eyJzdWIiOiJhIn0.sig"),
            /not valid base64url/,
        );
    });

    it("rejects non-JSON payload", () => {
        // "not json" base64url-encoded.
        const bad = Buffer.from("not json", "utf-8").toString("base64url");
        const token = `${
            Buffer.from('{"alg":"HS256"}', "utf-8").toString("base64url")
        }.${bad}.sig`;
        assert.throws(() => decodeJWT(token), /payload is not valid JSON/);
    });

    it("rejects payload that decodes to a non-object", () => {
        const b64 = (s: string) =>
            Buffer.from(s, "utf-8").toString("base64url");
        const token = `${b64('{"alg":"HS256"}')}.${b64("[1,2,3]")}.sig`;
        assert.throws(
            () => decodeJWT(token),
            /payload must decode to a JSON object/,
        );
    });
});

describe("hasClaim", () => {
    const token = mkToken(
        { alg: "HS256", typ: "JWT" },
        { iss: "https://x", sub: "u", iat: 1 },
    );

    it("returns true when a payload claim is present", () => {
        const decoded = decodeJWT(token);
        const iss = KNOWN_CLAIMS.find((c) => c.key === "iss")!;
        assert.equal(hasClaim(decoded, iss), true);
    });

    it("returns false when a payload claim is missing", () => {
        const decoded = decodeJWT(token);
        const aud = KNOWN_CLAIMS.find((c) => c.key === "aud")!;
        assert.equal(hasClaim(decoded, aud), false);
    });

    it("looks up header claims in the header segment", () => {
        const decoded = decodeJWT(token);
        const alg = KNOWN_CLAIMS.find((c) => c.key === "alg")!;
        const kid = KNOWN_CLAIMS.find((c) => c.key === "kid")!;
        assert.equal(hasClaim(decoded, alg), true);
        assert.equal(hasClaim(decoded, kid), false);
    });
});

describe("customPayloadClaims", () => {
    it("returns payload keys not in the registered or common lists", () => {
        const token = mkToken({ alg: "HS256" }, {
            iss: "x",
            sub: "y",
            tenant_id: "abc",
            roles: ["admin"],
        });
        const decoded = decodeJWT(token);
        assert.deepEqual(customPayloadClaims(decoded), ["tenant_id", "roles"]);
    });

    it("returns an empty array when every claim is well-known", () => {
        const token = mkToken({ alg: "HS256" }, { iss: "x", sub: "y", iat: 1 });
        const decoded = decodeJWT(token);
        assert.deepEqual(customPayloadClaims(decoded), []);
    });
});

// Reference moment for all expiry/time tests: 2024-06-15 12:00:00 UTC.
const NOW = new Date("2024-06-15T12:00:00Z");
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

describe("formatUtcDateTime", () => {
    it("renders a Unix timestamp in UTC with weekday and seconds", () => {
        // 2024-01-14 08:17:02 UTC
        const text = formatUtcDateTime(1705220222);
        // We don't lock down the exact punctuation across ICU versions,
        // but the salient parts must all appear.
        assert.match(text, /Sunday/);
        assert.match(text, /14 January 2024/);
        assert.match(text, /08:17:02/);
        assert.match(text, /UTC/);
    });
});

describe("relativeDuration", () => {
    it("rounds to the largest unit for positive deltas", () => {
        assert.equal(relativeDuration(1), "1 second");
        assert.equal(relativeDuration(60), "1 minute");
        assert.equal(relativeDuration(90), "1 minute");
        assert.equal(relativeDuration(3600), "1 hour");
        assert.equal(relativeDuration(60 * 60 * 24 * 3), "3 days");
    });

    it("appends 'ago' for negative deltas", () => {
        assert.equal(relativeDuration(-1), "1 second ago");
        assert.equal(relativeDuration(-60 * 60 * 2), "2 hours ago");
        assert.equal(
            relativeDuration(-60 * 60 * 24 * 365 * 2),
            "2 years ago",
        );
    });
});

describe("verboseDuration", () => {
    it("joins every non-zero unit with commas and an 'and'", () => {
        const total = 2 * 86400 + 3 * 3600 + 4 * 60 + 34;
        assert.equal(
            verboseDuration(total),
            "2 days, 3 hours, 4 minutes and 34 seconds",
        );
    });

    it("skips zero units", () => {
        assert.equal(verboseDuration(3600 + 1), "1 hour and 1 second");
        assert.equal(verboseDuration(3600), "1 hour");
    });

    it("handles the sub-second edge case", () => {
        assert.equal(verboseDuration(0), "a moment");
        assert.equal(verboseDuration(-5), "a moment");
    });
});

describe("timeClaimTexts", () => {
    it("adds `<claim>-text` siblings for every known time claim", () => {
        const texts = timeClaimTexts({
            iat: 1705220222,
            exp: 1705220222 + 3600,
            nbf: 1705220222 - 60,
            auth_time: 1705220000,
            sub: "ignored",
        });
        assert.deepEqual(Object.keys(texts).sort(), [
            "auth_time-text",
            "exp-text",
            "iat-text",
            "nbf-text",
        ]);
        assert.match(texts["iat-text"], /14 January 2024/);
    });

    it("skips non-numeric values silently", () => {
        const texts = timeClaimTexts({ iat: "not a number", exp: null });
        assert.deepEqual(texts, {});
    });
});

describe("describeExpiry", () => {
    it("flags a token as valid when exp is in the future", () => {
        const status = describeExpiry(
            { exp: NOW_SEC + 3600, iat: NOW_SEC - 60 },
            NOW,
        );
        assert.equal(status.state, "valid");
        assert.equal(status.secondsUntilExpiry, 3600);
        assert.equal(status.message, "Token will expire in 1 hour.");
    });

    it("uses a verbose multi-unit message for complex durations", () => {
        const delta = 2 * 86400 + 3 * 3600 + 4 * 60 + 34;
        const status = describeExpiry({ exp: NOW_SEC + delta }, NOW);
        assert.equal(status.state, "valid");
        assert.equal(
            status.message,
            "Token will expire in 2 days, 3 hours, 4 minutes and 34 seconds.",
        );
    });

    it("flags a token as expired when exp is in the past", () => {
        const status = describeExpiry({ exp: NOW_SEC - 7200 }, NOW);
        assert.equal(status.state, "expired");
        assert.equal(status.secondsUntilExpiry, -7200);
        assert.equal(status.message, "Token expired 2 hours ago.");
    });

    it("flags a token as not_yet_valid when nbf is in the future", () => {
        const status = describeExpiry(
            { nbf: NOW_SEC + 600, exp: NOW_SEC + 7200 },
            NOW,
        );
        assert.equal(status.state, "not_yet_valid");
        assert.equal(status.secondsUntilExpiry, 7200);
        assert.equal(
            status.message,
            "Token is not yet valid; becomes valid in 10 minutes.",
        );
    });

    it("reports no_expiry when exp is absent", () => {
        const status = describeExpiry({ iat: NOW_SEC - 60 }, NOW);
        assert.equal(status.state, "no_expiry");
        assert.equal(status.exp, null);
        assert.equal(status.secondsUntilExpiry, null);
        assert.match(status.message, /no 'exp' claim/);
    });

    it("ignores non-numeric exp/nbf values", () => {
        const status = describeExpiry(
            { exp: "not a number", nbf: null },
            NOW,
        );
        assert.equal(status.state, "no_expiry");
    });
});
