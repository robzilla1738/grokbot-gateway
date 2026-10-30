import { describe, expect, it } from "vitest";
import { buildProgram } from "../src/cli/index.js";

async function helpFor(args: string[]): Promise<string> {
  const chunks: string[] = [];
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    const program = buildProgram();
    program.exitOverride();
    await program.parseAsync(["node", "grokbot", ...args, "--help"]);
  } catch {
    // commander throws after printing help when exitOverride is set
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  }
  return chunks.join("");
}

const COMMANDS = [
  [],
  ["bots"],
  ["send"],
  ["ask"],
  ["read"],
  ["tail"],
  ["status"],
  ["doctor"],
  ["mcp"],
  ["mock"],
  ["init"],
  ["token"],
  ["token", "create"],
  ["token", "list"],
  ["token", "revoke"]
];

describe("CLI --help", () => {
  it("prints Examples for every command", async () => {
    for (const args of COMMANDS) {
      const text = await helpFor(args);
      expect(text, args.join(" ") || "root").toMatch(/Examples:/);
    }
  });

  it("does not accept a mock token on argv", async () => {
    const text = await helpFor(["mock"]);
    expect(text).not.toMatch(/--token </);
    expect(text).toMatch(/GROKBOT_MOCK_TOKEN/);
  });
});
