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
    hasClaim,
    KNOWN_CLAIMS,
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
