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
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
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
