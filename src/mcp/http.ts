import http from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { GrokBotClient } from "../client/index.js";
import { loadConfig } from "../config.js";
import { gatewayStatus } from "../doctor.js";
import {
  corsHeadersForOrigin,
  isLoopback,
  resolveBindAddress,
  validateHostAndOrigin
} from "../security/bind.js";
import { actorFromToken, extractBearer, hasScope, localActor, verifyToken } from "../security/tokens.js";
import { PRODUCT_NAME, VERSION } from "../version.js";
import { createTypedMcpServer } from "./server.js";

function sendJson(res: http.ServerResponse, status: number, payload: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...extra });
  res.end(JSON.stringify(payload));
}

const MAX_BODY_BYTES = 2 * 1024 * 1024;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (c: Buffer) => {
      if (tooLarge) return;
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        tooLarge = true;
        reject(new HttpError(413, "Payload too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (tooLarge) return;
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, "Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

export type HttpMcpOptions = {
  bind?: string;
  port?: number;
  requireToken?: boolean;
};

/** --no-token is loopback-only. Tailscale HTTP always needs a bearer token. */
export function assertHttpAuthPolicy(requireToken: boolean, bind: string): void {
  if (!requireToken && !isLoopback(bind)) {
    throw new Error("--no-token is only allowed on 127.0.0.1 / localhost. Use a gateway token on Tailscale.");
  }
}

export async function startHttpMcp(opts: HttpMcpOptions = {}): Promise<{ url: string; close: () => Promise<void> }> {
  const cfg = loadConfig();
  const bind = await resolveBindAddress(opts.bind ?? cfg.bind);
  // Port 0 picks a free port; the real one is read back after listen() for Host checks.
  let port = opts.port ?? cfg.httpPort;
  const requireToken = opts.requireToken ?? true;
  assertHttpAuthPolicy(requireToken, bind);
  const client = new GrokBotClient();
  // Each MCP session stays bound to the token that opened it, so a leaked session id cannot borrow wider scopes.
  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; actorId: string }>();

  const server = http.createServer(async (req, res) => {
    const security = validateHostAndOrigin(req.headers, bind, port);
    const cors = corsHeadersForOrigin(security.ok ? security.origin : null, bind, port);
    if (!security.ok) {
      sendJson(res, security.status, { ok: false, error: security.error });
      return;
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || bind}`);

    if (req.method === "GET" && url.pathname === "/health") {
      sendJson(res, 200, { ok: true, product: PRODUCT_NAME, version: VERSION }, cors);
      return;
    }

    const isStatus = req.method === "GET" && url.pathname === "/status";
    if (!isStatus && !url.pathname.startsWith("/mcp")) {
      sendJson(res, 404, { ok: false, error: "Not found" }, cors);
      return;
    }

    const presented =
      extractBearer(req.headers.authorization) ||
      (typeof req.headers["x-grokbot-token"] === "string" ? req.headers["x-grokbot-token"] : null);
    const rec = verifyToken(presented);
    if (requireToken && !rec) {
      sendJson(res, 401, { ok: false, error: "Unauthorized" }, cors);
      return;
    }
    const actor = rec ? actorFromToken(rec) : localActor("mcp-http");

    try {
      if (isStatus) {
        if (!hasScope(actor, "status")) {
          sendJson(res, 403, { ok: false, error: "Token is missing scope status" }, cors);
          return;
        }
        const status = await gatewayStatus();
        sendJson(res, status.ok ? 200 : 503, { ...status, product: PRODUCT_NAME }, cors);
        return;
      }

      const sessionId = req.headers["mcp-session-id"];
      const sid = typeof sessionId === "string" ? sessionId : undefined;
      let transport: StreamableHTTPServerTransport;

      if (sid) {
        const session = sessions.get(sid);
        if (!session) {
          // MCP spec: 404 tells the client to start a new session.
          sendJson(res, 404, { jsonrpc: "2.0", error: { code: -32001, message: "Session not found" }, id: null }, cors);
          return;
        }
        if (session.actorId !== actor.id) {
          sendJson(res, 403, { ok: false, error: "Session belongs to a different token" }, cors);
          return;
        }
        transport = session.transport;
      } else {
        const fresh = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            sessions.set(id, { transport: fresh, actorId: actor.id });
          }
        });
        fresh.onclose = () => {
          if (fresh.sessionId) sessions.delete(fresh.sessionId);
        };
        await createTypedMcpServer({ client, actor }).connect(fresh);
        transport = fresh;
      }

      const body = req.method === "POST" ? await readBody(req) : undefined;
      await transport.handleRequest(req, res, body);
    } catch (err) {
      if (!res.headersSent) {
        const status = err instanceof HttpError ? err.status : 500;
        sendJson(res, status, { ok: false, error: err instanceof Error ? err.message : "error" }, cors);
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, bind, () => resolve());
    server.on("error", reject);
  });
  const address = server.address();
  if (address && typeof address === "object") port = address.port;

  const url = `http://${bind}:${port}`;
  console.error(`[${PRODUCT_NAME}] HTTP MCP on ${url}/mcp  health ${url}/health`);
  return {
    url,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      })
  };
}
