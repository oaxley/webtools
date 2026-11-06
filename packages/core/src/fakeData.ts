/**
 * Fake data generator — realistic-looking test records built with
 * `@faker-js/faker`.
 *
 * Fields are organised in groups ("person", "location", …). Callers
 * pick fields with selectors: a field id (`person.email`) or a whole
 * group (`person`). Fields of the same group share their context
 * within a record, so `fullName`, `email` and `username` are built from
 * the same first and last name, and `zipCode` belongs to `state`.
 *
 * Exported from `@webtools/core/fakeData` rather than the package root:
 * faker and its English locale data weigh a few hundred KB, which only
 * the fake data page, route and MCP tool should pay for.
 *
 * Records are flat objects whose keys are the fields' `key`s (unique
 * across every group), in catalog order. Pass a `seed` to get the same
 * records every time: seeded runs also pin the reference date used for
 * relative dates (birthdates, past/future dates) to `FAKE_DATA_SEED_REF_DATE`.
 *
 * "Safe" mode (on by default) swaps the values that could reach something
 * real, such as an email address or a public IP, for values reserved for
 * testing. It lowers the risk, it doesn't remove it: see
 * `FakeDataOptions.safe`.
 */
import { base, en, en_US, Faker } from "@faker-js/faker";

/** Maximum number of records returned by a single call. */
export const MAX_FAKE_DATA_COUNT = 100;
/**
 * Maximum fields × records per call. Faker costs about 1–13 µs per value
 * (≈ 5 µs on average), so this keeps one request within the Workers free
 * plan's 10 ms CPU budget. All 10 `person` fields × 100 records fit;
 * every field × 100 records (≈ 4,700 values, ≈ 27 ms) does not.
 */
export const MAX_FAKE_DATA_VALUES = 1000;
/** Largest seed accepted (seeds are unsigned 32-bit integers). */
export const MAX_FAKE_DATA_SEED = 0xffffffff;
/** Reference "now" for seeded runs, so their dates are reproducible too. */
export const FAKE_DATA_SEED_REF_DATE = "2026-01-01T00:00:00.000Z";

/** A generated value. */
export type FakeValue = string | number | boolean;
/** One generated record, keyed by field `key`. */
export type FakeRecord = Record<string, FakeValue>;

/** Per-record state shared by the fields of one group. */
type Context = Record<string, unknown>;

interface FieldSpec {
    /** Short name inside the group, e.g. `email`. */
    name: string;
    /** Key in the generated records, unique across every group. */
    key: string;
    label: string;
    /** Example value, shown in the UI and the MCP description. */
    example: string;
    /** `safe`: use values reserved for testing (see FakeDataOptions.safe). */
    generate: (faker: Faker, ctx: Context, index: number, safe: boolean) => FakeValue;
}

interface GroupSpec {
    id: string;
    label: string;
    description: string;
    /** Builds the shared context, once per record and only when needed. */
    context?: (faker: Faker) => Context;
    fields: FieldSpec[];
}

/** ISO date (`YYYY-MM-DD`) of a `Date`. */
function isoDate(date: Date): string {
    return date.toISOString().slice(0, 10);
}

/** `Acme, Inc.` → `acme-inc.com` (`acme-inc.example` when safe). */
function domainOf(companyName: string, safe: boolean): string {
    const slug = companyName
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .replace(/-(inc|llc|group)$/, "");
    return `${slug || "example"}.${safe ? "example" : "com"}`;
}

/** IPv4 documentation ranges (RFC 5737), as faker network names. */
const TEST_NETS = ["test-net-1", "test-net-2", "test-net-3"] as const;

/** An address in the IPv6 documentation prefix `2001:db8::/32` (RFC 3849). */
function documentationIpv6(f: Faker): string {
    const groups = Array.from({ length: 6 }, () =>
        f.number.int({ min: 0, max: 0xffff }).toString(16),
    );
    return `2001:db8:${groups.join(":")}`;
}

/**
 * A unicast, locally administered MAC address (second-lowest bit of the
 * first octet set): never assigned to a manufacturer, so never a real
 * device's burned-in address.
 */
function localMac(f: Faker): string {
    const first = (f.number.int({ min: 0, max: 0xff }) & 0xfc) | 0x02;
    const rest = Array.from({ length: 5 }, () => f.number.int({ min: 0, max: 0xff }));
    return [first, ...rest].map((b) => b.toString(16).padStart(2, "0")).join(":");
}

/**
 * `(845) 501-0635` → `(845) 555-0135`: 555-0100 to 555-0199 are reserved
 * for fictional use in the North American Numbering Plan.
 */
function fictionalPhone(f: Faker): string {
    const area = f.phone.number({ style: "national" }).slice(0, 5);
    return `${area} 555-01${String(f.number.int({ min: 0, max: 99 })).padStart(2, "0")}`;
}

const GROUPS: GroupSpec[] = [
    {
        id: "person",
        label: "Person",
        description:
            "A person; name, email and username are built from the same name.",
        context: (f) => {
            const sex = f.person.sexType();
            return {
                sex,
                firstName: f.person.firstName(sex),
                lastName: f.person.lastName(),
            };
        },
        fields: [
            {
                name: "firstName",
                key: "firstName",
                label: "First name",
                example: "Nikita",
                generate: (_f, c) => c.firstName as string,
            },
            {
                name: "lastName",
                key: "lastName",
                label: "Last name",
                example: "Crist",
                generate: (_f, c) => c.lastName as string,
            },
            {
                name: "fullName",
                key: "fullName",
                label: "Full name",
                example: "Nikita Crist",
                generate: (_f, c) => `${c.firstName} ${c.lastName}`,
            },
            {
                name: "sex",
                key: "sex",
                label: "Sex",
                example: "female",
                generate: (_f, c) => c.sex as string,
            },
            {
                name: "birthdate",
                key: "birthdate",
                label: "Birthdate (18–80)",
                example: "1975-08-07",
                generate: (f) =>
                    isoDate(f.date.birthdate({ mode: "age", min: 18, max: 80 })),
            },
            {
                name: "jobTitle",
                key: "jobTitle",
                label: "Job title",
                example: "Lead Data Engineer",
                generate: (f) => f.person.jobTitle(),
            },
            {
                name: "email",
                key: "email",
                label: "Email",
                example: "Nikita_Crist83@example.com",
                generate: (f, c, _i, safe) => {
                    const name = {
                        firstName: c.firstName as string,
                        lastName: c.lastName as string,
                    };
                    return safe ? f.internet.exampleEmail(name) : f.internet.email(name);
                },
            },
            {
                name: "username",
                key: "username",
                label: "Username",
                example: "Nikita.Crist18",
                generate: (f, c) =>
                    f.internet.username({
                        firstName: c.firstName as string,
                        lastName: c.lastName as string,
                    }),
            },
            {
                name: "phone",
                key: "phone",
                label: "Phone",
                example: "(845) 555-0135",
                generate: (f, _c, _i, safe) =>
                    safe ? fictionalPhone(f) : f.phone.number({ style: "national" }),
            },
            {
                name: "avatar",
                key: "avatar",
                label: "Avatar URL",
                example:
                    "https://cdn.jsdelivr.net/gh/faker-js/assets-person-portrait/female/512/15.jpg",
                generate: (f, c) =>
                    f.image.personPortrait({ sex: c.sex as "female" | "male" }),
            },
        ],
    },
    {
        id: "location",
        label: "Location",
        description:
            "A US postal address; the ZIP code matches the state. Coordinates are random points.",
        context: (f) => ({ state: f.location.state({ abbreviated: true }) }),
        fields: [
            {
                name: "street",
                key: "street",
                label: "Street address",
                example: "588 Ivah Square",
                generate: (f) => f.location.streetAddress(),
            },
            {
                name: "city",
                key: "city",
                label: "City",
                example: "Lake Elmore",
                generate: (f) => f.location.city(),
            },
            {
                name: "state",
                key: "state",
                label: "State code",
                example: "CA",
                generate: (_f, c) => c.state as string,
            },
            {
                name: "zipCode",
                key: "zipCode",
                label: "ZIP code",
                example: "92891",
                generate: (f, c) => f.location.zipCode({ state: c.state as string }),
            },
            {
                name: "country",
                key: "country",
                label: "Country",
                example: "United States",
                generate: () => "United States",
            },
            {
                name: "countryCode",
                key: "countryCode",
                label: "Country code",
                example: "US",
                generate: () => "US",
            },
            {
                name: "latitude",
                key: "latitude",
                label: "Latitude",
                example: "64.9315",
                generate: (f) => f.location.latitude(),
            },
            {
                name: "longitude",
                key: "longitude",
                label: "Longitude",
                example: "-75.0990",
                generate: (f) => f.location.longitude(),
            },
        ],
    },
    {
        id: "company",
        label: "Company",
        description: "A company; its domain is derived from its name.",
        context: (f) => ({ name: f.company.name() }),
        fields: [
            {
                name: "name",
                key: "companyName",
                label: "Company name",
                example: "Crist - Hilll",
                generate: (_f, c) => c.name as string,
            },
            {
                name: "domain",
                key: "companyDomain",
                label: "Company domain",
                example: "crist-hilll.example",
                generate: (_f, c, _i, safe) => domainOf(c.name as string, safe),
            },
            {
                name: "catchPhrase",
                key: "catchPhrase",
                label: "Catch phrase",
                example: "Versatile secondary emulation",
                generate: (f) => f.company.catchPhrase(),
            },
            {
                name: "department",
                key: "department",
                label: "Department",
                example: "Beauty",
                generate: (f) => f.commerce.department(),
            },
        ],
    },
    {
        id: "internet",
        label: "Internet",
        description: "Network and web values.",
        fields: [
            {
                name: "url",
                key: "url",
                label: "URL",
                example: "https://athletic-sarong.example/",
                generate: (f, _c, _i, safe) =>
                    safe ? `https://${f.internet.domainWord()}.example/` : f.internet.url(),
            },
            {
                name: "domain",
                key: "domain",
                label: "Domain",
                example: "zany-bump.example",
                generate: (f, _c, _i, safe) =>
                    safe ? `${f.internet.domainWord()}.example` : f.internet.domainName(),
            },
            {
                name: "ipv4",
                key: "ipv4",
                label: "IPv4 address",
                example: "203.0.113.42",
                generate: (f, _c, _i, safe) =>
                    safe
                        ? f.internet.ipv4({ network: f.helpers.arrayElement(TEST_NETS) })
                        : f.internet.ipv4(),
            },
            {
                name: "ipv6",
                key: "ipv6",
                label: "IPv6 address",
                example: "2001:db8:85a3:0:8a2e:370:7334:1f",
                generate: (f, _c, _i, safe) => (safe ? documentationIpv6(f) : f.internet.ipv6()),
            },
            {
                name: "mac",
                key: "mac",
                label: "MAC address",
                example: "b6:ff:47:44:09:80",
                generate: (f, _c, _i, safe) => (safe ? localMac(f) : f.internet.mac()),
            },
            {
                name: "userAgent",
                key: "userAgent",
                label: "User agent",
                example: "Mozilla/5.0 (iPhone; CPU iPhone OS 12_2 like Mac OS X) …",
                generate: (f) => f.internet.userAgent(),
            },
            {
                name: "password",
                key: "password",
                label: "Password (not for real use)",
                example: "w7O7i7fCSp2YaQ6",
                generate: (f) => f.internet.password(),
            },
        ],
    },
    {
        id: "finance",
        label: "Finance",
        description: "Test-only financial values; card numbers pass the Luhn check.",
        fields: [
            {
                name: "iban",
                key: "iban",
                label: "IBAN",
                example: "ME33140235078900130425",
                generate: (f) => f.finance.iban(),
            },
            {
                name: "creditCard",
                key: "creditCard",
                label: "Credit card number",
                example: "3709-710877-70313",
                generate: (f) => f.finance.creditCardNumber(),
            },
            {
                name: "currency",
                key: "currency",
                label: "Currency code",
                example: "EUR",
                generate: (f) => f.finance.currencyCode(),
            },
            {
                name: "amount",
                key: "amount",
                label: "Amount",
                example: "611.85",
                generate: (f) => Number(f.finance.amount()),
            },
            {
                name: "accountNumber",
                key: "accountNumber",
                label: "Account number",
                example: "63033768",
                generate: (f) => f.finance.accountNumber(),
            },
        ],
    },
    {
        id: "commerce",
        label: "Commerce",
        description: "Products for shop and catalog screens.",
        fields: [
            {
                name: "productName",
                key: "productName",
                label: "Product name",
                example: "Ergonomic Steel Chair",
                generate: (f) => f.commerce.productName(),
            },
            {
                name: "price",
                key: "price",
                label: "Price",
                example: "140.39",
                generate: (f) => Number(f.commerce.price()),
            },
            {
                name: "isbn",
                key: "isbn",
                label: "ISBN",
                example: "978-0-7155-0610-3",
                generate: (f) => f.commerce.isbn(),
            },
            {
                name: "color",
                key: "color",
                label: "Color",
                example: "white",
                generate: (f) => f.color.human(),
            },
        ],
    },
    {
        id: "date",
        label: "Dates",
        description: "ISO 8601 timestamps relative to now (or to a fixed date when seeded).",
        fields: [
            {
                name: "past",
                key: "pastDate",
                label: "Past (last year)",
                example: "2025-11-08T12:56:45.074Z",
                generate: (f) => f.date.past().toISOString(),
            },
            {
                name: "recent",
                key: "recentDate",
                label: "Recent (last day)",
                example: "2026-11-04T21:13:02.511Z",
                generate: (f) => f.date.recent().toISOString(),
            },
            {
                name: "future",
                key: "futureDate",
                label: "Future (next year)",
                example: "2027-03-19T08:40:11.902Z",
                generate: (f) => f.date.future().toISOString(),
            },
        ],
    },
    {
        id: "misc",
        label: "Misc",
        description: "Identifiers, numbers and text.",
        fields: [
            {
                name: "id",
                key: "id",
                label: "Sequential id (1, 2, …)",
                example: "1",
                generate: (_f, _c, index) => index + 1,
            },
            {
                name: "uuid",
                key: "uuid",
                label: "UUID (v4)",
                example: "4b3c9a1e-8f2d-4c6a-9e1b-7d5f3a2c1b0e",
                generate: (f) => f.string.uuid(),
            },
            {
                name: "boolean",
                key: "boolean",
                label: "Boolean",
                example: "true",
                generate: (f) => f.datatype.boolean(),
            },
            {
                name: "integer",
                key: "integer",
                label: "Integer (0–1000)",
                example: "511",
                generate: (f) => f.number.int({ min: 0, max: 1000 }),
            },
            {
                name: "sentence",
                key: "sentence",
                label: "Sentence",
                example: "Brevis animadverto confero vilitas commodi earum.",
                generate: (f) => f.lorem.sentence(),
            },
            {
                name: "paragraph",
                key: "paragraph",
                label: "Paragraph",
                example: "Tenus aegrotatio adsum…",
                generate: (f) => f.lorem.paragraph(),
            },
        ],
    },
];

/** Public description of a field, for UIs and schemas. */
export interface FakeDataField {
    /** Selector, e.g. `person.email`. */
    id: string;
    /** Key in the generated records, e.g. `email`. */
    key: string;
    label: string;
    example: string;
}

/** Public description of a group of fields. */
export interface FakeDataGroup {
    /** Selector for the whole group, e.g. `person`. */
    id: string;
    label: string;
    description: string;
    fields: FakeDataField[];
}

/** Every group and its fields, in output order. */
export const FAKE_DATA_GROUPS: readonly FakeDataGroup[] = GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    description: g.description,
    fields: g.fields.map((f) => ({
        id: `${g.id}.${f.name}`,
        key: f.key,
        label: f.label,
        example: f.example,
    })),
}));

/** Every group id (`person`, `location`, …). */
export const FAKE_DATA_GROUP_IDS: readonly string[] = GROUPS.map((g) => g.id);

/** Every field id (`person.firstName`, …), in output order. */
export const FAKE_DATA_FIELD_IDS: readonly string[] = FAKE_DATA_GROUPS.flatMap(
    (g) => g.fields.map((f) => f.id),
);

/** Every accepted selector: group ids, then field ids. */
export const FAKE_DATA_SELECTORS: readonly string[] = [
    ...FAKE_DATA_GROUP_IDS,
    ...FAKE_DATA_FIELD_IDS,
];

export interface FakeDataOptions {
    /** Field or group ids, e.g. `["person", "location.city"]`. Required. */
    fields: readonly string[];
    /** How many records, 1..MAX_FAKE_DATA_COUNT. Defaults to 1. */
    count?: number;
    /** Integer 0..MAX_FAKE_DATA_SEED for reproducible output. */
    seed?: number;
    /**
     * Use values reserved for testing where a field could otherwise hit
     * something real (default `true`): emails and domains under
     * `example.com`/`.example` (RFC 2606), 555-01xx phone numbers, IPs
     * from the documentation ranges (RFC 5737, RFC 3849) and locally
     * administered MAC addresses. Names, addresses, IBANs and card
     * numbers are unaffected.
     */
    safe?: boolean;
}

/** Field ids whose values change when `safe` is on. */
export const FAKE_DATA_SAFE_FIELD_IDS: readonly string[] = [
    "person.email",
    "person.phone",
    "company.domain",
    "internet.url",
    "internet.domain",
    "internet.ipv4",
    "internet.ipv6",
    "internet.mac",
];

export interface FakeDataResult {
    /** Expanded field ids, in output order. */
    fields: string[];
    count: number;
    /** The seed used, or `null` for a random run. */
    seed: number | null;
    /** Whether values reserved for testing were used. */
    safe: boolean;
    records: FakeRecord[];
}

/**
 * Expand selectors (group or field ids) into field ids, deduplicated
 * and in catalog order.
 *
 * @throws Error on an empty list or an unknown selector.
 */
export function resolveFakeDataFields(selectors: readonly string[]): string[] {
    if (!Array.isArray(selectors) || selectors.length === 0) {
        throw new Error(
            "fields must list at least one field or group, e.g. person or person.email. " +
                `Groups: ${FAKE_DATA_GROUP_IDS.join(", ")}.`,
        );
    }
    const wanted = new Set<string>();
    for (const raw of selectors) {
        const selector = typeof raw === "string" ? raw.trim() : raw;
        if (typeof selector === "string" && FAKE_DATA_GROUP_IDS.includes(selector)) {
            const group = FAKE_DATA_GROUPS.find((g) => g.id === selector)!;
            for (const f of group.fields) wanted.add(f.id);
        } else if (
            typeof selector === "string" &&
            FAKE_DATA_FIELD_IDS.includes(selector)
        ) {
            wanted.add(selector);
        } else {
            throw new Error(
                `Unknown field: ${String(raw)}. Use a group (${FAKE_DATA_GROUP_IDS.join(", ")}) ` +
                    "or a field such as person.email.",
            );
        }
    }
    return FAKE_DATA_FIELD_IDS.filter((id) => wanted.has(id));
}

/**
 * Most records one call may return for `fieldCount` fields:
 * MAX_FAKE_DATA_COUNT, lowered by the MAX_FAKE_DATA_VALUES cap.
 */
export function maxFakeDataCount(fieldCount: number): number {
    if (fieldCount <= 0) return MAX_FAKE_DATA_COUNT;
    return Math.min(
        MAX_FAKE_DATA_COUNT,
        Math.floor(MAX_FAKE_DATA_VALUES / fieldCount),
    );
}

/**
 * Generate fake records.
 *
 * @throws Error when `fields`, `count` or `seed` is invalid, or when
 *   fields × count exceeds MAX_FAKE_DATA_VALUES. Messages
 *   are meant to be surfaced verbatim by the HTTP route and MCP tool.
 */
export function generateFakeData(options: FakeDataOptions): FakeDataResult {
    const { fields: selectors, count = 1, seed, safe = true } = options;

    const fields = resolveFakeDataFields(selectors);
    if (!Number.isInteger(count) || count < 1 || count > MAX_FAKE_DATA_COUNT) {
        throw new Error(
            `count must be an integer between 1 and ${MAX_FAKE_DATA_COUNT}.`,
        );
    }
    if (fields.length * count > MAX_FAKE_DATA_VALUES) {
        throw new Error(
            `fields × count must be at most ${MAX_FAKE_DATA_VALUES} values ` +
                `(got ${fields.length} × ${count} = ${fields.length * count}). ` +
                `With ${fields.length} fields, ask for at most ` +
                `${maxFakeDataCount(fields.length)} records, or pick fewer fields.`,
        );
    }
    if (typeof safe !== "boolean") {
        throw new Error("safe must be true or false.");
    }
    if (
        seed !== undefined &&
        (!Number.isInteger(seed) || seed < 0 || seed > MAX_FAKE_DATA_SEED)
    ) {
        throw new Error(
            `seed must be an integer between 0 and ${MAX_FAKE_DATA_SEED}.`,
        );
    }

    // A fresh instance per call: seeding and the reference date are
    // instance state, and concurrent requests must not share them.
    const faker = new Faker({ locale: [en_US, en, base] });
    if (seed !== undefined) {
        faker.seed(seed);
        faker.setDefaultRefDate(FAKE_DATA_SEED_REF_DATE);
    }

    const wanted = new Set(fields);
    const plan = GROUPS.map((group) => ({
        group,
        fields: group.fields.filter((f) => wanted.has(`${group.id}.${f.name}`)),
    })).filter((p) => p.fields.length > 0);

    const records = Array.from({ length: count }, (_, index) => {
        const record: FakeRecord = {};
        for (const { group, fields: groupFields } of plan) {
            const ctx = group.context ? group.context(faker) : {};
            for (const field of groupFields) {
                record[field.key] = field.generate(faker, ctx, index, safe);
            }
        }
        return record;
    });

    return { fields, count: records.length, seed: seed ?? null, safe, records };
}
