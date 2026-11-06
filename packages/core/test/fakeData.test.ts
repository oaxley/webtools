/**
 * Tests for the fake data generator (../src/fakeData.ts).
 *
 * Runner: Node built-in test runner.
 *   pnpm --filter @webtools/core test
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    FAKE_DATA_FIELD_IDS,
    FAKE_DATA_GROUP_IDS,
    FAKE_DATA_GROUPS,
    FAKE_DATA_SELECTORS,
    generateFakeData,
    MAX_FAKE_DATA_COUNT,
    MAX_FAKE_DATA_SEED,
    MAX_FAKE_DATA_VALUES,
    maxFakeDataCount,
    resolveFakeDataFields,
} from "../src/fakeData.ts";

describe("catalog", () => {
    it("has unique field ids and record keys", () => {
        const keys = FAKE_DATA_GROUPS.flatMap((g) => g.fields.map((f) => f.key));
        assert.equal(new Set(keys).size, keys.length);
        assert.equal(new Set(FAKE_DATA_FIELD_IDS).size, FAKE_DATA_FIELD_IDS.length);
    });

    it("prefixes field ids with their group id", () => {
        for (const g of FAKE_DATA_GROUPS) {
            for (const f of g.fields) assert.ok(f.id.startsWith(`${g.id}.`), f.id);
        }
    });

    it("lists groups then fields as selectors", () => {
        assert.deepEqual(FAKE_DATA_SELECTORS, [
            ...FAKE_DATA_GROUP_IDS,
            ...FAKE_DATA_FIELD_IDS,
        ]);
        assert.ok(FAKE_DATA_GROUP_IDS.includes("person"));
        assert.ok(FAKE_DATA_GROUP_IDS.includes("location"));
    });
});

describe("resolveFakeDataFields", () => {
    it("expands groups and keeps catalog order without duplicates", () => {
        const fields = resolveFakeDataFields([
            "location.city",
            "person.email",
            "person",
            "location.city",
        ]);
        const person = FAKE_DATA_GROUPS.find((g) => g.id === "person")!;
        assert.deepEqual(fields, [
            ...person.fields.map((f) => f.id),
            "location.city",
        ]);
    });

    it("trims selectors", () => {
        assert.deepEqual(resolveFakeDataFields([" person.email "]), ["person.email"]);
    });

    it("rejects an empty list", () => {
        assert.throws(() => resolveFakeDataFields([]), /at least one field/);
    });

    for (const bad of ["nope", "person.nope", "toString", "", "person."]) {
        it(`rejects ${JSON.stringify(bad)}`, () => {
            assert.throws(() => resolveFakeDataFields([bad]), /Unknown field/);
        });
    }
});

describe("maxFakeDataCount", () => {
    it("is the record limit, lowered by the value cap", () => {
        assert.equal(maxFakeDataCount(0), MAX_FAKE_DATA_COUNT);
        assert.equal(maxFakeDataCount(1), MAX_FAKE_DATA_COUNT);
        assert.equal(maxFakeDataCount(10), 100);
        assert.equal(maxFakeDataCount(11), 90);
        assert.equal(maxFakeDataCount(FAKE_DATA_FIELD_IDS.length), Math.floor(1000 / FAKE_DATA_FIELD_IDS.length));
        assert.ok(maxFakeDataCount(FAKE_DATA_FIELD_IDS.length) >= 1);
    });
});

describe("generateFakeData", () => {
    it("defaults to one record", () => {
        const result = generateFakeData({ fields: ["person.firstName"] });
        assert.equal(result.count, 1);
        assert.equal(result.seed, null);
        assert.deepEqual(result.fields, ["person.firstName"]);
        assert.deepEqual(Object.keys(result.records[0]), ["firstName"]);
        assert.equal(typeof result.records[0].firstName, "string");
    });

    it("generates every field, as many times as the cap allows", () => {
        const count = maxFakeDataCount(FAKE_DATA_FIELD_IDS.length);
        const result = generateFakeData({ fields: FAKE_DATA_GROUP_IDS, count });
        assert.equal(result.records.length, count);
        const keys = FAKE_DATA_GROUPS.flatMap((g) => g.fields.map((f) => f.key));
        for (const record of result.records) {
            assert.deepEqual(Object.keys(record), keys);
            for (const value of Object.values(record)) {
                assert.ok(["string", "number", "boolean"].includes(typeof value));
                if (typeof value === "string") assert.notEqual(value, "");
                if (typeof value === "number") assert.ok(Number.isFinite(value));
            }
        }
    });

    it("builds names, emails and usernames from one person", () => {
        const { records } = generateFakeData({ fields: ["person"], count: 50 });
        for (const r of records) {
            assert.equal(r.fullName, `${r.firstName} ${r.lastName}`);
            const strip = (s: unknown) =>
                String(s).toLowerCase().replace(/[^a-z]/g, "");
            const email = strip(String(r.email).split("@")[0]);
            assert.ok(
                email.includes(strip(r.firstName)) || email.includes(strip(r.lastName)),
                `${r.email} vs ${r.fullName}`,
            );
            assert.match(String(r.email), /^[^@\s]+@[^@\s]+\.[a-z]+$/);
            assert.ok(["female", "male"].includes(String(r.sex)));
            assert.match(String(r.birthdate), /^\d{4}-\d{2}-\d{2}$/);
        }
    });

    it("keeps US addresses consistent", () => {
        const { records } = generateFakeData({ fields: ["location"], count: 20 });
        for (const r of records) {
            assert.match(String(r.state), /^[A-Z]{2}$/);
            assert.match(String(r.zipCode), /^\d{5}$/);
            assert.equal(r.countryCode, "US");
            assert.ok(Math.abs(Number(r.latitude)) <= 90);
            assert.ok(Math.abs(Number(r.longitude)) <= 180);
        }
    });

    it("numbers misc.id from 1", () => {
        const { records } = generateFakeData({ fields: ["misc.id"], count: 5 });
        assert.deepEqual(records.map((r) => r.id), [1, 2, 3, 4, 5]);
    });

    it("is reproducible with a seed, dates included", () => {
        const options = { fields: FAKE_DATA_GROUP_IDS, count: 10, seed: 42 };
        const a = generateFakeData(options);
        const b = generateFakeData(options);
        assert.deepEqual(a, b);
        assert.equal(a.seed, 42);
        assert.notDeepEqual(
            a.records,
            generateFakeData({ ...options, seed: 43 }).records,
        );
    });

    it("accepts the seed bounds", () => {
        generateFakeData({ fields: ["misc.uuid"], seed: 0 });
        generateFakeData({ fields: ["misc.uuid"], seed: MAX_FAKE_DATA_SEED });
    });

    it("differs between unseeded runs", () => {
        const a = generateFakeData({ fields: ["misc.uuid"], count: 5 });
        const b = generateFakeData({ fields: ["misc.uuid"], count: 5 });
        assert.notDeepEqual(a.records, b.records);
    });

    it(`allows ${MAX_FAKE_DATA_COUNT} records of a whole person`, () => {
        const result = generateFakeData({ fields: ["person"], count: MAX_FAKE_DATA_COUNT });
        assert.equal(result.records.length, MAX_FAKE_DATA_COUNT);
    });

    it(`caps fields × count at ${MAX_FAKE_DATA_VALUES}`, () => {
        const fields = FAKE_DATA_FIELD_IDS.slice(0, 11);
        generateFakeData({ fields, count: 90 }); // 990
        assert.throws(
            () => generateFakeData({ fields, count: 91 }), // 1001
            /fields × count must be at most 1000 values \(got 11 × 91 = 1001\)\. With 11 fields, ask for at most 90 records/,
        );
        assert.throws(
            () => generateFakeData({ fields: FAKE_DATA_GROUP_IDS, count: 100 }),
            /at most 21 records/,
        );
    });

    for (const count of [0, MAX_FAKE_DATA_COUNT + 1, 1.5, Number.NaN, -1]) {
        it(`rejects count ${count}`, () => {
            assert.throws(
                () => generateFakeData({ fields: ["person"], count }),
                /count must be an integer between 1 and 100/,
            );
        });
    }

    for (const seed of [-1, 1.5, MAX_FAKE_DATA_SEED + 1, Number.NaN]) {
        it(`rejects seed ${seed}`, () => {
            assert.throws(
                () => generateFakeData({ fields: ["person"], seed }),
                /seed must be an integer between 0 and 4294967295/,
            );
        });
    }
});
