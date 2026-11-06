/**
 * Tests for the subnet planner (../src/subnetPlan.ts).
 *
 * Runner: Node built-in test runner, no dependencies.
 *   pnpm --filter @webtools/core test
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    freeBlocks,
    ipToInt,
    planSubnets,
    prefixForHosts,
    usableHostsForPrefix,
    type SubnetAllocation,
    type SubnetPlanEntry,
} from "../src/subnetPlan.ts";

function cidrs(entries: SubnetPlanEntry[]): string[] {
    return entries.map((e) => (e.ok ? e.cidr : `error: ${e.error}`));
}

describe("prefixForHosts", () => {
    it("picks the smallest block with enough usable hosts", () => {
        assert.equal(prefixForHosts(254), 24);
        assert.equal(prefixForHosts(255), 23);
        assert.equal(prefixForHosts(126), 25);
        assert.equal(prefixForHosts(127), 24);
        assert.equal(prefixForHosts(50), 26);
        assert.equal(prefixForHosts(3), 29);
    });

    it("uses /31 and /32 for 2 and 1 hosts (RFC 3021)", () => {
        assert.equal(prefixForHosts(1), 32);
        assert.equal(prefixForHosts(2), 31);
    });

    it("accounts for cloud reservations and minimum sizes", () => {
        assert.equal(prefixForHosts(1, "aws"), 28);
        assert.equal(prefixForHosts(11, "aws"), 28);
        assert.equal(prefixForHosts(12, "aws"), 27);
        assert.equal(prefixForHosts(251, "aws"), 24);
        assert.equal(prefixForHosts(252, "aws"), 23);
        assert.equal(prefixForHosts(3, "azure"), 29);
        assert.equal(prefixForHosts(4, "gcp"), 29);
        assert.equal(prefixForHosts(5, "gcp"), 28);
    });

    it("rejects non-positive and impossible counts", () => {
        assert.equal(prefixForHosts(0), null);
        assert.equal(prefixForHosts(-3), null);
        assert.equal(prefixForHosts(1.5), null);
        assert.equal(prefixForHosts(2 ** 32), null);
        assert.equal(prefixForHosts(2 ** 32 - 2), 0);
    });
});

describe("usableHostsForPrefix", () => {
    it("matches the classic and cloud counts", () => {
        assert.equal(usableHostsForPrefix(24), 254);
        assert.equal(usableHostsForPrefix(31), 2);
        assert.equal(usableHostsForPrefix(32), 1);
        assert.equal(usableHostsForPrefix(24, "aws"), 251);
        assert.equal(usableHostsForPrefix(29, "aws"), 0);
        assert.equal(usableHostsForPrefix(24, "gcp"), 252);
    });
});

describe("planSubnets", () => {
    it("reproduces the office plan from the blog post", () => {
        const plan = planSubnets("10.20.0.0/22", [
            { hosts: 254, name: "Staff laptops" },
            { hosts: 254, name: "Wi-Fi guests" },
            { hosts: 126, name: "Printers and IoT" },
            { hosts: 126, name: "Servers" },
        ]);
        assert.deepEqual(cidrs(plan.entries), [
            "10.20.0.0/24",
            "10.20.1.0/24",
            "10.20.2.0/25",
            "10.20.2.128/25",
        ]);
        assert.deepEqual(plan.free, ["10.20.3.0/24"]);
        assert.equal(plan.usedAddresses, 768);
        const servers = plan.entries[3] as SubnetAllocation;
        assert.equal(servers.firstHost, "10.20.2.129");
        assert.equal(servers.lastHost, "10.20.2.254");
        assert.equal(servers.broadcast, "10.20.2.255");
        assert.equal(servers.subnetMask, "255.255.255.128");
        assert.equal(servers.spare, 0);
        assert.equal(servers.name, "Servers");
    });

    it("normalises the parent to its network address", () => {
        const plan = planSubnets("10.20.1.77/22", []);
        assert.equal(plan.parent.cidr, "10.20.0.0/22");
        assert.deepEqual(plan.free, ["10.20.0.0/22"]);
    });

    it("keeps every subnet aligned on its own size", () => {
        const plan = planSubnets("192.168.0.0/24", [{ hosts: 10 }, { hosts: 50 }, { hosts: 2 }]);
        // /28 at .0, the /26 can't start at .16 so it goes to .64, the /31 fills the gap.
        assert.deepEqual(cidrs(plan.entries), ["192.168.0.0/28", "192.168.0.64/26", "192.168.0.16/31"]);
        assert.deepEqual(plan.free, [
            "192.168.0.18/31",
            "192.168.0.20/30",
            "192.168.0.24/29",
            "192.168.0.32/27",
            "192.168.0.128/25",
        ]);
        for (const e of plan.entries) {
            assert.ok(e.ok);
            assert.equal(e.start % e.totalAddresses, 0);
        }
    });

    it("packs largest first when asked, keeping input order in the result", () => {
        const plan = planSubnets("192.168.0.0/24", [{ hosts: 10 }, { hosts: 50 }, { hosts: 2 }], { order: "largest" });
        assert.deepEqual(cidrs(plan.entries), ["192.168.0.64/28", "192.168.0.0/26", "192.168.0.80/31"]);
        assert.deepEqual(plan.free, ["192.168.0.82/31", "192.168.0.84/30", "192.168.0.88/29", "192.168.0.96/27", "192.168.0.128/25"]);
    });

    it("reports subnets that don't fit without dropping the others", () => {
        const plan = planSubnets("10.0.0.0/24", [{ hosts: 100 }, { hosts: 60 }, { hosts: 100 }, { hosts: 20 }]);
        assert.equal(plan.entries[2].ok, false);
        assert.match((plan.entries[2] as { error: string }).error, /needs a \/25, but the largest free block is a \/26/i);
        assert.deepEqual(
            cidrs([plan.entries[0], plan.entries[1], plan.entries[3]]),
            ["10.0.0.0/25", "10.0.0.128/26", "10.0.0.192/27"],
        );
        assert.deepEqual(plan.free, ["10.0.0.224/27"]);
    });

    it("rejects requests larger than the parent and a full block", () => {
        const big = planSubnets("10.0.0.0/24", [{ hosts: 300 }]);
        assert.match((big.entries[0] as { error: string }).error, /larger than the \/24/);
        const full = planSubnets("10.0.0.0/30", [{ hosts: 2 }, { hosts: 2 }, { hosts: 1 }]);
        assert.deepEqual(cidrs(full.entries).slice(0, 2), ["10.0.0.0/31", "10.0.0.2/31"]);
        assert.match((full.entries[2] as { error: string }).error, /block is full/);
        assert.deepEqual(full.free, []);
    });

    it("rejects invalid host counts and throws on an invalid parent", () => {
        const plan = planSubnets("10.0.0.0/24", [{ hosts: 0 }]);
        assert.equal(plan.entries[0].ok, false);
        assert.throws(() => planSubnets("10.0.0/24", []), /Invalid IPv4/);
    });

    it("applies cloud reservations to the host range", () => {
        const plan = planSubnets("10.0.0.0/16", [{ hosts: 200 }], { reservation: "aws" });
        const e = plan.entries[0] as SubnetAllocation;
        assert.equal(e.cidr, "10.0.0.0/24");
        assert.equal(e.firstHost, "10.0.0.4");
        assert.equal(e.lastHost, "10.0.0.254");
        assert.equal(e.usableHosts, 251);
        assert.equal(e.spare, 51);
        const gcp = planSubnets("10.0.0.0/16", [{ hosts: 200 }], { reservation: "gcp" }).entries[0] as SubnetAllocation;
        assert.equal(gcp.firstHost, "10.0.0.2");
        assert.equal(gcp.lastHost, "10.0.0.253");
    });

    it("handles /32 hosts and the whole address space", () => {
        const one = planSubnets("10.0.0.0/24", [{ hosts: 1 }]).entries[0] as SubnetAllocation;
        assert.equal(one.cidr, "10.0.0.0/32");
        assert.equal(one.firstHost, "10.0.0.0");
        const all = planSubnets("0.0.0.0/0", [{ hosts: 2 ** 31 - 2 }]);
        assert.deepEqual(cidrs(all.entries), ["0.0.0.0/1"]);
        assert.deepEqual(all.free, ["128.0.0.0/1"]);
    });
});

describe("planSubnets - preferred address", () => {
    it("places a subnet on the free block it was picked from", () => {
        // Free space: 10.0.2.0/23 and 10.0.5.0/24. Picking the /24 must not land in the /23.
        const base = [{ hosts: 510 }, { hosts: 254, at: "10.0.4.0" }, { hosts: 510, at: "10.0.6.0" }];
        const plan = planSubnets("10.0.0.0/21", base);
        assert.deepEqual(plan.free, ["10.0.2.0/23", "10.0.5.0/24"]);
        const picked = planSubnets("10.0.0.0/21", [...base, { hosts: 254, at: "10.0.5.0" }]);
        assert.equal((picked.entries[3] as SubnetAllocation).cidr, "10.0.5.0/24");
        assert.deepEqual(picked.free, ["10.0.2.0/23"]);
    });

    it("keeps a preferred address ahead of earlier automatic subnets", () => {
        const plan = planSubnets("10.0.0.0/24", [{ hosts: 100 }, { hosts: 100, at: "10.0.0.0" }]);
        assert.deepEqual(cidrs(plan.entries), ["10.0.0.128/25", "10.0.0.0/25"]);
    });

    it("falls back to normal placement when the address no longer works", () => {
        // Misaligned for a /24, outside the parent, or already taken.
        const plan = planSubnets("10.0.0.0/22", [
            { hosts: 254, at: "10.0.1.128" },
            { hosts: 254, at: "192.168.0.0" },
            { hosts: 254, at: "10.0.3.0" },
            { hosts: 254, at: "10.0.3.0" },
        ]);
        assert.deepEqual(cidrs(plan.entries), ["10.0.0.0/24", "10.0.1.0/24", "10.0.3.0/24", "10.0.2.0/24"]);
    });
});

describe("freeBlocks", () => {
    it("covers a range with the fewest aligned blocks", () => {
        const s = ipToInt("10.0.0.0");
        assert.deepEqual(freeBlocks(s, s + 256, []), ["10.0.0.0/24"]);
        assert.deepEqual(freeBlocks(s + 1, s + 256, []), [
            "10.0.0.1/32",
            "10.0.0.2/31",
            "10.0.0.4/30",
            "10.0.0.8/29",
            "10.0.0.16/28",
            "10.0.0.32/27",
            "10.0.0.64/26",
            "10.0.0.128/25",
        ]);
        assert.deepEqual(freeBlocks(s, s + 256, [[s + 128, s + 192]]), ["10.0.0.0/25", "10.0.0.192/26"]);
    });
});
