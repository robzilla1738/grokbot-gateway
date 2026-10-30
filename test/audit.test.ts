import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendAudit } from "../src/security/audit.js";
import { auditLogPath } from "../src/paths.js";
import { redact } from "../src/redact.js";
import { GrokBotClient, createMockTransport } from "../src/client/index.js";
import { dispatchTool } from "../src/gateway.js";
import { localActor } from "../src/security/tokens.js";

describe("audit and redaction", () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "gbgt-audit-"));
    process.env.GROKBOT_GATEWAY_HOME = home;
  });

  afterEach(() => {
    delete process.env.GROKBOT_GATEWAY_HOME;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("redacts bearer tokens and gbgt secrets", () => {
    const token = "gbgt_" + "A".repeat(40);
    expect(redact(`Authorization: Bearer ${token}`)).not.toContain(token);
    expect(redact(`Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaaaabbbbbcccccc.dddddeeeeefffff`)).toBe(
      "[redacted]"
    );
  });

  it("never writes the message body or a planted token", async () => {
    const planted = "gbgt_SHOULD_NOT_APPEAR_IN_LOGS_AT_ALL_XXXX";
    await dispatchTool(
      { client: new GrokBotClient(createMockTransport()), actor: localActor("test") },
      "send_to_bot",
      { bot: "Chief", text: `here is a secret ${planted}` }
    );
    const log = fs.readFileSync(auditLogPath(), "utf8");
    expect(log).toContain("send_to_bot");
    expect(log).toContain("Chief");
    expect(log).not.toContain(planted);
    expect(log).not.toContain("here is a secret");
    const row = JSON.parse(log.trim().split("\n").at(-1) ?? "{}") as { messageChars?: number };
    expect(row.messageChars).toBeGreaterThan(10);
  });

  it("redacts secrets in error fields", () => {
    appendAudit({
      ts: new Date().toISOString(),
      actor: "test:local",
      action: "status",
      ok: false,
      error: "Unauthorized Bearer gbgt_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345"
    });
    const log = fs.readFileSync(auditLogPath(), "utf8");
    expect(log).not.toContain("gbgt_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345");
    expect(log).toContain("[redacted]");
  });
});
