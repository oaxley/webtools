/**
 * JWT decoder — parses a compact JWS token into its decoded parts.
 *
 * This module intentionally performs **no cryptographic verification**.
 * It only splits the token, base64url-decodes the header and payload,
 * and JSON-parses them. Signatures are returned as raw base64url strings.
 */

export interface JwtPart {
    /** Original base64url-encoded segment. */
    raw: string;
    /** Parsed JSON object. */
    json: Record<string, unknown>;
}

export interface JwtDecoded {
    header: JwtPart;
    payload: JwtPart;
    /** Raw base64url signature; empty string when the segment is empty. */
    signature: string;
    /** Convenience alias of `payload.json`. */
    claims: Record<string, unknown>;
}

/**
 * Decode `header.payload.signature` into its three parts.
 * Throws on malformed input (wrong segment count, bad base64url, non-JSON).
 */
export function decodeJWT(token: string): JwtDecoded {
    const trimmed = token.trim();
    if (!trimmed) {
        throw new Error("Empty token.");
    }

    const parts = trimmed.split(".");
    if (parts.length !== 3) {
        throw new Error(
            `Invalid JWT: expected 3 dot-separated segments, got ${parts.length}.`,
        );
    }

    const [rawHeader, rawPayload, rawSignature] = parts;

    const header = decodeJsonSegment(rawHeader, "header");
    const payload = decodeJsonSegment(rawPayload, "payload");

    return {
        header: { raw: rawHeader, json: header },
        payload: { raw: rawPayload, json: payload },
        signature: rawSignature,
        claims: payload,
    };
}

function decodeJsonSegment(
    segment: string,
    which: "header" | "payload",
): Record<string, unknown> {
    if (!segment) {
        throw new Error(`Invalid JWT: ${which} segment is empty.`);
    }

    let decoded: string;
    try {
        decoded = base64UrlDecode(segment);
    } catch (e) {
        throw new Error(
            `Invalid JWT: ${which} is not valid base64url (${
                e instanceof Error ? e.message : "unknown error"
            }).`,
        );
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(decoded);
    } catch {
        throw new Error(`Invalid JWT: ${which} is not valid JSON.`);
    }

    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(`Invalid JWT: ${which} must decode to a JSON object.`);
    }

    return parsed as Record<string, unknown>;
}

/**
 * Base64URL → UTF-8 string. Pads the input, swaps the URL-safe alphabet
 * back to standard, decodes with `atob`, then UTF-8-decodes the bytes
 * so non-ASCII characters round-trip correctly.
 */
function base64UrlDecode(input: string): string {
    if (!/^[A-Za-z0-9_-]*$/.test(input)) {
        throw new Error("contains non-base64url characters");
    }

    const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
    const padLen = (4 - (b64.length % 4)) % 4;
    const padded = b64 + "=".repeat(padLen);

    // atob returns a "binary string" where each char code is a byte. We
    // reassemble that into a Uint8Array and run it through TextDecoder so
    // UTF-8 payloads come back as proper strings.
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
        bytes,
    );
}

// ---------------------------------------------------------------------------
// Known-claim catalog
// ---------------------------------------------------------------------------

export type JwtClaimLocation = "payload" | "header";
export type JwtClaimCategory = "registered" | "common" | "header";
export type JwtClaimFormat =
    | "string"
    | "number"
    | "date"
    | "array"
    | "url"
    | "email";

export interface JwtClaimSpec {
    /** The JSON key, e.g. "iss". */
    key: string;
    /** Human-readable name, e.g. "Issuer". */
    name: string;
    /** Where the claim lives in the token. */
    location: JwtClaimLocation;
    category: JwtClaimCategory;
    /** Expected value shape; used for display hints only. */
    format?: JwtClaimFormat;
    /** Short tooltip-sized blurb. */
    description: string;
    /** Spec reference, when relevant. */
    rfc?: string;
}

/**
 * Claims the UI knows about. Order matters: it drives the on-screen list.
 */
export const KNOWN_CLAIMS: JwtClaimSpec[] = [
    // Registered payload claims (RFC 7519 §4.1).
    {
        key: "iss",
        name: "Issuer",
        location: "payload",
        category: "registered",
        format: "url",
        description:
            "Identifies the principal that issued the JWT. Usually a URL or case-sensitive string.",
        rfc: "RFC 7519 §4.1.1",
    },
    {
        key: "sub",
        name: "Subject",
        location: "payload",
        category: "registered",
        format: "string",
        description:
            "Identifies the principal that is the subject of the JWT.",
        rfc: "RFC 7519 §4.1.2",
    },
    {
        key: "aud",
        name: "Audience",
        location: "payload",
        category: "registered",
        format: "array",
        description:
            "Identifies the recipients the JWT is intended for. May be a string or an array of strings.",
        rfc: "RFC 7519 §4.1.3",
    },
    {
        key: "exp",
        name: "Expiration",
        location: "payload",
        category: "registered",
        format: "date",
        description:
            "Unix timestamp after which the JWT must not be accepted for processing.",
        rfc: "RFC 7519 §4.1.4",
    },
    {
        key: "nbf",
        name: "Not before",
        location: "payload",
        category: "registered",
        format: "date",
        description:
            "Unix timestamp before which the JWT must not be accepted for processing.",
        rfc: "RFC 7519 §4.1.5",
    },
    {
        key: "iat",
        name: "Issued at",
        location: "payload",
        category: "registered",
        format: "date",
        description: "Unix timestamp at which the JWT was issued.",
        rfc: "RFC 7519 §4.1.6",
    },
    {
        key: "jti",
        name: "JWT ID",
        location: "payload",
        category: "registered",
        format: "string",
        description:
            "A unique identifier for the JWT; can be used to prevent replay.",
        rfc: "RFC 7519 §4.1.7",
    },

    // Common OIDC / OAuth payload claims.
    {
        key: "name",
        name: "Full name",
        location: "payload",
        category: "common",
        format: "string",
        description: "End-user's full name, in displayable form.",
        rfc: "OIDC Core 1.0 §5.1",
    },
    {
        key: "email",
        name: "Email",
        location: "payload",
        category: "common",
        format: "email",
        description: "End-user's preferred email address.",
        rfc: "OIDC Core 1.0 §5.1",
    },
    {
        key: "scope",
        name: "Scopes",
        location: "payload",
        category: "common",
        format: "string",
        description:
            "Space-separated list of OAuth 2.0 scopes granted to the token.",
        rfc: "RFC 8693 §4.2",
    },
    {
        key: "azp",
        name: "Authorized party",
        location: "payload",
        category: "common",
        format: "string",
        description:
            "The party to which the ID Token was issued, when distinct from the audience.",
        rfc: "OIDC Core 1.0 §2",
    },

    // Header claims (RFC 7515 §4.1).
    {
        key: "alg",
        name: "Algorithm",
        location: "header",
        category: "header",
        format: "string",
        description:
            "Cryptographic algorithm used to secure the JWT (e.g. HS256, RS256, none).",
        rfc: "RFC 7515 §4.1.1",
    },
    {
        key: "typ",
        name: "Token type",
        location: "header",
        category: "header",
        format: "string",
        description: 'Media type of the token. Typically "JWT".',
        rfc: "RFC 7515 §4.1.9",
    },
    {
        key: "kid",
        name: "Key ID",
        location: "header",
        category: "header",
        format: "string",
        description: "Hint indicating which key was used to secure the JWT.",
        rfc: "RFC 7515 §4.1.4",
    },
];

/**
 * Does the given claim appear in the matching segment of the token?
 */
export function hasClaim(decoded: JwtDecoded, spec: JwtClaimSpec): boolean {
    const source =
        spec.location === "header" ? decoded.header.json : decoded.payload.json;
    return Object.prototype.hasOwnProperty.call(source, spec.key);
}

/**
 * Returns payload keys that aren't in {@link KNOWN_CLAIMS}, in insertion order.
 */
export function customPayloadClaims(decoded: JwtDecoded): string[] {
    const known = new Set(
        KNOWN_CLAIMS.filter((c) => c.location === "payload").map((c) => c.key),
    );
    return Object.keys(decoded.payload.json).filter((k) => !known.has(k));
}

// ---------------------------------------------------------------------------
// Date / expiry helpers
// ---------------------------------------------------------------------------

/**
 * JWT timestamp claims that carry seconds-since-epoch (RFC 7519 §2).
 * Kept here so API responses, UI code, and tests all agree on the set.
 */
export const TIME_CLAIMS = ["exp", "nbf", "iat", "auth_time"] as const;
export type TimeClaim = (typeof TIME_CLAIMS)[number];

/**
 * Format a Unix timestamp (seconds) as a human-readable UTC string, e.g.
 * `"Sunday, 14 January 2024, 08:17:02 UTC"`.
 *
 * Uses `en-GB` + explicit `UTC` so output is stable across runtimes and
 * doesn't depend on the server's locale or TZ.
 */
export function formatUtcDateTime(unixSeconds: number): string {
    const d = new Date(unixSeconds * 1000);
    return new Intl.DateTimeFormat("en-GB", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZone: "UTC",
        timeZoneName: "short",
    }).format(d);
}

/**
 * Phrase a signed second-delta as a plain-English duration, rounded to
 * the largest sensible unit. Positive deltas get no suffix, negative
 * deltas are tagged "ago".
 *
 *   relativeDuration(3600)   // "1 hour"
 *   relativeDuration(-7200)  // "2 hours ago"
 */
export function relativeDuration(deltaSeconds: number): string {
    const s = Math.abs(deltaSeconds);
    const units: Array<[string, number]> = [
        ["year", 60 * 60 * 24 * 365],
        ["month", 60 * 60 * 24 * 30],
        ["day", 60 * 60 * 24],
        ["hour", 60 * 60],
        ["minute", 60],
        ["second", 1],
    ];
    for (const [name, secs] of units) {
        if (s >= secs) {
            const n = Math.floor(s / secs);
            const suffix = n === 1 ? "" : "s";
            const direction = deltaSeconds < 0 ? " ago" : "";
            return `${n} ${name}${suffix}${direction}`;
        }
    }
    return deltaSeconds < 0 ? "just now" : "in a moment";
}

/**
 * Break a non-negative second count into every non-zero unit from
 * years down to seconds, joined with commas and an Oxford-style "and".
 *
 *   verboseDuration(2 * 86400 + 3 * 3600 + 4 * 60 + 34)
 *     // "2 days, 3 hours, 4 minutes and 34 seconds"
 *
 * Used for the forward-looking "will expire in …" message where we
 * want the exact remaining time at a glance.
 */
export function verboseDuration(seconds: number): string {
    const s = Math.max(0, Math.floor(seconds));
    if (s === 0) return "a moment";

    const units: Array<[string, number]> = [
        ["year", 60 * 60 * 24 * 365],
        ["month", 60 * 60 * 24 * 30],
        ["day", 60 * 60 * 24],
        ["hour", 60 * 60],
        ["minute", 60],
        ["second", 1],
    ];

    const parts: string[] = [];
    let remaining = s;
    for (const [name, size] of units) {
        const n = Math.floor(remaining / size);
        if (n > 0) {
            parts.push(`${n} ${name}${n === 1 ? "" : "s"}`);
            remaining -= n * size;
        }
    }

    if (parts.length === 1) return parts[0];
    const last = parts.pop()!;
    return `${parts.join(", ")} and ${last}`;
}

/**
 * Build the `*-text` sibling for every known time claim present in the
 * payload. Non-numeric values are skipped silently — the caller already
 * sees the raw value next to the generated text, so there's no reason
 * to synthesize a text field we can't make sense of.
 */
export function timeClaimTexts(
    payload: Record<string, unknown>,
): Record<string, string> {
    const out: Record<string, string> = {};
    for (const key of TIME_CLAIMS) {
        const value = payload[key];
        if (typeof value === "number" && Number.isFinite(value)) {
            out[`${key}-text`] = formatUtcDateTime(value);
        }
    }
    return out;
}

/**
 * JSON-friendly view of a decoded JWT, shared by the HTTP API
 * (`/api/v1/jwt`) and the MCP `decode_jwt` tool so both stay in
 * lock-step on key names.
 *
 * The original token is deliberately NOT included: the caller already
 * has it, and echoing it back only widens the blast radius of a
 * mistakenly cached or logged response.
 */
export interface JwtJsonSummary {
    header: Record<string, unknown>;
    payload: Record<string, unknown>;
    signature: string;
    analysis: {
        state: ExpiryState;
        message: string;
        /**
         * Human-readable UTC strings for every known time claim present
         * in the payload, keyed by the *original* claim name (exp, nbf,
         * iat, auth_time). Raw numeric values stay untouched in `payload`.
         */
        [claim: string]: string;
    };
}

/**
 * Build the {@link JwtJsonSummary} for a decoded token. `now` can be
 * injected for deterministic tests.
 */
export function toJwtJsonSummary(
    decoded: JwtDecoded,
    now: Date = new Date(),
): JwtJsonSummary {
    const expiry = describeExpiry(decoded.payload.json, now);
    const analysis: JwtJsonSummary["analysis"] = {
        state: expiry.state,
        message: expiry.message,
    };
    for (const [textKey, value] of Object.entries(
        timeClaimTexts(decoded.payload.json),
    )) {
        // `timeClaimTexts` returns keys like "exp-text" — strip the suffix.
        analysis[textKey.replace(/-text$/, "")] = value;
    }

    return {
        header: decoded.header.json,
        payload: decoded.payload.json,
        signature: decoded.signature,
        analysis,
    };
}

export type ExpiryState = "valid" | "expired" | "not_yet_valid" | "no_expiry";

export interface ExpiryStatus {
    state: ExpiryState;
    /** Short, user-friendly summary suitable for the API `message` field. */
    message: string;
    /** `exp` as a Unix timestamp if present and numeric; otherwise null. */
    exp: number | null;
    /** `nbf` as a Unix timestamp if present and numeric; otherwise null. */
    nbf: number | null;
    /**
     * Seconds remaining until `exp` relative to `now`. Negative when the
     * token is already expired; null when there is no `exp`.
     */
    secondsUntilExpiry: number | null;
}

/**
 * Classify the token's validity window and build a one-liner that
 * states (in English) whether it's expired, not yet valid, or how
 * much time is left.
 *
 * `now` defaults to the current wall clock but can be injected for
 * deterministic tests.
 */
export function describeExpiry(
    payload: Record<string, unknown>,
    now: Date = new Date(),
): ExpiryStatus {
    const nowSec = Math.floor(now.getTime() / 1000);
    const expRaw = payload.exp;
    const nbfRaw = payload.nbf;
    const exp = typeof expRaw === "number" && Number.isFinite(expRaw)
        ? expRaw
        : null;
    const nbf = typeof nbfRaw === "number" && Number.isFinite(nbfRaw)
        ? nbfRaw
        : null;

    // "Not yet valid" wins over expiry wording: if the nbf is in the
    // future, it doesn't matter whether exp has passed — the token
    // was never usable in the first place.
    //
    // We no longer append the absolute UTC date in parentheses: callers
    // already get it as `analysis.<claim>` next to this message.
    if (nbf !== null && nbf > nowSec) {
        return {
            state: "not_yet_valid",
            message:
                `Token is not yet valid; becomes valid in ${verboseDuration(nbf - nowSec)}.`,
            exp,
            nbf,
            secondsUntilExpiry: exp === null ? null : exp - nowSec,
        };
    }

    if (exp === null) {
        return {
            state: "no_expiry",
            message:
                "Token has no 'exp' claim; this decoder cannot determine expiration.",
            exp: null,
            nbf,
            secondsUntilExpiry: null,
        };
    }

    const delta = exp - nowSec;
    if (delta <= 0) {
        return {
            state: "expired",
            message: `Token expired ${relativeDuration(delta)}.`,
            exp,
            nbf,
            secondsUntilExpiry: delta,
        };
    }

    return {
        state: "valid",
        message: `Token will expire in ${verboseDuration(delta)}.`,
        exp,
        nbf,
        secondsUntilExpiry: delta,
    };
}
