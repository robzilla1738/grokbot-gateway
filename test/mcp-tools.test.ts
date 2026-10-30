import { describe, expect, it } from "vitest";
import { TOOL_DEFINITIONS, toolByName } from "../src/mcp/tools.js";
import { ALLOWED_ACTIONS } from "../src/security/guard.js";

describe("MCP tool schemas", () => {
  it("exposes the tools an outside agent needs", () => {
    expect(TOOL_DEFINITIONS.map((t) => t.name).sort()).toEqual(
      ["ask_bot", "list_bots", "read_chat", "send_to_bot", "status", "wait_for_reply"].sort()
    );
  });

  it("gives each tool a real description and a JSON schema", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.description.length).toBeGreaterThan(40);
      expect(tool.jsonSchema.type).toBe("object");
      expect(tool.jsonSchema.additionalProperties).toBe(false);
      expect(ALLOWED_ACTIONS).toContain(tool.name);
    }
  });

  it("requires bot+text for send and ask", () => {
    expect(toolByName("send_to_bot")?.jsonSchema).toMatchObject({ required: ["bot", "text"] });
    expect(toolByName("ask_bot")?.jsonSchema).toMatchObject({ required: ["bot", "text"] });
    expect(toolByName("read_chat")?.jsonSchema).toMatchObject({ required: ["bot"] });
    expect(toolByName("wait_for_reply")?.jsonSchema).toMatchObject({ required: ["bot"] });
  });

  it("zod schemas reject empty send payloads", () => {
    const send = toolByName("send_to_bot");
    expect(send).toBeTruthy();
    expect(() => send!.inputSchema.parse({ bot: "", text: "hi" })).toThrow();
    expect(send!.inputSchema.parse({ bot: "Chief", text: "hi" })).toEqual({ bot: "Chief", text: "hi" });
  });

  it("tells agents not to email/buy/delete via the gateway", () => {
    const send = toolByName("send_to_bot")!.description.toLowerCase();
    expect(send).toMatch(/email|buy|delete/);
  });
});
