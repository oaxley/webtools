/**
 * Message digests: MD5, SHA-1, SHA-2 (224/256/384/512), SHA-3 (256/512)
 * and CRC-32, plus HMAC over any of the cryptographic ones.
 *
 * Self-contained and dependency-free. `crypto.subtle` is not used: it has
 * no MD5, SHA-3 or CRC-32, and it is asynchronous, which gets in the way
 * of hashing as the user types. Everything here is synchronous and runs
 * identically in browsers, Cloudflare Workers and Node.
 *
 * 64-bit arithmetic (SHA-384/512, Keccak) is done on pairs of 32-bit
 * integers rather than BigInt, which is an order of magnitude faster.
 * The SHA-2 and Keccak constants are derived from their definitions
 * (fractional parts of prime roots, the Keccak LFSR) instead of being
 * pasted in as tables, so there is no transcription to get wrong; the
 * tests check every algorithm against published vectors and node:crypto.
 */
import { bytesToHex, encodeBase64, hexToBytes, textToBytes, type BytesFormat } from "./encoding.ts";

export type HashAlgorithm =
    | "md5"
    | "sha1"
    | "sha224"
    | "sha256"
    | "sha384"
    | "sha512"
    | "sha3-256"
    | "sha3-512"
    | "crc32";

/** How the digest is written out. */
export type DigestFormat = "hex" | "base64";

export interface HashAlgorithmInfo {
    /** Display name, e.g. `SHA-256`. */
    label: string;
    /** Digest size in bits. */
    bits: number;
    /** Internal block size in bytes (the HMAC block size). */
    blockBytes: number;
    /** False for checksums, which can't be keyed. */
    hmac: boolean;
}

export const HASH_ALGORITHMS: readonly HashAlgorithm[] = [
    "md5",
    "sha1",
    "sha224",
    "sha256",
    "sha384",
    "sha512",
    "sha3-256",
    "sha3-512",
    "crc32",
];

export const HASH_INFO: Record<HashAlgorithm, HashAlgorithmInfo> = {
    md5: { label: "MD5", bits: 128, blockBytes: 64, hmac: true },
    sha1: { label: "SHA-1", bits: 160, blockBytes: 64, hmac: true },
    sha224: { label: "SHA-224", bits: 224, blockBytes: 64, hmac: true },
    sha256: { label: "SHA-256", bits: 256, blockBytes: 64, hmac: true },
    sha384: { label: "SHA-384", bits: 384, blockBytes: 128, hmac: true },
    sha512: { label: "SHA-512", bits: 512, blockBytes: 128, hmac: true },
    "sha3-256": { label: "SHA3-256", bits: 256, blockBytes: 136, hmac: true },
    "sha3-512": { label: "SHA3-512", bits: 512, blockBytes: 72, hmac: true },
    crc32: { label: "CRC-32", bits: 32, blockBytes: 1, hmac: false },
};

export const DIGEST_FORMATS: readonly DigestFormat[] = ["hex", "base64"];

/** Largest input accepted by `computeHash`, in bytes. */
export const MAX_HASH_BYTES = 16 * 1_048_576;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Merkle–Damgård padding: append 0x80, zeros, then the message length in
 * bits as a `lengthBytes`-byte integer, so the total is a whole number of
 * blocks. Only the low 64 bits of the length are ever non-zero here.
 */
function mdPad(
    message: Uint8Array,
    blockBytes: number,
    lengthBytes: number,
    littleEndian: boolean,
): Uint8Array {
    const length = message.length;
    const total = Math.ceil((length + 1 + lengthBytes) / blockBytes) * blockBytes;
    const out = new Uint8Array(total);
    out.set(message);
    out[length] = 0x80;
    const view = new DataView(out.buffer);
    const bitsLow = (length * 8) >>> 0;
    const bitsHigh = Math.floor(length / 0x20000000);
    if (littleEndian) {
        view.setUint32(total - 8, bitsLow, true);
        view.setUint32(total - 4, bitsHigh, true);
    } else {
        view.setUint32(total - 8, bitsHigh);
        view.setUint32(total - 4, bitsLow);
    }
    return out;
}

/** Write 32-bit words out big-endian, truncated to `bytes`. */
function wordsToBytes(words: ArrayLike<number>, bytes: number, littleEndian = false): Uint8Array {
    const out = new Uint8Array(words.length * 4);
    const view = new DataView(out.buffer);
    for (let i = 0; i < words.length; i++) view.setUint32(i * 4, words[i] >>> 0, littleEndian);
    return out.subarray(0, bytes);
}

const rotl32 = (x: number, n: number) => (x << n) | (x >>> (32 - n));
const rotr32 = (x: number, n: number) => (x >>> n) | (x << (32 - n));

// ---------------------------------------------------------------------------
// MD5 (RFC 1321)
// ---------------------------------------------------------------------------

const MD5_SHIFTS = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
/** K[i] = floor(|sin(i + 1)| · 2³²), as defined by RFC 1321. */
const MD5_K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) | 0);

function md5(message: Uint8Array): Uint8Array {
    const padded = mdPad(message, 64, 8, true);
    const view = new DataView(padded.buffer);
    const m = new Int32Array(16);
    let a0 = 0x67452301;
    let b0 = 0xefcdab89 | 0;
    let c0 = 0x98badcfe | 0;
    let d0 = 0x10325476;

    for (let offset = 0; offset < padded.length; offset += 64) {
        for (let i = 0; i < 16; i++) m[i] = view.getInt32(offset + i * 4, true);
        let a = a0;
        let b = b0;
        let c = c0;
        let d = d0;
        for (let i = 0; i < 64; i++) {
            let f: number;
            let g: number;
            if (i < 16) {
                f = (b & c) | (~b & d);
                g = i;
            } else if (i < 32) {
                f = (d & b) | (~d & c);
                g = (5 * i + 1) & 15;
            } else if (i < 48) {
                f = b ^ c ^ d;
                g = (3 * i + 5) & 15;
            } else {
                f = c ^ (b | ~d);
                g = (7 * i) & 15;
            }
            f = (f + a + MD5_K[i] + m[g]) | 0;
            a = d;
            d = c;
            c = b;
            b = (b + rotl32(f, MD5_SHIFTS[(i >> 4) * 4 + (i & 3)])) | 0;
        }
        a0 = (a0 + a) | 0;
        b0 = (b0 + b) | 0;
        c0 = (c0 + c) | 0;
        d0 = (d0 + d) | 0;
    }
    return wordsToBytes([a0, b0, c0, d0], 16, true);
}

// ---------------------------------------------------------------------------
// SHA-1 (FIPS 180-4 §6.1)
// ---------------------------------------------------------------------------

function sha1(message: Uint8Array): Uint8Array {
    const padded = mdPad(message, 64, 8, false);
    const view = new DataView(padded.buffer);
    const w = new Int32Array(80);
    const h = new Int32Array([0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0]);

    for (let offset = 0; offset < padded.length; offset += 64) {
        for (let t = 0; t < 16; t++) w[t] = view.getInt32(offset + t * 4);
        for (let t = 16; t < 80; t++) w[t] = rotl32(w[t - 3] ^ w[t - 8] ^ w[t - 14] ^ w[t - 16], 1);
        let a = h[0];
        let b = h[1];
        let c = h[2];
        let d = h[3];
        let e = h[4];
        for (let t = 0; t < 80; t++) {
            let f: number;
            let k: number;
            if (t < 20) {
                f = (b & c) | (~b & d);
                k = 0x5a827999;
            } else if (t < 40) {
                f = b ^ c ^ d;
                k = 0x6ed9eba1;
            } else if (t < 60) {
                f = (b & c) | (b & d) | (c & d);
                k = 0x8f1bbcdc;
            } else {
                f = b ^ c ^ d;
                k = 0xca62c1d6;
            }
            const temp = (rotl32(a, 5) + f + e + k + w[t]) | 0;
            e = d;
            d = c;
            c = rotl32(b, 30);
            b = a;
            a = temp;
        }
        h[0] += a;
        h[1] += b;
        h[2] += c;
        h[3] += d;
        h[4] += e;
    }
    return wordsToBytes(h, 20);
}

// ---------------------------------------------------------------------------
// SHA-2 constants (FIPS 180-4 §4.2, §5.3)
// ---------------------------------------------------------------------------

/** The first `count` primes. */
function primes(count: number): number[] {
    const out: number[] = [];
    for (let n = 2; out.length < count; n++) {
        if (out.every((p) => p * p > n || n % p !== 0)) out.push(n);
    }
    return out;
}

/** floor(n^(1/k)) for a non-negative BigInt, by Newton's method. */
function integerRoot(n: bigint, k: bigint): bigint {
    if (n < 2n) return n;
    let x = 1n << (BigInt(n.toString(2).length) / k + 1n);
    for (;;) {
        const y = ((k - 1n) * x + n / x ** (k - 1n)) / k;
        if (y >= x) return x;
        x = y;
    }
}

/** First 64 bits of the fractional part of p^(1/k), as [high, low] words. */
function fractionBits(p: number, k: bigint): [number, number] {
    const bits = integerRoot(BigInt(p) << (64n * k), k) & 0xffffffffffffffffn;
    return [Number(bits >> 32n) | 0, Number(bits & 0xffffffffn) | 0];
}

interface Sha2Constants {
    /** SHA-512 round constants (cube roots of the first 80 primes). */
    k512Hi: Int32Array;
    k512Lo: Int32Array;
    /** SHA-256 round constants: the high words of the first 64. */
    k256: Int32Array;
    /** Initial hash values, as 64-bit [high, low] pairs. */
    iv512: Int32Array;
    iv384: Int32Array;
    iv256: Int32Array;
    iv224: Int32Array;
}

let sha2Constants: Sha2Constants | undefined;

/** Derived on first use, then cached (a few hundred BigInt operations). */
function getSha2Constants(): Sha2Constants {
    if (sha2Constants) return sha2Constants;
    const p = primes(80);
    const k512Hi = new Int32Array(80);
    const k512Lo = new Int32Array(80);
    p.forEach((prime, i) => {
        [k512Hi[i], k512Lo[i]] = fractionBits(prime, 3n);
    });
    // Square roots of the first 16 primes: primes 1–8 seed SHA-256/512,
    // primes 9–16 seed SHA-224/384.
    const roots = p.slice(0, 16).map((prime) => fractionBits(prime, 2n));
    const pairs = (from: number) => new Int32Array(roots.slice(from, from + 8).flat());
    sha2Constants = {
        k512Hi,
        k512Lo,
        k256: k512Hi.slice(0, 64),
        iv512: pairs(0),
        iv384: pairs(8),
        iv256: new Int32Array(roots.slice(0, 8).map(([hi]) => hi)),
        // SHA-224 takes the second 32 bits of those fractions.
        iv224: new Int32Array(roots.slice(8, 16).map(([, lo]) => lo)),
    };
    return sha2Constants;
}

// ---------------------------------------------------------------------------
// SHA-224 / SHA-256 (FIPS 180-4 §6.2, §6.3)
// ---------------------------------------------------------------------------

function sha256(message: Uint8Array, iv: Int32Array, outBytes: number): Uint8Array {
    const k = getSha2Constants().k256;
    const padded = mdPad(message, 64, 8, false);
    const view = new DataView(padded.buffer);
    const w = new Int32Array(64);
    const h = iv.slice();

    for (let offset = 0; offset < padded.length; offset += 64) {
        for (let t = 0; t < 16; t++) w[t] = view.getInt32(offset + t * 4);
        for (let t = 16; t < 64; t++) {
            const x = w[t - 15];
            const y = w[t - 2];
            const s0 = rotr32(x, 7) ^ rotr32(x, 18) ^ (x >>> 3);
            const s1 = rotr32(y, 17) ^ rotr32(y, 19) ^ (y >>> 10);
            w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
        }
        let a = h[0];
        let b = h[1];
        let c = h[2];
        let d = h[3];
        let e = h[4];
        let f = h[5];
        let g = h[6];
        let hh = h[7];
        for (let t = 0; t < 64; t++) {
            const s1 = rotr32(e, 6) ^ rotr32(e, 11) ^ rotr32(e, 25);
            const ch = (e & f) ^ (~e & g);
            const temp1 = (hh + s1 + ch + k[t] + w[t]) | 0;
            const s0 = rotr32(a, 2) ^ rotr32(a, 13) ^ rotr32(a, 22);
            const maj = (a & b) ^ (a & c) ^ (b & c);
            const temp2 = (s0 + maj) | 0;
            hh = g;
            g = f;
            f = e;
            e = (d + temp1) | 0;
            d = c;
            c = b;
            b = a;
            a = (temp1 + temp2) | 0;
        }
        h[0] += a;
        h[1] += b;
        h[2] += c;
        h[3] += d;
        h[4] += e;
        h[5] += f;
        h[6] += g;
        h[7] += hh;
    }
    return wordsToBytes(h, outBytes);
}

// ---------------------------------------------------------------------------
// SHA-384 / SHA-512 (FIPS 180-4 §6.4, §6.5), on [high, low] word pairs
// ---------------------------------------------------------------------------

/** High word of a 64-bit rotate right by 0 < n < 64, n ≠ 32. */
function rotrHi(hi: number, lo: number, n: number): number {
    return n < 32 ? (hi >>> n) | (lo << (32 - n)) : (lo >>> (n - 32)) | (hi << (64 - n));
}

/** Low word of a 64-bit rotate right by 0 < n < 64, n ≠ 32. */
function rotrLo(hi: number, lo: number, n: number): number {
    return n < 32 ? (lo >>> n) | (hi << (32 - n)) : (hi >>> (n - 32)) | (lo << (64 - n));
}

const TWO_32 = 4294967296;

function sha512(message: Uint8Array, iv: Int32Array, outBytes: number): Uint8Array {
    const { k512Hi: kh, k512Lo: kl } = getSha2Constants();
    const padded = mdPad(message, 128, 16, false);
    const view = new DataView(padded.buffer);
    const wh = new Int32Array(80);
    const wl = new Int32Array(80);
    const h = iv.slice(); // [h0hi, h0lo, h1hi, h1lo, …]

    for (let offset = 0; offset < padded.length; offset += 128) {
        for (let t = 0; t < 16; t++) {
            wh[t] = view.getInt32(offset + t * 8);
            wl[t] = view.getInt32(offset + t * 8 + 4);
        }
        for (let t = 16; t < 80; t++) {
            const xh = wh[t - 15];
            const xl = wl[t - 15];
            const s0h = rotrHi(xh, xl, 1) ^ rotrHi(xh, xl, 8) ^ (xh >>> 7);
            const s0l = rotrLo(xh, xl, 1) ^ rotrLo(xh, xl, 8) ^ ((xl >>> 7) | (xh << 25));
            const yh = wh[t - 2];
            const yl = wl[t - 2];
            const s1h = rotrHi(yh, yl, 19) ^ rotrHi(yh, yl, 61) ^ (yh >>> 6);
            const s1l = rotrLo(yh, yl, 19) ^ rotrLo(yh, yl, 61) ^ ((yl >>> 6) | (yh << 26));
            const lo = (s1l >>> 0) + (wl[t - 7] >>> 0) + (s0l >>> 0) + (wl[t - 16] >>> 0);
            wh[t] = (s1h + wh[t - 7] + s0h + wh[t - 16] + Math.floor(lo / TWO_32)) | 0;
            wl[t] = lo | 0;
        }

        let ah = h[0], al = h[1], bh = h[2], bl = h[3];
        let ch = h[4], cl = h[5], dh = h[6], dl = h[7];
        let eh = h[8], el = h[9], fh = h[10], fl = h[11];
        let gh = h[12], gl = h[13], hh = h[14], hl = h[15];

        for (let t = 0; t < 80; t++) {
            const S1h = rotrHi(eh, el, 14) ^ rotrHi(eh, el, 18) ^ rotrHi(eh, el, 41);
            const S1l = rotrLo(eh, el, 14) ^ rotrLo(eh, el, 18) ^ rotrLo(eh, el, 41);
            const chh = (eh & fh) ^ (~eh & gh);
            const chl = (el & fl) ^ (~el & gl);
            const t1l = (hl >>> 0) + (S1l >>> 0) + (chl >>> 0) + (kl[t] >>> 0) + (wl[t] >>> 0);
            const t1h = (hh + S1h + chh + kh[t] + wh[t] + Math.floor(t1l / TWO_32)) | 0;

            const S0h = rotrHi(ah, al, 28) ^ rotrHi(ah, al, 34) ^ rotrHi(ah, al, 39);
            const S0l = rotrLo(ah, al, 28) ^ rotrLo(ah, al, 34) ^ rotrLo(ah, al, 39);
            const majh = (ah & bh) ^ (ah & ch) ^ (bh & ch);
            const majl = (al & bl) ^ (al & cl) ^ (bl & cl);
            const t2l = (S0l >>> 0) + (majl >>> 0);
            const t2h = (S0h + majh + Math.floor(t2l / TWO_32)) | 0;

            hh = gh; hl = gl;
            gh = fh; gl = fl;
            fh = eh; fl = el;
            const el2 = (dl >>> 0) + (t1l >>> 0);
            eh = (dh + t1h + Math.floor(el2 / TWO_32)) | 0;
            el = el2 | 0;
            dh = ch; dl = cl;
            ch = bh; cl = bl;
            bh = ah; bl = al;
            const al2 = (t1l >>> 0) + (t2l >>> 0);
            ah = (t1h + t2h + Math.floor(al2 / TWO_32)) | 0;
            al = al2 | 0;
        }

        const add = (i: number, hi: number, lo: number) => {
            const sum = (h[i + 1] >>> 0) + (lo >>> 0);
            h[i] = (h[i] + hi + Math.floor(sum / TWO_32)) | 0;
            h[i + 1] = sum | 0;
        };
        add(0, ah, al);
        add(2, bh, bl);
        add(4, ch, cl);
        add(6, dh, dl);
        add(8, eh, el);
        add(10, fh, fl);
        add(12, gh, gl);
        add(14, hh, hl);
    }
    return wordsToBytes(h, outBytes);
}

// ---------------------------------------------------------------------------
// SHA-3 (FIPS 202): Keccak-f[1600] on [low, high] word pairs
// ---------------------------------------------------------------------------

interface KeccakConstants {
    /** Rotation offset of each lane, indexed by x + 5y. */
    rotations: number[];
    /** Round constants as [low, high] words. */
    roundLo: Int32Array;
    roundHi: Int32Array;
}

let keccakConstants: KeccakConstants | undefined;

function getKeccakConstants(): KeccakConstants {
    if (keccakConstants) return keccakConstants;
    // ρ offsets (FIPS 202 §3.2.2): walk (x, y) from (1, 0).
    const rotations = new Array<number>(25).fill(0);
    let x = 1;
    let y = 0;
    for (let t = 0; t < 24; t++) {
        rotations[x + 5 * y] = (((t + 1) * (t + 2)) / 2) % 64;
        [x, y] = [y, (2 * x + 3 * y) % 5];
    }
    // ι constants (FIPS 202 §3.2.5): bits 2^j − 1 come from an LFSR.
    const roundLo = new Int32Array(24);
    const roundHi = new Int32Array(24);
    let lfsr = 1;
    for (let round = 0; round < 24; round++) {
        for (let j = 0; j < 7; j++) {
            if (lfsr & 1) {
                const bit = (1 << j) - 1;
                if (bit < 32) roundLo[round] |= 1 << bit;
                else roundHi[round] |= 1 << (bit - 32);
            }
            lfsr = lfsr & 0x80 ? ((lfsr << 1) ^ 0x71) & 0xff : lfsr << 1;
        }
    }
    keccakConstants = { rotations, roundLo, roundHi };
    return keccakConstants;
}

/** Keccak-f[1600] permutation; lane i is s[2i] (low) and s[2i + 1] (high). */
function keccakF(s: Int32Array): void {
    const { rotations, roundLo, roundHi } = getKeccakConstants();
    const c = new Int32Array(10);
    const b = new Int32Array(50);
    for (let round = 0; round < 24; round++) {
        // θ
        for (let x = 0; x < 5; x++) {
            c[2 * x] = s[2 * x] ^ s[2 * x + 10] ^ s[2 * x + 20] ^ s[2 * x + 30] ^ s[2 * x + 40];
            c[2 * x + 1] = s[2 * x + 1] ^ s[2 * x + 11] ^ s[2 * x + 21] ^ s[2 * x + 31] ^ s[2 * x + 41];
        }
        for (let x = 0; x < 5; x++) {
            const next = 2 * ((x + 1) % 5);
            const prev = 2 * ((x + 4) % 5);
            const lo = c[next];
            const hi = c[next + 1];
            const dLo = c[prev] ^ ((lo << 1) | (hi >>> 31));
            const dHi = c[prev + 1] ^ ((hi << 1) | (lo >>> 31));
            for (let y = 0; y < 25; y += 5) {
                s[2 * (x + y)] ^= dLo;
                s[2 * (x + y) + 1] ^= dHi;
            }
        }
        // ρ and π: B[y, 2x + 3y] = rotl(A[x, y], r[x, y])
        for (let x = 0; x < 5; x++) {
            for (let y = 0; y < 5; y++) {
                const from = x + 5 * y;
                const to = y + 5 * ((2 * x + 3 * y) % 5);
                const lo = s[2 * from];
                const hi = s[2 * from + 1];
                const n = rotations[from];
                if (n === 0) {
                    b[2 * to] = lo;
                    b[2 * to + 1] = hi;
                } else if (n < 32) {
                    b[2 * to] = (lo << n) | (hi >>> (32 - n));
                    b[2 * to + 1] = (hi << n) | (lo >>> (32 - n));
                } else if (n === 32) {
                    b[2 * to] = hi;
                    b[2 * to + 1] = lo;
                } else {
                    const m = n - 32;
                    b[2 * to] = (hi << m) | (lo >>> (32 - m));
                    b[2 * to + 1] = (lo << m) | (hi >>> (32 - m));
                }
            }
        }
        // χ
        for (let y = 0; y < 25; y += 5) {
            for (let x = 0; x < 5; x++) {
                const i = 2 * (x + y);
                const i1 = 2 * (((x + 1) % 5) + y);
                const i2 = 2 * (((x + 2) % 5) + y);
                s[i] = b[i] ^ (~b[i1] & b[i2]);
                s[i + 1] = b[i + 1] ^ (~b[i1 + 1] & b[i2 + 1]);
            }
        }
        // ι
        s[0] ^= roundLo[round];
        s[1] ^= roundHi[round];
    }
}

function sha3(message: Uint8Array, outBytes: number): Uint8Array {
    const rate = 200 - 2 * outBytes;
    // pad10*1 with the SHA-3 domain bits 01: 0x06 … 0x80.
    const total = Math.floor(message.length / rate + 1) * rate;
    const padded = new Uint8Array(total);
    padded.set(message);
    padded[message.length] ^= 0x06;
    padded[total - 1] ^= 0x80;

    const view = new DataView(padded.buffer);
    const state = new Int32Array(50);
    for (let offset = 0; offset < total; offset += rate) {
        for (let i = 0; i < rate / 8; i++) {
            state[2 * i] ^= view.getInt32(offset + i * 8, true);
            state[2 * i + 1] ^= view.getInt32(offset + i * 8 + 4, true);
        }
        keccakF(state);
    }
    // outBytes ≤ rate for SHA3-256/512, so one squeeze is enough.
    return wordsToBytes(state, outBytes, true);
}

// ---------------------------------------------------------------------------
// CRC-32 (IEEE 802.3, as used by zip, gzip and PNG)
// ---------------------------------------------------------------------------

let crcTable: Int32Array | undefined;

function crc32(message: Uint8Array): Uint8Array {
    if (!crcTable) {
        crcTable = new Int32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            crcTable[n] = c;
        }
    }
    let crc = -1;
    for (let i = 0; i < message.length; i++) {
        crc = crcTable[(crc ^ message[i]) & 0xff] ^ (crc >>> 8);
    }
    // Written big-endian, so the hex matches the usual `cbf43926` form.
    return wordsToBytes([~crc], 4);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Raw digest of `message`. */
export function digest(algorithm: HashAlgorithm, message: Uint8Array): Uint8Array {
    switch (algorithm) {
        case "md5":
            return md5(message);
        case "sha1":
            return sha1(message);
        case "sha224":
            return sha256(message, getSha2Constants().iv224, 28);
        case "sha256":
            return sha256(message, getSha2Constants().iv256, 32);
        case "sha384":
            return sha512(message, getSha2Constants().iv384, 48);
        case "sha512":
            return sha512(message, getSha2Constants().iv512, 64);
        case "sha3-256":
            return sha3(message, 32);
        case "sha3-512":
            return sha3(message, 64);
        case "crc32":
            return crc32(message);
        default:
            throw unknownAlgorithm(algorithm);
    }
}

/** HMAC (RFC 2104) of `message` under `key`. */
export function hmac(algorithm: HashAlgorithm, key: Uint8Array, message: Uint8Array): Uint8Array {
    const info = HASH_INFO[algorithm];
    if (!info) throw unknownAlgorithm(algorithm);
    if (!info.hmac) {
        throw new Error(`${info.label} is a checksum, not a cryptographic hash: it can't be used with HMAC.`);
    }
    const block = info.blockBytes;
    const k = new Uint8Array(block);
    k.set(key.length > block ? digest(algorithm, key) : key);

    const inner = new Uint8Array(block + message.length);
    for (let i = 0; i < block; i++) inner[i] = k[i] ^ 0x36;
    inner.set(message, block);
    const innerDigest = digest(algorithm, inner);

    const outer = new Uint8Array(block + innerDigest.length);
    for (let i = 0; i < block; i++) outer[i] = k[i] ^ 0x5c;
    outer.set(innerDigest, block);
    return digest(algorithm, outer);
}

export interface HashOptions {
    /** Text to hash, or hex bytes when `inputFormat` is `hex`. */
    input: string;
    /** How to read `input`. Defaults to `text` (UTF-8). */
    inputFormat?: BytesFormat;
    /** Digest encoding. Defaults to `hex`. */
    outputFormat?: DigestFormat;
    /** Upper-case hex digits. Ignored for base64. Defaults to false. */
    uppercase?: boolean;
    /** When set, compute an HMAC under this key instead of a plain hash. */
    hmacKey?: string;
    /** How to read `hmacKey`. Defaults to `text`. */
    hmacKeyFormat?: BytesFormat;
    /** Override the input size cap, in bytes. Defaults to `MAX_HASH_BYTES`. */
    maxBytes?: number;
}

export interface ComputeHashInput extends HashOptions {
    algorithm: HashAlgorithm;
}

export interface HashResult {
    algorithm: HashAlgorithm;
    /** True when this is an HMAC rather than a plain hash. */
    hmac: boolean;
    /** The encoded digest. */
    digest: string;
    format: DigestFormat;
    /** Digest size in bits. */
    bits: number;
    /** Size of the hashed input, in bytes. */
    inputBytes: number;
}

export interface AllHashesResult {
    hmac: boolean;
    format: DigestFormat;
    inputBytes: number;
    /** One entry per algorithm; checksums are left out for HMAC. */
    hashes: { algorithm: HashAlgorithm; digest: string; bits: number }[];
}

/**
 * Hash (or HMAC) `input` with one algorithm.
 *
 * Shared by the web page, the HTTP route and the MCP tool, so all three
 * validate the same way and return the same shape.
 *
 * @throws Error on unknown options, bad hex or oversized input. Messages
 *   are meant to be surfaced verbatim.
 */
export function computeHash(request: ComputeHashInput): HashResult {
    const { algorithm } = request;
    if (!isOneOf(algorithm, HASH_ALGORITHMS)) throw unknownAlgorithm(algorithm);
    const prepared = prepare(request);
    if (prepared.key && !HASH_INFO[algorithm].hmac) {
        throw new Error(`${HASH_INFO[algorithm].label} is a checksum, not a cryptographic hash: it can't be used with HMAC.`);
    }
    return {
        algorithm,
        hmac: prepared.key !== null,
        digest: run(algorithm, prepared),
        format: prepared.format,
        bits: HASH_INFO[algorithm].bits,
        inputBytes: prepared.bytes.length,
    };
}

/** Hash `input` with every algorithm (every HMAC-capable one with a key). */
export function computeAllHashes(request: HashOptions): AllHashesResult {
    const prepared = prepare(request);
    const algorithms = HASH_ALGORITHMS.filter((a) => prepared.key === null || HASH_INFO[a].hmac);
    return {
        hmac: prepared.key !== null,
        format: prepared.format,
        inputBytes: prepared.bytes.length,
        hashes: algorithms.map((algorithm) => ({
            algorithm,
            digest: run(algorithm, prepared),
            bits: HASH_INFO[algorithm].bits,
        })),
    };
}

interface Prepared {
    bytes: Uint8Array;
    key: Uint8Array | null;
    format: DigestFormat;
    uppercase: boolean;
}

function prepare(request: HashOptions): Prepared {
    const {
        input,
        inputFormat = "text",
        outputFormat = "hex",
        uppercase = false,
        hmacKey,
        hmacKeyFormat = "text",
        maxBytes = MAX_HASH_BYTES,
    } = request;
    if (typeof input !== "string") throw new Error("Input must be a string.");
    if (!isOneOf(inputFormat, ["text", "hex"] as const)) {
        throw new Error(`Unknown input format: ${String(inputFormat)}. Use 'text' or 'hex'.`);
    }
    if (!isOneOf(outputFormat, DIGEST_FORMATS)) {
        throw new Error(`Unknown output format: ${String(outputFormat)}. Use 'hex' or 'base64'.`);
    }
    if (typeof uppercase !== "boolean") throw new Error("uppercase must be true or false.");
    if (hmacKey !== undefined && typeof hmacKey !== "string") {
        throw new Error("HMAC key must be a string.");
    }
    if (!isOneOf(hmacKeyFormat, ["text", "hex"] as const)) {
        throw new Error(`Unknown HMAC key format: ${String(hmacKeyFormat)}. Use 'text' or 'hex'.`);
    }

    const bytes = inputFormat === "hex" ? hexToBytes(input) : textToBytes(input);
    if (bytes.length > maxBytes) {
        throw new Error(
            `Input is too large: ${bytes.length.toLocaleString("en-US")} bytes (limit: ${maxBytes.toLocaleString("en-US")}).`,
        );
    }
    let key: Uint8Array | null = null;
    if (hmacKey !== undefined) {
        try {
            key = hmacKeyFormat === "hex" ? hexToBytes(hmacKey) : textToBytes(hmacKey);
        } catch (e) {
            throw new Error(`HMAC key: ${e instanceof Error ? e.message : "invalid hex."}`);
        }
    }
    return { bytes, key, format: outputFormat, uppercase };
}

function run(algorithm: HashAlgorithm, { bytes, key, format, uppercase }: Prepared): string {
    const raw = key ? hmac(algorithm, key, bytes) : digest(algorithm, bytes);
    if (format === "base64") return encodeBase64(raw);
    const hex = bytesToHex(raw);
    return uppercase ? hex.toUpperCase() : hex;
}

function unknownAlgorithm(algorithm: unknown): Error {
    return new Error(`Unknown hash algorithm: ${String(algorithm)}. Use one of: ${HASH_ALGORITHMS.join(", ")}.`);
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
    return typeof value === "string" && (options as readonly string[]).includes(value);
}
