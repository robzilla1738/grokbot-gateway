import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildProgram } from "../src/cli/index.js";

async function run(args: string[]): Promise<{ stdout: string; stderr: string; code: number }> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  const writeOut = ((chunk: unknown, ..._rest: unknown[]) => {
    stdout.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  const writeErr = ((chunk: unknown, ..._rest: unknown[]) => {
    stderr.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  process.stdout.write = writeOut;
  process.stderr.write = writeErr;
  const prevExit = process.exitCode;
  process.exitCode = 0;
  try {
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(["node", "grokbot", ...args]);
    return { stdout: stdout.join(""), stderr: stderr.join(""), code: Number(process.exitCode ?? 0) };
  } catch (err) {
    return {
      stdout: stdout.join(""),
      stderr: stderr.join("") + (err instanceof Error ? err.message : String(err)),
      code: 1
    };
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    process.exitCode = prevExit;
  }
}

describe("CLI --json against mock transport", () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "gbgt-cli-"));
    process.env.GROKBOT_GATEWAY_HOME = home;
    process.env.GROKBOT_TRANSPORT = "mock";
    process.env.GROKBOT_MOCK = "1";
  });

  afterEach(() => {
    delete process.env.GROKBOT_GATEWAY_HOME;
    delete process.env.GROKBOT_TRANSPORT;
    delete process.env.GROKBOT_MOCK;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("lists bots as JSON", async () => {
    const result = await run(["--json", "bots"]);
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as { ok: boolean; bots: Array<{ name: string }> };
    expect(payload.ok).toBe(true);
    expect(payload.bots.map((b) => b.name)).toEqual(["Chief", "Ops"]);
  });

  it("asks a bot and returns replies as JSON", async () => {
    const result = await run(["--json", "ask", "Chief", "hello", "--timeout", "5"]);
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as { ok: boolean; replies: Array<{ text: string }> };
    expect(payload.ok).toBe(true);
    expect(payload.replies[0]?.text).toMatch(/hello/);
  });

  it("inits non-interactively and prints MCP snippets", async () => {
    const result = await run(["--json", "init", "--yes"]);
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      mcp: { claudeCursor: string; codex: string };
      doctor: { checks: Array<{ ok: boolean; fix?: string }> };
    };
    expect(payload.ok).toBe(true);
    expect(payload.mcp.claudeCursor).toContain('"grokbot"');
    expect(payload.mcp.codex).toContain("mcp_servers.grokbot");
    for (const c of payload.doctor.checks.filter((x) => !x.ok)) {
      expect(c.fix && c.fix.length > 8).toBe(true);
    }
  });

  it("creates a read-only expiring token without putting the secret in the store", async () => {
    const result = await run(["--json", "token", "create", "--name", "ci-agent"]);
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      token: string;
      scopes: string[];
      expiresAt: string | null;
    };
    expect(payload.ok).toBe(true);
    expect(payload.token.startsWith("gbgt_")).toBe(true);
    expect(payload.scopes).not.toContain("bots:send");
    expect(payload.expiresAt).toBeTruthy();
    const stored = fs.readFileSync(path.join(home, "tokens.json"), "utf8");
    expect(stored).not.toContain(payload.token);
  });
});
