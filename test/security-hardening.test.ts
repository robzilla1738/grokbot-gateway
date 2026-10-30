import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GrokBotClient, createMockTransport } from "../src/client/index.js";
import { runDoctor } from "../src/doctor.js";
import { dispatchTool } from "../src/gateway.js";
import { fileModeBits } from "../src/security/files.js";
import { UNTRUSTED_REPLY_NOTICE } from "../src/security/injection.js";
import { assertSendRateLimit, resetRateLimitsForTests } from "../src/security/rate-limit.js";
import { isAllowedBindAddress, resolveBindAddress } from "../src/security/bind.js";
import { assertHttpAuthPolicy } from "../src/mcp/http.js";
import {
  actorFromToken,
  createToken,
  parseExpiry,
  parseScopes,
  verifyToken
} from "../src/security/tokens.js";
import { tokensPath } from "../src/paths.js";
import { MAX_MESSAGE_CHARS } from "../src/types.js";

describe("security hardening", () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "gbgt-sec-"));
    process.env.GROKBOT_GATEWAY_HOME = home;
    resetRateLimitsForTests();
  });

  afterEach(() => {
    delete process.env.GROKBOT_GATEWAY_HOME;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("defaults new tokens to read-only scopes", () => {
    const rec = createToken("reader");
    expect(rec.scopes).toEqual(["bots:list", "bots:read", "status"]);
    expect(rec.scopes).not.toContain("bots:send");
    expect(parseScopes()).toEqual(["bots:list", "bots:read", "status"]);
  });

  it("defaults new tokens to a ~30 day expiry", () => {
    const rec = createToken("exp");
    expect(rec.expiresAt).toBeTruthy();
    const delta = Date.parse(rec.expiresAt!) - Date.now();
    expect(delta).toBeGreaterThan(29 * 86_400_000);
    expect(delta).toBeLessThan(31 * 86_400_000);
  });

  it("stores the gateway home at mode 0700", () => {
    createToken("perm-home");
    expect(fs.statSync(home).mode & 0o777).toBe(0o700);
  });

  it("stores tokens at mode 0600", () => {
    createToken("perm");
    const mode = fileModeBits(tokensPath());
    expect(mode).toBe(0o600);
  });

  it("rejects expired tokens", () => {
    const rec = createToken({
      name: "old",
      scopes: parseScopes("*"),
      expiresAt: new Date(Date.now() - 1000).toISOString()
    });
    expect(verifyToken(rec.token)).toBeNull();
  });

  it("parses duration expiry", () => {
    const iso = parseExpiry("7d");
    expect(iso).toBeTruthy();
    expect(Date.parse(iso!) - Date.now()).toBeGreaterThan(6 * 86_400_000);
  });

  it("enforces per-bot allowlists", async () => {
    const rec = createToken({
      name: "chief-only",
      scopes: parseScopes("bots:list,bots:read,bots:send,status"),
      botAllowlist: ["Chief"]
    });
    const gateway = {
      client: new GrokBotClient(createMockTransport()),
      actor: actorFromToken(rec)
    };
    const denied = await dispatchTool(gateway, "send_to_bot", { bot: "Ops", text: "nope" });
    expect(denied.isError).toBe(true);
    expect(denied.content[0]?.text).toMatch(/not allowed/);
    const listed = await dispatchTool(gateway, "list_bots", {});
    expect(listed.content[0]?.text).toContain("Chief");
    expect(listed.content[0]?.text).not.toContain("Ops");
  });

  it("rate-limits sends", () => {
    expect(() => {
      for (let i = 0; i < 5; i++) assertSendRateLimit("t1", 3);
    }).toThrow(/Rate limit/);
  });

  it("validates MCP tool args", async () => {
    const gateway = {
      client: new GrokBotClient(createMockTransport()),
      actor: actorFromToken(createToken({ name: "s", scopes: parseScopes("*") }))
    };
    const empty = await dispatchTool(gateway, "send_to_bot", { bot: "Chief", text: "" });
    expect(empty.isError).toBe(true);
    expect(empty.content[0]?.text).toMatch(/Invalid send_to_bot/);
    const huge = await dispatchTool(gateway, "send_to_bot", {
      bot: "Chief",
      text: "x".repeat(MAX_MESSAGE_CHARS + 1)
    });
    expect(huge.isError).toBe(true);
  });

  it("marks chat replies as untrusted", async () => {
    const gateway = {
      client: new GrokBotClient(createMockTransport()),
      actor: actorFromToken(createToken({ name: "s", scopes: parseScopes("*") }))
    };
    const asked = await dispatchTool(gateway, "ask_bot", { bot: "Chief", text: "hi", timeoutMs: 2000 });
    expect(asked.content[0]?.text).toContain(UNTRUSTED_REPLY_NOTICE);
  });

  it("refuses public bind addresses", async () => {
    expect(isAllowedBindAddress("0.0.0.0")).toBe(false);
    expect(isAllowedBindAddress("8.8.8.8")).toBe(false);
    expect(isAllowedBindAddress("192.168.1.5")).toBe(false);
    expect(isAllowedBindAddress("127.0.0.1")).toBe(true);
    expect(isAllowedBindAddress("100.64.1.2")).toBe(true);
    await expect(resolveBindAddress("8.8.8.8")).rejects.toThrow(/Refusing to bind/);
  });

  it("refuses --no-token on a Tailscale address", () => {
    expect(() => assertHttpAuthPolicy(false, "100.64.1.2")).toThrow(/127\.0\.0\.1 \/ localhost/);
    expect(() => assertHttpAuthPolicy(false, "127.0.0.1")).not.toThrow();
    expect(() => assertHttpAuthPolicy(true, "100.64.1.2")).not.toThrow();
  });

  it("doctor failures include a fix", async () => {
    const result = await runDoctor();
    for (const c of result.checks.filter((x) => !x.ok)) {
      expect(c.fix && c.fix.length > 8).toBe(true);
    }
  });
});
