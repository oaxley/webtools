/**
 * Exhaustive tests for `calculateCIDR` and `isRoutable` (../src/ip.ts).
 *
 * All core `ip.ts` tests live in this one file on purpose: when new
 * functions are added in other src files, they get their own
 * `<name>.test.ts` file next to this one.
 *
 * Runner: Node built-in test runner, no dependencies.
 *   node --test test/
 *   pnpm --filter @webtools/core test
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { calculateCIDR, isRoutable, type CidrResult } from "../src/ip.ts";

const IPV4 = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

describe("calculateCIDR - classic subnets", () => {
    const cases: Array<[string, CidrResult]> = [
        [
            "192.168.1.0/24",
            {
                network: "192.168.1.0",
                broadcast: "192.168.1.255",
                prefix: 24,
                subnetMask: "255.255.255.0",
                firstHost: "192.168.1.1",
                lastHost: "192.168.1.254",
                totalAddresses: 256,
                usableHosts: 254,
            },
        ],
        [
            "10.0.0.0/8",
            {
                network: "10.0.0.0",
                broadcast: "10.255.255.255",
                prefix: 8,
                subnetMask: "255.0.0.0",
                firstHost: "10.0.0.1",
                lastHost: "10.255.255.254",
                totalAddresses: 16_777_216,
                usableHosts: 16_777_214,
            },
        ],
        [
            "172.16.0.0/16",
            {
                network: "172.16.0.0",
                broadcast: "172.16.255.255",
                prefix: 16,
                subnetMask: "255.255.0.0",
                firstHost: "172.16.0.1",
                lastHost: "172.16.255.254",
                totalAddresses: 65_536,
                usableHosts: 65_534,
            },
        ],
        [
            // Private 172.16/12 range spans 172.16.0.0 - 172.31.255.255.
            "172.16.0.0/12",
            {
                network: "172.16.0.0",
                broadcast: "172.31.255.255",
                prefix: 12,
                subnetMask: "255.240.0.0",
                firstHost: "172.16.0.1",
                lastHost: "172.31.255.254",
                totalAddresses: 1_048_576,
                usableHosts: 1_048_574,
            },
        ],
        [
            // /23 crosses an octet boundary.
            "192.168.0.0/23",
            {
                network: "192.168.0.0",
                broadcast: "192.168.1.255",
                prefix: 23,
                subnetMask: "255.255.254.0",
                firstHost: "192.168.0.1",
                lastHost: "192.168.1.254",
                totalAddresses: 512,
                usableHosts: 510,
            },
        ],
        [
            // Lower half of a /24 split into two /25s.
            "192.168.1.0/25",
            {
                network: "192.168.1.0",
                broadcast: "192.168.1.127",
                prefix: 25,
                subnetMask: "255.255.255.128",
                firstHost: "192.168.1.1",
                lastHost: "192.168.1.126",
                totalAddresses: 128,
                usableHosts: 126,
            },
        ],
        [
            // Upper half of a /24 split into two /25s.
            "192.168.1.128/25",
            {
                network: "192.168.1.128",
                broadcast: "192.168.1.255",
                prefix: 25,
                subnetMask: "255.255.255.128",
                firstHost: "192.168.1.129",
                lastHost: "192.168.1.254",
                totalAddresses: 128,
                usableHosts: 126,
            },
        ],
        [
            "192.168.1.64/26",
            {
                network: "192.168.1.64",
                broadcast: "192.168.1.127",
                prefix: 26,
                subnetMask: "255.255.255.192",
                firstHost: "192.168.1.65",
                lastHost: "192.168.1.126",
                totalAddresses: 64,
                usableHosts: 62,
            },
        ],
        [
            "198.51.100.0/27",
            {
                network: "198.51.100.0",
                broadcast: "198.51.100.31",
                prefix: 27,
                subnetMask: "255.255.255.224",
                firstHost: "198.51.100.1",
                lastHost: "198.51.100.30",
                totalAddresses: 32,
                usableHosts: 30,
            },
        ],
        [
            "192.0.2.0/28",
            {
                network: "192.0.2.0",
                broadcast: "192.0.2.15",
                prefix: 28,
                subnetMask: "255.255.255.240",
                firstHost: "192.0.2.1",
                lastHost: "192.0.2.14",
                totalAddresses: 16,
                usableHosts: 14,
            },
        ],
        [
            "203.0.113.0/29",
            {
                network: "203.0.113.0",
                broadcast: "203.0.113.7",
                prefix: 29,
                subnetMask: "255.255.255.248",
                firstHost: "203.0.113.1",
                lastHost: "203.0.113.6",
                totalAddresses: 8,
                usableHosts: 6,
            },
        ],
        [
            // Smallest regular subnet: 4 addresses, 2 usable.
            "10.10.10.0/30",
            {
                network: "10.10.10.0",
                broadcast: "10.10.10.3",
                prefix: 30,
                subnetMask: "255.255.255.252",
                firstHost: "10.10.10.1",
                lastHost: "10.10.10.2",
                totalAddresses: 4,
                usableHosts: 2,
            },
        ],
    ];

    for (const [input, expected] of cases) {
        it(`${input}`, () => {
            assert.deepStrictEqual(calculateCIDR(input), expected);
        });
    }
});

describe("calculateCIDR - edge prefixes", () => {
    it("0.0.0.0/0 covers the whole IPv4 space", () => {
        assert.deepStrictEqual(calculateCIDR("0.0.0.0/0"), {
            network: "0.0.0.0",
            broadcast: "255.255.255.255",
            prefix: 0,
            subnetMask: "0.0.0.0",
            firstHost: "0.0.0.1",
            lastHost: "255.255.255.254",
            // 2^32: must not overflow to 0 via 32-bit arithmetic.
            totalAddresses: 4_294_967_296,
            usableHosts: 4_294_967_294,
        });
    });

    it("0.0.0.0/1 is the lower half of the IPv4 space", () => {
        assert.deepStrictEqual(calculateCIDR("0.0.0.0/1"), {
            network: "0.0.0.0",
            broadcast: "127.255.255.255",
            prefix: 1,
            subnetMask: "128.0.0.0",
            firstHost: "0.0.0.1",
            lastHost: "127.255.255.254",
            totalAddresses: 2_147_483_648,
            usableHosts: 2_147_483_646,
        });
    });

    it("128.0.0.0/1 is the upper half (exercises high-bit arithmetic)", () => {
        assert.deepStrictEqual(calculateCIDR("200.0.0.0/1"), {
            network: "128.0.0.0",
            broadcast: "255.255.255.255",
            prefix: 1,
            subnetMask: "128.0.0.0",
            firstHost: "128.0.0.1",
            lastHost: "255.255.255.254",
            totalAddresses: 2_147_483_648,
            usableHosts: 2_147_483_646,
        });
    });

    it("/31 point-to-point: both addresses usable (RFC 3021)", () => {
        assert.deepStrictEqual(calculateCIDR("192.168.1.0/31"), {
            network: "192.168.1.0",
            broadcast: "192.168.1.1",
            prefix: 31,
            subnetMask: "255.255.255.254",
            firstHost: "192.168.1.0",
            lastHost: "192.168.1.1",
            totalAddresses: 2,
            usableHosts: 2,
        });
    });

    it("/31 with an odd address normalizes down to the even network", () => {
        const r = calculateCIDR("192.168.1.1/31");
        assert.strictEqual(r.network, "192.168.1.0");
        assert.strictEqual(r.broadcast, "192.168.1.1");
        assert.strictEqual(r.firstHost, "192.168.1.0");
        assert.strictEqual(r.lastHost, "192.168.1.1");
        assert.strictEqual(r.usableHosts, 2);
    });

    it("/32 single host: network == broadcast == first == last", () => {
        assert.deepStrictEqual(calculateCIDR("192.168.1.5/32"), {
            network: "192.168.1.5",
            broadcast: "192.168.1.5",
            prefix: 32,
            subnetMask: "255.255.255.255",
            firstHost: "192.168.1.5",
            lastHost: "192.168.1.5",
            totalAddresses: 1,
            usableHosts: 1,
        });
    });

    it("/32 on the all-ones address (signed 32-bit pitfall)", () => {
        assert.deepStrictEqual(calculateCIDR("255.255.255.255/32"), {
            network: "255.255.255.255",
            broadcast: "255.255.255.255",
            prefix: 32,
            subnetMask: "255.255.255.255",
            firstHost: "255.255.255.255",
            lastHost: "255.255.255.255",
            totalAddresses: 1,
            usableHosts: 1,
        });
    });

    it("loopback address inside its /8", () => {
        const r = calculateCIDR("127.0.0.1/8");
        assert.strictEqual(r.network, "127.0.0.0");
        assert.strictEqual(r.broadcast, "127.255.255.255");
        assert.strictEqual(r.firstHost, "127.0.0.1");
        assert.strictEqual(r.lastHost, "127.255.255.254");
    });
});

describe("calculateCIDR - host bits are masked off (normalization)", () => {
    const cases: Array<[string, string, string]> = [
        // [input, expected network, expected broadcast]
        ["192.168.1.5/24", "192.168.1.0", "192.168.1.255"],
        ["10.1.2.3/8", "10.0.0.0", "10.255.255.255"],
        ["172.16.9.130/12", "172.16.0.0", "172.31.255.255"],
        ["192.168.1.200/25", "192.168.1.128", "192.168.1.255"],
        ["192.168.1.33/26", "192.168.1.0", "192.168.1.63"],
        ["123.45.67.89/0", "0.0.0.0", "255.255.255.255"],
        ["255.255.255.255/0", "0.0.0.0", "255.255.255.255"],
        ["255.255.255.254/31", "255.255.255.254", "255.255.255.255"],
    ];

    for (const [input, network, broadcast] of cases) {
        it(`${input} -> network ${network}`, () => {
            const r = calculateCIDR(input);
            assert.strictEqual(r.network, network);
            assert.strictEqual(r.broadcast, broadcast);
            assert.strictEqual(r.prefix, Number(input.split("/")[1]));
        });
    }
});

describe("calculateCIDR - full prefix table (0-32)", () => {
    const expectedMasks = [
        "0.0.0.0",
        "128.0.0.0",
        "192.0.0.0",
        "224.0.0.0",
        "240.0.0.0",
        "248.0.0.0",
        "252.0.0.0",
        "254.0.0.0",
        "255.0.0.0",
        "255.128.0.0",
        "255.192.0.0",
        "255.224.0.0",
        "255.240.0.0",
        "255.248.0.0",
        "255.252.0.0",
        "255.254.0.0",
        "255.255.0.0",
        "255.255.128.0",
        "255.255.192.0",
        "255.255.224.0",
        "255.255.240.0",
        "255.255.248.0",
        "255.255.252.0",
        "255.255.254.0",
        "255.255.255.0",
        "255.255.255.128",
        "255.255.255.192",
        "255.255.255.224",
        "255.255.255.240",
        "255.255.255.248",
        "255.255.255.252",
        "255.255.255.254",
        "255.255.255.255",
    ];

    for (let prefix = 0; prefix <= 32; prefix++) {
        it(`/${prefix}: mask, totals and usable-host rule`, () => {
            const r = calculateCIDR(`10.20.30.40/${prefix}`);
            const total = 2 ** (32 - prefix);
            const usable = prefix === 32 ? 1 : prefix === 31 ? 2 : total - 2;

            assert.strictEqual(r.prefix, prefix);
            assert.strictEqual(r.subnetMask, expectedMasks[prefix]);
            assert.strictEqual(r.totalAddresses, total);
            assert.strictEqual(r.usableHosts, usable);

            // Every emitted address must be well-formed IPv4.
            for (const field of [r.network, r.broadcast, r.firstHost, r.lastHost]) {
                assert.match(field as string, IPV4);
            }
        });
    }
});

describe("calculateCIDR - result shape", () => {
    it("returns exactly the 8 CidrResult fields with the right types", () => {
        const r = calculateCIDR("192.168.1.0/24");
        assert.deepStrictEqual(Object.keys(r).sort(), [
            "broadcast",
            "firstHost",
            "lastHost",
            "network",
            "prefix",
            "subnetMask",
            "totalAddresses",
            "usableHosts",
        ]);
        assert.strictEqual(typeof r.network, "string");
        assert.strictEqual(typeof r.broadcast, "string");
        assert.strictEqual(typeof r.prefix, "number");
        assert.strictEqual(typeof r.subnetMask, "string");
        assert.strictEqual(typeof r.firstHost, "string");
        assert.strictEqual(typeof r.lastHost, "string");
        assert.strictEqual(typeof r.totalAddresses, "number");
        assert.strictEqual(typeof r.usableHosts, "number");
    });

    it("firstHost <= lastHost as 32-bit values", () => {
        const toInt = (ip: string) =>
            ip.split(".").reduce((acc, o) => acc * 256 + Number(o), 0);
        for (const input of ["0.0.0.0/0", "10.0.0.0/8", "192.168.0.0/23", "192.168.1.0/30", "192.168.1.0/31", "192.168.1.5/32"]) {
            const r = calculateCIDR(input);
            assert.ok(
                toInt(r.firstHost as string) <= toInt(r.lastHost as string),
                `${input}: firstHost should be <= lastHost`,
            );
        }
    });
});

describe("calculateCIDR - surrounding whitespace is tolerated", () => {
    it("leading/trailing spaces, tabs and newlines", () => {
        assert.deepStrictEqual(
            calculateCIDR("  192.168.1.0/24  "),
            calculateCIDR("192.168.1.0/24"),
        );
        assert.deepStrictEqual(
            calculateCIDR("\t10.0.0.0/8\n"),
            calculateCIDR("10.0.0.0/8"),
        );
    });
});

describe("calculateCIDR - invalid input throws", () => {
    it("malformed CIDR notation", () => {
        for (const input of [
            "",
            "foo",
            "192.168.1.0", // missing prefix
            "192.168.1.0/24/extra", // extra slash
            "192.168.1.0//24",
        ]) {
            assert.throws(() => calculateCIDR(input), /Invalid CIDR notation/, input || "(empty string)");
        }
    });

    it("out-of-range or non-integer prefix", () => {
        for (const input of [
            "10.0.0.0/33",
            "10.0.0.0/-1",
            "10.0.0.0/abc",
            "10.0.0.0/24.5",
            "10.0.0.0/NaN",
        ]) {
            assert.throws(() => calculateCIDR(input), /Invalid prefix/, input);
        }
    });

    it("malformed IPv4 address", () => {
        for (const input of [
            "256.0.0.0/24", // octet > 255
            "192.168.1.999/24",
            "999.999.999.999/8",
            "192.168.1/24", // only 3 octets
            "192.168.1.1.1/24", // 5 octets
            "a.b.c.d/24", // non-numeric
            "192.168.1.-1/24",
            "192.168..1/24", // empty octet
            "192.168.1./24", // trailing dot
            ".192.168.1/24", // leading dot
            " /24", // empty address
            "/24", // missing address passes notation check, fails IPv4 validation
            "::1/24", // IPv6 is not supported (valid prefix, so it reaches IP validation)
            "2001:db8::/32",
            "192.168.1.0 /24", // inner space breaks the last octet
        ]) {
            assert.throws(() => calculateCIDR(input), /Invalid IPv4 address/, input);
        }
    });

    it("thrown errors are Error instances with a message", () => {
        for (const input of ["foo", "10.0.0.0/33", "256.0.0.0/24"]) {
            assert.throws(
                () => calculateCIDR(input),
                (err: unknown) => err instanceof Error && err.message.length > 0,
                input,
            );
        }
    });

    it("documents current lenient behavior: empty prefix parses as 0", () => {
        // Number("") === 0, so "192.168.1.0/" is treated as a /0.
        // Kept as a characterization test: tighten the implementation
        // (and update this test) if empty prefixes should be rejected.
        const r = calculateCIDR("192.168.1.0/");
        assert.strictEqual(r.prefix, 0);
        assert.strictEqual(r.network, "0.0.0.0");
    });
});

describe("isRoutable", () => {
    it("private RFC 1918 ranges are not routable", () => {
        for (const input of [
            "10.0.0.0/8",
            "10.1.2.3/8",
            "172.16.0.0/12",
            "172.31.255.255/32",
            "192.168.0.0/16",
            "192.168.1.0/24",
        ]) {
            assert.strictEqual(isRoutable(input), false, input);
        }
    });

    it("special-purpose blocks are not routable", () => {
        for (const input of [
            "0.0.0.0/0", // "this network"
            "127.0.0.1/8", // loopback
            "169.254.10.20/16", // link-local
            "100.64.0.0/10", // CGNAT shared space
            "100.127.255.255/32",
            "192.0.0.0/24", // IANA special
            "192.0.2.0/24", // documentation TEST-NET-1
            "198.51.100.0/24", // documentation TEST-NET-2
            "203.0.113.0/24", // documentation TEST-NET-3
            "198.18.0.0/15", // benchmarking
            "224.0.0.0/4", // multicast
            "239.1.2.3/32",
            "240.0.0.1/32", // reserved
        ]) {
            assert.strictEqual(isRoutable(input), false, input);
        }
    });

    it("public unicast space is routable", () => {
        for (const input of [
            "8.8.8.0/24",
            "1.1.1.1/32",
            "11.0.0.0/8",
            "9.255.255.255/32",
            "100.63.255.255/32", // just below CGNAT
            "100.128.0.0/16", // just above CGNAT
            "172.15.255.255/32", // just below 172.16/12
            "172.32.0.0/16", // just above 172.16/12
            "192.167.255.255/32",
            "192.169.0.0/24",
            "223.255.255.255/32", // just below multicast
            "128.0.0.0/1", // upper half of the address space
        ]) {
            assert.strictEqual(isRoutable(input), true, input);
        }
    });

    it("host bits are masked off before the check", () => {
        // 192.168.1.200/25 normalizes to network 192.168.1.128 (private).
        assert.strictEqual(isRoutable("192.168.1.200/25"), false);
        assert.strictEqual(isRoutable("  8.8.8.8/32  "), true);
    });

    it("throws on invalid CIDR input", () => {
        for (const input of ["foo", "10.0.0.0/33", "256.0.0.0/24"]) {
            assert.throws(() => isRoutable(input), Error, input);
        }
    });
});
