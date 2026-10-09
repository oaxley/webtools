export interface CidrResult {
    network: string;
    broadcast: string;
    prefix: number;
    subnetMask: string;
    firstHost: string | null;
    lastHost: string | null;
    totalAddresses: number;
    usableHosts: number;
}

export function calculateCIDR(cidr: string): CidrResult {
    const parts = cidr.trim().split("/");
    if (parts.length !== 2) {
        throw new Error(`Invalid CIDR notation: '${cidr}'. Expected format: <ipv4>/<prefix> (e.g. 192.168.1.0/24).`);
    }

    const [ipStr, prefixStr] = parts;
    const prefix = Number(prefixStr);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
        throw new Error(`Invalid prefix '${prefixStr}'. Prefix must be an integer between 0 and 32.`);
    }

    const octets = ipStr.split(".");
    if (octets.length !== 4) {
        throw new Error(`Invalid IPv4 address: '${ipStr}'. Expected 4 octets.`);
    }

    const bytes = octets.map((o) => {
        if (!/^\d+$/.test(o)) {
            throw new Error(`Invalid IPv4 address: '${ipStr}'. Octet "${o}" is not numeric.`);
        }
        const n = Number(o);
        if (!Number.isInteger(n) || n < 0 || n > 255) {
            throw new Error(`Invalid IPv4 address: '${ipStr}'. Octet '${o}' must be between 0 and 255.`);
        }
        return n;
    });

    const ipInt = ((bytes[0] * 256 ** 3 + bytes[1] * 256 ** 2 + bytes[2] * 256 + bytes[3]) >>> 0);
    const maskInt = prefix === 0 ? 0 : ((0xffffffff << (32 - prefix)) >>> 0);
    const networkInt = (ipInt & maskInt) >>> 0;
    const broadcastInt = (networkInt | (~maskInt >>> 0)) >>> 0;

    const toIp = (n: number): string =>
        `${(n >>> 24) & 0xff}.${(n >>> 16) & 0xff}.${(n >>> 8) & 0xff}.${n & 0xff}`;

    const network = toIp(networkInt);
    const broadcast = toIp(broadcastInt);
    const subnetMask = toIp(maskInt);

    const hostBits = 32 - prefix;
    const totalAddresses = 2 ** hostBits;

    let firstHost: string | null;
    let lastHost: string | null;
    let usableHosts: number;

    if (prefix === 32) {
        firstHost = network;
        lastHost = network;
        usableHosts = 1;
    } else if (prefix === 31) {
        // RFC 3021: point-to-point links have no network/broadcast reservation.
        firstHost = network;
        lastHost = broadcast;
        usableHosts = 2;
    } else {
        firstHost = toIp(networkInt + 1);
        lastHost = toIp(broadcastInt - 1);
        usableHosts = totalAddresses - 2;
    }

    return {
        network,
        broadcast,
        prefix,
        subnetMask,
        firstHost,
        lastHost,
        totalAddresses,
        usableHosts,
    };
}

/** IPv4 blocks that are not publicly routable: [network, prefix]. */
const NON_ROUTABLE_BLOCKS: Array<[number, number]> = [
    [0x00_00_00_00, 8], // "This network" (0.0.0.0/8)
    [0x0a_00_00_00, 8], // Private use, RFC 1918 (10.0.0.0/8)
    [0x64_40_00_00, 10], // Shared address space / CGNAT, RFC 6598 (100.64.0.0/10)
    [0x7f_00_00_00, 8], // Loopback (127.0.0.0/8)
    [0xa9_fe_00_00, 16], // Link-local (169.254.0.0/16)
    [0xac_10_00_00, 12], // Private use, RFC 1918 (172.16.0.0/12)
    [0xc0_00_00_00, 24], // IANA special purpose (192.0.0.0/24)
    [0xc0_00_02_00, 24], // Documentation TEST-NET-1 (192.0.2.0/24)
    [0xc0_a8_00_00, 16], // Private use, RFC 1918 (192.168.0.0/16)
    [0xc6_12_00_00, 15], // Benchmarking, RFC 2544 (198.18.0.0/15)
    [0xc6_33_64_00, 24], // Documentation TEST-NET-2 (198.51.100.0/24)
    [0xcb_00_71_00, 24], // Documentation TEST-NET-3 (203.0.113.0/24)
    [0xe0_00_00_00, 4], // Multicast (224.0.0.0/4)
    [0xf0_00_00_00, 4], // Reserved for future use (240.0.0.0/4)
];

/**
 * Returns false when the subnet's network address falls inside a
 * well-known non-publicly-routable block (private, loopback, link-local,
 * multicast, reserved, documentation, CGNAT, …), true otherwise.
 * Throws on invalid CIDR input, like {@link calculateCIDR}.
 */
export function isRoutable(cidr: string): boolean {
    const { network } = calculateCIDR(cidr);
    const [a, b, c, d] = network.split(".").map(Number);
    const ip = ((a * 256 ** 3 + b * 256 ** 2 + c * 256 + d) >>> 0);
    return !NON_ROUTABLE_BLOCKS.some(([block, blockPrefix]) => {
        const mask = blockPrefix === 0 ? 0 : ((0xffffffff << (32 - blockPrefix)) >>> 0);
        return ((ip & mask) >>> 0) === block;
    });
}
