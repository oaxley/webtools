/**
 * NanoID generator — compact, URL-friendly random identifiers.
 *
 * A self-contained re-implementation of the `nanoid` algorithm, kept
 * dependency-free on purpose. Randomness comes from the Web Crypto API
 * (`crypto.getRandomValues`), available in browsers, Cloudflare Workers
 * and Node 19+.
 *
 * Bytes are mapped to characters with a bitmask and rejection sampling:
 * each byte is masked down to the smallest power of two covering the
 * alphabet, and values that still fall outside it are discarded. A plain
 * `byte % alphabet.length` would favour the first characters whenever
 * the alphabet size is not a power of two.
 *
 * Only named alphabets are supported, which keeps validation and URL
 * encoding trivial for the HTTP route and MCP tool.
 */

/** Built-in alphabets, by name. */
export const NANOID_ALPHABETS = {
    /** nanoid's default URL-safe alphabet (64 characters). */
    url: "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict",
    /** Letters and digits (62 characters). */
    alphanumeric:
        "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
    /** Lower-case letters and digits (36 characters). */
    lowercase: "0123456789abcdefghijklmnopqrstuvwxyz",
    /** Digits only (10 characters). */
    numbers: "0123456789",
    /** Lower-case hexadecimal (16 characters). */
    hex: "0123456789abcdef",
    /** Letters and digits minus look-alikes `0 O 1 l I` (57 characters). */
    nolookalikes: "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz",
} as const;

/** Name of a built-in alphabet. */
export type NanoIdAlphabet = keyof typeof NANOID_ALPHABETS;

/** Alphabet names accepted by `generateNanoIds`, for input validation. */
export const NANOID_ALPHABET_NAMES = Object.keys(
    NANOID_ALPHABETS,
) as readonly NanoIdAlphabet[];

/** Default ID length, matching upstream nanoid (~126 bits of entropy). */
export const NANOID_DEFAULT_SIZE = 21;
/** Shortest ID accepted. */
export const NANOID_MIN_SIZE = 2;
/** Longest ID accepted. */
export const NANOID_MAX_SIZE = 255;
/** Maximum number of IDs returned by a single `generateNanoIds` call. */
export const MAX_NANOID_COUNT = 10;

export interface NanoIdOptions {
    /** How many IDs to generate, 1..MAX_NANOID_COUNT. Defaults to 1. */
    count?: number;
    /** ID length, NANOID_MIN_SIZE..NANOID_MAX_SIZE. Defaults to 21. */
    size?: number;
    /** Named alphabet. Defaults to `url`. */
    alphabet?: NanoIdAlphabet;
    /**
     * Keep the first and last characters alphanumeric (no `-` or `_`),
     * so IDs are never mistaken for CLI flags and double-click selects
     * them whole. Only changes anything for the `url` alphabet. Defaults
     * to false (plain nanoid behaviour).
     */
    safeEnds?: boolean;
}

/** Characters that are awkward at either end of an identifier. */
const UNSAFE_EDGE_CHARS = /[-_]/g;

/** `chars` minus the characters that are awkward at the edges. */
function edgeAlphabet(chars: string): string {
    return chars.replace(UNSAFE_EDGE_CHARS, "");
}

function isAlphabetName(name: unknown): name is NanoIdAlphabet {
    return (
        typeof name === "string" &&
        (NANOID_ALPHABET_NAMES as readonly string[]).includes(name)
    );
}

/** Build an ID of `size` characters drawn uniformly from `chars`. */
function randomString(chars: string, size: number): string {
    // Smallest 2^k - 1 mask covering every index (chars.length <= 256).
    const mask = (2 << (31 - Math.clz32((chars.length - 1) | 1))) - 1;
    // Bytes per batch: enough on average to fill `size` characters given
    // the rejection rate, with a 1.6x safety margin (as upstream does).
    const step = Math.ceil((1.6 * mask * size) / chars.length);
    const bytes = new Uint8Array(step);

    let id = "";
    while (id.length < size) {
        crypto.getRandomValues(bytes);
        for (let i = 0; i < step && id.length < size; i++) {
            const index = bytes[i] & mask;
            if (index < chars.length) id += chars[index];
        }
    }
    return id;
}

/**
 * Build an ID whose first and last characters come from the edge-safe
 * subset of `chars` and whose middle comes from the full alphabet. Each
 * position stays uniform over its own character set.
 */
function safeEndsString(chars: string, size: number): string {
    const ends = randomString(edgeAlphabet(chars), 2);
    const middle = size > 2 ? randomString(chars, size - 2) : "";
    return ends[0] + middle + ends[1];
}

/** Bits of entropy carried by one ID of `size` characters. */
export function nanoIdEntropyBits(
    size: number = NANOID_DEFAULT_SIZE,
    alphabet: NanoIdAlphabet = "url",
    safeEnds: boolean = false,
): number {
    const chars = NANOID_ALPHABETS[alphabet];
    if (!safeEnds) return size * Math.log2(chars.length);
    return (
        2 * Math.log2(edgeAlphabet(chars).length) +
        (size - 2) * Math.log2(chars.length)
    );
}

/**
 * Generate a batch of NanoIDs.
 *
 * @throws Error when `count`, `size` or `alphabet` is out of range.
 *   Messages are meant to be surfaced verbatim by the HTTP route and
 *   MCP tool.
 */
export function generateNanoIds(options: NanoIdOptions = {}): string[] {
    const {
        count = 1,
        size = NANOID_DEFAULT_SIZE,
        alphabet = "url",
        safeEnds = false,
    } = options;

    if (!isAlphabetName(alphabet)) {
        throw new Error(
            `Unknown alphabet: ${String(alphabet)}. Use one of: ` +
                `${NANOID_ALPHABET_NAMES.join(", ")}.`,
        );
    }
    if (
        !Number.isInteger(size) ||
        size < NANOID_MIN_SIZE ||
        size > NANOID_MAX_SIZE
    ) {
        throw new Error(
            `size must be an integer between ${NANOID_MIN_SIZE} and ${NANOID_MAX_SIZE}.`,
        );
    }
    if (!Number.isInteger(count) || count < 1 || count > MAX_NANOID_COUNT) {
        throw new Error(
            `count must be an integer between 1 and ${MAX_NANOID_COUNT}.`,
        );
    }

    if (typeof safeEnds !== "boolean") {
        throw new Error("safeEnds must be true or false.");
    }

    const chars = NANOID_ALPHABETS[alphabet];
    const generate = safeEnds ? safeEndsString : randomString;
    return Array.from({ length: count }, () => generate(chars, size));
}

/**
 * Generate a single NanoID.
 *
 * @throws Error when `size` or `alphabet` is out of range.
 */
export function generateNanoId(
    size: number = NANOID_DEFAULT_SIZE,
    alphabet: NanoIdAlphabet = "url",
    safeEnds: boolean = false,
): string {
    return generateNanoIds({ size, alphabet, safeEnds })[0];
}
