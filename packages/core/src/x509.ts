/**
 * X.509 certificate decoder (RFC 5280).
 *
 * Parses PEM or raw base64 DER input into a structured view of the
 * certificate's TBS fields, extensions and signature. Zero dependencies,
 * zero verification — this is a presentation layer, not a validator.
 *
 * The DER / ASN.1 reader implemented here only supports the subset of
 * the standard that X.509 certificates actually use. It handles short
 * and long-form lengths, universal and context-specific tags, and the
 * primitive types we care about (INTEGER, OID, UTCTime, GeneralizedTime,
 * BIT STRING, OCTET STRING, printable/UTF-8/IA5/BMP strings, SEQUENCE,
 * SET, [0] BOOLEAN defaults, …).
 */
import {
    formatUtcDateTime,
    relativeDuration,
    verboseDuration,
} from "./jwt.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface X509Name {
    /** RFC 4514-ish "CN=example.com, O=Example, C=US". */
    dn: string;
    /** Each relative distinguished name, in the order they appeared. */
    rdns: Array<{
        /** Friendly attribute name (CN, O, …). Falls back to the OID. */
        type: string;
        oid: string;
        value: string;
    }>;
}

export interface X509PublicKey {
    /** Friendly algorithm name ("RSA", "EC", "Ed25519", …). */
    algorithm: string;
    algorithmOid: string;
    /** For EC keys, the named curve ("P-256", "P-384", …). */
    curve?: string;
    /** Modulus size in bits for RSA; curve field size for EC. */
    sizeBits?: number;
    /** Raw DER bytes of the SubjectPublicKeyInfo. */
    rawDer: Uint8Array;
    /** Base64-encoded SPKI as a PEM-ready string (no header lines). */
    base64Der: string;
}

export type X509ExtensionValue =
    | { kind: "basicConstraints"; ca: boolean; pathLenConstraint?: number }
    | { kind: "keyUsage"; usages: string[] }
    | { kind: "extKeyUsage"; usages: string[] }
    | {
        kind: "subjectAltName";
        names: Array<{ type: string; value: string }>;
    }
    | { kind: "subjectKeyIdentifier"; keyId: string }
    | {
        kind: "authorityKeyIdentifier";
        keyId?: string;
        issuer?: string;
        serialNumber?: string;
    }
    | { kind: "crlDistributionPoints"; urls: string[] }
    | {
        kind: "authorityInfoAccess";
        entries: Array<{ method: string; methodOid: string; location: string }>;
    }
    | {
        kind: "certificatePolicies";
        policies: Array<{ oid: string; qualifiers: string[] }>;
    }
    | { kind: "unknown"; hex: string };

export interface X509Extension {
    oid: string;
    /** Friendly name; falls back to the OID. */
    name: string;
    critical: boolean;
    value: X509ExtensionValue;
}

export interface X509Decoded {
    /** Original PEM text if the input was a PEM block; `null` for raw DER. */
    pem: string | null;
    /** Raw DER bytes. */
    derBytes: Uint8Array;
    /** DER bytes of the TBSCertificate (used to compute the signature). */
    tbsBytes: Uint8Array;

    version: number; // 1 | 2 | 3
    /** Hex-encoded serial number with `:` separators between bytes. */
    serialNumber: string;
    /** Friendly signature algorithm name; falls back to the OID. */
    signatureAlgorithm: string;
    signatureAlgorithmOid: string;

    issuer: X509Name;
    validity: { notBefore: Date; notAfter: Date };
    subject: X509Name;

    subjectPublicKey: X509PublicKey;

    /** v2/v3 only. Hex-encoded, `:` separated. */
    issuerUniqueId?: string;
    subjectUniqueId?: string;

    /** v3 only. */
    extensions: X509Extension[];

    signature: {
        /** `:`-separated hex of the signature bits. */
        hex: string;
        bytes: Uint8Array;
    };
}

// ---------------------------------------------------------------------------
// Field catalog
// ---------------------------------------------------------------------------

export type X509FieldLocation = "tbs" | "extension" | "derived";

export interface X509FieldSpec {
    key: string;
    name: string;
    location: X509FieldLocation;
    /** RFC 5280 mandatory → true. */
    mandatory: boolean;
    description: string;
    rfc?: string;
}

/**
 * Ordered list of fields the X.509 UI knows about. Order drives on-screen
 * presentation.
 */
export const KNOWN_X509_FIELDS: X509FieldSpec[] = [
    // TBS (mandatory) fields.
    {
        key: "version",
        name: "Version",
        location: "tbs",
        mandatory: true,
        description:
            "Certificate format version. v3 (value 2) is required when extensions are present.",
        rfc: "RFC 5280 §4.1.2.1",
    },
    {
        key: "serialNumber",
        name: "Serial number",
        location: "tbs",
        mandatory: true,
        description:
            "Positive integer assigned by the CA, unique per issuer. Up to 20 octets.",
        rfc: "RFC 5280 §4.1.2.2",
    },
    {
        key: "signatureAlgorithm",
        name: "Signature algorithm",
        location: "tbs",
        mandatory: true,
        description:
            "Algorithm used by the CA to sign the certificate (e.g. sha256WithRSAEncryption).",
        rfc: "RFC 5280 §4.1.2.3",
    },
    {
        key: "issuer",
        name: "Issuer",
        location: "tbs",
        mandatory: true,
        description:
            "Distinguished Name of the CA that signed the certificate.",
        rfc: "RFC 5280 §4.1.2.4",
    },
    {
        key: "validity",
        name: "Validity period",
        location: "tbs",
        mandatory: true,
        description:
            "Two timestamps that bound when the certificate is valid: notBefore and notAfter.",
        rfc: "RFC 5280 §4.1.2.5",
    },
    {
        key: "subject",
        name: "Subject",
        location: "tbs",
        mandatory: true,
        description:
            "Distinguished Name of the entity associated with the public key.",
        rfc: "RFC 5280 §4.1.2.6",
    },
    {
        key: "subjectPublicKey",
        name: "Subject public key",
        location: "tbs",
        mandatory: true,
        description:
            "Algorithm identifier and encoded public key of the subject.",
        rfc: "RFC 5280 §4.1.2.7",
    },
    {
        key: "signatureValue",
        name: "Signature value",
        location: "tbs",
        mandatory: true,
        description:
            "Digital signature computed over the TBSCertificate bytes with the signature algorithm.",
        rfc: "RFC 5280 §4.1.1.3",
    },

    // v3 extensions.
    {
        key: "ext:basicConstraints",
        name: "Basic constraints",
        location: "extension",
        mandatory: false,
        description:
            "Marks the certificate as a CA and bounds the path length. MUST be present on CA certs.",
        rfc: "RFC 5280 §4.2.1.9",
    },
    {
        key: "ext:keyUsage",
        name: "Key usage",
        location: "extension",
        mandatory: false,
        description:
            "Bit string listing the cryptographic operations the key may perform.",
        rfc: "RFC 5280 §4.2.1.3",
    },
    {
        key: "ext:extKeyUsage",
        name: "Extended key usage",
        location: "extension",
        mandatory: false,
        description:
            "Additional purposes the key may be used for (e.g. serverAuth, clientAuth).",
        rfc: "RFC 5280 §4.2.1.12",
    },
    {
        key: "ext:subjectAltName",
        name: "Subject alternative name",
        location: "extension",
        mandatory: false,
        description:
            "Alternative identities bound to the subject (DNS names, IPs, URIs, emails).",
        rfc: "RFC 5280 §4.2.1.6",
    },
    {
        key: "ext:subjectKeyIdentifier",
        name: "Subject key identifier",
        location: "extension",
        mandatory: false,
        description:
            "A unique identifier for the subject's public key. Required on CA certs.",
        rfc: "RFC 5280 §4.2.1.2",
    },
    {
        key: "ext:authorityKeyIdentifier",
        name: "Authority key identifier",
        location: "extension",
        mandatory: false,
        description:
            "Identifies the public key used to sign this certificate, matching the issuer's SKI.",
        rfc: "RFC 5280 §4.2.1.1",
    },
    {
        key: "ext:crlDistributionPoints",
        name: "CRL distribution points",
        location: "extension",
        mandatory: false,
        description:
            "Where to fetch the certificate revocation list for this issuer.",
        rfc: "RFC 5280 §4.2.1.13",
    },
    {
        key: "ext:authorityInfoAccess",
        name: "Authority information access",
        location: "extension",
        mandatory: false,
        description:
            "URLs that provide OCSP responses or the issuer's certificate.",
        rfc: "RFC 5280 §4.2.2.1",
    },
    {
        key: "ext:certificatePolicies",
        name: "Certificate policies",
        location: "extension",
        mandatory: false,
        description:
            "Policy identifiers under which the certificate was issued, with optional qualifiers.",
        rfc: "RFC 5280 §4.2.1.4",
    },

    // Derived values.
    {
        key: "fingerprint.sha256",
        name: "SHA-256 fingerprint",
        location: "derived",
        mandatory: false,
        description:
            "SHA-256 digest of the entire DER encoding of the certificate.",
    },
    {
        key: "fingerprint.sha1",
        name: "SHA-1 fingerprint",
        location: "derived",
        mandatory: false,
        description:
            "SHA-1 digest of the entire DER encoding. Legacy; SHA-256 is preferred.",
    },
];

/**
 * Whether the given field is present on this certificate.
 */
export function hasX509Field(cert: X509Decoded, spec: X509FieldSpec): boolean {
    if (spec.location === "tbs") {
        // All TBS fields covered in {@link KNOWN_X509_FIELDS} are mandatory
        // and therefore always present on a successfully-parsed cert.
        return true;
    }
    if (spec.location === "extension") {
        const oid = EXT_KEY_TO_OID[spec.key];
        if (!oid) return false;
        return cert.extensions.some((e) => e.oid === oid);
    }
    // Derived (fingerprints) are computed lazily by the UI.
    return false;
}

/**
 * Extensions present on the certificate that aren't in the known-field
 * catalog. Returned in the order they appear in the DER encoding.
 */
export function customX509Extensions(cert: X509Decoded): X509Extension[] {
    const known = new Set(Object.values(EXT_KEY_TO_OID));
    return cert.extensions.filter((e) => !known.has(e.oid));
}

const EXT_KEY_TO_OID: Record<string, string> = {
    "ext:basicConstraints": "2.5.29.19",
    "ext:keyUsage": "2.5.29.15",
    "ext:extKeyUsage": "2.5.29.37",
    "ext:subjectAltName": "2.5.29.17",
    "ext:subjectKeyIdentifier": "2.5.29.14",
    "ext:authorityKeyIdentifier": "2.5.29.35",
    "ext:crlDistributionPoints": "2.5.29.31",
    "ext:authorityInfoAccess": "1.3.6.1.5.5.7.1.1",
    "ext:certificatePolicies": "2.5.29.32",
};

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Parse a certificate from PEM or raw base64 DER input. Throws with a
 * human-readable message on malformed input.
 */
export function decodeX509(input: string): X509Decoded {
    const trimmed = input.trim();
    if (!trimmed) throw new Error("Empty input.");

    const { pem, derBytes } = inputToDer(trimmed);
    return parseCertificate(derBytes, pem);
}

function inputToDer(
    input: string,
): { pem: string | null; derBytes: Uint8Array } {
    const pemMatch = input.match(
        /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/,
    );
    if (pemMatch) {
        const b64 = pemMatch[1].replace(/\s+/g, "");
        try {
            return { pem: input, derBytes: base64ToBytes(b64) };
        } catch (e) {
            throw new Error(
                `PEM body is not valid base64 (${
                    e instanceof Error ? e.message : "unknown error"
                }).`,
            );
        }
    }
    // No PEM markers → treat the input as raw base64 DER. Allow URL-safe
    // alphabets and arbitrary whitespace.
    const cleaned = input.replace(/\s+/g, "").replace(/-/g, "+").replace(
        /_/g,
        "/",
    );
    try {
        return { pem: null, derBytes: base64ToBytes(cleaned) };
    } catch (e) {
        throw new Error(
            `Input is not a PEM block or valid base64 (${
                e instanceof Error ? e.message : "unknown error"
            }).`,
        );
    }
}

// ---------------------------------------------------------------------------
// Base64 ↔ bytes (runtime-independent).
// ---------------------------------------------------------------------------

function base64ToBytes(b64: string): Uint8Array {
    if (!/^[A-Za-z0-9+/]*=*$/.test(b64)) {
        throw new Error("contains non-base64 characters");
    }
    const padLen = (4 - (b64.length % 4)) % 4;
    const padded = b64 + "=".repeat(padLen);
    // Prefer `atob` when available (browser), fall back to `Buffer` (Node).
    if (typeof atob === "function") {
        const binary = atob(padded);
        const out = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
        return out;
    }
    const nodeBuffer = (globalThis as unknown as {
        Buffer?: {
            from: (data: string, encoding: string) => { [i: number]: number; length: number };
        };
    }).Buffer;
    if (nodeBuffer) {
        const buf = nodeBuffer.from(padded, "base64");
        const out = new Uint8Array(buf.length);
        for (let i = 0; i < buf.length; i++) out[i] = buf[i];
        return out;
    }
    throw new Error("no base64 decoder available in this runtime");
}

// ---------------------------------------------------------------------------
// Tiny DER / ASN.1 reader.
// ---------------------------------------------------------------------------

interface Tlv {
    /** Tag byte as encountered in the stream. */
    tag: number;
    /** Tag class: 0=universal, 1=application, 2=context, 3=private. */
    cls: number;
    /** Whether the primitive/constructed bit is set. */
    constructed: boolean;
    /** Tag number (low 5 bits for low tags; multi-byte unsupported here). */
    tagNumber: number;
    /** Bytes of the value only (not including tag/length). */
    value: Uint8Array;
    /** Byte offset of the TLV start in the parent buffer. */
    start: number;
    /** Byte offset one past the TLV end in the parent buffer. */
    end: number;
}

class DerReader {
    private readonly bytes: Uint8Array;
    private offset = 0;
    constructor(bytes: Uint8Array) {
        this.bytes = bytes;
    }

    get remaining(): number {
        return this.bytes.length - this.offset;
    }

    peekTag(): number | null {
        if (this.offset >= this.bytes.length) return null;
        return this.bytes[this.offset];
    }

    /** Read the next TLV from the stream and advance past it. */
    read(): Tlv {
        if (this.offset >= this.bytes.length) {
            throw new Error("Unexpected end of DER stream");
        }
        const start = this.offset;
        const tag = this.bytes[this.offset++];
        const cls = (tag & 0xc0) >> 6;
        const constructed = (tag & 0x20) !== 0;
        const low = tag & 0x1f;
        if (low === 0x1f) {
            throw new Error(
                "Multi-byte ASN.1 tags are not supported by this parser.",
            );
        }
        const length = this.readLength();
        if (this.offset + length > this.bytes.length) {
            throw new Error("DER length overruns buffer");
        }
        const value = this.bytes.subarray(this.offset, this.offset + length);
        this.offset += length;
        return {
            tag,
            cls,
            constructed,
            tagNumber: low,
            value,
            start,
            end: this.offset,
        };
    }

    private readLength(): number {
        const first = this.bytes[this.offset++];
        if ((first & 0x80) === 0) return first;
        const n = first & 0x7f;
        if (n === 0) {
            throw new Error(
                "Indefinite-length encodings are not valid in DER.",
            );
        }
        if (n > 4) throw new Error("Unsupported DER length size");
        let len = 0;
        for (let i = 0; i < n; i++) {
            len = (len << 8) | this.bytes[this.offset++];
        }
        return len;
    }
}

function readSequence(bytes: Uint8Array): Tlv[] {
    const reader = new DerReader(bytes);
    const items: Tlv[] = [];
    while (reader.remaining > 0) items.push(reader.read());
    return items;
}

function expect(tlv: Tlv, tag: number, what: string): void {
    if (tlv.tag !== tag) {
        throw new Error(
            `${what}: expected tag 0x${tag.toString(16)}, got 0x${
                tlv.tag.toString(16)
            }`,
        );
    }
}

// ---------------------------------------------------------------------------
// Encoded value helpers.
// ---------------------------------------------------------------------------

function bytesToHexColon(bytes: Uint8Array): string {
    if (bytes.length === 0) return "";
    const out: string[] = [];
    for (let i = 0; i < bytes.length; i++) {
        out.push(bytes[i].toString(16).padStart(2, "0"));
    }
    return out.join(":");
}

function bytesToBase64(bytes: Uint8Array): string {
    if (typeof btoa === "function") {
        let binary = "";
        for (let i = 0; i < bytes.length; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }
    const nodeBuffer = (globalThis as unknown as {
        Buffer?: {
            from: (data: Uint8Array) => { toString: (encoding: string) => string };
        };
    }).Buffer;
    if (nodeBuffer) {
        return nodeBuffer.from(bytes).toString("base64");
    }
    throw new Error("no base64 encoder available in this runtime");
}

function readInteger(bytes: Uint8Array): bigint {
    if (bytes.length === 0) return 0n;
    let n = 0n;
    for (let i = 0; i < bytes.length; i++) n = (n << 8n) | BigInt(bytes[i]);
    // Negative numbers (not expected on cert serials, but handle correctly).
    if ((bytes[0] & 0x80) !== 0) {
        n -= 1n << BigInt(bytes.length * 8);
    }
    return n;
}

function readOid(bytes: Uint8Array): string {
    if (bytes.length === 0) return "";
    const parts: number[] = [];
    const first = bytes[0];
    parts.push(Math.floor(first / 40));
    parts.push(first % 40);
    let value = 0;
    for (let i = 1; i < bytes.length; i++) {
        value = (value << 7) | (bytes[i] & 0x7f);
        if ((bytes[i] & 0x80) === 0) {
            parts.push(value);
            value = 0;
        }
    }
    return parts.join(".");
}

function readUtf8(bytes: Uint8Array): string {
    return new TextDecoder("utf-8").decode(bytes);
}

function readBmp(bytes: Uint8Array): string {
    // UCS-2 big-endian.
    let out = "";
    for (let i = 0; i + 1 < bytes.length; i += 2) {
        out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    }
    return out;
}

function readPrintable(bytes: Uint8Array): string {
    let out = "";
    for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
    return out;
}

function readDirectoryString(tlv: Tlv): string {
    // DirectoryString CHOICE: PrintableString, UTF8String, TeletexString, UniversalString, BMPString, IA5String.
    switch (tlv.tag) {
        case 0x0c: // UTF8String
            return readUtf8(tlv.value);
        case 0x13: // PrintableString
        case 0x14: // TeletexString / T61String
        case 0x16: // IA5String
            return readPrintable(tlv.value);
        case 0x1e: // BMPString
            return readBmp(tlv.value);
        case 0x1c: // UniversalString (UCS-4)
            // Not seen in practice, fall through to printable.
            return readPrintable(tlv.value);
        default:
            return readPrintable(tlv.value);
    }
}

function readTime(tlv: Tlv): Date {
    const s = readPrintable(tlv.value);
    // UTCTime  YYMMDDHHMMSSZ    (tag 0x17)
    // GeneralizedTime YYYYMMDDHHMMSSZ (tag 0x18)
    if (tlv.tag === 0x17) {
        // RFC 5280 §4.1.2.5.1: 2-digit year, pivot at 50.
        const m = s.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/);
        if (!m) throw new Error(`Bad UTCTime value: ${s}`);
        const yy = parseInt(m[1], 10);
        const year = yy >= 50 ? 1900 + yy : 2000 + yy;
        return new Date(Date.UTC(
            year,
            parseInt(m[2], 10) - 1,
            parseInt(m[3], 10),
            parseInt(m[4], 10),
            parseInt(m[5], 10),
            parseInt(m[6], 10),
        ));
    }
    if (tlv.tag === 0x18) {
        const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/);
        if (!m) throw new Error(`Bad GeneralizedTime value: ${s}`);
        return new Date(Date.UTC(
            parseInt(m[1], 10),
            parseInt(m[2], 10) - 1,
            parseInt(m[3], 10),
            parseInt(m[4], 10),
            parseInt(m[5], 10),
            parseInt(m[6], 10),
        ));
    }
    throw new Error(`Unsupported time tag 0x${tlv.tag.toString(16)}`);
}

function readBitString(bytes: Uint8Array): {
    unusedBits: number;
    bits: Uint8Array;
} {
    if (bytes.length === 0) return { unusedBits: 0, bits: new Uint8Array(0) };
    return { unusedBits: bytes[0], bits: bytes.subarray(1) };
}

// ---------------------------------------------------------------------------
// Known OID → friendly name tables.
// ---------------------------------------------------------------------------

const SIG_ALG_NAMES: Record<string, string> = {
    "1.2.840.113549.1.1.1": "rsaEncryption",
    "1.2.840.113549.1.1.5": "sha1WithRSAEncryption",
    "1.2.840.113549.1.1.11": "sha256WithRSAEncryption",
    "1.2.840.113549.1.1.12": "sha384WithRSAEncryption",
    "1.2.840.113549.1.1.13": "sha512WithRSAEncryption",
    "1.2.840.113549.1.1.10": "rsassa-pss",
    "1.2.840.10045.2.1": "ecPublicKey",
    "1.2.840.10045.4.1": "ecdsa-with-SHA1",
    "1.2.840.10045.4.3.2": "ecdsa-with-SHA256",
    "1.2.840.10045.4.3.3": "ecdsa-with-SHA384",
    "1.2.840.10045.4.3.4": "ecdsa-with-SHA512",
    "1.3.101.112": "Ed25519",
    "1.3.101.113": "Ed448",
};

const PUBLIC_KEY_ALG_NAMES: Record<string, string> = {
    "1.2.840.113549.1.1.1": "RSA",
    "1.2.840.10045.2.1": "EC",
    "1.3.101.112": "Ed25519",
    "1.3.101.113": "Ed448",
};

const CURVE_NAMES: Record<string, string> = {
    "1.2.840.10045.3.1.7": "P-256",
    "1.3.132.0.34": "P-384",
    "1.3.132.0.35": "P-521",
    "1.3.132.0.10": "secp256k1",
};

const NAME_ATTR_TYPES: Record<string, string> = {
    "2.5.4.3": "CN",
    "2.5.4.4": "SN",
    "2.5.4.5": "serialNumber",
    "2.5.4.6": "C",
    "2.5.4.7": "L",
    "2.5.4.8": "ST",
    "2.5.4.9": "street",
    "2.5.4.10": "O",
    "2.5.4.11": "OU",
    "2.5.4.12": "title",
    "2.5.4.42": "givenName",
    "0.9.2342.19200300.100.1.25": "DC",
    "1.2.840.113549.1.9.1": "emailAddress",
    "2.5.4.15": "businessCategory",
    "2.5.4.17": "postalCode",
    "1.3.6.1.4.1.311.60.2.1.3": "jurisdictionC",
};

const EXT_NAMES: Record<string, string> = {
    "2.5.29.14": "subjectKeyIdentifier",
    "2.5.29.15": "keyUsage",
    "2.5.29.17": "subjectAltName",
    "2.5.29.18": "issuerAltName",
    "2.5.29.19": "basicConstraints",
    "2.5.29.31": "cRLDistributionPoints",
    "2.5.29.32": "certificatePolicies",
    "2.5.29.33": "policyMappings",
    "2.5.29.35": "authorityKeyIdentifier",
    "2.5.29.37": "extKeyUsage",
    "1.3.6.1.5.5.7.1.1": "authorityInfoAccess",
    "1.3.6.1.5.5.7.1.11": "subjectInfoAccess",
};

const EXT_KEY_USAGE_NAMES: Record<string, string> = {
    "1.3.6.1.5.5.7.3.1": "serverAuth",
    "1.3.6.1.5.5.7.3.2": "clientAuth",
    "1.3.6.1.5.5.7.3.3": "codeSigning",
    "1.3.6.1.5.5.7.3.4": "emailProtection",
    "1.3.6.1.5.5.7.3.8": "timeStamping",
    "1.3.6.1.5.5.7.3.9": "OCSPSigning",
};

const ACCESS_METHOD_NAMES: Record<string, string> = {
    "1.3.6.1.5.5.7.48.1": "ocsp",
    "1.3.6.1.5.5.7.48.2": "caIssuers",
    "1.3.6.1.5.5.7.48.3": "timeStamping",
};

const KEY_USAGE_BITS = [
    "digitalSignature",
    "nonRepudiation",
    "keyEncipherment",
    "dataEncipherment",
    "keyAgreement",
    "keyCertSign",
    "cRLSign",
    "encipherOnly",
    "decipherOnly",
];

// ---------------------------------------------------------------------------
// Top-level certificate parser.
// ---------------------------------------------------------------------------

function parseCertificate(
    der: Uint8Array,
    pem: string | null,
): X509Decoded {
    // Certificate  ::=  SEQUENCE  { tbsCertificate, signatureAlgorithm,
    //                               signature BIT STRING }
    const outer = new DerReader(der).read();
    if (!outer.constructed || outer.tag !== 0x30) {
        throw new Error(
            "Expected an outer SEQUENCE (did you paste a certificate?).",
        );
    }
    if (outer.end !== der.length) {
        // Trailing bytes outside the top-level SEQUENCE — tolerate silently
        // since many tools append newlines, but refuse if there's actual
        // ASN.1 after it.
        // (No-op; we proceed with `outer.value`.)
    }

    const inner = readSequence(outer.value);
    if (inner.length !== 3) {
        throw new Error(
            `Expected 3 children in Certificate, got ${inner.length}.`,
        );
    }
    const [tbsTlv, sigAlgTlv, sigTlv] = inner;
    expect(tbsTlv, 0x30, "TBSCertificate");
    expect(sigAlgTlv, 0x30, "signatureAlgorithm");
    expect(sigTlv, 0x03, "signature");

    const tbsBytes = der.subarray(tbsTlv.start, tbsTlv.end);
    const tbs = parseTbs(tbsTlv.value);
    const sigAlgOid = parseAlgorithmIdentifier(sigAlgTlv.value).oid;
    const sigBits = readBitString(sigTlv.value).bits;

    return {
        pem,
        derBytes: der,
        tbsBytes,
        version: tbs.version,
        serialNumber: tbs.serialNumber,
        signatureAlgorithm: SIG_ALG_NAMES[sigAlgOid] ?? sigAlgOid,
        signatureAlgorithmOid: sigAlgOid,
        issuer: tbs.issuer,
        validity: tbs.validity,
        subject: tbs.subject,
        subjectPublicKey: tbs.subjectPublicKey,
        issuerUniqueId: tbs.issuerUniqueId,
        subjectUniqueId: tbs.subjectUniqueId,
        extensions: tbs.extensions,
        signature: {
            hex: bytesToHexColon(sigBits),
            bytes: sigBits,
        },
    };
}

// ---------------------------------------------------------------------------
// TBSCertificate.
// ---------------------------------------------------------------------------

interface ParsedTbs {
    version: number;
    serialNumber: string;
    issuer: X509Name;
    validity: { notBefore: Date; notAfter: Date };
    subject: X509Name;
    subjectPublicKey: X509PublicKey;
    issuerUniqueId?: string;
    subjectUniqueId?: string;
    extensions: X509Extension[];
}

function parseTbs(tbs: Uint8Array): ParsedTbs {
    const reader = new DerReader(tbs);
    let version = 1;
    let next = reader.read();

    // Optional EXPLICIT [0] version.
    if (next.cls === 2 && next.tagNumber === 0 && next.constructed) {
        const inner = new DerReader(next.value).read();
        expect(inner, 0x02, "version INTEGER");
        version = Number(readInteger(inner.value)) + 1;
        next = reader.read();
    }

    // serialNumber.
    expect(next, 0x02, "serialNumber");
    const serialBytes = next.value;
    // Trim a single leading 0x00 that was only there to force positivity.
    const serialDisplay = serialBytes.length > 1 && serialBytes[0] === 0 &&
            (serialBytes[1] & 0x80) !== 0
        ? bytesToHexColon(serialBytes.subarray(1))
        : bytesToHexColon(serialBytes);

    // signature (AlgorithmIdentifier) — redundant with the outer one but
    // required by the ASN.1 definition. We keep it for structural purposes
    // only; the public value is the outer signatureAlgorithm.
    const sigAlgTlv = reader.read();
    expect(sigAlgTlv, 0x30, "TBS signature AlgorithmIdentifier");

    // issuer, validity, subject.
    const issuerTlv = reader.read();
    expect(issuerTlv, 0x30, "issuer");
    const issuer = parseName(issuerTlv.value);

    const validityTlv = reader.read();
    expect(validityTlv, 0x30, "validity");
    const validityParts = readSequence(validityTlv.value);
    if (validityParts.length !== 2) {
        throw new Error("validity must contain exactly 2 fields");
    }
    const notBefore = readTime(validityParts[0]);
    const notAfter = readTime(validityParts[1]);

    const subjectTlv = reader.read();
    expect(subjectTlv, 0x30, "subject");
    const subject = parseName(subjectTlv.value);

    // subjectPublicKeyInfo.
    const spkiTlv = reader.read();
    expect(spkiTlv, 0x30, "subjectPublicKeyInfo");
    const spkiBytes = tbs.subarray(spkiTlv.start, spkiTlv.end);
    const subjectPublicKey = parseSpki(spkiTlv.value, spkiBytes);

    // Optional context-specific fields: [1] issuerUniqueID, [2] subjectUniqueID,
    // [3] extensions. Any combination may be present.
    let issuerUniqueId: string | undefined;
    let subjectUniqueId: string | undefined;
    let extensions: X509Extension[] = [];

    while (reader.remaining > 0) {
        const tlv = reader.read();
        if (tlv.cls !== 2) {
            throw new Error(
                `Unexpected TBS trailer tag 0x${tlv.tag.toString(16)}`,
            );
        }
        if (tlv.tagNumber === 1) {
            // issuerUniqueID — implicit BIT STRING.
            const { bits } = readBitString(tlv.value);
            issuerUniqueId = bytesToHexColon(bits);
        } else if (tlv.tagNumber === 2) {
            const { bits } = readBitString(tlv.value);
            subjectUniqueId = bytesToHexColon(bits);
        } else if (tlv.tagNumber === 3) {
            // extensions is EXPLICIT [3] SEQUENCE OF Extension.
            const extSeq = new DerReader(tlv.value).read();
            expect(extSeq, 0x30, "extensions");
            extensions = readSequence(extSeq.value).map(parseExtension);
        } else {
            // Unknown context-specific tag — ignore to stay lenient.
        }
    }

    return {
        version,
        serialNumber: serialDisplay,
        issuer,
        validity: { notBefore, notAfter },
        subject,
        subjectPublicKey,
        issuerUniqueId,
        subjectUniqueId,
        extensions,
    };
}

// ---------------------------------------------------------------------------
// Name / RDN parsing.
// ---------------------------------------------------------------------------

function parseName(bytes: Uint8Array): X509Name {
    const rdns: X509Name["rdns"] = [];
    for (const rdn of readSequence(bytes)) {
        // Each RDN is a SET of AttributeTypeAndValue.
        expect(rdn, 0x31, "RDN");
        for (const atv of readSequence(rdn.value)) {
            expect(atv, 0x30, "AttributeTypeAndValue");
            const parts = readSequence(atv.value);
            if (parts.length !== 2) continue;
            const oid = readOid(parts[0].value);
            const value = readDirectoryString(parts[1]);
            rdns.push({ type: NAME_ATTR_TYPES[oid] ?? oid, oid, value });
        }
    }
    // Build a readable DN. We mirror OpenSSL's `-nameopt RFC2253`-ish
    // flavour: comma-separated with trailing whitespace.
    const dn = rdns.map((r) => `${r.type}=${escapeDnValue(r.value)}`).join(", ");
    return { dn, rdns };
}

function escapeDnValue(value: string): string {
    // RFC 4514 §2.4 escape set, minus the leading/trailing space rules
    // which don't matter for display purposes.
    return value.replace(/([,+"\\<>;])/g, "\\$1");
}

// ---------------------------------------------------------------------------
// SubjectPublicKeyInfo.
// ---------------------------------------------------------------------------

function parseSpki(bytes: Uint8Array, rawSpki: Uint8Array): X509PublicKey {
    const parts = readSequence(bytes);
    if (parts.length !== 2) {
        throw new Error("subjectPublicKeyInfo must have 2 fields");
    }
    const alg = parseAlgorithmIdentifier(parts[0].value);
    expect(parts[1], 0x03, "subjectPublicKey BIT STRING");
    const { bits } = readBitString(parts[1].value);

    const algorithm = PUBLIC_KEY_ALG_NAMES[alg.oid] ?? alg.oid;

    let curve: string | undefined;
    let sizeBits: number | undefined;

    if (alg.oid === "1.2.840.10045.2.1") {
        // EC. Parameters is a named-curve OID (ANY in the DER grammar, so
        // we parse the parameter TLV, not its inner value).
        if (alg.parametersTlv && alg.parametersTlv.tag === 0x06) {
            const curveOid = readOid(alg.parametersTlv.value);
            curve = CURVE_NAMES[curveOid] ?? curveOid;
        }
        // Encoded EC point: 0x04 || X || Y for uncompressed. Field size
        // is the length of X in bits.
        if (bits.length >= 1 && bits[0] === 0x04) {
            const coordLen = (bits.length - 1) / 2;
            if (Number.isInteger(coordLen)) sizeBits = coordLen * 8;
        }
    } else if (alg.oid === "1.2.840.113549.1.1.1") {
        // RSA. The BIT STRING contains an RSAPublicKey SEQUENCE.
        try {
            const rsa = new DerReader(bits).read();
            if (rsa.tag === 0x30) {
                const rsaParts = readSequence(rsa.value);
                if (rsaParts.length >= 1 && rsaParts[0].tag === 0x02) {
                    // Trim a leading 0x00 padding byte if present.
                    const modulus = rsaParts[0].value;
                    const mod = modulus.length > 0 && modulus[0] === 0
                        ? modulus.subarray(1)
                        : modulus;
                    sizeBits = mod.length * 8;
                }
            }
        } catch {
            // Non-fatal; leave sizeBits unset.
        }
    }

    return {
        algorithm,
        algorithmOid: alg.oid,
        curve,
        sizeBits,
        rawDer: rawSpki,
        base64Der: bytesToBase64(rawSpki),
    };
}

function parseAlgorithmIdentifier(
    bytes: Uint8Array,
): { oid: string; parametersTlv: Tlv | null } {
    const parts = readSequence(bytes);
    if (parts.length < 1) throw new Error("empty AlgorithmIdentifier");
    expect(parts[0], 0x06, "algorithm OID");
    const oid = readOid(parts[0].value);
    // Keep the full TLV so callers can discriminate NULL from a named-curve
    // OID or a structured value.
    const parametersTlv = parts.length > 1 ? parts[1] : null;
    return { oid, parametersTlv };
}

// ---------------------------------------------------------------------------
// Extensions.
// ---------------------------------------------------------------------------

function parseExtension(tlv: Tlv): X509Extension {
    expect(tlv, 0x30, "Extension");
    const parts = readSequence(tlv.value);
    if (parts.length < 2 || parts.length > 3) {
        throw new Error(
            `Extension must have 2 or 3 fields, got ${parts.length}`,
        );
    }
    expect(parts[0], 0x06, "extension OID");
    const oid = readOid(parts[0].value);

    let critical = false;
    let valueTlv: Tlv;
    if (parts.length === 3) {
        expect(parts[1], 0x01, "extension critical BOOLEAN");
        critical = parts[1].value.length > 0 && parts[1].value[0] !== 0;
        valueTlv = parts[2];
    } else {
        valueTlv = parts[1];
    }
    expect(valueTlv, 0x04, "extnValue OCTET STRING");

    const name = EXT_NAMES[oid] ?? oid;
    const value = parseExtensionValue(oid, valueTlv.value);
    return { oid, name, critical, value };
}

function parseExtensionValue(oid: string, bytes: Uint8Array): X509ExtensionValue {
    try {
        switch (oid) {
            case "2.5.29.19":
                return parseBasicConstraints(bytes);
            case "2.5.29.15":
                return parseKeyUsage(bytes);
            case "2.5.29.37":
                return parseExtKeyUsage(bytes);
            case "2.5.29.17":
                return parseSubjectAltName(bytes);
            case "2.5.29.14":
                return parseSubjectKeyIdentifier(bytes);
            case "2.5.29.35":
                return parseAuthorityKeyIdentifier(bytes);
            case "2.5.29.31":
                return parseCrlDistributionPoints(bytes);
            case "1.3.6.1.5.5.7.1.1":
                return parseAuthorityInfoAccess(bytes);
            case "2.5.29.32":
                return parseCertificatePolicies(bytes);
            default:
                return { kind: "unknown", hex: bytesToHexColon(bytes) };
        }
    } catch {
        // Fall back to the hex blob so a parse hiccup never kills the whole
        // page.
        return { kind: "unknown", hex: bytesToHexColon(bytes) };
    }
}

function parseBasicConstraints(bytes: Uint8Array): X509ExtensionValue {
    const outer = new DerReader(bytes).read();
    expect(outer, 0x30, "BasicConstraints");
    let ca = false;
    let pathLenConstraint: number | undefined;
    for (const part of readSequence(outer.value)) {
        if (part.tag === 0x01) {
            ca = part.value.length > 0 && part.value[0] !== 0;
        } else if (part.tag === 0x02) {
            pathLenConstraint = Number(readInteger(part.value));
        }
    }
    return { kind: "basicConstraints", ca, pathLenConstraint };
}

function parseKeyUsage(bytes: Uint8Array): X509ExtensionValue {
    const tlv = new DerReader(bytes).read();
    expect(tlv, 0x03, "KeyUsage BIT STRING");
    const { unusedBits, bits } = readBitString(tlv.value);
    const usages: string[] = [];
    for (let i = 0; i < KEY_USAGE_BITS.length; i++) {
        const byteIdx = Math.floor(i / 8);
        if (byteIdx >= bits.length) break;
        const bitIdx = 7 - (i % 8);
        if (byteIdx === bits.length - 1 && bitIdx < unusedBits) break;
        if ((bits[byteIdx] >> bitIdx) & 1) usages.push(KEY_USAGE_BITS[i]);
    }
    return { kind: "keyUsage", usages };
}

function parseExtKeyUsage(bytes: Uint8Array): X509ExtensionValue {
    const outer = new DerReader(bytes).read();
    expect(outer, 0x30, "ExtKeyUsage");
    const usages: string[] = [];
    for (const part of readSequence(outer.value)) {
        expect(part, 0x06, "ExtKeyUsage OID");
        const oid = readOid(part.value);
        usages.push(EXT_KEY_USAGE_NAMES[oid] ?? oid);
    }
    return { kind: "extKeyUsage", usages };
}

function parseSubjectAltName(bytes: Uint8Array): X509ExtensionValue {
    const outer = new DerReader(bytes).read();
    expect(outer, 0x30, "SubjectAltName");
    const names: Array<{ type: string; value: string }> = [];
    for (const n of readSequence(outer.value)) {
        if (n.cls !== 2) continue;
        switch (n.tagNumber) {
            case 1: // rfc822Name
                names.push({ type: "email", value: readPrintable(n.value) });
                break;
            case 2: // dNSName
                names.push({ type: "DNS", value: readPrintable(n.value) });
                break;
            case 6: // uniformResourceIdentifier
                names.push({ type: "URI", value: readPrintable(n.value) });
                break;
            case 7: // iPAddress
                names.push({ type: "IP", value: formatIpBytes(n.value) });
                break;
            case 8: // registeredID
                names.push({ type: "OID", value: readOid(n.value) });
                break;
            case 4: // directoryName
                if (n.constructed) {
                    const inner = new DerReader(n.value).read();
                    if (inner.tag === 0x30) {
                        const name = parseName(inner.value);
                        names.push({ type: "DN", value: name.dn });
                    }
                }
                break;
            default:
                names.push({
                    type: `otherName[${n.tagNumber}]`,
                    value: bytesToHexColon(n.value),
                });
        }
    }
    return { kind: "subjectAltName", names };
}

function formatIpBytes(bytes: Uint8Array): string {
    if (bytes.length === 4) {
        return `${bytes[0]}.${bytes[1]}.${bytes[2]}.${bytes[3]}`;
    }
    if (bytes.length === 16) {
        const parts: string[] = [];
        for (let i = 0; i < 16; i += 2) {
            parts.push(((bytes[i] << 8) | bytes[i + 1]).toString(16));
        }
        return parts.join(":");
    }
    return bytesToHexColon(bytes);
}

function parseSubjectKeyIdentifier(bytes: Uint8Array): X509ExtensionValue {
    const tlv = new DerReader(bytes).read();
    expect(tlv, 0x04, "SubjectKeyIdentifier OCTET STRING");
    return { kind: "subjectKeyIdentifier", keyId: bytesToHexColon(tlv.value) };
}

function parseAuthorityKeyIdentifier(
    bytes: Uint8Array,
): X509ExtensionValue {
    const outer = new DerReader(bytes).read();
    expect(outer, 0x30, "AuthorityKeyIdentifier");
    let keyId: string | undefined;
    let issuer: string | undefined;
    let serialNumber: string | undefined;
    for (const part of readSequence(outer.value)) {
        if (part.cls === 2 && part.tagNumber === 0) {
            keyId = bytesToHexColon(part.value);
        } else if (part.cls === 2 && part.tagNumber === 1) {
            // authorityCertIssuer — GeneralNames.
            try {
                const first = new DerReader(part.value).read();
                if (first.cls === 2 && first.tagNumber === 4) {
                    const inner = new DerReader(first.value).read();
                    if (inner.tag === 0x30) {
                        issuer = parseName(inner.value).dn;
                    }
                }
            } catch {
                // Keep going; issuer stays unset.
            }
        } else if (part.cls === 2 && part.tagNumber === 2) {
            serialNumber = bytesToHexColon(part.value);
        }
    }
    return { kind: "authorityKeyIdentifier", keyId, issuer, serialNumber };
}

function parseCrlDistributionPoints(bytes: Uint8Array): X509ExtensionValue {
    const outer = new DerReader(bytes).read();
    expect(outer, 0x30, "CRLDistributionPoints");
    const urls: string[] = [];
    for (const dp of readSequence(outer.value)) {
        if (dp.tag !== 0x30) continue;
        // DistributionPoint { distributionPoint [0], ... }
        for (const part of readSequence(dp.value)) {
            if (part.cls !== 2 || part.tagNumber !== 0) continue;
            // distributionPoint [0] CHOICE { fullName [0] GeneralNames }
            const inner = new DerReader(part.value).read();
            if (inner.cls !== 2 || inner.tagNumber !== 0) continue;
            for (const gn of readSequence(inner.value)) {
                if (gn.cls === 2 && gn.tagNumber === 6) {
                    urls.push(readPrintable(gn.value));
                }
            }
        }
    }
    return { kind: "crlDistributionPoints", urls };
}

function parseAuthorityInfoAccess(bytes: Uint8Array): X509ExtensionValue {
    const outer = new DerReader(bytes).read();
    expect(outer, 0x30, "AuthorityInfoAccess");
    const entries: Array<{ method: string; methodOid: string; location: string }> = [];
    for (const desc of readSequence(outer.value)) {
        if (desc.tag !== 0x30) continue;
        const parts = readSequence(desc.value);
        if (parts.length !== 2) continue;
        expect(parts[0], 0x06, "accessMethod OID");
        const methodOid = readOid(parts[0].value);
        const method = ACCESS_METHOD_NAMES[methodOid] ?? methodOid;
        const gn = parts[1];
        let location = "";
        if (gn.cls === 2 && gn.tagNumber === 6) {
            location = readPrintable(gn.value);
        } else {
            location = bytesToHexColon(gn.value);
        }
        entries.push({ method, methodOid, location });
    }
    return { kind: "authorityInfoAccess", entries };
}

function parseCertificatePolicies(bytes: Uint8Array): X509ExtensionValue {
    const outer = new DerReader(bytes).read();
    expect(outer, 0x30, "CertificatePolicies");
    const policies: Array<{ oid: string; qualifiers: string[] }> = [];
    for (const info of readSequence(outer.value)) {
        if (info.tag !== 0x30) continue;
        const parts = readSequence(info.value);
        if (parts.length < 1) continue;
        expect(parts[0], 0x06, "policyIdentifier");
        const oid = readOid(parts[0].value);
        const qualifiers: string[] = [];
        if (parts.length >= 2 && parts[1].tag === 0x30) {
            for (const q of readSequence(parts[1].value)) {
                if (q.tag !== 0x30) continue;
                const qp = readSequence(q.value);
                if (qp.length < 2) continue;
                const qOid = readOid(qp[0].value);
                if (qOid === "1.3.6.1.5.5.7.2.1") {
                    // CPS URI (IA5String).
                    qualifiers.push(`CPS: ${readPrintable(qp[1].value)}`);
                } else if (qOid === "1.3.6.1.5.5.7.2.2") {
                    // User notice — pull out explicitText if it's a string.
                    try {
                        const notice = new DerReader(qp[1].value).read();
                        if (notice.tag === 0x30) {
                            const noticeParts = readSequence(notice.value);
                            for (const np of noticeParts) {
                                if (
                                    np.tag === 0x0c || np.tag === 0x1e ||
                                    np.tag === 0x13 || np.tag === 0x14
                                ) {
                                    qualifiers.push(
                                        `UserNotice: ${readDirectoryString(np)}`,
                                    );
                                }
                            }
                        }
                    } catch {
                        qualifiers.push("UserNotice");
                    }
                } else {
                    qualifiers.push(qOid);
                }
            }
        }
        policies.push({ oid, qualifiers });
    }
    return { kind: "certificatePolicies", policies };
}

// ---------------------------------------------------------------------------
// Fingerprints.
// ---------------------------------------------------------------------------

/**
 * Compute SHA-1 and SHA-256 digests of the certificate's DER encoding.
 * Uses `crypto.subtle` (available in modern browsers and recent Node).
 */
export async function computeFingerprints(
    cert: X509Decoded,
): Promise<{ sha1: string; sha256: string }> {
    const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
    if (!subtle) {
        throw new Error(
            "crypto.subtle is not available; cannot compute fingerprints.",
        );
    }
    // Copy into a dedicated ArrayBuffer. This avoids a `SharedArrayBuffer`
    // type widening on `.buffer` and works across runtimes that reject
    // typed-array-backed inputs for `digest`.
    const copy = new ArrayBuffer(cert.derBytes.byteLength);
    new Uint8Array(copy).set(cert.derBytes);
    const [sha1Buf, sha256Buf] = await Promise.all([
        subtle.digest("SHA-1", copy),
        subtle.digest("SHA-256", copy),
    ]);
    return {
        sha1: bytesToHexColon(new Uint8Array(sha1Buf)),
        sha256: bytesToHexColon(new Uint8Array(sha256Buf)),
    };
}

// ---------------------------------------------------------------------------
// Validity analysis
// ---------------------------------------------------------------------------

export type X509ValidityState = "pending" | "active" | "expired";

export interface X509ValidityStatus {
    /** Lifecycle bucket of the certificate relative to `now`. */
    state: X509ValidityState;
    /** One-line, user-facing summary (English). */
    message: string;
    /** `notBefore` as a human-readable UTC date. */
    notBeforeText: string;
    /** `notAfter` as a human-readable UTC date. */
    notAfterText: string;
    /**
     * Seconds remaining until `notAfter` relative to `now`. Negative
     * when the certificate has already expired.
     */
    secondsUntilExpiry: number;
}

/**
 * Classify a certificate's validity window relative to `now` and build
 * a short English summary. Used both by the UI (badge in the validity
 * row) and the API (`analysis` block). `now` defaults to the wall clock
 * but can be injected for deterministic tests.
 */
export function describeValidity(
    cert: X509Decoded,
    now: Date = new Date(),
): X509ValidityStatus {
    const nowSec = Math.floor(now.getTime() / 1000);
    const notBeforeSec = Math.floor(cert.validity.notBefore.getTime() / 1000);
    const notAfterSec = Math.floor(cert.validity.notAfter.getTime() / 1000);
    const notBeforeText = formatUtcDateTime(notBeforeSec);
    const notAfterText = formatUtcDateTime(notAfterSec);
    const secondsUntilExpiry = notAfterSec - nowSec;

    if (nowSec < notBeforeSec) {
        return {
            state: "pending",
            message:
                `Certificate is not yet valid; becomes valid in ${
                    verboseDuration(notBeforeSec - nowSec)
                }.`,
            notBeforeText,
            notAfterText,
            secondsUntilExpiry,
        };
    }

    if (secondsUntilExpiry <= 0) {
        return {
            state: "expired",
            message: `Certificate expired ${
                relativeDuration(secondsUntilExpiry)
            }.`,
            notBeforeText,
            notAfterText,
            secondsUntilExpiry,
        };
    }

    return {
        state: "active",
        message: `Certificate is valid for another ${
            verboseDuration(secondsUntilExpiry)
        }.`,
        notBeforeText,
        notAfterText,
        secondsUntilExpiry,
    };
}

// ---------------------------------------------------------------------------
// JSON summary
// ---------------------------------------------------------------------------

/**
 * Canonical JSON summary of a parsed certificate. Shared by the web UI
 * (right-column `DecodedBlock`s + Copy JSON button) and the HTTP API
 * (`POST /api/v1/x509` response body) so both views stay in lock-step.
 *
 * Binary blobs (`pem`, `derBytes`, `tbsBytes`) are intentionally
 * omitted — the caller already has the input, and raw bytes don't
 * belong in a JSON payload.
 *
 * `fingerprints` is populated when supplied by the caller (both the UI
 * and the API compute them via {@link computeFingerprints} separately).
 */
export interface X509JsonSummary {
    /** TBS and signature-level fields. */
    certificate: {
        version: number;
        serialNumber: string;
        signatureAlgorithm: string;
        signatureAlgorithmOid: string;
        issuer: string;
        validity: { notBefore: string; notAfter: string };
        subject: string;
        subjectPublicKey: {
            algorithm: string;
            algorithmOid: string;
            curve?: string;
            sizeBits?: number;
        };
    };
    /** Keyed by `ext:<name>` for known extensions, `ext:<oid>` otherwise. */
    extensions: Record<string, X509ExtensionJson>;
    /** `:`-separated hex of the signature bits. */
    signatureValue: string;
    /** SHA-1 and SHA-256 digests of the DER encoding, if computed. */
    fingerprints?: { sha256: string; sha1: string };
}

export interface X509ExtensionJson {
    oid: string;
    critical: boolean;
    [k: string]: unknown;
}

/**
 * Build the shared JSON summary. The UI then slices this into its three
 * right-column blocks (`certificate`, `extensions`, signature) and the
 * API returns it (plus `analysis`) more or less verbatim.
 */
export function toX509JsonSummary(
    cert: X509Decoded,
    fingerprints?: { sha1: string; sha256: string } | null,
): X509JsonSummary {
    const summary: X509JsonSummary = {
        certificate: {
            version: cert.version,
            serialNumber: cert.serialNumber,
            signatureAlgorithm: cert.signatureAlgorithm,
            signatureAlgorithmOid: cert.signatureAlgorithmOid,
            issuer: cert.issuer.dn,
            validity: {
                notBefore: cert.validity.notBefore.toISOString(),
                notAfter: cert.validity.notAfter.toISOString(),
            },
            subject: cert.subject.dn,
            subjectPublicKey: {
                algorithm: cert.subjectPublicKey.algorithm,
                algorithmOid: cert.subjectPublicKey.algorithmOid,
                ...(cert.subjectPublicKey.curve && {
                    curve: cert.subjectPublicKey.curve,
                }),
                ...(cert.subjectPublicKey.sizeBits !== undefined && {
                    sizeBits: cert.subjectPublicKey.sizeBits,
                }),
            },
        },
        extensions: buildExtensionsJson(cert),
        signatureValue: cert.signature.hex,
    };
    if (fingerprints) {
        summary.fingerprints = {
            sha256: fingerprints.sha256,
            sha1: fingerprints.sha1,
        };
    }
    return summary;
}

/**
 * Full API view of a certificate: the shared {@link X509JsonSummary}
 * (always with fingerprints) plus an `analysis` block mirroring the JWT
 * API shape (state + message + human-readable notBefore / notAfter).
 *
 * Returned by `POST /api/v1/x509`; the MCP `decode_x509` tool returns
 * the same shape minus `signatureValue`.
 */
export interface X509ApiResponse extends X509JsonSummary {
    fingerprints: { sha256: string; sha1: string };
    analysis: {
        state: X509ValidityState;
        message: string;
        /** `notBefore` as a human-readable UTC date. */
        notBefore: string;
        /** `notAfter` as a human-readable UTC date. */
        notAfter: string;
    };
}

/**
 * Build the {@link X509ApiResponse} for a parsed certificate. Async
 * because fingerprints go through `crypto.subtle`. `now` can be
 * injected for deterministic tests.
 */
export async function toX509ApiResponse(
    cert: X509Decoded,
    now: Date = new Date(),
): Promise<X509ApiResponse> {
    const fingerprints = await computeFingerprints(cert);
    const summary = toX509JsonSummary(cert, fingerprints);
    const validity = describeValidity(cert, now);
    return {
        ...summary,
        fingerprints,
        analysis: {
            state: validity.state,
            message: validity.message,
            notBefore: validity.notBeforeText,
            notAfter: validity.notAfterText,
        },
    };
}

/**
 * Shape a single extension into the JSON form consumed by the UI's
 * `DecodedBlock` and returned by the API. Keyed by extension's
 * canonical identifier (`ext:<name>` for known, `ext:<oid>` for custom).
 */
export function extensionToJson(ext: X509Extension): X509ExtensionJson {
    const base: X509ExtensionJson = {
        oid: ext.oid,
        critical: ext.critical,
    };
    switch (ext.value.kind) {
        case "basicConstraints":
            base.ca = ext.value.ca;
            if (ext.value.pathLenConstraint !== undefined) {
                base.pathLenConstraint = ext.value.pathLenConstraint;
            }
            break;
        case "keyUsage":
            base.usages = ext.value.usages;
            break;
        case "extKeyUsage":
            base.usages = ext.value.usages;
            break;
        case "subjectAltName":
            base.names = ext.value.names;
            break;
        case "subjectKeyIdentifier":
            base.keyId = ext.value.keyId;
            break;
        case "authorityKeyIdentifier":
            if (ext.value.keyId) base.keyId = ext.value.keyId;
            if (ext.value.issuer) base.issuer = ext.value.issuer;
            if (ext.value.serialNumber) {
                base.serialNumber = ext.value.serialNumber;
            }
            break;
        case "crlDistributionPoints":
            base.urls = ext.value.urls;
            break;
        case "authorityInfoAccess":
            base.entries = ext.value.entries;
            break;
        case "certificatePolicies":
            base.policies = ext.value.policies;
            break;
        case "unknown":
            base.hex = ext.value.hex;
            break;
    }
    return base;
}

/**
 * Canonical key for an extension in the JSON summary: `ext:<name>` for
 * extensions in the catalog, `ext:<oid>` for anything else. Mirrors
 * `KNOWN_X509_FIELDS[].key` so UI click-to-flash resolves cleanly.
 */
export function extensionJsonKey(ext: X509Extension): string {
    const OID_TO_KEY: Record<string, string> = Object.fromEntries(
        Object.entries(EXT_KEY_TO_OID).map(([k, v]) => [v, k]),
    );
    return OID_TO_KEY[ext.oid] ?? `ext:${ext.oid}`;
}

function buildExtensionsJson(
    cert: X509Decoded,
): Record<string, X509ExtensionJson> {
    const out: Record<string, X509ExtensionJson> = {};
    for (const ext of cert.extensions) {
        out[extensionJsonKey(ext)] = extensionToJson(ext);
    }
    return out;
}
