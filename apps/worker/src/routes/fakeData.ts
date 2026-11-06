/**
 * `/api/v1/fake-data` — generate realistic fake records for tests.
 *
 * GET is fine here: the request carries nothing sensitive. Responses
 * are `no-store`, so unseeded batches are never replayed from a cache.
 *
 * Query parameters:
 * - `fields`  required. Comma-separated field or group ids, e.g.
 *             `person,location.city`. May also be repeated
 *             (`fields=person&fields=location.city`).
 * - `count`   1..100 (default `1`). Fields × count is capped at 1,000
 *             values (groups expanded) to stay within the CPU budget of a
 *             single request.
 * - `seed`    integer 0..4294967295 for reproducible records
 */
import { Hono } from "hono";
import { generateFakeData } from "@webtools/core/fakeData";

const fakeData = new Hono();

fakeData.get("/", (c) => {
  c.header("Cache-Control", "no-store");

  const fields = (c.req.queries("fields") ?? [])
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter((value) => value !== "");
  const countParam = c.req.query("count");
  const seedParam = c.req.query("seed");

  try {
    const count = countParam === undefined ? 1 : Number(countParam);
    const seed =
      seedParam === undefined
        ? undefined
        : seedParam.trim() === ""
          ? Number.NaN
          : Number(seedParam);
    // Same shape as the MCP `generate_fake_data` tool.
    return c.json(generateFakeData({ fields, count, seed }));
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "Invalid request" },
      400,
    );
  }
});

export default fakeData;
