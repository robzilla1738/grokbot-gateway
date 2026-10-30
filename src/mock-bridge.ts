import http from "node:http";
import { createMockStore, mockSend, type MockStore } from "./client/mock.js";
import { corsHeadersForOrigin, validateHostAndOrigin } from "./security/bind.js";
import { hashesMatch } from "./security/tokens.js";

export type MockBridge = {
  url: string;
  host: string;
  port: number;
  token: string;
  store: MockStore;
  close(): Promise<void>;
};

function sendJson(
  res: http.ServerResponse,
  status: number,
  payload: unknown,
  extra: Record<string, string> = {}
): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...extra });
  res.end(body);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export async function startMockBridge(opts?: {
  host?: string;
  port?: number;
  token?: string;
  store?: MockStore;
}): Promise<MockBridge> {
  const host = opts?.host ?? "127.0.0.1";
  const token = opts?.token ?? "mock-token";
  const store = opts?.store ?? createMockStore();

  const server = http.createServer(async (req, res) => {
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const security = validateHostAndOrigin(req.headers, host, port);
    const cors = corsHeadersForOrigin(security.ok ? security.origin : null, host, port);
    if (!security.ok) {
      sendJson(res, security.status, { ok: false, error: security.error });
      return;
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || host}`);
    if (url.pathname === "/health") {
      sendJson(res, 200, { ok: true, mock: true }, cors);
      return;
    }

    const auth = req.headers.authorization;
    const presented =
      typeof auth === "string" && auth.startsWith("Bearer ")
        ? auth.slice("Bearer ".length)
        : typeof req.headers["x-grokbot-notch-token"] === "string"
          ? req.headers["x-grokbot-notch-token"]
          : "";
    if (!presented || !hashesMatch(presented, token)) {
      sendJson(res, 401, { ok: false, error: "Unauthorized" }, cors);
      return;
    }

    try {
      if (req.method === "GET" && url.pathname === "/api/bootstrap") {
        sendJson(
          res,
          200,
          {
            ok: true,
            liveConnected: store.liveConnected,
            bots: store.bots,
            user: { name: "Mock User", teamId: null }
          },
          cors
        );
        return;
      }

      const transcriptMatch = /^\/api\/bot\/([^/]+)\/transcript$/.exec(url.pathname);
      if (req.method === "GET" && transcriptMatch?.[1]) {
        const id = decodeURIComponent(transcriptMatch[1]);
        sendJson(
          res,
          200,
          { ok: true, agentId: id, entries: store.transcripts.get(id) ?? [] },
          cors
        );
        return;
      }

      const messageMatch = /^\/api\/bot\/([^/]+)\/message$/.exec(url.pathname);
      if (req.method === "POST" && messageMatch?.[1]) {
        const id = decodeURIComponent(messageMatch[1]);
        const raw = await readBody(req);
        const body = raw ? (JSON.parse(raw) as { text?: string }) : {};
        const text = String(body.text || "").trim();
        if (!text) {
          sendJson(res, 400, { ok: false, error: "Empty message" }, cors);
          return;
        }
        const result = mockSend(store, id, text);
        sendJson(res, 200, { ok: true, messageId: result.messageId }, cors);
        return;
      }

      sendJson(res, 404, { ok: false, error: "Not found" }, cors);
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : "error" }, cors);
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(opts?.port ?? 0, host, () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    url: `http://${host}:${port}`,
    host,
    port,
    token,
    store,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      })
  };
}
