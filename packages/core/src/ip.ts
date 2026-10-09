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
        throw new Error(`Invalid CIDR notation: "${cidr}". Expected format: <ipv4>/<prefix> (e.g. 192.168.1.0/24).`);
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
