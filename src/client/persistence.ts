import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { grokBotSupportDir } from "../paths.js";
import type { BotRef, ChatEntry } from "../types.js";

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

export function sha256Hex(str: string): string {
  return crypto.createHash("sha256").update(str).digest("hex");
}

export function decodePersistenceFilename(filename: string): string | null {
  if (!filename.endsWith(".blob")) return null;
  const stem = filename.slice(0, -5);
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const ch of stem) {
    const val = BASE32.indexOf(ch);
    if (val < 0) return null;
    acc = (acc << 5) | val;
    bits += 5;
    if (bits >= 8) {
      bytes.push((acc >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return null;
  }
}

export type PersistenceSnapshot = {
  activeAccountScope: string | null;
  localBots: BotRef[];
  transcripts: Map<string, ChatEntry[]>;
};

function previewFromEntries(entries: ChatEntry[]): BotRef["lastPreview"] {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (e?.text) {
      return {
        role: e.role,
        text: e.text.replace(/\s+/g, " ").trim().slice(0, 180),
        timestampMs: e.timestampMs ?? null
      };
    }
  }
  return null;
}

function asChatEntries(raw: unknown[]): ChatEntry[] {
  const out: ChatEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const parsed = item as Record<string, unknown>;
    if (parsed.kind === "send-message") {
      const message = parsed.message as { type?: string; content?: string } | undefined;
      if (message?.type === "text" && message.content) {
        out.push({
          id: String(parsed.id ?? crypto.randomUUID()),
          role: "assistant",
          text: String(message.content).trim(),
          timestampMs: typeof parsed.timestampMs === "number" ? parsed.timestampMs : null
        });
      }
    } else if (parsed.kind === "message" && typeof parsed.content === "string") {
      out.push({
        id: String(parsed.id ?? crypto.randomUUID()),
        role: String(parsed.role ?? "user"),
        text: parsed.content.trim(),
        timestampMs: typeof parsed.timestampMs === "number" ? parsed.timestampMs : null
      });
    }
  }
  return out;
}

export function readPersistenceSnapshot(supportDir = grokBotSupportDir()): PersistenceSnapshot {
  const result: PersistenceSnapshot = {
    activeAccountScope: null,
    localBots: [],
    transcripts: new Map()
  };
  const dir = path.join(supportDir, "sand-client-persistence");
  if (!fs.existsSync(dir)) return result;

  const files = fs.readdirSync(dir);
  const blobs: { key: string; value: unknown }[] = [];
  for (const f of files) {
    const key = decodePersistenceFilename(f);
    if (!key) continue;
    try {
      const raw = fs.readFileSync(path.join(dir, f), "utf8");
      const nl = raw.indexOf("\n");
      const jsonText = nl >= 0 && raw.startsWith('"sand.client.') ? raw.slice(nl + 1) : raw;
      const parsed = JSON.parse(jsonText) as { value?: unknown };
      blobs.push({ key, value: parsed.value });
    } catch {
      // skip unreadable blob
    }
  }

  for (const { key, value } of blobs) {
    if (key === "sand.client.slice.client-meta.account-slot" && typeof value === "string") {
      result.activeAccountScope = sha256Hex(value);
    }
  }

  const botsById = new Map<string, BotRef>();
  for (const { key, value } of blobs) {
    if (!value) continue;
    if (key.endsWith(".roster.last-roster") && typeof value === "object") {
      const rows = (value as { rows?: unknown[] }).rows;
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const r = row as Record<string, unknown>;
        if (typeof r.id !== "string") continue;
        botsById.set(r.id, {
          id: r.id,
          name: String(r.name ?? "Grok Bot"),
          title: typeof r.title === "string" ? r.title : "",
          description: typeof r.description === "string" ? r.description : "",
          hasUnread: Boolean(r.hasUnread),
          unreadCount: Number(r.unreadCount ?? 0),
          harness: typeof r.harness === "string" ? r.harness : undefined,
          updatedAtMs: Number(r.updatedAt ?? r.lastActivityAt ?? 0)
        });
      }
    } else if (key.includes(".transcript.replicas.") && typeof value === "object") {
      const agentId = key.split(".transcript.replicas.")[1];
      const entries = (value as { entries?: unknown[] }).entries;
      if (agentId && Array.isArray(entries)) {
        result.transcripts.set(agentId, asChatEntries(entries));
      }
    }
  }

  for (const bot of botsById.values()) {
    bot.lastPreview = previewFromEntries(result.transcripts.get(bot.id) ?? []);
    result.localBots.push(bot);
  }
  return result;
}
