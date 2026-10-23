/**
 * Base64 / Base32 / Base58 encoder and decoder.
 *
 * Self-contained and dependency-free: the alphabets are applied by hand
 * rather than through `btoa`/`atob`, so URL-safe and unpadded variants
 * behave identically in browsers, Cloudflare Workers and Node.
 *
 * Encoding always starts from bytes (UTF-8 text or a hex string) and
 * decoding always ends in bytes, which the caller can read as UTF-8 text
 * or as hex. Decoders are deliberately lenient about whitespace, letter
 * case and missing padding — people paste wrapped output from terminals
 * and log files — but strict about characters outside the alphabet, so a
 * typo is reported instead of silently producing wrong bytes.
 */

/** Supported encodings. */
export type BaseEncoding = "base64" | "base32" | "base58";

/** What `convertEncoding` should do with its input. */
export type EncodingOperation = "encode" | "decode";

/** How the caller's string should be read as bytes when encoding. */
export type BytesFormat = "text" | "hex";

/** Base32 alphabet variants. */
export type Base32Variant = "rfc4648" | "crockford";

/** RFC 4648 §4 standard alphabet. */
export const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
/** RFC 4648 §5 URL- and filename-safe alphabet. */
export const BASE64_URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
/** RFC 4648 §6 alphabet. */
export const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
/** Crockford's base32: no I, L, O or U. */
export const BASE32_CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** Bitcoin's base58 alphabet: no 0, O, I or l. */
export const BASE58_ALPHABET =
    "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Largest input accepted by base64/base32, in bytes. */
export const MAX_ENCODING_BYTES = 1_048_576;
/**
 * Largest input accepted by base58, in bytes. Base58 is not a power of
 * two, so converting means big-number division over the whole input:
 * cost grows with the square of the length. Base58 encodes keys,
 * addresses and hashes — tens of bytes — so a small cap is plenty and
 * keeps a single request from burning CPU.
 */
export const MAX_BASE58_BYTES = 4096;

/** Encoding-specific options. Ignored where they don't apply. */
export interface EncodingOptions {
    /** base64: use the URL-safe alphabet (`-_`). Defaults to false. */
    urlSafe?: boolean;
    /** base64/base32: emit `=` padding. Defaults to true. */
    padding?: boolean;
    /** base32: alphabet variant. Defaults to `rfc4648`. */
    variant?: Base32Variant;
}

export interface EncodeResult {
    encoding: BaseEncoding;
    operation: "encode";
    /** The encoded string. */
    output: string;
    /** Size of the decoded input, in bytes. */
    inputBytes: number;
}

export interface DecodeResult {
    encoding: BaseEncoding;
    operation: "decode";
    /** Decoded bytes as UTF-8 text, or null when they aren't valid UTF-8. */
    text: string | null;
    /** Decoded bytes as lower-case hex. */
    hex: string;
    /** Number of decoded bytes. */
    bytes: number;
}

export type ConversionResult = EncodeResult | DecodeResult;

export interface ConvertEncodingInput {
    encoding: BaseEncoding;
    operation: EncodingOperation;
    /** Text to encode, or the encoded string to decode. */
    input: string;
    /** How to read `input` when encoding. Defaults to `text`. */
    inputFormat?: BytesFormat;
    options?: EncodingOptions;
    /**
     * Override the size cap, in bytes of decoded data. Defaults to
     * `MAX_BASE58_BYTES` for base58 and `MAX_ENCODING_BYTES` otherwise.
     * The HTTP API passes tighter caps to stay within its CPU budget.
     */
    maxBytes?: number;
}

export const BASE_ENCODINGS: readonly BaseEncoding[] = [
    "base64",
    "base32",
    "base58",
];
export const ENCODING_OPERATIONS: readonly EncodingOperation[] = [
    "encode",
    "decode",
];
export const BYTES_FORMATS: readonly BytesFormat[] = ["text", "hex"];
export const BASE32_VARIANTS: readonly Base32Variant[] = [
    "rfc4648",
    "crockford",
];

/** Human-readable name used in error messages. */
const LABELS: Record<BaseEncoding, string> = {
    base64: "Base64",
    base32: "Base32",
    base58: "Base58",
};

// ---------------------------------------------------------------------------
// Bytes <-> text / hex
// ---------------------------------------------------------------------------

/** UTF-8 encode a string. */
export function textToBytes(text: string): Uint8Array {
    return new TextEncoder().encode(text);
}

/**
 * UTF-8 decode bytes, or return null when they are not valid UTF-8
 * (binary payloads: keys, hashes, images…).
 */
export function bytesToText(bytes: Uint8Array): string | null {
    try {
        // ignoreBOM: keep a leading U+FEFF, so the text matches the bytes.
        return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
        return null;
    }
}

/** Lower-case hex, no separators. */
export function bytesToHex(bytes: Uint8Array): string {
    let out = "";
    for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
    return out;
}

/**
 * Parse hex into bytes. Whitespace, `:` and `-` separators and a leading
 * `0x` are ignored, so output pasted from other tools works as-is.
 *
 * @throws Error on an odd digit count or a non-hex character.
 */
export function hexToBytes(hex: string): Uint8Array {
    const cleaned = hex.replace(/^0[xX]/, "").replace(/[\s:-]+/g, "");
    if (cleaned === "") return new Uint8Array(0);
    const bad = /[^0-9a-fA-F]/.exec(cleaned);
    if (bad) {
        throw new Error(
            `Invalid hex input: '${bad[0]}' is not a hex digit (position ${bad.index + 1}).`,
        );
    }
    if (cleaned.length % 2 !== 0) {
        throw new Error(
            `Invalid hex input: expected an even number of digits, got ${cleaned.length}.`,
        );
    }
    const bytes = new Uint8Array(cleaned.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

// ---------------------------------------------------------------------------
// Decoder input helpers
// ---------------------------------------------------------------------------

/** Build a character → value table for `alphabet`. */
function lookupTable(alphabet: string): Record<string, number> {
    const table: Record<string, number> = Object.create(null) as Record<
        string,
        number
    >;
    for (let i = 0; i < alphabet.length; i++) table[alphabet[i]] = i;
    return table;
}

/**
 * Report an unexpected character, pointing at where it sits in the
 * user's original input (1-based, so it matches what an editor shows).
 */
function invalidCharacter(
    encoding: BaseEncoding,
    char: string,
    index: number,
): Error {
    const shown = char.trim() === "" ? JSON.stringify(char) : `'${char}'`;
    return new Error(
        `Invalid ${LABELS[encoding]} input: ${shown} is not in the alphabet (position ${index + 1}).`,
    );
}

/** Characters dropped from encoded input before decoding. */
const IGNORED_IN_INPUT = /\s/;

// ---------------------------------------------------------------------------
// Base64
// ---------------------------------------------------------------------------

/** Encode bytes as base64. */
export function encodeBase64(
    bytes: Uint8Array,
    options: { urlSafe?: boolean; padding?: boolean } = {},
): string {
    const { urlSafe = false, padding = true } = options;
    const alphabet = urlSafe ? BASE64_URL_ALPHABET : BASE64_ALPHABET;

    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
        const b0 = bytes[i];
        const b1 = bytes[i + 1];
        const b2 = bytes[i + 2];
        out += alphabet[b0 >> 2];
        if (b1 === undefined) {
            out += alphabet[(b0 & 0x03) << 4];
            if (padding) out += "==";
            break;
        }
        out += alphabet[((b0 & 0x03) << 4) | (b1 >> 4)];
        if (b2 === undefined) {
            out += alphabet[(b1 & 0x0f) << 2];
            if (padding) out += "=";
            break;
        }
        out += alphabet[((b1 & 0x0f) << 2) | (b2 >> 6)];
        out += alphabet[b2 & 0x3f];
    }
    return out;
}

const BASE64_VALUES = (() => {
    const table = lookupTable(BASE64_ALPHABET);
    // Accept the URL-safe alphabet in the same pass: `-` and `_` map to
    // the same values as `+` and `/`.
    table["-"] = 62;
    table["_"] = 63;
    return table;
})();

/**
 * Decode base64, accepting both alphabets, missing padding and any
 * whitespace (including the line breaks `base64`/PEM output adds).
 */
export function decodeBase64(input: string): Uint8Array {
    let bits = 0;
    let buffer = 0;
    const out: number[] = [];
    let seen = 0;

    for (let i = 0; i < input.length; i++) {
        const char = input[i];
        if (IGNORED_IN_INPUT.test(char)) continue;
        if (char === "=") {
            // Padding only makes sense at the end; everything after it
            // must be padding or whitespace.
            const rest = input.slice(i).replace(/[\s=]/g, "");
            if (rest !== "") {
                throw new Error(
                    `Invalid Base64 input: unexpected data after the '=' padding (position ${i + 1}).`,
                );
            }
            break;
        }
        const value = BASE64_VALUES[char];
        if (value === undefined) throw invalidCharacter("base64", char, i);
        buffer = (buffer << 6) | value;
        bits += 6;
        seen++;
        if (bits >= 8) {
            bits -= 8;
            out.push((buffer >> bits) & 0xff);
        }
        // Keep only the bits not yet emitted, so the buffer never
        // outgrows 32-bit bitwise arithmetic.
        buffer &= (1 << bits) - 1;
    }

    if (seen % 4 === 1) {
        throw new Error(
            "Invalid Base64 input: length is not valid (a single trailing character carries no complete byte).",
        );
    }
    // Leftover bits of a truncated group must be zero, otherwise the
    // input carries data that no byte can hold.
    if (bits > 0 && buffer !== 0) {
        throw new Error(
            "Invalid Base64 input: the last character has non-zero unused bits.",
        );
    }
    return new Uint8Array(out);
}

// ---------------------------------------------------------------------------
// Base32
// ---------------------------------------------------------------------------

/** Encode bytes as base32 (RFC 4648 or Crockford). */
export function encodeBase32(
    bytes: Uint8Array,
    options: { variant?: Base32Variant; padding?: boolean } = {},
): string {
    const { variant = "rfc4648", padding = true } = options;
    const alphabet =
        variant === "crockford" ? BASE32_CROCKFORD_ALPHABET : BASE32_ALPHABET;

    let out = "";
    let buffer = 0;
    let bits = 0;
    for (const byte of bytes) {
        buffer = (buffer << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            bits -= 5;
            out += alphabet[(buffer >>> bits) & 31];
        }
        buffer &= (1 << bits) - 1;
    }
    if (bits > 0) out += alphabet[(buffer << (5 - bits)) & 31];

    // Crockford's spec has no padding; RFC 4648 pads to a multiple of 8.
    if (padding && variant === "rfc4648" && out.length % 8 !== 0) {
        out += "=".repeat(8 - (out.length % 8));
    }
    return out;
}

const BASE32_VALUES = lookupTable(BASE32_ALPHABET);
const BASE32_CROCKFORD_VALUES = (() => {
    const table = lookupTable(BASE32_CROCKFORD_ALPHABET);
    // Crockford's lenient decoding: letters that look like digits are
    // accepted as those digits.
    table["O"] = 0;
    table["I"] = 1;
    table["L"] = 1;
    return table;
})();

/**
 * Decode base32. Letter case and whitespace are ignored, padding is
 * optional, and Crockford input may also contain `-` separators.
 */
export function decodeBase32(
    input: string,
    options: { variant?: Base32Variant } = {},
): Uint8Array {
    const { variant = "rfc4648" } = options;
    const values =
        variant === "crockford" ? BASE32_CROCKFORD_VALUES : BASE32_VALUES;

    let buffer = 0;
    let bits = 0;
    const out: number[] = [];

    for (let i = 0; i < input.length; i++) {
        const char = input[i];
        if (IGNORED_IN_INPUT.test(char)) continue;
        if (variant === "crockford" && char === "-") continue;
        if (char === "=") {
            const rest = input.slice(i).replace(/[\s=]/g, "");
            if (rest !== "") {
                throw new Error(
                    `Invalid Base32 input: unexpected data after the '=' padding (position ${i + 1}).`,
                );
            }
            break;
        }
        const value = values[char.toUpperCase()];
        if (value === undefined) throw invalidCharacter("base32", char, i);
        buffer = (buffer << 5) | value;
        bits += 5;
        if (bits >= 8) {
            bits -= 8;
            out.push((buffer >>> bits) & 0xff);
        }
        buffer &= (1 << bits) - 1;
    }

    if (bits >= 5) {
        throw new Error(
            "Invalid Base32 input: length is not valid (the trailing characters carry no complete byte).",
        );
    }
    if (bits > 0 && buffer !== 0) {
        throw new Error(
            "Invalid Base32 input: the last character has non-zero unused bits.",
        );
    }
    return new Uint8Array(out);
}

// ---------------------------------------------------------------------------
// Base58
// ---------------------------------------------------------------------------

/**
 * Encode bytes as base58 (Bitcoin alphabet).
 *
 * Base58 is not a power of two, so this is a base-256 → base-58
 * conversion: every input byte is pushed through the digits collected so
 * far. Leading zero bytes carry no value in a big number, so they are
 * written out separately as `1`s, which is what keeps addresses the same
 * length.
 */
export function encodeBase58(bytes: Uint8Array): string {
    let zeros = 0;
    while (zeros < bytes.length && bytes[zeros] === 0) zeros++;

    const digits: number[] = [];
    for (let i = zeros; i < bytes.length; i++) {
        let carry = bytes[i];
        for (let j = 0; j < digits.length; j++) {
            carry += digits[j] << 8;
            digits[j] = carry % 58;
            carry = (carry / 58) | 0;
        }
        while (carry > 0) {
            digits.push(carry % 58);
            carry = (carry / 58) | 0;
        }
    }

    let out = "1".repeat(zeros);
    for (let i = digits.length - 1; i >= 0; i--) out += BASE58_ALPHABET[digits[i]];
    return out;
}

const BASE58_VALUES = lookupTable(BASE58_ALPHABET);

/** Decode base58 (Bitcoin alphabet). Whitespace is ignored. */
export function decodeBase58(input: string): Uint8Array {
    const chars: string[] = [];
    for (let i = 0; i < input.length; i++) {
        const char = input[i];
        if (IGNORED_IN_INPUT.test(char)) continue;
        if (BASE58_VALUES[char] === undefined) {
            throw invalidCharacter("base58", char, i);
        }
        chars.push(char);
    }

    let zeros = 0;
    while (zeros < chars.length && chars[zeros] === "1") zeros++;

    const bytes: number[] = [];
    for (let i = zeros; i < chars.length; i++) {
        let carry = BASE58_VALUES[chars[i]];
        for (let j = 0; j < bytes.length; j++) {
            carry += bytes[j] * 58;
            bytes[j] = carry & 0xff;
            carry >>= 8;
        }
        while (carry > 0) {
            bytes.push(carry & 0xff);
            carry >>= 8;
        }
    }

    const out = new Uint8Array(zeros + bytes.length);
    for (let i = 0; i < bytes.length; i++) {
        out[zeros + bytes.length - 1 - i] = bytes[i];
    }
    return out;
}

// ---------------------------------------------------------------------------
// Shared entry point
// ---------------------------------------------------------------------------

function sizeLimit(encoding: BaseEncoding): number {
    return encoding === "base58" ? MAX_BASE58_BYTES : MAX_ENCODING_BYTES;
}

/**
 * Upper bound on the bytes `input` decodes to, used for the size check
 * before doing any work. Whitespace, padding and separators carry no
 * data, so they are not counted.
 */
function estimateDecodedBytes(encoding: BaseEncoding, input: string): number {
    const length = input.replace(/[\s=-]/g, "").length;
    if (encoding === "base64") return Math.floor((length * 3) / 4);
    if (encoding === "base32") return Math.floor((length * 5) / 8);
    return Math.ceil(length * 0.733); // log(58)/log(256)
}

function checkSize(
    encoding: BaseEncoding,
    bytes: number,
    limit: number = sizeLimit(encoding),
): void {
    if (bytes > limit) {
        const suffix =
            encoding === "base58"
                ? " Base58 conversion cost grows with the square of the input, so it is capped lower than the other encodings."
                : "";
        throw new Error(
            `Input is too large: ${bytes} bytes exceeds the ${limit}-byte limit for ${LABELS[encoding]}.${suffix}`,
        );
    }
}

function isOneOf<T extends string>(
    value: unknown,
    allowed: readonly T[],
): value is T {
    return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

/**
 * Encode or decode `input` with the given base encoding.
 *
 * One entry point shared by the web page, the HTTP route and the MCP
 * tool, so all three validate the same way and return the same shapes.
 *
 * @throws Error on unknown options, oversized input or characters
 *   outside the alphabet. Messages are meant to be surfaced verbatim.
 */
export function convertEncoding(
    request: ConvertEncodingInput,
): ConversionResult {
    const {
        encoding,
        operation,
        input,
        inputFormat = "text",
        options = {},
        maxBytes,
    } = request;

    if (!isOneOf(encoding, BASE_ENCODINGS)) {
        throw new Error(
            `Unknown encoding: ${String(encoding)}. Use one of: ${BASE_ENCODINGS.join(", ")}.`,
        );
    }
    if (!isOneOf(operation, ENCODING_OPERATIONS)) {
        throw new Error(
            `Unknown operation: ${String(operation)}. Use 'encode' or 'decode'.`,
        );
    }
    if (typeof input !== "string") {
        throw new Error("Input must be a string.");
    }
    if (!isOneOf(inputFormat, BYTES_FORMATS)) {
        throw new Error(
            `Unknown input format: ${String(inputFormat)}. Use 'text' or 'hex'.`,
        );
    }

    const { urlSafe = false, padding = true, variant = "rfc4648" } = options;
    if (typeof urlSafe !== "boolean") {
        throw new Error("urlSafe must be true or false.");
    }
    if (typeof padding !== "boolean") {
        throw new Error("padding must be true or false.");
    }
    if (!isOneOf(variant, BASE32_VARIANTS)) {
        throw new Error(
            `Unknown Base32 variant: ${String(variant)}. Use 'rfc4648' or 'crockford'.`,
        );
    }

    if (operation === "encode") {
        const bytes =
            inputFormat === "hex" ? hexToBytes(input) : textToBytes(input);
        checkSize(encoding, bytes.length, maxBytes);
        const output =
            encoding === "base64"
                ? encodeBase64(bytes, { urlSafe, padding })
                : encoding === "base32"
                  ? encodeBase32(bytes, { variant, padding })
                  : encodeBase58(bytes);
        return { encoding, operation, output, inputBytes: bytes.length };
    }

    checkSize(encoding, estimateDecodedBytes(encoding, input), maxBytes);
    const bytes =
        encoding === "base64"
            ? decodeBase64(input)
            : encoding === "base32"
              ? decodeBase32(input, { variant })
              : decodeBase58(input);
    return {
        encoding,
        operation,
        text: bytesToText(bytes),
        hex: bytesToHex(bytes),
        bytes: bytes.length,
    };
}
