import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GrokBotClient, createMockTransport } from "../src/client/index.js";
import { dispatchTool } from "../src/gateway.js";
import { localActor } from "../src/security/tokens.js";
import { createToken, parseScopes } from "../src/security/tokens.js";
import { actorFromToken } from "../src/security/tokens.js";

describe("gateway dispatch", () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "gbgt-gw-"));
    process.env.GROKBOT_GATEWAY_HOME = home;
  });

  afterEach(() => {
    delete process.env.GROKBOT_GATEWAY_HOME;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("list_bots and ask_bot work through the MCP dispatcher", async () => {
    const gateway = { client: new GrokBotClient(createMockTransport()), actor: localActor("test") };
    const listed = await dispatchTool(gateway, "list_bots", {});
    expect(listed.isError).toBeFalsy();
    expect(listed.content[0]?.text).toContain("Chief");
    const asked = await dispatchTool(gateway, "ask_bot", { bot: "Chief", text: "hi", timeoutMs: 2000 });
    expect(asked.isError).toBeFalsy();
    expect(asked.content[0]?.text).toContain("Mock reply");
  });

  it("enforces token scopes", async () => {
    const rec = createToken("reader", parseScopes("bots:read,status"));
    const gateway = {
      client: new GrokBotClient(createMockTransport()),
      actor: actorFromToken(rec)
    };
    const denied = await dispatchTool(gateway, "send_to_bot", { bot: "Chief", text: "nope" });
    expect(denied.isError).toBe(true);
    expect(denied.content[0]?.text).toMatch(/missing scope bots:send/);
    const allowed = await dispatchTool(gateway, "read_chat", { bot: "Chief" });
    expect(allowed.isError).toBeFalsy();
  });
});
