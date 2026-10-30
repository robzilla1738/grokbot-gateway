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
import { actorFromToken, extractBearer, localActor, verifyToken } from "../security/tokens.js";
import { PRODUCT_NAME, VERSION } from "../version.js";
import { createTypedMcpServer } from "./server.js";

function sendJson(res: http.ServerResponse, status: number, payload: unknown, extra: Record<string, string> = {}): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...extra });
  res.end(JSON.stringify(payload));
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => {
      chunks.push(c as Buffer);
      if (chunks.reduce((n, b) => n + b.length, 0) > 2 * 1024 * 1024) {
        reject(new Error("Payload too large"));
      }
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
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
  const port = opts.port ?? cfg.httpPort;
  const requireToken = opts.requireToken ?? true;
  assertHttpAuthPolicy(requireToken, bind);
  const client = new GrokBotClient();
  const transports = new Map<string, StreamableHTTPServerTransport>();

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

    if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/status")) {
      const status = await gatewayStatus();
      sendJson(res, status.ok ? 200 : 503, { ...status, product: PRODUCT_NAME, version: VERSION }, cors);
      return;
    }

    if (!url.pathname.startsWith("/mcp")) {
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
      const sessionId = req.headers["mcp-session-id"];
      const sid = typeof sessionId === "string" ? sessionId : undefined;
      let transport = sid ? transports.get(sid) : undefined;

      if (!transport) {
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (id) => {
            transports.set(id, transport!);
          }
        });
        transport.onclose = () => {
          const id = transport?.sessionId;
          if (id) transports.delete(id);
        };
        const mcp = createTypedMcpServer({ client, actor });
        await mcp.connect(transport);
      }

      const body = req.method === "POST" ? await readBody(req) : undefined;
      await transport.handleRequest(req, res, body);
    } catch (err) {
      if (!res.headersSent) {
        sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : "error" }, cors);
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, bind, () => resolve());
    server.on("error", reject);
  });

  const url = `http://${bind}:${port}`;
  console.error(`[${PRODUCT_NAME}] HTTP MCP on ${url}/mcp  health ${url}/health`);
  return {
    url,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      })
  };
}
