
import { Hono } from "hono";
import { calculateCIDR } from "@webtools/core";

const app = new Hono();

app.get("/api/v1/ip", (c) => {
  const cidr = c.req.query("cidr");

  if (!cidr) {
    return c.json({ error: "Missing cidr parameter" }, 400);
  }

  try {
    return c.json(calculateCIDR(cidr));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : "Invalid IPv4 CIDR" }, 400);
  }
});

export default app;

