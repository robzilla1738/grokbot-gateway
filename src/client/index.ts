import fs from "node:fs";
import { loadConfig } from "../config.js";
import { grokBotSupportDir, notchAuthTokenPath } from "../paths.js";
import { sessionPresent } from "./session.js";
import { createMockTransport } from "./mock.js";
import { createNotchTransport } from "./notch.js";
import { createStandaloneTransport } from "./standalone.js";
import { resolveBot, type GrokBotTransport, type ListBotsResult } from "./transport.js";
import { snapshotAssistantIds, waitForReply } from "./wait.js";
import type { BotRef, ChatEntry, SendResult, TransportName } from "../types.js";

export { resolveBot } from "./transport.js";
export { createMockTransport, createMockStore } from "./mock.js";
export { createNotchTransport } from "./notch.js";
export { createStandaloneTransport } from "./standalone.js";
export { waitForReply, snapshotAssistantIds } from "./wait.js";
export type { GrokBotTransport, ListBotsResult } from "./transport.js";

function notchSeemsAvailable(): boolean {
  try {
    return fs.existsSync(notchAuthTokenPath());
  } catch {
    return false;
  }
}

function standaloneSeemsAvailable(): boolean {
  if (sessionPresent()) return true;
  try {
    return fs.existsSync(grokBotSupportDir());
  } catch {
    return false;
  }
}

export function selectTransportName(requested: TransportName = loadConfig().transport): Exclude<TransportName, "auto"> {
  if (requested !== "auto") return requested;
  if (process.env.GROKBOT_MOCK === "1") return "mock";
  if (standaloneSeemsAvailable()) return "standalone";
  if (notchSeemsAvailable()) return "notch";
  return "standalone";
}

export function createTransport(name: TransportName = loadConfig().transport): GrokBotTransport {
  const resolved = selectTransportName(name);
  switch (resolved) {
    case "mock":
      return createMockTransport();
    case "notch":
      return createNotchTransport();
    case "standalone":
      return createStandaloneTransport();
    default: {
      const _never: never = resolved;
      throw new Error(`Unknown transport ${_never}`);
    }
  }
}

export class GrokBotClient {
  readonly transport: GrokBotTransport;
  readonly transportName: Exclude<TransportName, "auto">;

  constructor(transport?: GrokBotTransport, name?: TransportName) {
    this.transportName = transport?.name ?? selectTransportName(name);
    this.transport = transport ?? createTransport(this.transportName);
  }

  async listBots(): Promise<ListBotsResult> {
    return this.transport.listBots();
  }

  async resolve(ref: string): Promise<BotRef> {
    const { bots } = await this.transport.listBots();
    return resolveBot(bots, ref);
  }

  private async bot(ref: string | BotRef): Promise<BotRef> {
    return typeof ref === "string" ? this.resolve(ref) : ref;
  }

  async send(ref: string | BotRef, text: string): Promise<SendResult> {
    const bot = await this.bot(ref);
    return this.transport.sendMessage(bot, text);
  }

  async read(ref: string | BotRef, opts?: { limit?: number; since?: string }) {
    const bot = await this.bot(ref);
    return this.transport.getTranscript(bot, opts);
  }

  async ask(
    ref: string | BotRef,
    text: string,
    opts?: { timeoutMs?: number; pollMs?: number; onUpdate?: (entries: ChatEntry[]) => void }
  ): Promise<{ bot: BotRef; messageId: string; replies: ChatEntry[] }> {
    const bot = await this.bot(ref);
    const sinceIds = await snapshotAssistantIds(this.transport, bot);
    const sent = await this.transport.sendMessage(bot, text);
    const replies = await waitForReply(this.transport, bot, {
      timeoutMs: opts?.timeoutMs,
      pollMs: opts?.pollMs,
      sinceIds,
      onUpdate: opts?.onUpdate
    });
    return { bot, messageId: sent.messageId, replies };
  }

  async wait(
    ref: string | BotRef,
    opts?: { timeoutMs?: number; since?: string; pollMs?: number }
  ): Promise<ChatEntry[]> {
    const bot = await this.bot(ref);
    const transcript = await this.transport.getTranscript(bot, { limit: 50 });
    const sinceIds = new Set(
      transcript.entries.filter((e) => e.role === "assistant").map((e) => e.id)
    );
    if (opts?.since) {
      const idx = transcript.entries.findIndex((e) => e.id === opts.since);
      if (idx >= 0) {
        for (const entry of transcript.entries.slice(idx + 1)) {
          if (entry.role === "assistant") sinceIds.delete(entry.id);
        }
      }
    }
    return waitForReply(this.transport, bot, {
      timeoutMs: opts?.timeoutMs,
      pollMs: opts?.pollMs,
      sinceIds
    });
  }
}
