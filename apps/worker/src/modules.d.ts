/** `.yaml` files are bundled as Text modules (`rules` in `wrangler.jsonc`). */
declare module "*.yaml" {
  const text: string;
  export default text;
}
