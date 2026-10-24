export {
    BASE32_ALPHABET,
    BASE32_CROCKFORD_ALPHABET,
    BASE32_VARIANTS,
    BASE58_ALPHABET,
    BASE64_ALPHABET,
    BASE64_URL_ALPHABET,
    BASE_ENCODINGS,
    BYTES_FORMATS,
    bytesToHex,
    bytesToText,
    convertEncoding,
    decodeBase32,
    decodeBase58,
    decodeBase64,
    encodeBase32,
    encodeBase58,
    encodeBase64,
    ENCODING_OPERATIONS,
    hexToBytes,
    MAX_BASE58_BYTES,
    MAX_ENCODING_BYTES,
    textToBytes,
} from "./encoding";
export type {
    Base32Variant,
    BaseEncoding,
    BytesFormat,
    ConversionResult,
    ConvertEncodingInput,
    DecodeResult,
    EncodeResult,
    EncodingOperation,
    EncodingOptions,
} from "./encoding";

export {
    computeAllHashes,
    computeHash,
    digest,
    DIGEST_FORMATS,
    HASH_ALGORITHMS,
    HASH_INFO,
    hmac,
    MAX_HASH_BYTES,
} from "./hash";
export type {
    AllHashesResult,
    ComputeHashInput,
    DigestFormat,
    HashAlgorithm,
    HashAlgorithmInfo,
    HashOptions,
    HashResult,
} from "./hash";

export { calculateCIDR, isRoutable } from "./ip";
export type { CidrResult } from "./ip";

export {
    KNOWN_CLAIMS,
    TIME_CLAIMS,
    customPayloadClaims,
    decodeJWT,
    describeExpiry,
    formatUtcDateTime,
    hasClaim,
    relativeDuration,
    timeClaimTexts,
    toJwtJsonSummary,
    verboseDuration,
} from "./jwt";
export type {
    ExpiryState,
    ExpiryStatus,
    JwtClaimCategory,
    JwtClaimFormat,
    JwtClaimLocation,
    JwtClaimSpec,
    JwtDecoded,
    JwtJsonSummary,
    JwtPart,
    TimeClaim,
} from "./jwt";

export {
    generateNanoId,
    generateNanoIds,
    MAX_NANOID_COUNT,
    NANOID_ALPHABET_NAMES,
    NANOID_ALPHABETS,
    NANOID_DEFAULT_SIZE,
    NANOID_MAX_SIZE,
    NANOID_MIN_SIZE,
    nanoIdEntropyBits,
} from "./nanoid";
export type { NanoIdAlphabet, NanoIdOptions } from "./nanoid";

export {
    AMBIGUOUS_CHARACTERS,
    generatePassword,
    generatePasswords,
    MAX_PASSWORD_COUNT,
    PASSPHRASE_DEFAULT_SEPARATOR,
    PASSPHRASE_DEFAULT_WORDS,
    PASSPHRASE_MAX_SEPARATOR,
    PASSPHRASE_MAX_WORDS,
    PASSPHRASE_MIN_WORDS,
    PASSWORD_CHARSET_NAMES,
    PASSWORD_CHARSETS,
    PASSWORD_DEFAULT_LENGTH,
    PASSWORD_MAX_LENGTH,
    PASSWORD_MIN_LENGTH,
    PASSWORD_MODES,
    passwordEntropyBits,
    resolvePasswordOptions,
} from "./password";
export type {
    GeneratedPasswords,
    PassphraseOptions,
    PasswordCharset,
    PasswordMode,
    PasswordOptions,
    RandomPasswordOptions,
    ResolvedPasswordOptions,
} from "./password";

// The strength estimator is exported separately (`./passwordStrength`)
// rather than from here: it carries ~100 KB of dictionaries, and the
// web app loads it on demand. Only the light helpers are re-exported.
export { EFF_WORDLIST_SIZE } from "./passwordWordlist";
export {
    ATTACK_SCENARIOS,
    crackTimes,
    formatDuration,
    scoreFromLog10,
    STRENGTH_LABELS,
} from "./passwordCrackTime";
export type { AttackScenarioId, CrackTime, StrengthScore } from "./passwordCrackTime";

export {
    generateULID,
    generateULIDs,
    MAX_ULID_COUNT,
    ULID_ALPHABET,
    ULID_LENGTH,
    ULID_MAX_TIME,
} from "./ulid";
export type { UlidOptions } from "./ulid";

export {
    generateUUIDs,
    generateUUIDv4,
    generateUUIDv7,
    MAX_UUID_COUNT,
    UUID_VERSIONS,
} from "./uuid";
export type { UuidOptions, UuidVersion } from "./uuid";

export {
    computeFingerprints,
    customX509Extensions,
    decodeX509,
    describeValidity,
    extensionJsonKey,
    extensionToJson,
    hasX509Field,
    KNOWN_X509_FIELDS,
    toX509ApiResponse,
    toX509JsonSummary,
} from "./x509";
export type {
    X509ApiResponse,
    X509Decoded,
    X509Extension,
    X509ExtensionJson,
    X509ExtensionValue,
    X509FieldLocation,
    X509FieldSpec,
    X509JsonSummary,
    X509Name,
    X509PublicKey,
    X509ValidityState,
    X509ValidityStatus,
} from "./x509";