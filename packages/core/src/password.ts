/**
 * Password and passphrase generator, with exact entropy.
 *
 * Two modes:
 *
 * - `random`: characters drawn uniformly from the chosen sets (lower,
 *   upper, digits, symbols), optionally without look-alikes and with at
 *   least one character of each set.
 * - `passphrase`: words drawn uniformly from the EFF large wordlist
 *   (7,776 words, ~12.9 bits each), Diceware style.
 *
 * Because every choice is uniform, the strength of a generated password
 * is known exactly: it is the base-2 logarithm of the number of outputs
 * the generator could have produced. No pattern guessing is needed, as
 * opposed to a password someone typed (see ./passwordStrength.ts).
 *
 * Randomness comes from the Web Crypto API (`crypto.getRandomValues`),
 * available in browsers, Cloudflare Workers and Node 19+. Indices are
 * drawn by rejection sampling: a plain `random % n` would favour the
 * first elements whenever 2^32 is not a multiple of n.
 */
import { EFF_LARGE_WORDLIST } from "./passwordWordlist.ts";

/** Character sets for `random` mode, in display order. */
export const PASSWORD_CHARSETS = {
    lower: "abcdefghijklmnopqrstuvwxyz",
    upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    digits: "0123456789",
    /** Every printable ASCII symbol (32 characters). */
    symbols: "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
} as const;

export type PasswordCharset = keyof typeof PASSWORD_CHARSETS;

/** Set names, in display order. */
export const PASSWORD_CHARSET_NAMES = Object.keys(
    PASSWORD_CHARSETS,
) as PasswordCharset[];

/** Characters dropped by `excludeAmbiguous`: easy to misread or mistype. */
export const AMBIGUOUS_CHARACTERS = "0O1lI|";

export const PASSWORD_MODES = ["random", "passphrase"] as const;
export type PasswordMode = (typeof PASSWORD_MODES)[number];

export const PASSWORD_MIN_LENGTH = 4;
export const PASSWORD_MAX_LENGTH = 128;
export const PASSWORD_DEFAULT_LENGTH = 20;

export const PASSPHRASE_MIN_WORDS = 3;
export const PASSPHRASE_MAX_WORDS = 12;
export const PASSPHRASE_DEFAULT_WORDS = 6;
export const PASSPHRASE_DEFAULT_SEPARATOR = "-";
/** Longest allowed separator, in characters. */
export const PASSPHRASE_MAX_SEPARATOR = 3;

/** Maximum number of passwords returned by one `generatePasswords` call. */
export const MAX_PASSWORD_COUNT = 20;

export interface RandomPasswordOptions {
    mode?: "random";
    /** Number of characters, 4..128 (default 20). */
    length?: number;
    /** Sets to draw from (default: all four). */
    sets?: readonly PasswordCharset[];
    /** Drop look-alike characters (`0 O 1 l I |`). Default `false`. */
    excludeAmbiguous?: boolean;
    /** Guarantee at least one character of each set. Default `true`. */
    requireEachSet?: boolean;
}

export interface PassphraseOptions {
    mode: "passphrase";
    /** Number of words, 3..12 (default 6). */
    words?: number;
    /**
     * Between words: 1 to 3 characters, no letters or digits (default
     * `-`). Never empty, and never confusable with a word or the digit,
     * so a passphrase splits back into the words it was made from.
     */
    separator?: string;
    /** Capitalise each word. Adds no entropy. Default `false`. */
    capitalize?: boolean;
    /** Append one random digit to one random word. Default `false`. */
    includeNumber?: boolean;
}

export type PasswordOptions = (RandomPasswordOptions | PassphraseOptions) & {
    /** How many passwords to generate, 1..20 (default 1). */
    count?: number;
};

/** Fully resolved settings, as echoed by the API and MCP tool. */
export type ResolvedPasswordOptions =
    | {
          mode: "random";
          length: number;
          sets: PasswordCharset[];
          excludeAmbiguous: boolean;
          requireEachSet: boolean;
      }
    | {
          mode: "passphrase";
          words: number;
          separator: string;
          capitalize: boolean;
          includeNumber: boolean;
      };

export interface GeneratedPasswords {
    options: ResolvedPasswordOptions;
    /** Exact entropy of each password, in bits. */
    entropyBits: number;
    passwords: string[];
}

/** Uniform integer in [0, n) for 1 <= n <= 2^32. */
function randomIndex(n: number): number {
    if (n === 1) return 0;
    // Largest multiple of n that fits in 32 bits: values at or above it
    // would wrap around unevenly, so they are drawn again.
    const limit = 2 ** 32 - (2 ** 32 % n);
    const buffer = new Uint32Array(1);
    for (;;) {
        crypto.getRandomValues(buffer);
        if (buffer[0] < limit) return buffer[0] % n;
    }
}

/** Characters of `set`, minus look-alikes when asked. */
function charsetChars(set: PasswordCharset, excludeAmbiguous: boolean): string {
    const chars = PASSWORD_CHARSETS[set];
    if (!excludeAmbiguous) return chars;
    return [...chars].filter((c) => !AMBIGUOUS_CHARACTERS.includes(c)).join("");
}

function isInteger(value: unknown, min: number, max: number): value is number {
    return (
        typeof value === "number" &&
        Number.isInteger(value) &&
        value >= min &&
        value <= max
    );
}

function checkBoolean(value: unknown, name: string): boolean | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "boolean") {
        throw new Error(`${name} must be true or false.`);
    }
    return value;
}

/**
 * Validate options and fill in defaults.
 *
 * @throws Error with a message meant to be shown verbatim by the HTTP
 *   route and MCP tool.
 */
export function resolvePasswordOptions(
    options: RandomPasswordOptions | PassphraseOptions = {},
): ResolvedPasswordOptions {
    const mode = options.mode ?? "random";
    if (!(PASSWORD_MODES as readonly string[]).includes(mode)) {
        throw new Error(
            `Unknown mode: ${String(mode)}. Use one of: ${PASSWORD_MODES.join(", ")}.`,
        );
    }

    if (mode === "passphrase") {
        const o = options as PassphraseOptions;
        const words = o.words ?? PASSPHRASE_DEFAULT_WORDS;
        if (!isInteger(words, PASSPHRASE_MIN_WORDS, PASSPHRASE_MAX_WORDS)) {
            throw new Error(
                `words must be an integer between ${PASSPHRASE_MIN_WORDS} and ${PASSPHRASE_MAX_WORDS}.`,
            );
        }
        const separator = o.separator ?? PASSPHRASE_DEFAULT_SEPARATOR;
        if (
            typeof separator !== "string" ||
            separator.length === 0 ||
            [...separator].length > PASSPHRASE_MAX_SEPARATOR ||
            /[\p{L}\p{N}\p{Cc}]/u.test(separator)
        ) {
            throw new Error(
                `separator must be 1 to ${PASSPHRASE_MAX_SEPARATOR} characters, with no letters or digits.`,
            );
        }
        return {
            mode,
            words,
            separator,
            capitalize: checkBoolean(o.capitalize, "capitalize") ?? false,
            includeNumber: checkBoolean(o.includeNumber, "includeNumber") ?? false,
        };
    }

    const o = options as RandomPasswordOptions;
    const length = o.length ?? PASSWORD_DEFAULT_LENGTH;
    if (!isInteger(length, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH)) {
        throw new Error(
            `length must be an integer between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH}.`,
        );
    }
    const requested = o.sets ?? PASSWORD_CHARSET_NAMES;
    if (!Array.isArray(requested) || requested.length === 0) {
        throw new Error(
            `sets must list at least one of: ${PASSWORD_CHARSET_NAMES.join(", ")}.`,
        );
    }
    for (const set of requested) {
        if (!(PASSWORD_CHARSET_NAMES as readonly string[]).includes(set)) {
            throw new Error(
                `Unknown character set: ${String(set)}. Use any of: ${PASSWORD_CHARSET_NAMES.join(", ")}.`,
            );
        }
    }
    // Canonical order, no duplicates.
    const sets = PASSWORD_CHARSET_NAMES.filter((s) => requested.includes(s));
    const requireEachSet = checkBoolean(o.requireEachSet, "requireEachSet") ?? true;
    if (requireEachSet && length < sets.length) {
        throw new Error(
            `length must be at least ${sets.length} to include every chosen set.`,
        );
    }
    return {
        mode,
        length,
        sets,
        excludeAmbiguous: checkBoolean(o.excludeAmbiguous, "excludeAmbiguous") ?? false,
        requireEachSet,
    };
}

/**
 * Exact entropy, in bits, of one password produced with `options`.
 *
 * - Random, any set allowed: `length × log2(alphabet size)`.
 * - Random, at least one of each set: only strings that contain every
 *   set count. Their number comes from inclusion–exclusion,
 *   `Σ over subsets S (−1)^|S| (N − |S's characters|)^length`, worked
 *   out as ratios to `N^length` so it stays within double precision.
 * - Passphrase: `words × log2(7776)`, plus `log2(10 × words)` for the
 *   digit (10 values, appended to one of the words). Separators and
 *   capitals are fixed, so they add nothing. (Four EFF words contain a
 *   hyphen, so with the `-` separator a handful of outputs can be built
 *   two ways; that overstates the total by far less than 0.01 bit.)
 */
export function passwordEntropyBits(
    options: RandomPasswordOptions | PassphraseOptions = {},
): number {
    const o = resolvePasswordOptions(options);
    if (o.mode === "passphrase") {
        const bits = o.words * Math.log2(EFF_LARGE_WORDLIST.length);
        return o.includeNumber ? bits + Math.log2(10 * o.words) : bits;
    }
    const sizes = o.sets.map((s) => charsetChars(s, o.excludeAmbiguous).length);
    const total = sizes.reduce((a, b) => a + b, 0);
    const bits = o.length * Math.log2(total);
    if (!o.requireEachSet || sizes.length === 1) return bits;

    // Fraction of all strings that contain every set.
    let fraction = 0;
    for (let mask = 0; mask < 1 << sizes.length; mask++) {
        let excluded = 0;
        let parity = 1;
        sizes.forEach((size, i) => {
            if (mask & (1 << i)) {
                excluded += size;
                parity = -parity;
            }
        });
        fraction += parity * ((total - excluded) / total) ** o.length;
    }
    return bits + Math.log2(fraction);
}

function randomPassword(o: Extract<ResolvedPasswordOptions, { mode: "random" }>): string {
    const groups = o.sets.map((s) => charsetChars(s, o.excludeAmbiguous));
    const alphabet = groups.join("");
    for (;;) {
        let password = "";
        for (let i = 0; i < o.length; i++) {
            password += alphabet[randomIndex(alphabet.length)];
        }
        // Draw again until every set appears. Forcing one character of
        // each set into random positions would be quicker, but it would
        // make some passwords likelier than others; rejection keeps every
        // valid password equally likely, which is what the entropy assumes.
        if (!o.requireEachSet || groups.every((g) => [...g].some((c) => password.includes(c)))) {
            return password;
        }
    }
}

function passphrase(o: Extract<ResolvedPasswordOptions, { mode: "passphrase" }>): string {
    const words = Array.from({ length: o.words }, () => {
        const word = EFF_LARGE_WORDLIST[randomIndex(EFF_LARGE_WORDLIST.length)];
        return o.capitalize ? word[0].toUpperCase() + word.slice(1) : word;
    });
    if (o.includeNumber) {
        words[randomIndex(words.length)] += String(randomIndex(10));
    }
    return words.join(o.separator);
}

/**
 * Generate a batch of passwords or passphrases.
 *
 * @throws Error when an option is out of range. Messages are meant to be
 *   surfaced verbatim by the HTTP route and MCP tool.
 */
export function generatePasswords(options: PasswordOptions = {}): GeneratedPasswords {
    const { count = 1, ...rest } = options;
    if (!isInteger(count, 1, MAX_PASSWORD_COUNT)) {
        throw new Error(`count must be an integer between 1 and ${MAX_PASSWORD_COUNT}.`);
    }
    const resolved = resolvePasswordOptions(rest);
    const generate = () =>
        resolved.mode === "passphrase" ? passphrase(resolved) : randomPassword(resolved);
    return {
        options: resolved,
        entropyBits: passwordEntropyBits(resolved),
        passwords: Array.from({ length: count }, generate),
    };
}

/** Generate a single password. @throws Error when an option is out of range. */
export function generatePassword(
    options: RandomPasswordOptions | PassphraseOptions = {},
): string {
    return generatePasswords({ ...options, count: 1 }).passwords[0];
}
