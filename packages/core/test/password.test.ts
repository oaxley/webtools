/**
 * Tests for the password generator (../src/password.ts) and the
 * strength estimator (../src/passwordStrength.ts).
 *
 * Runner: Node built-in test runner, no dependencies.
 *   node --test test/
 *   pnpm --filter @webtools/core test
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    AMBIGUOUS_CHARACTERS,
    generatePassword,
    generatePasswords,
    MAX_PASSWORD_COUNT,
    PASSWORD_CHARSET_NAMES,
    PASSWORD_CHARSETS,
    passwordEntropyBits,
    resolvePasswordOptions,
    type PasswordCharset,
} from "../src/password.ts";
import { EFF_LARGE_WORDLIST, EFF_WORDLIST_SIZE } from "../src/passwordWordlist.ts";
import {
    COMMON_NAMES,
    COMMON_PASSWORDS,
    ENGLISH_WORDS,
} from "../src/passwordDictionaries.ts";
import { estimateStrength } from "../src/passwordStrength.ts";
import { crackTimes, formatDuration, scoreFromLog10 } from "../src/passwordCrackTime.ts";

describe("wordlists", () => {
    it("has the 7,776 distinct EFF words", () => {
        assert.equal(EFF_WORDLIST_SIZE, 7776);
        assert.equal(new Set(EFF_LARGE_WORDLIST).size, 7776);
        assert.equal(EFF_LARGE_WORDLIST[0], "abacus");
        assert.equal(EFF_LARGE_WORDLIST[7775], "zoom");
        for (const word of EFF_LARGE_WORDLIST) assert.match(word, /^[a-z-]{3,9}$/);
    });

    it("keeps the dictionaries in frequency order", () => {
        assert.deepEqual(COMMON_PASSWORDS.slice(0, 3), ["123456", "password", "12345678"]);
        assert.equal(COMMON_PASSWORDS.length, 10_000);
        assert.ok(ENGLISH_WORDS.length >= 20_000);
        assert.ok(COMMON_NAMES.length >= 3_000);
        for (const list of [COMMON_PASSWORDS, ENGLISH_WORDS, COMMON_NAMES]) {
            assert.ok(list.every((w) => w.length > 0 && !w.includes(",")));
        }
    });
});

describe("resolvePasswordOptions", () => {
    it("defaults to 20 random characters from every set", () => {
        assert.deepEqual(resolvePasswordOptions(), {
            mode: "random",
            length: 20,
            sets: ["lower", "upper", "digits", "symbols"],
            excludeAmbiguous: false,
            requireEachSet: true,
        });
    });

    it("defaults passphrases to six words joined by '-'", () => {
        assert.deepEqual(resolvePasswordOptions({ mode: "passphrase" }), {
            mode: "passphrase",
            words: 6,
            separator: "-",
            capitalize: false,
            includeNumber: false,
        });
    });

    it("puts sets in canonical order and drops duplicates", () => {
        const o = resolvePasswordOptions({ sets: ["digits", "lower", "digits"] });
        assert.deepEqual(o.mode === "random" && o.sets, ["lower", "digits"]);
    });

    const invalid: Array<[string, Parameters<typeof resolvePasswordOptions>[0], RegExp]> = [
        ["length too short", { length: 3 }, /length/],
        ["length too long", { length: 129 }, /length/],
        ["fractional length", { length: 10.5 }, /length/],
        ["no sets", { sets: [] }, /sets/],
        ["unknown set", { sets: ["emoji" as PasswordCharset] }, /Unknown character set/],
        ["too few words", { mode: "passphrase", words: 2 }, /words/],
        ["too many words", { mode: "passphrase", words: 13 }, /words/],
        ["empty separator", { mode: "passphrase", separator: "" }, /separator/],
        ["letter separator", { mode: "passphrase", separator: "x" }, /separator/],
        ["digit separator", { mode: "passphrase", separator: "1" }, /separator/],
        ["long separator", { mode: "passphrase", separator: "----" }, /separator/],
        ["unknown mode", { mode: "pin" as "random" }, /Unknown mode/],
        ["non-boolean flag", { excludeAmbiguous: "yes" as unknown as boolean }, /true or false/],
    ];
    for (const [name, options, message] of invalid) {
        it(`rejects ${name}`, () => {
            assert.throws(() => resolvePasswordOptions(options), message);
        });
    }

    it("accepts a length equal to the number of sets", () => {
        assert.doesNotThrow(() => resolvePasswordOptions({ length: 4 }));
    });
});

describe("generatePasswords", () => {
    it("returns the requested count, the settings and the entropy", () => {
        const result = generatePasswords({ count: 5, length: 12 });
        assert.equal(result.passwords.length, 5);
        assert.equal(result.options.mode, "random");
        assert.equal(result.entropyBits, passwordEntropyBits({ length: 12 }));
        for (const p of result.passwords) assert.equal(p.length, 12);
    });

    it("rejects counts outside 1..20", () => {
        assert.throws(() => generatePasswords({ count: 0 }), /count/);
        assert.throws(() => generatePasswords({ count: MAX_PASSWORD_COUNT + 1 }), /count/);
    });

    it("draws only from the chosen sets", () => {
        const { passwords } = generatePasswords({
            count: 20,
            length: 64,
            sets: ["lower", "digits"],
        });
        for (const p of passwords) assert.match(p, /^[a-z0-9]{64}$/);
    });

    it("includes every chosen set when asked", () => {
        for (let i = 0; i < 500; i++) {
            const p = generatePassword({ length: 4 });
            for (const set of PASSWORD_CHARSET_NAMES) {
                assert.ok(
                    [...PASSWORD_CHARSETS[set]].some((c) => p.includes(c)),
                    `${p} has no ${set} character`,
                );
            }
        }
    });

    it("leaves out look-alikes when asked", () => {
        const { passwords } = generatePasswords({
            count: 20,
            length: 128,
            excludeAmbiguous: true,
        });
        for (const p of passwords) {
            for (const c of AMBIGUOUS_CHARACTERS) assert.ok(!p.includes(c), `${p} has ${c}`);
        }
    });

    it("picks every character equally often (chi-square)", () => {
        const alphabet = Object.values(PASSWORD_CHARSETS).join("");
        const counts = new Map<string, number>([...alphabet].map((c) => [c, 0]));
        const { passwords } = generatePasswords({
            count: 20,
            length: 128,
            requireEachSet: false,
        });
        let draws = 0;
        // 20 × 128 × 40 draws ≈ 1,090 per character.
        for (let round = 0; round < 40; round++) {
            const batch = round === 0 ? passwords : generatePasswords({ count: 20, length: 128, requireEachSet: false }).passwords;
            for (const p of batch) {
                for (const c of p) {
                    counts.set(c, counts.get(c)! + 1);
                    draws++;
                }
            }
        }
        const expected = draws / alphabet.length;
        let chi2 = 0;
        for (const n of counts.values()) chi2 += (n - expected) ** 2 / expected;
        // 93 degrees of freedom: p = 0.0001 at about 155.
        assert.ok(chi2 < 155, `chi-square ${chi2.toFixed(1)} suggests bias`);
    });

    it("builds passphrases from the EFF list", () => {
        const { passwords } = generatePasswords({
            mode: "passphrase",
            words: 5,
            separator: " ",
            count: 20,
        });
        for (const p of passwords) {
            const words = p.split(" ");
            assert.equal(words.length, 5);
            for (const w of words) assert.ok(EFF_LARGE_WORDLIST.includes(w), w);
        }
    });

    it("capitalises words and adds one digit when asked", () => {
        for (let i = 0; i < 50; i++) {
            const p = generatePassword({
                mode: "passphrase",
                words: 4,
                separator: ".",
                capitalize: true,
                includeNumber: true,
            });
            const words = p.split(".");
            assert.equal(words.length, 4);
            assert.equal((p.match(/\d/g) ?? []).length, 1, p);
            for (const w of words) {
                assert.match(w, /^[A-Z]/);
                assert.ok(EFF_LARGE_WORDLIST.includes(w.replace(/\d$/, "").toLowerCase()), w);
            }
        }
    });
});

describe("passwordEntropyBits", () => {
    const close = (actual: number, expected: number) =>
        assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);

    it("is length × log2(alphabet) without the each-set rule", () => {
        close(passwordEntropyBits({ length: 16, requireEachSet: false }), 16 * Math.log2(94));
        close(
            passwordEntropyBits({ length: 10, sets: ["digits"] }),
            10 * Math.log2(10),
        );
        close(
            passwordEntropyBits({ length: 8, sets: ["lower", "upper"], excludeAmbiguous: true, requireEachSet: false }),
            // l, I and O are look-alikes.
            8 * Math.log2(49),
        );
    });

    it("matches a brute-force count with the each-set rule", () => {
        // Strings of length 4 over 26 lower + 10 digits with at least one
        // of each: count them all.
        let valid = 0;
        for (let a = 0; a < 36 ** 4; a++) {
            const digits = [0, 1, 2, 3].map((k) => Math.floor(a / 36 ** k) % 36 < 10);
            if (digits.some(Boolean) && !digits.every(Boolean)) valid++;
        }
        close(passwordEntropyBits({ length: 4, sets: ["lower", "digits"] }), Math.log2(valid));
    });

    it("counts each EFF word as log2(7776) bits", () => {
        close(passwordEntropyBits({ mode: "passphrase", words: 6 }), 6 * Math.log2(7776));
        close(
            passwordEntropyBits({ mode: "passphrase", words: 4, includeNumber: true }),
            4 * Math.log2(7776) + Math.log2(40),
        );
        // Capitals and separators are fixed choices.
        close(
            passwordEntropyBits({ mode: "passphrase", words: 4, capitalize: true, separator: "_" }),
            4 * Math.log2(7776),
        );
    });
});

describe("estimateStrength", () => {
    const weak = [
        "password",
        "123456",
        "P@ssw0rd",
        "qwerty123",
        "iloveyou",
        "1987",
        "aaaaaaaa",
        "abcdefgh",
        "asdfghjkl",
        "Summer2024",
        "dragon123",
        "12/03/1999",
    ];
    for (const password of weak) {
        it(`scores "${password}" 0 or 1`, () => {
            const e = estimateStrength(password);
            assert.ok(e.score <= 1, `${password}: score ${e.score}, ${e.bits.toFixed(1)} bits`);
            assert.ok(e.warning, `${password} should have a warning`);
        });
    }

    it("scores long random passwords and passphrases 4", () => {
        for (let i = 0; i < 20; i++) {
            for (const options of [{ length: 16 }, { mode: "passphrase" as const, words: 6 }]) {
                const password = generatePassword(options);
                const e = estimateStrength(password);
                assert.equal(e.score, 4, `${password}: ${e.bits.toFixed(1)} bits`);
                assert.equal(e.warning, null);
            }
        }
    });

    it("never rates a random password above its true entropy by much", () => {
        // Counting the cardinality of the characters actually used can
        // overshoot slightly; it should never be off by more than a few bits.
        for (let i = 0; i < 50; i++) {
            const password = generatePassword({ length: 20 });
            const e = estimateStrength(password);
            assert.ok(e.bits <= passwordEntropyBits({ length: 20 }) + 2, `${password}: ${e.bits}`);
        }
    });

    it("sees through l33t spellings and misspellings", () => {
        const plain = estimateStrength("troubadour");
        const decorated = estimateStrength("Tr0ub4dor&3");
        assert.ok(decorated.bits < 50, `Tr0ub4dor&3 at ${decorated.bits.toFixed(1)} bits`);
        assert.ok(decorated.bits > plain.bits);
        assert.ok(
            decorated.patterns.some(
                (p) => p.description.includes("troubadour") && p.description.includes("substituted"),
            ),
            JSON.stringify(decorated.patterns),
        );
    });

    it("rates a four-word passphrase above a decorated word", () => {
        assert.ok(
            estimateStrength("correct horse battery staple").bits >
                estimateStrength("Tr0ub4dor&3").bits + 15,
        );
    });

    it("charges a repeated separator once", () => {
        const spaced = estimateStrength("correct horse battery staple");
        assert.deepEqual(
            spaced.patterns.filter((p) => p.pattern === "separator").map((p) => p.start),
            [7, 13, 21],
        );
        assert.equal(
            estimateStrength("correct-horse-battery-staple").bits.toFixed(6),
            spaced.bits.toFixed(6),
        );
        // Spacing words out costs the attacker the separator choice, and
        // never makes a passphrase look weaker than the words run together.
        assert.ok(spaced.bits > estimateStrength("correcthorsebatterystaple").bits);
    });

    it("explains a common password by its rank", () => {
        const e = estimateStrength("monkey");
        assert.equal(e.patterns.length, 1);
        assert.equal(e.patterns[0].pattern, "common-password");
        assert.match(e.patterns[0].description, /^\d+th most common password$/);
    });

    it("splits a password into ordered pieces that cover it exactly", () => {
        for (const password of ["Monkey2024!", "xX_dragon_Xx", "qwertyJ8#kQ"]) {
            const e = estimateStrength(password);
            assert.equal(e.patterns.map((p) => p.token).join(""), password);
            let position = 0;
            for (const p of e.patterns) {
                assert.equal(p.start, position);
                position += p.token.length;
            }
        }
    });

    it("handles empty, very long and non-ASCII input", () => {
        assert.equal(estimateStrength("").score, 0);
        const long = generatePassword({ length: 128 }).repeat(4);
        const started = performance.now();
        assert.equal(estimateStrength(long).score, 4);
        assert.ok(performance.now() - started < 2000);
        assert.ok(Number.isFinite(estimateStrength(long).bits));
        assert.ok(estimateStrength("mot de passe éèà 🙂").bits > 0);
    });
});

describe("crack times", () => {
    it("divides half the guesses by each scenario's rate", () => {
        const [online, bcrypt, fast] = crackTimes(6);
        assert.ok(Math.abs(online.seconds - 1e6 / 2 / 10) < 1e-6);
        assert.ok(Math.abs(bcrypt.seconds - 1e6 / 2 / 1e4) < 1e-9);
        assert.ok(Math.abs(fast.seconds - 1e6 / 2 / 1e11) < 1e-15);
        assert.equal(fast.text, "instantly");
    });

    it("formats durations", () => {
        assert.equal(formatDuration(0.5), "instantly");
        assert.equal(formatDuration(1), "1 second");
        assert.equal(formatDuration(90), "2 minutes");
        assert.equal(formatDuration(3 * 3600), "3 hours");
        assert.equal(formatDuration(5 * 86_400), "5 days");
        assert.equal(formatDuration(40 * 31_556_952), "40 years");
        assert.equal(formatDuration(5e3 * 31_556_952), "thousands of years");
        assert.equal(formatDuration(5e7 * 31_556_952), "millions of years");
        assert.equal(formatDuration(5e9 * 31_556_952), "billions of years");
        assert.equal(formatDuration(5e10 * 31_556_952), "longer than the universe has existed");
        assert.equal(formatDuration(Infinity), "longer than the universe has existed");
    });

    it("maps guesses to the 0-4 scale", () => {
        assert.deepEqual(
            [2, 5.9, 6, 11.9, 12, 14.9, 15, 19.9, 20, 40].map(scoreFromLog10),
            [0, 0, 1, 1, 2, 2, 3, 3, 4, 4],
        );
    });
});
