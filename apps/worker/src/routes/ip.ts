/**
 * `/api/v1/ip` — IPv4 CIDR → network/broadcast/mask/usable-hosts.
 *
 * Thin HTTP wrapper around `calculateCIDR` + `isRoutable` from
 * `@webtools/core`. Core errors are surfaced verbatim as 400s.
 */
import { Hono } from "hono";
import { calculateCIDR, isRoutable } from "@webtools/core";

const ip = new Hono();

ip.get("/", (c) => {
  const cidr = c.req.query("cidr");

  if (!cidr) {
    return c.json({ error: "Missing cidr parameter" }, 400);
  }

  try {
    return c.json({ ...calculateCIDR(cidr), routable: isRoutable(cidr) });
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "Invalid IPv4 CIDR" },
      400,
    );
  }
});

export default ip;
