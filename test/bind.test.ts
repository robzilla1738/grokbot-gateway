import { describe, expect, it } from "vitest";
import {
  allowedHosts,
  isAllowedBindAddress,
  isPublicWildcard,
  isTailscaleIPv4,
  resolveBindAddress,
  validateHostAndOrigin
} from "../src/security/bind.js";

describe("bind and host checks", () => {
  it("refuses public wildcards", async () => {
    expect(isPublicWildcard("0.0.0.0")).toBe(true);
    await expect(resolveBindAddress("0.0.0.0")).rejects.toThrow(/Refusing to bind/);
    await expect(resolveBindAddress("127.0.0.1")).resolves.toBe("127.0.0.1");
  });

  it("rejects a wrong Host header", () => {
    const bad = validateHostAndOrigin({ host: "evil.example:14789" }, "127.0.0.1", 14789);
    expect(bad.ok).toBe(false);
    const good = validateHostAndOrigin({ host: "127.0.0.1:14789" }, "127.0.0.1", 14789);
    expect(good.ok).toBe(true);
  });

  it("rejects a cross-site Origin", () => {
    const bad = validateHostAndOrigin(
      { host: "127.0.0.1:14789", origin: "https://evil.example" },
      "127.0.0.1",
      14789
    );
    expect(bad.ok).toBe(false);
    const good = validateHostAndOrigin(
      { host: "127.0.0.1:14789", origin: "http://127.0.0.1:14789" },
      "127.0.0.1",
      14789
    );
    expect(good.ok).toBe(true);
  });

  it("includes loopback aliases in allowed hosts", () => {
    const hosts = allowedHosts("127.0.0.1", 14789);
    expect(hosts.has("localhost:14789")).toBe(true);
  });

  it("only allows loopback or Tailscale CGNAT", () => {
    expect(isTailscaleIPv4("100.64.0.1")).toBe(true);
    expect(isTailscaleIPv4("100.63.0.1")).toBe(false);
    expect(isAllowedBindAddress("10.0.0.1")).toBe(false);
  });
});
