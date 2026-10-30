import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GrokBotClient, createMockStore, createMockTransport, createNotchTransport } from "../src/client/index.js";
import { resolveBot } from "../src/client/transport.js";
import { startMockBridge, type MockBridge } from "../src/mock-bridge.js";

describe("mock client", () => {
  it("lists bots", async () => {
    const client = new GrokBotClient(createMockTransport());
    const listed = await client.listBots();
    expect(listed.ok).toBe(true);
    expect(listed.bots.map((b) => b.name)).toEqual(["Chief", "Ops"]);
  });

  it("resolves bots by name, id, and prefix", async () => {
    const { bots } = await new GrokBotClient(createMockTransport()).listBots();
    expect(resolveBot(bots, "Chief").id).toBe("bot-chief");
    expect(resolveBot(bots, "bot-ops").name).toBe("Ops");
    expect(resolveBot(bots, "chi").name).toBe("Chief");
    expect(() => resolveBot(bots, "nope")).toThrow(/No bot matching/);
  });

  it("sends a message and waits for the mock reply", async () => {
    const store = createMockStore({ replyDelayMs: 20 });
    const client = new GrokBotClient(createMockTransport(store));
    const result = await client.ask("Chief", "hello from the gateway", { timeoutMs: 2000, pollMs: 10 });
    expect(result.messageId).toBeTruthy();
    expect(result.replies.some((r) => r.text.includes("hello from the gateway"))).toBe(true);
  });

  it("read returns history including the user turn", async () => {
    const client = new GrokBotClient(createMockTransport());
    const sent = await client.send("Ops", "status?");
    const transcript = await client.read("Ops", { limit: 10 });
    expect(transcript.entries.some((e) => e.id === sent.messageId && e.role === "user")).toBe(true);
  });

  it("wait_for_reply still returns a reply that already landed after send", async () => {
    const store = createMockStore({ replyDelayMs: 5 });
    const client = new GrokBotClient(createMockTransport(store));
    const sent = await client.send("Chief", "already-done");
    await new Promise((r) => setTimeout(r, 40));
    const replies = await client.wait("Chief", { since: sent.messageId, timeoutMs: 2000, pollMs: 10 });
    expect(replies.some((r) => r.text.includes("already-done"))).toBe(true);
  });
});

describe("notch HTTP transport against mock bridge", () => {
  let bridge: MockBridge;
  const home = mkdtempSync(path.join(os.tmpdir(), "gbgt-"));

  beforeEach(async () => {
    process.env.GROKBOT_GATEWAY_HOME = home;
    bridge = await startMockBridge({ host: "127.0.0.1", token: "mock-token" });
    process.env.GROKBOT_NOTCH_URL = bridge.url;
    process.env.GROKBOT_NOTCH_AUTH_TOKEN = bridge.token;
  });

  afterEach(async () => {
    await bridge.close();
    delete process.env.GROKBOT_NOTCH_URL;
    delete process.env.GROKBOT_NOTCH_AUTH_TOKEN;
  });

  it("lists and sends through the notch-compatible HTTP API", async () => {
    const client = new GrokBotClient(createNotchTransport({ baseUrl: bridge.url, token: bridge.token }));
    const listed = await client.listBots();
    expect(listed.bots).toHaveLength(2);
    const asked = await client.ask("Chief", "ping", { timeoutMs: 2000, pollMs: 15 });
    expect(asked.replies[0]?.text).toMatch(/ping/);
  });

  it("rejects a bad token", async () => {
    const client = new GrokBotClient(createNotchTransport({ baseUrl: bridge.url, token: "wrong-token" }));
    await expect(client.listBots()).rejects.toThrow(/Unauthorized/);
  });
});
