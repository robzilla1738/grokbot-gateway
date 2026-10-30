import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { startMockBridge, type MockBridge } from "../src/mock-bridge.js";

describe("mock bridge HTTP security", () => {
  let bridge: MockBridge | undefined;

  afterEach(async () => {
    await bridge?.close();
    bridge = undefined;
  });

  it("serves /health without a token and rejects a bad Host", async () => {
    bridge = await startMockBridge({ host: "127.0.0.1", token: "mock-token" });
    const health = await fetch(`${bridge.url}/health`);
    expect(health.status).toBe(200);
    const body = (await health.json()) as { ok: boolean; mock: boolean };
    expect(body).toEqual({ ok: true, mock: true });

    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port: bridge!.port,
          path: "/health",
          headers: { Host: "evil.example:14790" }
        },
        (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        }
      );
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  });
});
