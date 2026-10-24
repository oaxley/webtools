/**
 * Strength estimator for passwords a human chose.
 *
 * A generated password has an exact strength (see ./password.ts): every
 * choice was uniform, so counting the possibilities is enough. A typed
 * password does not. `Tr0ub4dor&3` draws on 94 characters and would be
 * worth 72 bits if it were random, but a cracker tries dictionary words
 * with digit-and-symbol decorations long before it reaches random
 * strings.
 *
 * So the estimate works the way an attacker does. It finds every
 * recognisable pattern in the password (leaked passwords, English words,
 * names, l33t spellings, keyboard runs, sequences, repeats, dates),
 * prices each one in guesses, then looks for the cheapest way to cover
 * the whole password with them. The result is the cost of the cheapest
 * route, which is an upper bound on the real strength: patterns we fail
 * to spot make a password look stronger than it is, never weaker.
 *
 * This is a compact, dependency-free take on the approach introduced by
 * zxcvbn (Dropbox, MIT licence) and its paper "zxcvbn: Low-Budget
 * Password Strength Estimation" (USENIX Security 2016). It uses the same
 * frequency lists (./passwordDictionaries.ts) and the same shape of
 * guess estimates, with simpler matchers and search:
 *
 * - misspellings (one letter off a dictionary word) are matched too,
 *   since cracking rule sets try them,
 * - keyboard patterns cover runs along a row of a QWERTY, AZERTY or
 *   QWERTZ keyboard, not arbitrary walks across the whole layout,
 * - the search adds a flat cost per extra piece instead of modelling
 *   the number of ways to cut the password up.
 *
 * Both simplifications can only overestimate strength, so the verdicts
 * stay on the pessimistic side of zxcvbn's for a few exotic passwords
 * and match it closely for ordinary ones. Nothing here is a substitute
 * for checking a password against a breach list.
 */
import {
    COMMON_NAMES,
    COMMON_PASSWORDS,
    ENGLISH_WORDS,
} from "./passwordDictionaries.ts";
import { EFF_LARGE_WORDLIST } from "./passwordWordlist.ts";
import {
    crackTimes,
    scoreFromLog10,
    STRENGTH_LABELS,
    type CrackTime,
    type StrengthScore,
} from "./passwordCrackTime.ts";

export {
    ATTACK_SCENARIOS,
    crackTimes,
    formatDuration,
    scoreFromLog10,
    STRENGTH_LABELS,
} from "./passwordCrackTime.ts";
export type {
    AttackScenarioId,
    CrackTime,
    StrengthScore,
} from "./passwordCrackTime.ts";

/** Longest password the estimator will analyse in full. */
export const MAX_ESTIMATED_LENGTH = 256;

export type PatternName =
    | "common-password"
    | "word"
    | "name"
    | "passphrase-word"
    | "keyboard"
    | "sequence"
    | "repeat"
    | "date"
    | "separator"
    | "random";

/** One recognised piece of the password, as priced by the estimator. */
export interface StrengthPattern {
    /** Where the piece starts, as a character index. */
    start: number;
    /** The matched text. */
    token: string;
    pattern: PatternName;
    /** Guesses an attacker needs for this piece alone. */
    guesses: number;
    /** Plain-English explanation, e.g. "the 15th most common password". */
    description: string;
}

export interface StrengthEstimate {
    /** Guesses to find the password, capped at `Number.MAX_VALUE`. */
    guesses: number;
    /** `log10(guesses)`, which stays finite for very strong passwords. */
    guessesLog10: number;
    /** Equivalent entropy in bits, `log2(guesses)`. */
    bits: number;
    score: StrengthScore;
    /** "Weak", "Strong"… matching `score`. */
    label: string;
    /** The pieces the password was broken into, in order. */
    patterns: StrengthPattern[];
    /** The single biggest problem, when there is one. */
    warning: string | null;
    /** What to change, most useful first. */
    suggestions: string[];
    crackTimes: CrackTime[];
}

/** Rank (1-based) of every dictionary word, by dictionary. */
interface Dictionary {
    pattern: PatternName;
    name: string;
    ranks: Map<string, number>;
    /** Longest word, so lookups can skip longer substrings. */
    maxLength: number;
}

let dictionaries: Dictionary[] | undefined;

function buildDictionaries(): Dictionary[] {
    const dictionary = (
        pattern: PatternName,
        name: string,
        ranks: Map<string, number>,
    ): Dictionary => ({
        pattern,
        name,
        ranks,
        maxLength: Math.max(...[...ranks.keys()].map((w) => w.length)),
    });
    const rank = (words: readonly string[]): Map<string, number> => {
        const map = new Map<string, number>();
        // The lists are frequency-ordered, so the first occurrence wins.
        words.forEach((word, i) => {
            if (!map.has(word)) map.set(word, i + 1);
        });
        return map;
    };
    return [
        dictionary("common-password", "password", rank(COMMON_PASSWORDS)),
        dictionary("word", "English word", rank(ENGLISH_WORDS)),
        dictionary("name", "name", rank(COMMON_NAMES)),
        dictionary(
            "passphrase-word",
            "passphrase word",
            // Alphabetical, so position says nothing about frequency: any
            // word costs an attacker the whole list.
            new Map(EFF_LARGE_WORDLIST.map((w) => [w, EFF_LARGE_WORDLIST.length])),
        ),
    ];
}

/** Letters a l33t character can stand for. */
const LEET_SUBSTITUTIONS: Record<string, string[]> = {
    "4": ["a"],
    "@": ["a"],
    "8": ["b"],
    "(": ["c"],
    "{": ["c"],
    "[": ["c"],
    "<": ["c"],
    "3": ["e"],
    "6": ["g"],
    "9": ["g"],
    "1": ["i", "l"],
    "!": ["i"],
    "|": ["i", "l"],
    "7": ["t", "l"],
    "0": ["o"],
    "$": ["s"],
    "5": ["s"],
    "+": ["t"],
    "2": ["z"],
};

/** Rows of three common keyboard layouts, plus the number row. */
const KEYBOARD_ROWS = [
    "1234567890",
    "qwertyuiop",
    "asdfghjkl",
    "zxcvbnm",
    // AZERTY and QWERTZ differ only in the rows that matter here.
    "azertyuiop",
    "qwertzuiop",
    "qsdfghjklm",
    "wxcvbn",
] as const;

/** Variants of `token` with l33t characters read as letters, lower-cased. */
function leetVariants(token: string): string[] {
    const lower = token.toLowerCase();
    const positions = [...lower]
        .map((c, i) => [i, LEET_SUBSTITUTIONS[c]] as const)
        .filter((entry): entry is readonly [number, string[]] => entry[1] !== undefined);
    if (positions.length === 0 || positions.length > 6) return [];

    let variants = [[...lower]];
    for (const [index, letters] of positions) {
        const next: string[][] = [];
        for (const variant of variants) {
            for (const letter of letters) {
                const copy = [...variant];
                copy[index] = letter;
                next.push(copy);
            }
        }
        variants = next;
    }
    return variants.map((chars) => chars.join("")).filter((v) => v !== lower);
}

/**
 * How many ways the letters of `token` could have been capitalised.
 *
 * All lower case costs nothing. The three habits (first letter, all
 * caps, last letter) only double the work. Anything else is priced as
 * the number of ways to pick which letters are capitals.
 */
function caseVariations(token: string): number {
    if (!/[A-Z]/.test(token)) return 1;
    if (
        /^[^a-z]*[A-Z][^A-Z]*$/.test(token) ||
        token === token.toUpperCase() ||
        /^[^A-Z]*[A-Z][^a-z]*$/.test(token)
    ) {
        return 2;
    }
    const upper = (token.match(/[A-Z]/g) ?? []).length;
    const lower = (token.match(/[a-z]/g) ?? []).length;
    let total = 0;
    for (let i = 1; i <= Math.min(upper, lower + upper); i++) {
        total += binomial(upper + lower, i);
    }
    return Math.max(2, total);
}

function binomial(n: number, k: number): number {
    if (k < 0 || k > n) return 0;
    let result = 1;
    for (let i = 1; i <= Math.min(k, n - k); i++) {
        result = (result * (n - Math.min(k, n - k) + i)) / i;
    }
    return result;
}

/** Size of the character space the password draws on. */
function cardinality(password: string): number {
    let total = 0;
    if (/[a-z]/.test(password)) total += 26;
    if (/[A-Z]/.test(password)) total += 26;
    if (/[0-9]/.test(password)) total += 10;
    if (/[ !-/:-@[-`{-~]/.test(password)) total += 33;
    // Anything else (accents, emoji) is worth far more, but counting it
    // honestly would flatter one-emoji passwords.
    if (/[^\x20-\x7e]/.test(password)) total += 100;
    return Math.max(total, 10);
}

interface Match extends StrengthPattern {
    end: number;
    /**
     * A separator. It pays no per-piece penalty of its own: the word after
     * it does, exactly as if the words were run together, so spacing a
     * passphrase out never makes it look weaker.
     */
    joins?: boolean;
}

/** Characters people put between words. */
const SEPARATOR_CHARACTERS = " -_.,/+:;|~*";
/** Guesses to pick the separator, paid once however often it repeats. */
const SEPARATOR_GUESSES = SEPARATOR_CHARACTERS.length;

/**
 * The separator in `correct horse battery staple`: the most frequent
 * separator character, wherever it sits between two other characters.
 * Using it is a single choice, so every occurrence is matched for free
 * and `estimateStrength` charges the choice once.
 */
function separatorMatches(password: string): Match[] {
    const chars = [...password];
    let separator: string | undefined;
    let most = 0;
    for (const c of SEPARATOR_CHARACTERS) {
        const n = chars.filter((x) => x === c).length;
        if (n > most) {
            most = n;
            separator = c;
        }
    }
    if (separator === undefined) return [];
    const matches: Match[] = [];
    for (let i = 1; i < password.length - 1; i++) {
        if (password[i] !== separator) continue;
        if (password[i - 1] === separator || password[i + 1] === separator) continue;
        matches.push({
            start: i,
            end: i + 1,
            token: separator,
            pattern: "separator",
            guesses: 1,
            description: "separator between words",
            joins: true,
        });
    }
    return matches;
}

/** Misspellings are only looked for in passwords up to this long. */
const MAX_FUZZY_LENGTH = 40;
/** Shortest word worth matching with a typo; shorter ones match by chance. */
const MIN_FUZZY_WORD = 6;
const ALPHABET = "abcdefghijklmnopqrstuvwxyz";

/** Spellings one letter added, dropped or changed away from `word`. */
function oneEditAway(word: string): Set<string> {
    const edits = new Set<string>();
    for (let i = 0; i <= word.length; i++) {
        if (i < word.length) edits.add(word.slice(0, i) + word.slice(i + 1));
        for (const c of ALPHABET) {
            edits.add(word.slice(0, i) + c + word.slice(i));
            if (i < word.length) edits.add(word.slice(0, i) + c + word.slice(i + 1));
        }
    }
    edits.delete(word);
    return edits;
}

/**
 * Words spelled one letter off, like `troubador` for `troubadour`.
 * Crackers' rule sets try such variants of every dictionary word, so a
 * typo buys roughly `27 × length` times the word's rank, not randomness.
 */
function misspellingMatches(password: string): Match[] {
    dictionaries ??= buildDictionaries();
    const matches: Match[] = [];
    if (password.length > MAX_FUZZY_LENGTH) return matches;
    const searched = dictionaries.filter((d) => d.pattern !== "passphrase-word");
    for (let i = 0; i < password.length; i++) {
        for (let j = i + MIN_FUZZY_WORD - 1; j <= Math.min(password.length, i + 16); j++) {
            const token = password.slice(i, j);
            // Flag l33t readings before filtering, so the flag stays right.
            const spellings = [
                { spelling: token.toLowerCase(), leet: false },
                ...leetVariants(token).map((spelling) => ({ spelling, leet: true })),
            ].filter(({ spelling }) => /^[a-z]+$/.test(spelling));
            const best = new Map<Dictionary, { word: string; rank: number; leet: boolean }>();
            spellings.forEach(({ spelling, leet }) => {
                for (const word of oneEditAway(spelling)) {
                    if (word.length < MIN_FUZZY_WORD) continue;
                    for (const dictionary of searched) {
                        const rank = dictionary.ranks.get(word);
                        const current = best.get(dictionary);
                        if (rank !== undefined && (!current || rank < current.rank)) {
                            best.set(dictionary, { word, rank, leet });
                        }
                    }
                }
            });
            for (const [dictionary, { word, rank, leet }] of best) {
                matches.push({
                    start: i,
                    end: j,
                    token,
                    pattern: dictionary.pattern,
                    guesses:
                        rank *
                        27 *
                        word.length *
                        caseVariations(token) *
                        (leet ? leetVariations(token) : 1),
                    description:
                        `${article(dictionary.name)} "${word}" misspelled` +
                        (leet ? ", with substituted characters" : ""),
                });
            }
        }
    }
    return matches;
}

function dictionaryMatches(password: string): Match[] {
    dictionaries ??= buildDictionaries();
    const matches: Match[] = [];
    const lower = password.toLowerCase();
    const longest = Math.max(...dictionaries.map((d) => d.maxLength));

    for (let i = 0; i < password.length; i++) {
        for (let j = i + 2; j <= Math.min(password.length, i + longest); j++) {
            const token = password.slice(i, j);
            const plain = lower.slice(i, j);
            const candidates: Array<{ word: string; leet: boolean }> = [
                { word: plain, leet: false },
                ...leetVariants(token).map((word) => ({ word, leet: true })),
            ];
            const reversedPlain = [...plain].reverse().join("");

            for (const dictionary of dictionaries) {
                if (j - i > dictionary.maxLength) continue;
                let best: Match | undefined;
                for (const { word, leet } of candidates) {
                    const rank = dictionary.ranks.get(word);
                    if (rank === undefined) continue;
                    // An attacker pays the rank, then the decorations.
                    const guesses =
                        rank * caseVariations(token) * (leet ? leetVariations(token) : 1);
                    const extras = [
                        leet ? "with substituted characters" : "",
                        caseVariations(token) > 1 ? "capitalised" : "",
                    ].filter(Boolean);
                    const match: Match = {
                        start: i,
                        end: j,
                        token,
                        pattern: dictionary.pattern,
                        guesses,
                        description:
                            (dictionary.pattern === "passphrase-word"
                                ? `word from the EFF passphrase list`
                                : `${ordinal(rank)} most common ${dictionary.name}`) +
                            (extras.length > 0 ? `, ${extras.join(" and ")}` : ""),
                    };
                    if (!best || match.guesses < best.guesses) best = match;
                }
                if (best) matches.push(best);

                const reversedRank = dictionary.ranks.get(reversedPlain);
                if (reversedRank !== undefined && reversedPlain !== plain) {
                    matches.push({
                        start: i,
                        end: j,
                        token,
                        pattern: dictionary.pattern,
                        guesses: reversedRank * caseVariations(token) * 2,
                        description: `${article(dictionary.name)} "${reversedPlain}" spelled backwards`,
                    });
                }
            }
        }
    }
    return matches;
}

/**
 * Cost of the l33t spelling itself: the attacker tries each way of
 * substituting the letters that could have been substituted. Counted as
 * two choices per substituted character, at least two overall.
 */
function leetVariations(token: string): number {
    const substituted = [...token.toLowerCase()].filter(
        (c) => LEET_SUBSTITUTIONS[c] !== undefined,
    ).length;
    return Math.max(2, 2 ** substituted);
}

function keyboardMatches(password: string): Match[] {
    const matches: Match[] = [];
    const lower = password.toLowerCase();
    for (let i = 0; i < lower.length; i++) {
        for (let j = i + 3; j <= lower.length; j++) {
            const token = lower.slice(i, j);
            const backwards = [...token].reverse().join("");
            const row = KEYBOARD_ROWS.find(
                (r) => r.includes(token) || r.includes(backwards),
            );
            // A longer run contains this one, so it can't be on a row either.
            if (!row) break;
            // Starting key, direction, then how far the finger slid.
            const guesses =
                KEYBOARD_ROWS[1].length * 2 * token.length * caseVariations(password.slice(i, j));
            matches.push({
                start: i,
                end: j,
                token: password.slice(i, j),
                pattern: "keyboard",
                guesses,
                description: "a run of keys along one keyboard row",
            });
        }
    }
    return matches;
}

function sequenceMatches(password: string): Match[] {
    const matches: Match[] = [];
    for (let i = 0; i < password.length; i++) {
        for (let j = i + 3; j <= password.length; j++) {
            const token = password.slice(i, j);
            const codes = [...token].map((c) => c.codePointAt(0)!);
            const step = codes[1] - codes[0];
            // Once the run breaks, every longer token breaks too.
            if (step !== 1 && step !== -1) break;
            if (!codes.every((c, k) => k === 0 || c - codes[k - 1] === step)) break;
            const digits = /^[0-9]+$/.test(token);
            if (!digits && !/^[A-Za-z]+$/.test(token)) break;
            // Where the run starts, which way it goes, how long it is.
            const guesses = (digits ? 10 : 26) * 2 * token.length;
            matches.push({
                start: i,
                end: j,
                token,
                pattern: "sequence",
                guesses,
                description: step === 1 ? "a rising sequence" : "a falling sequence",
            });
        }
    }
    return matches;
}

function repeatMatches(password: string, baseCardinality: number): Match[] {
    const matches: Match[] = [];
    for (let i = 0; i < password.length; i++) {
        for (let unit = 1; unit <= (password.length - i) / 2; unit++) {
            const chunk = password.slice(i, i + unit);
            let repeats = 1;
            while (
                password.slice(i + repeats * unit, i + (repeats + 1) * unit) === chunk
            ) {
                repeats++;
            }
            if (repeats < 2) continue;
            const token = password.slice(i, i + repeats * unit);
            // Guess the repeated chunk, then how many times it repeats.
            const chunkGuesses = Math.min(
                baseCardinality ** unit,
                cheapestDictionaryGuesses(chunk) ?? Infinity,
            );
            matches.push({
                start: i,
                end: i + token.length,
                token,
                pattern: "repeat",
                guesses: chunkGuesses * repeats,
                description: `"${chunk}" repeated ${repeats} times`,
            });
        }
    }
    return matches;
}

/** Rank of `word` in any dictionary, lowest first; `undefined` if absent. */
function cheapestDictionaryGuesses(word: string): number | undefined {
    dictionaries ??= buildDictionaries();
    let best: number | undefined;
    for (const dictionary of dictionaries) {
        const rank = dictionary.ranks.get(word.toLowerCase());
        if (rank !== undefined && (best === undefined || rank < best)) best = rank;
    }
    return best === undefined ? undefined : best * caseVariations(word);
}

/** Years and dates: `1987`, `2024`, `12/03/1999`, `3-7-88`. */
function dateMatches(password: string): Match[] {
    const matches: Match[] = [];
    const push = (start: number, token: string, guesses: number, description: string) =>
        matches.push({
            start,
            end: start + token.length,
            token,
            pattern: "date",
            guesses,
            description,
        });

    for (const m of password.matchAll(/(?:19|20)\d{2}/g)) {
        // A year someone would pick: roughly 1900 to the near future.
        push(m.index, m[0], 130, "a year");
    }
    for (const m of password.matchAll(
        /\b(\d{1,2})([/.\-_])(\d{1,2})\2((?:19|20)?\d{2})\b/g,
    )) {
        const day = Number(m[1]);
        const month = Number(m[3]);
        if (day > 31 || month > 31 || day === 0 || month === 0) continue;
        // A day of the year, a plausible year, and the separator used.
        push(m.index, m[0], 365 * 130 * 4, "a date");
    }
    for (const m of password.matchAll(/\b\d{6,8}\b/g)) {
        push(m.index, m[0], 365 * 130 * 4, "a date written without separators");
    }
    return matches;
}

/** Cost the attacker pays for each extra piece they have to line up. */
const SEGMENT_PENALTY = 10;

/**
 * Cheapest way to cover `password`, as a running total in log space.
 *
 * Every position gets the best cost of reaching it, which makes this a
 * shortest-path problem over the matches. Multiplying guesses means
 * adding logarithms, so the arithmetic stays exact for passwords far
 * stronger than `Number.MAX_VALUE` can hold.
 *
 * Characters no pattern explains are random, each worth
 * `log2(cardinality)` bits. A run of them counts as a single piece, so
 * the per-piece penalty doesn't inflate a genuinely random password:
 * `last` tracks the best cost of reaching a position at the end of
 * such a run, `cost` the best cost of reaching it at the end of a match.
 */
function cheapestCover(
    password: string,
    matches: Match[],
    baseCardinality: number,
): { log2: number; patterns: StrengthPattern[] } {
    const n = password.length;
    const penalty = Math.log2(SEGMENT_PENALTY);
    const perChar = Math.log2(baseCardinality);
    const byEnd: Match[][] = Array.from({ length: n + 1 }, () => []);
    for (const match of matches) byEnd[match.end].push(match);
    const pays = (match: Match) => (match.start === 0 || match.joins ? 0 : penalty);

    const cost = new Float64Array(n + 1).fill(Infinity);
    const random = new Float64Array(n + 1).fill(Infinity);
    const viaMatch: (Match | undefined)[] = new Array(n + 1).fill(undefined);
    // Where the random run ending here began.
    const runStart = new Int32Array(n + 1);
    cost[0] = 0;
    const best = (i: number) => Math.min(cost[i], random[i]);

    for (let end = 1; end <= n; end++) {
        // Extend a random run, or start one after a match.
        const extend = random[end - 1];
        const start = cost[end - 1] + (end - 1 === 0 ? 0 : penalty);
        if (extend <= start) {
            random[end] = extend + perChar;
            runStart[end] = runStart[end - 1];
        } else {
            random[end] = start + perChar;
            runStart[end] = end - 1;
        }
        for (const match of byEnd[end]) {
            const total = best(match.start) + Math.log2(match.guesses) + pays(match);
            if (total < cost[end]) {
                cost[end] = total;
                viaMatch[end] = match;
            }
        }
    }

    const patterns: StrengthPattern[] = [];
    for (let end = n; end > 0; ) {
        if (cost[end] <= random[end]) {
            const { end: _end, ...pattern } = viaMatch[end]!;
            patterns.unshift(pattern);
            end = pattern.start;
        } else {
            const start = runStart[end];
            const token = password.slice(start, end);
            patterns.unshift({
                start,
                token,
                pattern: "random",
                guesses: baseCardinality ** token.length,
                description: "no recognisable pattern",
            });
            end = start;
        }
    }
    return { log2: best(n), patterns };
}

/** "an English word", "a name". */
function article(noun: string): string {
    return `${/^[aeiou]/i.test(noun) ? "an" : "a"} ${noun}`;
}

function ordinal(n: number): string {
    const suffix =
        n % 100 >= 11 && n % 100 <= 13
            ? "th"
            : (["th", "st", "nd", "rd"][n % 10] ?? "th");
    return `${n}${suffix}`;
}

/** `"token"`, shortened so a 200-character repeat doesn't flood the UI. */
function quote(token: string): string {
    return `"${token.length > 24 ? `${token.slice(0, 20)}…` : token}"`;
}

function buildFeedback(
    password: string,
    patterns: StrengthPattern[],
    score: StrengthScore,
): { warning: string | null; suggestions: string[] } {
    const suggestions: string[] = [];
    let warning: string | null = null;

    if (password.length === 0) {
        return { warning: null, suggestions: [] };
    }
    // The weakest link is the pattern that covers the most ground for
    // the fewest guesses.
    const weakest = [...patterns]
        .filter((p) => p.pattern !== "random")
        .sort(
            (a, b) =>
                Math.log2(a.guesses) / a.token.length -
                Math.log2(b.guesses) / b.token.length,
        )[0];

    if (score >= 3) {
        // Patterns found in a strong password (the words of a passphrase,
        // say) are not a problem worth flagging.
        return {
            warning: null,
            suggestions: ["Store it in a password manager so it can stay long and unique."],
        };
    }
    if (
        patterns.length === 1 &&
        patterns[0].pattern === "common-password" &&
        /^\d+\w\w most common/.test(patterns[0].description)
    ) {
        warning = "This is one of the most common passwords in use.";
    } else if (weakest) {
        switch (weakest.pattern) {
            case "common-password":
                warning = `${quote(weakest.token)} appears in lists of leaked passwords.`;
                break;
            case "word":
            case "passphrase-word":
                warning = /misspelled|substituted|backwards/.test(weakest.description)
                    ? `${quote(weakest.token)} is a common word in disguise, and crackers try those disguises.`
                    : `${quote(weakest.token)} is a common word, which crackers try first.`;
                break;
            case "name":
                warning = `${quote(weakest.token)} is a common name.`;
                break;
            case "keyboard":
                warning = `${quote(weakest.token)} is a run of neighbouring keys.`;
                break;
            case "sequence":
                warning = `${quote(weakest.token)} is a predictable sequence.`;
                break;
            case "repeat":
                warning = `${quote(weakest.token)} is a repeated pattern.`;
                break;
            case "date":
                warning = `${quote(weakest.token)} looks like a date, and dates are easy to guess.`;
                break;
        }
    }

    if (password.length < 12) {
        suggestions.push("Make it longer: length helps more than anything else.");
    }
    if (weakest && ["word", "name", "passphrase-word"].includes(weakest.pattern)) {
        suggestions.push(
            "Use several unrelated words, or let the generator pick a passphrase.",
        );
    }
    if (
        patterns.some(
            (p) =>
                p.pattern !== "random" &&
                /\d|[^A-Za-z0-9]/.test(p.token) &&
                p.description.includes("substituted"),
        )
    ) {
        suggestions.push(
            "Swapping a for @ or o for 0 is expected, and barely slows a cracker down.",
        );
    }
    if (patterns.some((p) => p.pattern === "date")) {
        suggestions.push("Leave out birthdays, anniversaries and years.");
    }
    if (suggestions.length === 0) {
        suggestions.push("Add more unpredictable characters or another word.");
    }
    return { warning, suggestions: suggestions.slice(0, 3) };
}

/**
 * Estimate how many guesses a password would survive.
 *
 * Runs entirely locally and in a few milliseconds; nothing is sent
 * anywhere. Passwords longer than `MAX_ESTIMATED_LENGTH` are analysed
 * up to that length and the rest is counted as random, which keeps the
 * O(n²) search bounded.
 */
export function estimateStrength(password: string): StrengthEstimate {
    if (password === "") {
        return {
            guesses: 0,
            guessesLog10: 0,
            bits: 0,
            score: 0,
            label: STRENGTH_LABELS[0],
            patterns: [],
            warning: null,
            suggestions: [],
            crackTimes: crackTimes(0),
        };
    }

    const head = password.slice(0, MAX_ESTIMATED_LENGTH);
    const tail = password.slice(MAX_ESTIMATED_LENGTH);
    const base = cardinality(head);
    const matches = [
        ...dictionaryMatches(head),
        ...misspellingMatches(head),
        ...keyboardMatches(head),
        ...sequenceMatches(head),
        ...repeatMatches(head, base),
        ...dateMatches(head),
        ...separatorMatches(head),
    ].filter((m) => m.start >= 0 && m.end <= head.length);

    const { log2, patterns } = cheapestCover(head, matches, base);
    const separatorBits = patterns.some((p) => p.pattern === "separator")
        ? Math.log2(SEPARATOR_GUESSES)
        : 0;
    const bits = log2 + separatorBits + tail.length * Math.log2(base);
    const guessesLog10 = bits * Math.log10(2);
    const score = scoreFromLog10(guessesLog10);
    const { warning, suggestions } = buildFeedback(password, patterns, score);

    return {
        guesses: Math.min(2 ** bits, Number.MAX_VALUE),
        guessesLog10,
        bits,
        score,
        label: STRENGTH_LABELS[score],
        patterns,
        warning,
        suggestions,
        crackTimes: crackTimes(guessesLog10),
    };
}
