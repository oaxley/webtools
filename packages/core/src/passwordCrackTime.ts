/**
 * Crack-time estimates and strength scores shared by the generator and
 * the strength estimator.
 *
 * Kept apart from ./passwordStrength.ts so that pages and routes which
 * only generate passwords (whose strength is exact) can show crack
 * times without pulling in the estimator's dictionaries.
 */

/** Guess rates, in guesses per second, for three kinds of attack. */
export const ATTACK_SCENARIOS = [
    {
        id: "online",
        label: "Online, rate-limited",
        detail: "Guessing against a login form that allows 10 attempts a second",
        guessesPerSecond: 10,
    },
    {
        id: "bcrypt",
        label: "Leaked database, slow hash",
        detail: "Offline cracking of bcrypt or Argon2id hashes on one GPU",
        guessesPerSecond: 1e4,
    },
    {
        id: "fast",
        label: "Leaked database, fast hash",
        detail: "Offline cracking of MD5 or SHA-256 hashes on a GPU rig",
        guessesPerSecond: 1e11,
    },
] as const;

export type AttackScenarioId = (typeof ATTACK_SCENARIOS)[number]["id"];

/** 0 very weak, 1 weak, 2 fair, 3 strong, 4 very strong. */
export type StrengthScore = 0 | 1 | 2 | 3 | 4;

export const STRENGTH_LABELS: Record<StrengthScore, string> = {
    0: "Very weak",
    1: "Weak",
    2: "Fair",
    3: "Strong",
    4: "Very strong",
};

export interface CrackTime {
    scenario: AttackScenarioId;
    label: string;
    detail: string;
    /** Seconds to cover half the guesses; `Infinity` beyond 1e30 seconds. */
    seconds: number;
    /** Readable duration, e.g. "3 hours" or "thousands of years". */
    text: string;
}

const SECONDS = {
    minute: 60,
    hour: 3600,
    day: 86_400,
    month: 2_629_746,
    year: 31_556_952,
} as const;

/** Readable duration, e.g. "instantly", "3 hours", "millions of years". */
export function formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds)) return "longer than the universe has existed";
    if (seconds < 1) return "instantly";
    const round = (value: number, unit: string) => {
        const n = Math.round(value);
        return `${n} ${unit}${n === 1 ? "" : "s"}`;
    };
    if (seconds < SECONDS.minute) return round(seconds, "second");
    if (seconds < SECONDS.hour) return round(seconds / SECONDS.minute, "minute");
    if (seconds < SECONDS.day) return round(seconds / SECONDS.hour, "hour");
    if (seconds < SECONDS.month) return round(seconds / SECONDS.day, "day");
    if (seconds < SECONDS.year) return round(seconds / SECONDS.month, "month");
    const years = seconds / SECONDS.year;
    if (years < 1000) return round(years, "year");
    if (years < 1e6) return "thousands of years";
    if (years < 1e9) return "millions of years";
    // The universe is about 13.8 billion years old.
    if (years < 1.38e10) return "billions of years";
    return "longer than the universe has existed";
}

/**
 * How long each kind of attacker needs, given a number of guesses.
 *
 * Half the guesses on average, since the password is as likely to be
 * found in the first half of the search as the second.
 */
export function crackTimes(guessesLog10: number): CrackTime[] {
    return ATTACK_SCENARIOS.map((scenario) => {
        const log10 = guessesLog10 - Math.log10(2 * scenario.guessesPerSecond);
        const seconds = log10 > 30 ? Infinity : 10 ** log10;
        return {
            scenario: scenario.id,
            label: scenario.label,
            detail: scenario.detail,
            seconds,
            text: formatDuration(seconds),
        };
    });
}

/**
 * Score from the number of guesses.
 *
 * Stricter than zxcvbn's scale, which was tuned for rate-limited online
 * guessing and calls 10^10 guesses "very strong". Here the bands follow
 * the offline attacks shown next to the score, since a site's password
 * database can always leak:
 *
 * - 0 very weak:   under 10^6, found online within a day
 * - 1 weak:        under 10^12 (~40 bits), found within weeks even
 *                  against bcrypt, and in seconds against a fast hash
 * - 2 fair:        under 10^15 (~50 bits), safe behind bcrypt, but a
 *                  fast hash falls within hours
 * - 3 strong:      under 10^20 (~66 bits), a fast hash takes years
 * - 4 very strong: 10^20 and up, out of reach of any known attack
 */
export function scoreFromLog10(guessesLog10: number): StrengthScore {
    if (guessesLog10 < 6) return 0;
    if (guessesLog10 < 12) return 1;
    if (guessesLog10 < 15) return 2;
    if (guessesLog10 < 20) return 3;
    return 4;
}
