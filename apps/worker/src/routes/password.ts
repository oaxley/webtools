/**
 * `/api/v1/password` — generate random passwords or EFF passphrases.
 *
 * GET is fine here: the request carries settings only, never a password.
 * Responses are marked `no-store` so no browser or CDN cache ever replays
 * a password issued to someone else.
 *
 * There is deliberately no endpoint to *check* a password: sending a
 * real password to a server is the habit a strength meter should
 * discourage. The web page checks typed passwords in the browser.
 *
 * Query parameters (all optional):
 * - `mode`             `random` (default) or `passphrase`
 * - `count`            1..20 (default `1`)
 *
 * Random mode:
 * - `length`           4..128 characters (default `20`)
 * - `sets`             comma-separated subset of `lower,upper,digits,symbols`
 *                      (default: all four)
 * - `excludeAmbiguous` `true` to drop look-alikes `0 O 1 l I |`
 * - `requireEachSet`   `false` to allow passwords missing a set (default `true`)
 *
 * Passphrase mode:
 * - `words`            3..12 (default `6`)
 * - `separator`        1 to 3 characters, no letters or digits (default `-`)
 * - `capitalize`       `true` to capitalise each word
 * - `includeNumber`    `true` to append one digit to one word
 */
import { Hono } from "hono";
import {
  generatePasswords,
  type PasswordCharset,
  type PasswordOptions,
} from "@webtools/core";
import { parseFlag } from "./params";

const password = new Hono();

/** Integer query parameter; non-numbers become NaN for core to reject. */
function parseNumber(value: string | undefined): number | undefined {
  return value === undefined ? undefined : Number(value);
}

/** Shared by GET /api/v1/password and the `generate_password` MCP tool. */
export function runPassword(options: PasswordOptions) {
  const { options: resolved, entropyBits, passwords } = generatePasswords(options);
  return {
    ...resolved,
    // Rounded: the exact figure is in the core, and two decimals is
    // plenty for anyone comparing strengths.
    entropyBits: Math.round(entropyBits * 100) / 100,
    count: passwords.length,
    passwords,
  };
}

password.get("/", (c) => {
  c.header("Cache-Control", "no-store");
  const q = (name: string) => c.req.query(name);

  try {
    const mode = q("mode") ?? "random";
    const count = parseNumber(q("count"));
    let options: PasswordOptions;
    if (mode === "passphrase") {
      options = {
        mode,
        count,
        words: parseNumber(q("words")),
        separator: q("separator"),
        capitalize: parseFlag(q("capitalize"), "capitalize"),
        includeNumber: parseFlag(q("includeNumber"), "includeNumber"),
      };
    } else {
      const sets = q("sets");
      options = {
        mode: mode as "random",
        count,
        length: parseNumber(q("length")),
        sets:
          sets === undefined
            ? undefined
            : (sets.split(",").map((s) => s.trim()) as PasswordCharset[]),
        excludeAmbiguous: parseFlag(q("excludeAmbiguous"), "excludeAmbiguous"),
        requireEachSet: parseFlag(q("requireEachSet"), "requireEachSet"),
      };
    }
    return c.json(runPassword(options));
  } catch (e) {
    return c.json(
      { error: e instanceof Error ? e.message : "Invalid request" },
      400,
    );
  }
});

export default password;
