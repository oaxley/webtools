/**
 * ULID generator — Universally Unique Lexicographically Sortable
 * Identifiers (https://github.com/ulid/spec).
 *
 * A ULID is 128 bits written as 26 Crockford base32 characters:
 *
 *     01JBQ6Z9X4  E7M2K8P5R3T9V0WY
 *     |--------|  |--------------|
 *     timestamp     randomness
 *     48 bits       80 bits
 *
 * The timestamp (Unix milliseconds) comes first and the alphabet is in
 * ASCII order, so ULIDs sort by creation time even as plain strings.
 *
 * Randomness comes from the Web Crypto API (`crypto.getRandomValues`),
 * available in browsers, Cloudflare Workers and Node 19+.
 */

/** Crockford base32: digits and upper-case letters minus I, L, O, U. */
export const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Length of a ULID string. */
export const ULID_LENGTH = 26;

/** Largest timestamp a ULID can hold (2^48 - 1 ms, year 10889). */
export const ULID_MAX_TIME = 2 ** 48 - 1;

/** Maximum number of ULIDs returned by a single `generateULIDs` call. */
export const MAX_ULID_COUNT = 10;

const TIME_CHARS = 10;
const RANDOM_BYTES = 10; // 80 bits

export interface UlidOptions {
    /** How many ULIDs to generate, 1..MAX_ULID_COUNT. Defaults to 1. */
    count?: number;
    /**
     * Keep ULIDs strictly increasing, even within one millisecond: the
     * random part of the previous ULID is incremented instead of being
     * redrawn (the spec's "monotonic" mode). Defaults to true.
     */
    monotonic?: boolean;
    /** Emit lower-case letters. The spec is upper-case. Defaults to false. */
    lowercase?: boolean;
}

/** Encode a 48-bit timestamp as 10 base32 characters, big-endian. */
function encodeTime(ms: number): string {
    let out = "";
    for (let i = 0; i < TIME_CHARS; i++) {
        // Plain arithmetic: bitwise operators would truncate to 32 bits.
        out = ULID_ALPHABET[ms % 32] + out;
        ms = Math.floor(ms / 32);
    }
    return out;
}

/** Encode 80 bits (10 bytes) as 16 base32 characters, 5 bits at a time. */
function encodeRandom(bytes: Uint8Array): string {
    let out = "";
    let buffer = 0;
    let bits = 0;
    for (const byte of bytes) {
        buffer = (buffer << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            bits -= 5;
            out += ULID_ALPHABET[(buffer >>> bits) & 31];
        }
        buffer &= (1 << bits) - 1;
    }
    return out;
}

/** Add 1 to a big-endian byte array; returns false when it wraps around. */
function increment(bytes: Uint8Array): boolean {
    for (let i = bytes.length - 1; i >= 0; i--) {
        if (bytes[i] < 0xff) {
            bytes[i]++;
            return true;
        }
        bytes[i] = 0;
    }
    return false;
}

// Monotonicity state. Module-level, so ordering holds per process /
// isolate, which is all the spec asks for.
let lastTime = -1;
const lastRandom = new Uint8Array(RANDOM_BYTES);

/**
 * Generate a single ULID.
 *
 * In monotonic mode, ULIDs created in the same millisecond as the
 * previous one (or after the clock went backwards) reuse its timestamp
 * and its random part plus one, so they keep strictly increasing. If
 * the 80 random bits ever overflow, the timestamp is advanced by 1 ms
 * (the spec says to throw; this mirrors our UUID v7 generator instead).
 *
 * @param now Current time in ms since the epoch (injectable for tests).
 */
export function generateULID(
    monotonic: boolean = true,
    now: number = Date.now(),
): string {
    let time = Math.floor(now);
    if (!Number.isFinite(time) || time < 0 || time > ULID_MAX_TIME) {
        throw new Error(
            `Timestamp out of range: must be between 0 and ${ULID_MAX_TIME}.`,
        );
    }

    if (!monotonic) {
        const random = new Uint8Array(RANDOM_BYTES);
        crypto.getRandomValues(random);
        return encodeTime(time) + encodeRandom(random);
    }

    if (time > lastTime) {
        crypto.getRandomValues(lastRandom);
    } else {
        // Same millisecond, or clock went backwards: stay on the last
        // timestamp and bump the random part.
        time = lastTime;
        if (!increment(lastRandom)) {
            time++;
            crypto.getRandomValues(lastRandom);
        }
    }
    lastTime = time;
    return encodeTime(time) + encodeRandom(lastRandom);
}

/**
 * Generate a batch of ULIDs.
 *
 * @throws Error when an option is out of range. Messages are meant to
 *   be surfaced verbatim by the HTTP route and MCP tool.
 */
export function generateULIDs(options: UlidOptions = {}): string[] {
    const { count = 1, monotonic = true, lowercase = false } = options;

    if (!Number.isInteger(count) || count < 1 || count > MAX_ULID_COUNT) {
        throw new Error(
            `count must be an integer between 1 and ${MAX_ULID_COUNT}.`,
        );
    }
    if (typeof monotonic !== "boolean") {
        throw new Error("monotonic must be true or false.");
    }
    if (typeof lowercase !== "boolean") {
        throw new Error("lowercase must be true or false.");
    }

    return Array.from({ length: count }, () => {
        const ulid = generateULID(monotonic);
        return lowercase ? ulid.toLowerCase() : ulid;
    });
}
