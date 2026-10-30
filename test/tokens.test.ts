import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createToken,
  extractBearer,
  hashToken,
  hashesMatch,
  listTokens,
  parseScopes,
  revokeToken,
  verifyToken
} from "../src/security/tokens.js";

describe("tokens", () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "gbgt-tokens-"));
    process.env.GROKBOT_GATEWAY_HOME = home;
  });

  afterEach(() => {
    delete process.env.GROKBOT_GATEWAY_HOME;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("creates a hashed token and never stores the secret", () => {
    const rec = createToken("claude-code", parseScopes("bots:list,bots:read,bots:send,status"));
    expect(rec.token.startsWith("gbgt_")).toBe(true);
    const file = JSON.parse(fs.readFileSync(path.join(home, "tokens.json"), "utf8")) as {
      tokens: Array<{ hash: string; token?: string }>;
    };
    expect(file.tokens[0]?.token).toBeUndefined();
    expect(file.tokens[0]?.hash).toBe(hashToken(rec.token));
    expect(file.tokens[0]?.hash).not.toContain(rec.token);
  });

  it("verifies, lists, and revokes", () => {
    const rec = createToken("codex", parseScopes("*"));
    expect(verifyToken(rec.token)?.id).toBe(rec.id);
    expect(verifyToken("gbgt_nope")).toBeNull();
    expect(listTokens()).toHaveLength(1);
    revokeToken(rec.id);
    expect(verifyToken(rec.token)).toBeNull();
    expect(listTokens()[0]?.revokedAt).toBeTruthy();
  });

  it("uses timing-safe hash comparison", () => {
    const a = hashToken("gbgt_aaa");
    expect(hashesMatch(a, a)).toBe(true);
    expect(hashesMatch(a, hashToken("gbgt_bbb"))).toBe(false);
    expect(hashesMatch("abc", "ab")).toBe(false);
  });

  it("refuses a second active token with the same name and revokes the active one by name", () => {
    const first = createToken("agent");
    expect(() => createToken("agent")).toThrow(/already exists/);
    revokeToken("agent");
    const second = createToken("agent");
    expect(revokeToken("agent").id).toBe(second.id);
    expect(verifyToken(first.token)).toBeNull();
  });

  it("accepts any casing of the Bearer scheme", () => {
    expect(extractBearer("Bearer gbgt_x")).toBe("gbgt_x");
    expect(extractBearer("bearer  gbgt_x")).toBe("gbgt_x");
    expect(extractBearer("gbgt_x")).toBe("gbgt_x");
    expect(extractBearer(undefined)).toBeNull();
  });

  it("parses scopes and rejects unknown ones", () => {
    expect(parseScopes("*")).toContain("bots:send");
    expect(() => parseScopes("bots:launch-nukes")).toThrow(/Unknown scope/);
  });
});
