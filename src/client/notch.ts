import { notchAuthTokenPath } from "../paths.js";
import { loadConfig } from "../config.js";
import type { BotRef, ChatEntry } from "../types.js";
import {
  filterSince,
  type GrokBotTransport,
  type ListBotsResult,
  TransportError
} from "./transport.js";
import fs from "node:fs";

export type NotchClientOptions = {
  baseUrl?: string;
  token?: string;
  tokenFile?: string;
};

function readToken(opts: NotchClientOptions): string {
  if (opts.token) return opts.token;
  if (process.env.GROKBOT_NOTCH_AUTH_TOKEN) return process.env.GROKBOT_NOTCH_AUTH_TOKEN;
  const file = opts.tokenFile || process.env.GROKBOT_NOTCH_TOKEN_FILE || notchAuthTokenPath();
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    throw new TransportError(
      `No notch auth token. Expected ${file} or GROKBOT_NOTCH_AUTH_TOKEN. Is GrokBot Notch running?`
    );
  }
}

export function createNotchTransport(options: NotchClientOptions = {}): GrokBotTransport {
  const cfg = loadConfig();
  const baseUrl = (options.baseUrl || cfg.notchUrl).replace(/\/$/, "");

  async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const token = readToken(options);
    const url = `${baseUrl}${path}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...(init.headers ?? {})
      }
    });
    const text = await res.text();
    let json: Record<string, unknown>;
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      json = { raw: text };
    }
    if (!res.ok || json.ok === false) {
      throw new TransportError(String(json.error || json.message || `HTTP ${res.status}`), res.status);
    }
    return json as T;
  }

  return {
    name: "notch",
    async listBots(): Promise<ListBotsResult> {
      const data = await api<{
        liveConnected?: boolean;
        bots?: BotRef[];
        user?: ListBotsResult["user"];
      }>("/api/bootstrap");
      return {
        ok: true,
        liveConnected: Boolean(data.liveConnected),
        bots: data.bots ?? [],
        user: data.user
      };
    },
    async sendMessage(bot, text) {
      const data = await api<{ messageId?: string }>(`/api/bot/${encodeURIComponent(bot.id)}/message`, {
        method: "POST",
        body: JSON.stringify({ text })
      });
      return {
        ok: true,
        bot,
        messageId: data.messageId || "",
        sentAtMs: Date.now()
      };
    },
    async getTranscript(bot, opts) {
      const data = await api<{ entries?: ChatEntry[] }>(
        `/api/bot/${encodeURIComponent(bot.id)}/transcript`
      );
      return {
        ok: true,
        bot,
        entries: filterSince(data.entries ?? [], opts?.since, opts?.limit ?? 20)
      };
    },
    async ping() {
      try {
        const data = await api<{ ok?: boolean }>("/api/bootstrap");
        return { ok: true, detail: data.ok === false ? "notch bootstrap failed" : "notch reachable" };
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
    }
  };
}
