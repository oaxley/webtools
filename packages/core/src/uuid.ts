/**
 * UUID generator — RFC 9562 version 4 (random) and version 7
 * (Unix-epoch time-ordered) identifiers.
 *
 * Randomness comes from the Web Crypto API (`crypto.randomUUID` /
 * `crypto.getRandomValues`), available in browsers, Cloudflare Workers
 * and Node 19+. Nothing here is a secret, but a CSPRNG keeps collisions
 * vanishingly unlikely.
 */

/** Supported UUID versions. */
export type UuidVersion = 4 | 7;

export interface UuidOptions {
    /** UUID version to generate. Defaults to 7. */
    version?: UuidVersion;
    /** How many UUIDs to generate, 1..MAX_UUID_COUNT. Defaults to 1. */
    count?: number;
    /** Emit upper-case hex digits. Defaults to false. */
    uppercase?: boolean;
    /** Keep the 8-4-4-4-12 hyphens. Defaults to true. */
    hyphens?: boolean;
}

/** Maximum number of UUIDs returned by a single `generateUUIDs` call. */
export const MAX_UUID_COUNT = 10;

/** Versions accepted by `generateUUIDs`, for input validation. */
export const UUID_VERSIONS: readonly UuidVersion[] = [4, 7];

/** Format 16 bytes as a canonical lower-case, hyphenated UUID string. */
function bytesToUuid(bytes: Uint8Array): string {
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
        "",
    );
    return (
        `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-` +
        `${hex.slice(16, 20)}-${hex.slice(20)}`
    );
}

/** Generate a random (version 4) UUID. */
export function generateUUIDv4(): string {
    return crypto.randomUUID();
}

// Monotonicity state for v7 (RFC 9562 §6.2, method 1: a 12-bit counter
// stored in `rand_a`). Module-level, so ordering holds per process /
// isolate, which is all the RFC asks for.
let lastTimestamp = -1;
let counter = 0;

/**
 * Generate a time-ordered (version 7) UUID.
 *
 * Layout: 48-bit big-endian Unix timestamp in milliseconds, 4-bit
 * version, 12-bit counter (`rand_a`), 2-bit variant, 62 random bits.
 *
 * UUIDs generated within the same millisecond, or after the clock went
 * backwards, keep strictly increasing: the counter is bumped instead,
 * and when it overflows the timestamp is advanced by 1 ms.
 *
 * @param now Current time in ms since the epoch (injectable for tests).
 */
export function generateUUIDv7(now: number = Date.now()): string {
    let timestamp = Math.floor(now);
    if (timestamp > lastTimestamp) {
        // New millisecond: reseed the counter randomly, leaving the top
        // bit clear so there is room to increment before overflowing.
        const seed = new Uint16Array(1);
        crypto.getRandomValues(seed);
        counter = seed[0] & 0x7ff;
    } else {
        // Same millisecond, or clock went backwards: stay on the last
        // timestamp and bump the counter.
        timestamp = lastTimestamp;
        counter++;
        if (counter > 0xfff) {
            timestamp++;
            counter = 0;
        }
    }
    lastTimestamp = timestamp;

    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);

    // 48-bit timestamp, big-endian. Split to stay clear of 32-bit
    // bitwise truncation.
    const high = Math.floor(timestamp / 2 ** 16);
    const low = timestamp % 2 ** 16;
    bytes[0] = (high >>> 24) & 0xff;
    bytes[1] = (high >>> 16) & 0xff;
    bytes[2] = (high >>> 8) & 0xff;
    bytes[3] = high & 0xff;
    bytes[4] = (low >>> 8) & 0xff;
    bytes[5] = low & 0xff;

    // Version (0111) + 12-bit counter.
    bytes[6] = 0x70 | ((counter >>> 8) & 0x0f);
    bytes[7] = counter & 0xff;

    // Variant (10xx); the rest of the bytes stay random.
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    return bytesToUuid(bytes);
}

/**
 * Generate a batch of UUIDs.
 *
 * @throws Error when `version` or `count` is out of range. Messages are
 *   meant to be surfaced verbatim by the HTTP route and MCP tool.
 */
export function generateUUIDs(options: UuidOptions = {}): string[] {
    const {
        version = 7,
        count = 1,
        uppercase = false,
        hyphens = true,
    } = options;

    if (!UUID_VERSIONS.includes(version)) {
        throw new Error(
            `Unsupported UUID version: ${String(version)}. Use 4 or 7.`,
        );
    }
    if (!Number.isInteger(count) || count < 1 || count > MAX_UUID_COUNT) {
        throw new Error(
            `count must be an integer between 1 and ${MAX_UUID_COUNT}.`,
        );
    }

    const generate = version === 4 ? generateUUIDv4 : () => generateUUIDv7();
    return Array.from({ length: count }, () => {
        let uuid = generate();
        if (!hyphens) uuid = uuid.replace(/-/g, "");
        return uppercase ? uuid.toUpperCase() : uuid;
    });
}
