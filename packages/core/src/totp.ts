/**
 * One-time passwords: HOTP (RFC 4226) and TOTP (RFC 6238), plus the
 * `otpauth://` URIs that authenticator apps scan as QR codes.
 *
 * HOTP is an HMAC of an 8-byte counter, cut down to a few decimal digits
 * ("dynamic truncation"). TOTP is HOTP with the counter taken from the
 * clock: `floor(unixTime / period)`.
 *
 * Everything here is pure and synchronous, so the web page can compute
 * codes locally: a TOTP secret must never be sent to a server.
 */
import { BASE32_ALPHABET, encodeBase32 } from "./encoding.ts";
import { hmac, type HashAlgorithm } from "./hash.ts";

/** HMAC hashes allowed by RFC 6238. */
export type TotpAlgorithm = Extract<HashAlgorithm, "sha1" | "sha256" | "sha512">;

export const TOTP_ALGORITHMS: readonly TotpAlgorithm[] = ["sha1", "sha256", "sha512"];

/** Names used in `otpauth://` URIs. */
export const TOTP_ALGORITHM_NAMES: Record<TotpAlgorithm, string> = {
    sha1: "SHA1",
    sha256: "SHA256",
    sha512: "SHA512",
};

export const TOTP_MIN_DIGITS = 6;
export const TOTP_MAX_DIGITS = 8;

/** Defaults every authenticator app understands. */
export const TOTP_DEFAULTS = {
    algorithm: "sha1" as TotpAlgorithm,
    digits: 6,
    period: 30,
} as const;

/** 20 bytes = 160 bits, the size RFC 4226 recommends for SHA-1. */
export const TOTP_DEFAULT_SECRET_BYTES = 20;

export interface HotpOptions {
    algorithm?: TotpAlgorithm;
    digits?: number;
}

export interface TotpOptions extends HotpOptions {
    /** Unix time in seconds (default: now). */
    time?: number;
    /** Time step in seconds (default 30). */
    period?: number;
}

/** Every intermediate value of one HOTP computation, for teaching. */
export interface HotpDetails {
    counter: number;
    /** The counter as the 8 big-endian bytes that are HMAC'd. */
    counterBytes: Uint8Array;
    /** Full HMAC output (20, 32 or 64 bytes). */
    hmac: Uint8Array;
    /** Low 4 bits of the last HMAC byte: where the 4-byte window starts. */
    offset: number;
    /** The 4 bytes at `offset`, top bit cleared: a 31-bit integer. */
    binary: number;
    /** `binary mod 10^digits`, zero-padded. */
    code: string;
}

function checkOptions(algorithm: TotpAlgorithm, digits: number): void {
    if (!TOTP_ALGORITHMS.includes(algorithm)) {
        throw new Error(`Unsupported algorithm '${algorithm}'. Use sha1, sha256 or sha512.`);
    }
    if (!Number.isInteger(digits) || digits < TOTP_MIN_DIGITS || digits > TOTP_MAX_DIGITS) {
        throw new Error(`Digits must be an integer from ${TOTP_MIN_DIGITS} to ${TOTP_MAX_DIGITS}.`);
    }
}

function checkPeriod(period: number): void {
    if (!Number.isInteger(period) || period < 1) {
        throw new Error("The period must be a whole number of seconds, at least 1.");
    }
}

/** Big-endian 8-byte encoding of a non-negative safe integer. */
function counterToBytes(counter: number): Uint8Array {
    if (!Number.isSafeInteger(counter) || counter < 0) {
        throw new Error("The counter must be a non-negative integer.");
    }
    const bytes = new Uint8Array(8);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, Math.floor(counter / 2 ** 32));
    view.setUint32(4, counter % 2 ** 32);
    return bytes;
}

/** HOTP (RFC 4226) with all intermediate values. */
export function hotpDetails(key: Uint8Array, counter: number, options: HotpOptions = {}): HotpDetails {
    const { algorithm = TOTP_DEFAULTS.algorithm, digits = TOTP_DEFAULTS.digits } = options;
    checkOptions(algorithm, digits);
    const counterBytes = counterToBytes(counter);
    const mac = hmac(algorithm, key, counterBytes);
    // Dynamic truncation (RFC 4226 §5.3).
    const offset = mac[mac.length - 1] & 0x0f;
    const binary =
        ((mac[offset] & 0x7f) << 24) |
        (mac[offset + 1] << 16) |
        (mac[offset + 2] << 8) |
        mac[offset + 3];
    const code = String(binary % 10 ** digits).padStart(digits, "0");
    return { counter, counterBytes, hmac: mac, offset, binary, code };
}

/** HOTP code (RFC 4226) for `counter`. */
export function hotp(key: Uint8Array, counter: number, options: HotpOptions = {}): string {
    return hotpDetails(key, counter, options).code;
}

/** TOTP time step for a Unix time in seconds. */
export function totpCounter(time: number, period: number = TOTP_DEFAULTS.period): number {
    checkPeriod(period);
    if (!Number.isFinite(time) || time < 0) throw new Error("The time must be a non-negative number.");
    return Math.floor(time / period);
}

/** Seconds left before the code for `time` changes. */
export function totpSecondsRemaining(time: number, period: number = TOTP_DEFAULTS.period): number {
    checkPeriod(period);
    return period - (time % period);
}

const nowSeconds = () => Date.now() / 1000;

/** TOTP code (RFC 6238). */
export function totp(key: Uint8Array, options: TotpOptions = {}): string {
    const { time = nowSeconds(), period = TOTP_DEFAULTS.period, ...rest } = options;
    return hotp(key, totpCounter(time, period), rest);
}

export interface TotpVerifyOptions extends TotpOptions {
    /** Steps accepted on each side of the current one (default 1, max 10). */
    window?: number;
}

export interface TotpMatch {
    /** Time step that matched: store it to reject the same code twice. */
    counter: number;
    /** Steps away from the current one: -1 = previous code, +1 = next. */
    delta: number;
}

/** Compare two strings without stopping at the first difference. */
function constantTimeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

/**
 * Check a code against the current step and `window` steps on each side
 * (clocks drift, and people type slowly). Returns the matching step, or
 * `null`. Callers should reject a match whose `counter` is not greater
 * than the last one accepted: a TOTP code is single-use.
 */
export function verifyTotp(key: Uint8Array, code: string, options: TotpVerifyOptions = {}): TotpMatch | null {
    const { window = 1, time = nowSeconds(), period = TOTP_DEFAULTS.period, ...rest } = options;
    if (!Number.isInteger(window) || window < 0 || window > 10) {
        throw new Error("The window must be an integer from 0 to 10.");
    }
    const candidate = code.replace(/\s/g, "");
    const current = totpCounter(time, period);
    let match: TotpMatch | null = null;
    // Check every step, even after a match, so timing doesn't reveal which one.
    for (let delta = -window; delta <= window; delta++) {
        const counter = current + delta;
        if (counter < 0) continue;
        if (constantTimeEqual(hotp(key, counter, rest), candidate) && match === null) {
            match = { counter, delta };
        }
    }
    return match;
}

// ---------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------

/** New random secret, as unpadded RFC 4648 Base32 (what apps expect). */
export function generateTotpSecret(bytes: number = TOTP_DEFAULT_SECRET_BYTES): string {
    if (!Number.isInteger(bytes) || bytes < 10 || bytes > 64) {
        throw new Error("Secrets must be 10 to 64 bytes long.");
    }
    const key = new Uint8Array(bytes);
    crypto.getRandomValues(key);
    return encodeBase32(key, { padding: false });
}

/**
 * Decode a Base32 secret the way authenticator apps do: case, spaces,
 * dashes and padding are ignored, and leftover bits are dropped.
 */
export function decodeTotpSecret(secret: string): Uint8Array {
    const clean = secret.replace(/[\s\-=]/g, "").toUpperCase();
    if (clean === "") throw new Error("The secret is empty.");
    const out: number[] = [];
    let buffer = 0;
    let bits = 0;
    for (let i = 0; i < clean.length; i++) {
        const value = BASE32_ALPHABET.indexOf(clean[i]);
        if (value < 0) {
            throw new Error(
                `Invalid character '${clean[i]}' in the secret: Base32 uses only A–Z and 2–7.`,
            );
        }
        buffer = ((buffer << 5) | value) & 0xffff;
        bits += 5;
        if (bits >= 8) {
            bits -= 8;
            out.push((buffer >>> bits) & 0xff);
        }
    }
    if (out.length === 0) throw new Error("The secret is too short.");
    return new Uint8Array(out);
}

// ---------------------------------------------------------------------------
// otpauth:// URIs (Google Authenticator key URI format)
// ---------------------------------------------------------------------------

export interface OtpauthParams {
    /** Base32 secret. */
    secret: string;
    /** Service name, e.g. "GitHub". */
    issuer?: string;
    /** Account name, e.g. "alice@example.com". */
    account?: string;
    algorithm?: TotpAlgorithm;
    digits?: number;
    period?: number;
}

/**
 * `otpauth://totp/Issuer:account?secret=…&issuer=Issuer`. Parameters
 * equal to the defaults are left out, since a few apps ignore them anyway.
 */
export function buildOtpauthUri(params: OtpauthParams): string {
    const {
        secret,
        issuer = "",
        account = "",
        algorithm = TOTP_DEFAULTS.algorithm,
        digits = TOTP_DEFAULTS.digits,
        period = TOTP_DEFAULTS.period,
    } = params;
    checkOptions(algorithm, digits);
    checkPeriod(period);
    decodeTotpSecret(secret);

    const label = [issuer, account]
        .filter((part) => part !== "")
        .map(encodeURIComponent)
        .join(":");
    const query = [`secret=${secret.replace(/[\s\-=]/g, "").toUpperCase()}`];
    if (issuer) query.push(`issuer=${encodeURIComponent(issuer)}`);
    if (algorithm !== TOTP_DEFAULTS.algorithm) query.push(`algorithm=${TOTP_ALGORITHM_NAMES[algorithm]}`);
    if (digits !== TOTP_DEFAULTS.digits) query.push(`digits=${digits}`);
    if (period !== TOTP_DEFAULTS.period) query.push(`period=${period}`);
    return `otpauth://totp/${label}?${query.join("&")}`;
}

function decodeComponent(text: string): string {
    try {
        return decodeURIComponent(text.replace(/\+/g, " "));
    } catch {
        throw new Error("The URI contains an invalid %-escape.");
    }
}

/** Parse an `otpauth://totp/…` URI. Throws a readable error otherwise. */
export function parseOtpauthUri(uri: string): Required<OtpauthParams> {
    const match = /^otpauth:\/\/([a-z]+)\/([^?#]*)(?:\?([^#]*))?$/i.exec(uri.trim());
    if (!match) throw new Error("Not an otpauth:// URI. It should look like otpauth://totp/Issuer:account?secret=…");
    const type = match[1].toLowerCase();
    if (type === "hotp") throw new Error("This is an HOTP (counter-based) URI: only TOTP is supported here.");
    if (type !== "totp") throw new Error(`Unknown OTP type '${match[1]}'. Expected totp.`);

    const label = decodeComponent(match[2]);
    const colon = label.indexOf(":");
    let issuer = colon >= 0 ? label.slice(0, colon).trim() : "";
    const account = (colon >= 0 ? label.slice(colon + 1) : label).trim();

    const query = new Map<string, string>();
    for (const pair of (match[3] ?? "").split("&")) {
        if (pair === "") continue;
        const eq = pair.indexOf("=");
        const key = decodeComponent(eq >= 0 ? pair.slice(0, eq) : pair).toLowerCase();
        query.set(key, decodeComponent(eq >= 0 ? pair.slice(eq + 1) : ""));
    }

    const secret = query.get("secret");
    if (!secret) throw new Error("The URI has no secret= parameter.");
    decodeTotpSecret(secret);
    // The issuer parameter wins over the label prefix (Google's spec).
    issuer = query.get("issuer") ?? issuer;

    const algName = (query.get("algorithm") ?? "SHA1").toUpperCase();
    const algorithm = TOTP_ALGORITHMS.find((a) => TOTP_ALGORITHM_NAMES[a] === algName);
    if (!algorithm) throw new Error(`Unsupported algorithm '${algName}'. Use SHA1, SHA256 or SHA512.`);
    const digits = Number(query.get("digits") ?? TOTP_DEFAULTS.digits);
    const period = Number(query.get("period") ?? TOTP_DEFAULTS.period);
    checkOptions(algorithm, digits);
    checkPeriod(period);

    return {
        secret: secret.replace(/[\s\-=]/g, "").toUpperCase(),
        issuer,
        account,
        algorithm,
        digits,
        period,
    };
}
