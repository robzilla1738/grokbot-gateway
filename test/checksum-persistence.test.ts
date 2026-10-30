import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCursorChecksum } from "../src/client/checksum.js";
import { decodePersistenceFilename, sha256Hex } from "../src/client/persistence.js";
import { decryptSafeStorageValue } from "../src/client/session.js";
import { buildBackendHeaders } from "../src/client/rpc.js";
import type { AuthContext } from "../src/client/session.js";

describe("standalone session helpers", () => {
  it("builds a checksum that includes the machine id", () => {
    const sum = createCursorChecksum("machine-1", 1_700_000_000_000);
    expect(sum.endsWith("machine-1")).toBe(true);
    expect(sum.startsWith("machine-1")).toBe(false);
    expect(createCursorChecksum("machine-1", 1_700_000_000_000)).toBe(sum);
  });

  it("decodes persistence blob filenames from base32", () => {
    const key = "sand.client.slice.client-meta.account-slot";
    const encoded = encodeBase32(key) + ".blob";
    expect(decodePersistenceFilename(encoded)).toBe(key);
  });

  it("decrypts plaintext:v1 safe-storage values", () => {
    const secret = "cursor-access-token-value";
    const stored = "plaintext:v1:" + Buffer.from(secret, "utf8").toString("base64");
    expect(decryptSafeStorageValue(stored, Buffer.alloc(16))).toBe(secret);
  });

  it("does not put the access token in any header name, only Bearer", () => {
    const auth: AuthContext = {
      accountScope: "default",
      accessToken: "secret-token-value",
      machineId: "m",
      teamId: null,
      teamName: "",
      cachedEmail: "",
      userName: "Tester",
      source: "test"
    };
    const headers = buildBackendHeaders(auth, "0.71.2");
    expect(headers.authorization).toBe("Bearer secret-token-value");
    expect(headers["x-cursor-client-type"]).toBe("sand");
    expect(JSON.stringify(Object.keys(headers))).not.toContain("secret-token-value");
  });

  it("hashes account slots the same way as the desktop client", () => {
    expect(sha256Hex("slot")).toBe(crypto.createHash("sha256").update("slot").digest("hex"));
  });
});

function encodeBase32(input: string): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  const bytes = Buffer.from(input, "utf8");
  let bits = 0;
  let acc = 0;
  let out = "";
  for (const byte of bytes) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(acc >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(acc << (5 - bits)) & 31];
  return out;
}
