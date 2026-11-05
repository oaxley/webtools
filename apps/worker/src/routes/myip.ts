/**
 * `/api/v1/myip` — "What's my IP": echoes the caller's public IPv4
 * address, with the approximate location and the network (ISP) that
 * Cloudflare's edge attaches to every request.
 *
 * Nothing is computed or stored: the IP comes from the
 * `CF-Connecting-IP` header and the rest from `request.cf`. Locally the
 * address is loopback or private, and `request.cf` is the lookup Wrangler
 * did for the developer's own internet connection (cached in
 * `node_modules/.mf/cf.json`, git-ignored).
 *
 * IPv4 only for now. A client that reached us over IPv6 gets a 422 that
 * says so, rather than an IPv6 address the page can't make use of.
 *
 * CORS: same-origin calls (site and API on one domain) need nothing.
 * For a split deployment, the site's origin goes in `ALLOWED_ORIGINS`
 * (comma-separated, see `wrangler.jsonc`), and only those origins may
 * read the answer from a browser. Every other site is refused.
 */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { isIPv4, isRoutable } from "@webtools/core";

type Bindings = { ALLOWED_ORIGINS?: string };

/** `request.cf` fields this route reads (all optional, edge-provided). */
interface CfGeo {
  city?: string;
  region?: string;
  regionCode?: string;
  country?: string;
  postalCode?: string;
  continent?: string;
  timezone?: string;
  latitude?: string;
  longitude?: string;
  asn?: number;
  asOrganization?: string;
}

/** Origins allowed to read the answer cross-origin. */
export function allowedOrigins(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : null;

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

const myip = new Hono<{ Bindings: Bindings }>();

myip.use(
  "*",
  cors({
    origin: (origin, c) =>
      allowedOrigins(c.env.ALLOWED_ORIGINS).includes(origin) ? origin : null,
    allowMethods: ["GET"],
  }),
);

myip.get("/", (c) => {
  // Each caller gets their own answer: no cache may store or share it.
  // (`cors()` above already adds `Vary: Origin`.)
  c.header("Cache-Control", "no-store");

  const ip = c.req.header("cf-connecting-ip")?.trim();
  if (!ip) {
    return c.json({ error: "Could not determine the client IP address." }, 500);
  }
  if (!isIPv4(ip)) {
    return c.json(
      {
        error:
          "You are connected over IPv6. Only IPv4 addresses are supported for now.",
      },
      422,
    );
  }

  const cf = (c.req.raw.cf ?? {}) as CfGeo;
  const asn = num(cf.asn);

  return c.json({
    ip,
    version: 4,
    routable: isRoutable(`${ip}/32`),
    location: {
      approximate: true,
      city: str(cf.city),
      region: str(cf.region),
      regionCode: str(cf.regionCode),
      country: str(cf.country),
      postalCode: str(cf.postalCode),
      continent: str(cf.continent),
      timezone: str(cf.timezone),
      latitude: num(cf.latitude),
      longitude: num(cf.longitude),
    },
    isp: {
      asn,
      organization: str(cf.asOrganization),
    },
  });
});

export default myip;
