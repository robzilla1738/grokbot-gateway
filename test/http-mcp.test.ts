import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startHttpMcp } from "../src/mcp/http.js";
import { createToken, parseScopes } from "../src/security/tokens.js";
import { PRODUCT_NAME, VERSION } from "../src/version.js";

const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } }
};

function mcpPost(url: string, token: string, body: unknown, sessionId?: string): Promise<Response> {
  return fetch(`${url}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${token}`,
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {})
    },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

describe("HTTP MCP", () => {
  let home: string;
  let server: Awaited<ReturnType<typeof startHttpMcp>> | undefined;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "gbgt-http-"));
    process.env.GROKBOT_GATEWAY_HOME = home;
    process.env.GROKBOT_TRANSPORT = "mock";
  });

  afterEach(async () => {
    await server?.close();
    server = undefined;
    delete process.env.GROKBOT_GATEWAY_HOME;
    delete process.env.GROKBOT_TRANSPORT;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("keeps /health minimal and requires a status-scoped token for /status", async () => {
    server = await startHttpMcp({ bind: "127.0.0.1", port: 0 });
    const health = await fetch(`${server.url}/health`);
    expect(await health.json()).toEqual({ ok: true, product: PRODUCT_NAME, version: VERSION });

    expect((await fetch(`${server.url}/status`)).status).toBe(401);

    const reader = createToken("reader");
    const status = await fetch(`${server.url}/status`, { headers: { Authorization: `bearer ${reader.token}` } });
    expect(status.status).toBe(200);
    expect(((await status.json()) as { transport: string }).transport).toBe("mock");

    const listOnly = createToken({ name: "list-only", scopes: ["bots:list"] });
    const denied = await fetch(`${server.url}/status`, { headers: { Authorization: `Bearer ${listOnly.token}` } });
    expect(denied.status).toBe(403);
  });

  it("binds a session to the token that opened it and 404s unknown sessions", async () => {
    server = await startHttpMcp({ bind: "127.0.0.1", port: 0 });
    const owner = createToken({ name: "owner", scopes: parseScopes("*") });
    const other = createToken("other");

    const init = await mcpPost(server.url, owner.token, INITIALIZE);
    expect(init.status).toBe(200);
    const sessionId = init.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();
    await init.text();

    const listTools = { jsonrpc: "2.0", id: 2, method: "tools/list" };
    expect((await mcpPost(server.url, other.token, listTools, sessionId!)).status).toBe(403);
    expect((await mcpPost(server.url, owner.token, listTools, "no-such-session")).status).toBe(404);
  });

  it("rejects oversized and malformed bodies", async () => {
    server = await startHttpMcp({ bind: "127.0.0.1", port: 0 });
    const token = createToken("big").token;
    expect((await mcpPost(server.url, token, "x".repeat(3 * 1024 * 1024))).status).toBe(413);
    expect((await mcpPost(server.url, token, "{not json")).status).toBe(400);
  });
});
