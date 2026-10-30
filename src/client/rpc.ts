import crypto from "node:crypto";
import os from "node:os";
import { loadConfig } from "../config.js";
import { createCursorChecksum } from "./checksum.js";
import type { AuthContext } from "./session.js";

export function buildBackendHeaders(auth: AuthContext, clientVersion?: string): Record<string, string> {
  const version = clientVersion || loadConfig().clientVersion;
  const headers: Record<string, string> = {
    authorization: `Bearer ${auth.accessToken}`,
    "x-cursor-checksum": createCursorChecksum(auth.machineId),
    "x-cursor-client-type": "sand",
    "x-cursor-client-version": version,
    "x-sand-box-namespace": "prod",
    "x-cursor-client-os": process.platform === "darwin" ? "darwin" : process.platform,
    "x-cursor-client-source": "sand-desktop",
    "x-ghost-mode": "true",
    "x-cursor-timezone": Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    "x-request-id": crypto.randomUUID(),
    "content-type": "application/json",
    "connect-protocol-version": "1",
    "user-agent": `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Sand/${version} Safari/537.36`
  };
  if (auth.teamId != null) headers["x-cursor-team-id"] = String(auth.teamId);
  return headers;
}

export async function callGrokBotRpc<T = Record<string, unknown>>(
  method: string,
  body: Record<string, unknown>,
  auth: AuthContext,
  backendUrl?: string
): Promise<T> {
  if (!auth.accessToken) {
    throw new Error("Sign in to Desktop Grok Bot so the gateway can use that session. Do not paste an xAI API key.");
  }
  const base = (backendUrl || loadConfig().backendUrl).replace(/\/$/, "");
  const url = `${base}/aiserver.v1.GrokBotService/${method}`;
  const res = await fetch(url, {
    method: "POST",
    headers: buildBackendHeaders(auth),
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json: Record<string, unknown>;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const refusal = res.headers.get("x-grok-bot-refusal");
    const msg = String(json.message || json.error || `HTTP ${res.status}`);
    const err = new Error(refusal ? `${msg} (${refusal})` : msg);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return json as T;
}

const sandMachineIdByScope = new Map<string, string>();

export async function resolveRegisteredSandMachineId(auth: AuthContext, backendUrl?: string): Promise<string> {
  const cached = sandMachineIdByScope.get(auth.accountScope);
  if (cached) return cached;
  try {
    const base = (backendUrl || loadConfig().backendUrl).replace(/\/$/, "");
    const res = await fetch(`${base}/aiserver.v1.DashboardService/ListSandMachines`, {
      method: "POST",
      headers: buildBackendHeaders(auth),
      body: JSON.stringify({})
    });
    if (res.ok) {
      const data = (await res.json()) as { machines?: Array<{ label?: string; connected?: boolean; kind?: string; machineId?: string }> };
      const machines = Array.isArray(data.machines) ? data.machines : [];
      const host = os.hostname().toLowerCase();
      const match =
        machines.find((m) => (m.label || "").toLowerCase() === host) ||
        machines.find((m) => m.connected && m.kind === "desktop") ||
        machines[0];
      if (match?.machineId) {
        sandMachineIdByScope.set(auth.accountScope, match.machineId);
        return match.machineId;
      }
    }
  } catch {
    // fall through
  }
  return auth.machineId;
}

export function parseServerTranscriptEntry(rawEntry: {
  body?: string;
  seq?: number;
  entryKind?: string;
}): Record<string, unknown> | null {
  if (!rawEntry?.body) return null;
  try {
    const decoded = JSON.parse(Buffer.from(rawEntry.body, "base64").toString("utf8")) as Record<string, unknown>;
    return { seq: rawEntry.seq, entryKind: rawEntry.entryKind, ...decoded };
  } catch {
    return null;
  }
}
