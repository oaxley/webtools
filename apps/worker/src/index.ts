/**
 * Worker entry point.
 *
 * Keeps the top-level file deliberately small: it only wires the
 * versioned API prefix (`/api/v1`) to per-tool sub-routers. Each
 * sub-router lives in `routes/<tool>.ts` next door, mirroring the
 * split in `@webtools/core`.
 */
import { Hono } from "hono";
import ip from "./routes/ip";
import jwt from "./routes/jwt";
import mcp from "./routes/mcp";
import uuid from "./routes/uuid";
import x509 from "./routes/x509";

const app = new Hono();

// `/api/v1/...` namespace. Bumping the version is a matter of
// `app.route("/api/v2/ip", ipV2)` here — the sub-routers themselves
// stay version-agnostic.
app.route("/api/v1/ip", ip);
app.route("/api/v1/jwt", jwt);
app.route("/api/v1/x509", x509);
app.route("/api/v1/uuid", uuid);

// MCP (Model Context Protocol) endpoint. Lives at the conventional
// `/mcp` path, outside the versioned API namespace, so standard MCP
// clients find it without extra configuration.
app.route("/mcp", mcp);

export default app;
