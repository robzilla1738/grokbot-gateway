import { describe, expect, it } from "vitest";
import { assertAllowedAction, GuardError, isForbiddenToolName } from "../src/security/guard.js";
import { dispatchTool } from "../src/gateway.js";
import { GrokBotClient, createMockTransport } from "../src/client/index.js";
import { localActor } from "../src/security/tokens.js";

describe("guard", () => {
  it("allows the documented gateway actions", () => {
    expect(() => assertAllowedAction("list_bots")).not.toThrow();
    expect(() => assertAllowedAction("send_to_bot")).not.toThrow();
    expect(() => assertAllowedAction("status")).not.toThrow();
  });

  it("refuses email, purchase, and delete", () => {
    expect(() => assertAllowedAction("send_email")).toThrow(GuardError);
    expect(() => assertAllowedAction("purchase")).toThrow(GuardError);
    expect(() => assertAllowedAction("delete_bot")).toThrow(GuardError);
    expect(isForbiddenToolName("buy")).toBe(true);
  });

  it("dispatch refuses unknown tools without calling the client", async () => {
    const result = await dispatchTool(
      { client: new GrokBotClient(createMockTransport()), actor: localActor("test") },
      "send_email",
      { to: "someone@example.com" }
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/never send email/i);
  });
});
