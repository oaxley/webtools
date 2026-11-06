/**
 * Subnet planning: carve an IPv4 block into smaller subnets sized by the
 * number of hosts each one needs (VLSM).
 *
 * Every subnet is placed on a boundary that is a multiple of its own size,
 * so subnets can never overlap and each one is a valid CIDR block.
 */
import { calculateCIDR, isIPv4, type CidrResult } from "./ip.ts";

/** Who reserves addresses in each subnet. */
export type SubnetReservation = "standard" | "aws" | "azure" | "gcp";

export interface SubnetReservationInfo {
    label: string;
    /** Addresses reserved at the start of the block (network address included). */
    head: number;
    /** Addresses reserved at the end of the block (broadcast address included). */
    tail: number;
    /** Longest prefix (smallest subnet) the platform accepts. */
    maxPrefix: number;
    note: string;
}

export const SUBNET_RESERVATIONS: Record<SubnetReservation, SubnetReservationInfo> = {
    standard: {
        label: "Standard",
        head: 1,
        tail: 1,
        maxPrefix: 32,
        note: "Network and broadcast addresses are reserved. /31 and /32 use every address (RFC 3021).",
    },
    aws: {
        label: "AWS",
        head: 4,
        tail: 1,
        maxPrefix: 28,
        note: "AWS reserves the first four addresses and the last one of every VPC subnet. Smallest subnet: /28.",
    },
    azure: {
        label: "Azure",
        head: 4,
        tail: 1,
        maxPrefix: 29,
        note: "Azure reserves the first four addresses and the last one of every subnet. Smallest subnet: /29.",
    },
    gcp: {
        label: "GCP",
        head: 2,
        tail: 2,
        maxPrefix: 29,
        note: "Google Cloud reserves the network, gateway, second-to-last and broadcast addresses. Smallest subnet: /29.",
    },
};

export const SUBNET_RESERVATION_NAMES = Object.keys(SUBNET_RESERVATIONS) as SubnetReservation[];

/** Usable hosts in a block of the given prefix, or 0 if the platform doesn't allow it. */
export function usableHostsForPrefix(prefix: number, reservation: SubnetReservation = "standard"): number {
    const info = SUBNET_RESERVATIONS[reservation];
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > info.maxPrefix) return 0;
    const size = 2 ** (32 - prefix);
    if (reservation === "standard" && prefix >= 31) return size;
    return Math.max(0, size - info.head - info.tail);
}

/**
 * Longest prefix (smallest block) with at least `hosts` usable addresses,
 * or null when no IPv4 block is large enough.
 */
export function prefixForHosts(hosts: number, reservation: SubnetReservation = "standard"): number | null {
    if (!Number.isInteger(hosts) || hosts < 1) return null;
    for (let prefix = SUBNET_RESERVATIONS[reservation].maxPrefix; prefix >= 0; prefix--) {
        if (usableHostsForPrefix(prefix, reservation) >= hosts) return prefix;
    }
    return null;
}

export interface SubnetRequest {
    /** Number of usable hosts the subnet must hold. */
    hosts: number;
    name?: string;
    /**
     * Preferred network address (e.g. a free block the user picked). Used
     * when the subnet is aligned there and the space is free; otherwise the
     * subnet is placed like any other.
     */
    at?: string;
}

export interface SubnetAllocation extends CidrResult {
    ok: true;
    /** Position of the request in the input list. */
    index: number;
    name: string;
    cidr: string;
    requestedHosts: number;
    /** Usable hosts left over: `usableHosts - requestedHosts`. */
    spare: number;
    /** Integer value of the network address. */
    start: number;
}

export interface SubnetAllocationError {
    ok: false;
    index: number;
    name: string;
    requestedHosts: number;
    /** Prefix the request would need, if any IPv4 block is large enough. */
    prefix: number | null;
    error: string;
}

export type SubnetPlanEntry = SubnetAllocation | SubnetAllocationError;

export interface SubnetPlan {
    parent: CidrResult & { cidr: string };
    /** One entry per request, in input order. */
    entries: SubnetPlanEntry[];
    /** Unallocated space as the fewest aligned CIDR blocks, in address order. */
    free: string[];
    /** Addresses taken by the allocated subnets. */
    usedAddresses: number;
}

export interface PlanSubnetsOptions {
    reservation?: SubnetReservation;
    /**
     * `input` (default): place requests in the given order, each in the
     * lowest aligned free slot. `largest`: place the biggest first, which
     * packs tighter and leaves the free space in one piece.
     */
    order?: "input" | "largest";
}

export function ipToInt(ip: string): number {
    const [a, b, c, d] = ip.split(".").map(Number);
    return (a * 256 ** 3 + b * 256 ** 2 + c * 256 + d) >>> 0;
}

export function intToIp(n: number): string {
    return `${(n >>> 24) & 0xff}.${(n >>> 16) & 0xff}.${(n >>> 8) & 0xff}.${n & 0xff}`;
}

/** Largest aligned power of two starting at `start` that fits before `end`. */
function largestBlock(start: number, end: number): number {
    let size = 2 ** 32;
    while (size > 1 && (start % size !== 0 || start + size > end)) size /= 2;
    return size;
}

/**
 * Cover `[start, end)` with the fewest aligned CIDR blocks.
 * `used` intervals are `[start, end)` pairs inside the range.
 */
export function freeBlocks(start: number, end: number, used: Array<[number, number]>): string[] {
    const sorted = [...used].sort((x, y) => x[0] - y[0]);
    const out: string[] = [];
    let cursor = start;
    const fill = (to: number) => {
        while (cursor < to) {
            const size = largestBlock(cursor, to);
            out.push(`${intToIp(cursor)}/${32 - Math.log2(size)}`);
            cursor += size;
        }
    };
    for (const [s, e] of sorted) {
        if (s > cursor) fill(s);
        cursor = Math.max(cursor, e);
    }
    fill(end);
    return out;
}

/** Lowest start in `[start, end)`, aligned on `size`, that overlaps no used interval. */
function findSlot(start: number, end: number, size: number, used: Array<[number, number]>): number | null {
    let candidate = Math.ceil(start / size) * size;
    while (candidate + size <= end) {
        const clash = used.find(([s, e]) => s < candidate + size && e > candidate);
        if (!clash) return candidate;
        candidate = Math.ceil(clash[1] / size) * size;
    }
    return null;
}

/**
 * Allocate `requests` inside `parentCidr`. Throws on an invalid parent
 * CIDR (like {@link calculateCIDR}); requests that don't fit come back
 * as `ok: false` entries instead, so the rest of the plan still works.
 */
export function planSubnets(
    parentCidr: string,
    requests: SubnetRequest[],
    options: PlanSubnetsOptions = {},
): SubnetPlan {
    const reservation = options.reservation ?? "standard";
    const parentInfo = calculateCIDR(parentCidr);
    const parent = { ...parentInfo, cidr: `${parentInfo.network}/${parentInfo.prefix}` };
    const start = ipToInt(parent.network);
    const end = start + parent.totalAddresses;

    const order = requests.map((_, i) => i);
    if (options.order === "largest") {
        order.sort((x, y) => {
            const px = prefixForHosts(requests[x].hosts, reservation) ?? -1;
            const py = prefixForHosts(requests[y].hosts, reservation) ?? -1;
            return px - py || x - y;
        });
    }

    // Requests with a preferred address claim it first, so automatic
    // placement can't take it from them.
    const preferred = new Map<number, number>();
    const claimed: Array<[number, number]> = [];
    for (const index of order) {
        const { hosts, at } = requests[index];
        const prefix = Number.isInteger(hosts) && hosts >= 1 ? prefixForHosts(hosts, reservation) : null;
        if (at === undefined || prefix === null || prefix < parent.prefix || !isIPv4(at)) continue;
        const size = 2 ** (32 - prefix);
        const slot = ipToInt(at);
        const fits = slot % size === 0 && slot >= start && slot + size <= end;
        if (fits && !claimed.some(([s, e]) => s < slot + size && e > slot)) {
            claimed.push([slot, slot + size]);
            preferred.set(index, slot);
        }
    }

    const used: Array<[number, number]> = [];
    const entries: SubnetPlanEntry[] = new Array(requests.length);
    const placeOrder = [...order.filter((i) => preferred.has(i)), ...order.filter((i) => !preferred.has(i))];
    for (const index of placeOrder) {
        const { hosts, name = "" } = requests[index];
        const base = { ok: false as const, index, name, requestedHosts: hosts };
        if (!Number.isInteger(hosts) || hosts < 1) {
            entries[index] = { ...base, prefix: null, error: "Ask for at least 1 host." };
            continue;
        }
        const prefix = prefixForHosts(hosts, reservation);
        if (prefix === null) {
            entries[index] = { ...base, prefix, error: `No IPv4 block holds ${hosts.toLocaleString("en-US")} hosts.` };
            continue;
        }
        if (prefix < parent.prefix) {
            entries[index] = {
                ...base,
                prefix,
                error: `Needs a /${prefix}, larger than the /${parent.prefix} it lives in.`,
            };
            continue;
        }
        const size = 2 ** (32 - prefix);
        const slot = preferred.get(index) ?? findSlot(start, end, size, used);
        if (slot === null) {
            const free = freeBlocks(start, end, used);
            const largest = free.length ? Math.min(...free.map((b) => Number(b.split("/")[1]))) : null;
            entries[index] = {
                ...base,
                prefix,
                error:
                    largest === null
                        ? `Needs a /${prefix}, but the block is full.`
                        : `Needs a /${prefix}, but the largest free block is a /${largest}.`,
            };
            continue;
        }
        used.push([slot, slot + size]);
        const cidr = `${intToIp(slot)}/${prefix}`;
        const info = calculateCIDR(cidr);
        const res = SUBNET_RESERVATIONS[reservation];
        const usableHosts = usableHostsForPrefix(prefix, reservation);
        const cloud = reservation !== "standard";
        entries[index] = {
            ...info,
            firstHost: cloud ? intToIp(slot + res.head) : info.firstHost,
            lastHost: cloud ? intToIp(slot + size - 1 - res.tail) : info.lastHost,
            usableHosts,
            ok: true,
            index,
            name,
            cidr,
            requestedHosts: hosts,
            spare: usableHosts - hosts,
            start: slot,
        };
    }

    return {
        parent,
        entries,
        free: freeBlocks(start, end, used),
        usedAddresses: used.reduce((sum, [s, e]) => sum + e - s, 0),
    };
}
