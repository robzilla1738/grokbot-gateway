import { describe, expect, it } from "vitest";
import { parseServerTranscript } from "../src/client/standalone.js";

function entry(seq: string, payload: Record<string, unknown>): { seq: string; body: string } {
  return { seq, body: Buffer.from(JSON.stringify(payload)).toString("base64") };
}

describe("standalone transcript parsing", () => {
  it("returns text entries oldest first, keyed by the sent messageId", () => {
    const parsed = parseServerTranscript([
      entry("12", { kind: "send-message", id: "reply", message: { type: "text", content: "pong" } }),
      entry("11", { kind: "tool-call", id: "tool" }),
      entry("10", { kind: "message", id: "t1u", clientNonce: "ask", role: "user", content: "ping" })
    ]);
    expect(parsed.map((e) => [e.id, e.role, e.seq])).toEqual([
      ["ask", "user", 10],
      ["reply", "assistant", 12]
    ]);
  });
});
