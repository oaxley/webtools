/** Query-string helpers shared by the `/api/v1/*` routes. */

/** Parse an optional boolean query flag; `undefined` when absent. */
export function parseFlag(
  value: string | undefined,
  name: string,
): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  throw new Error(`'${name}' must be true or false.`);
}
