import crypto from "node:crypto";
import type { BotRef, ChatEntry } from "../types.js";
import { filterSince, type GrokBotTransport, type ListBotsResult } from "./transport.js";
import { TransportError } from "./transport.js";

export type MockStore = {
  liveConnected: boolean;
  bots: BotRef[];
  transcripts: Map<string, ChatEntry[]>;
  replyDelayMs: number;
  autoReply: boolean;
};

export function createMockStore(overrides?: Partial<MockStore>): MockStore {
  const chief: BotRef = {
    id: "bot-chief",
    name: "Chief",
    title: "Chief of Staff",
    description: "Coordinates the other bots.",
    hasUnread: false,
    unreadCount: 0,
    isPinned: true,
    harness: "temporal",
    updatedAtMs: Date.now(),
    lastPreview: {
      role: "assistant",
      text: "Ready when you are.",
      timestampMs: Date.now() - 60_000
    }
  };
  const ops: BotRef = {
    id: "bot-ops",
    name: "Ops",
    title: "Ops",
    description: "Keeps the box healthy.",
    hasUnread: false,
    unreadCount: 0,
    isPinned: false,
    harness: "temporal",
    updatedAtMs: Date.now(),
    lastPreview: null
  };
  const transcripts = new Map<string, ChatEntry[]>([
    [
      chief.id,
      [
        {
          id: "m-welcome",
          role: "assistant",
          text: "Ready when you are.",
          timestampMs: Date.now() - 60_000
        }
      ]
    ],
    [ops.id, []]
  ]);
  return {
    liveConnected: true,
    bots: [chief, ops],
    transcripts,
    replyDelayMs: 25,
    autoReply: true,
    ...overrides
  };
}

function requireBot(store: MockStore, id: string): BotRef {
  const bot = store.bots.find((b) => b.id === id);
  if (!bot) throw new TransportError(`Unknown bot ${id}`, 404);
  return bot;
}

export function mockSend(store: MockStore, botId: string, text: string): { messageId: string; bot: BotRef } {
  const bot = requireBot(store, botId);
  const messageId = crypto.randomUUID();
  const entries = store.transcripts.get(bot.id) ?? [];
  entries.push({
    id: messageId,
    role: "user",
    text,
    timestampMs: Date.now()
  });
  store.transcripts.set(bot.id, entries);
  if (store.autoReply) {
    const delay = store.replyDelayMs;
    const replyId = `reply-${messageId}`;
    setTimeout(() => {
      const list = store.transcripts.get(bot.id) ?? [];
      list.push({
        id: replyId,
        role: "assistant",
        text: `Mock reply to: ${text}`,
        timestampMs: Date.now()
      });
      store.transcripts.set(bot.id, list);
      bot.lastPreview = { role: "assistant", text: `Mock reply to: ${text}`, timestampMs: Date.now() };
    }, delay);
  }
  return { messageId, bot };
}

export function createMockTransport(store: MockStore = createMockStore()): GrokBotTransport {
  return {
    name: "mock",
    async listBots(): Promise<ListBotsResult> {
      return {
        ok: true,
        liveConnected: store.liveConnected,
        bots: store.bots,
        user: { name: "Mock User", teamId: null }
      };
    },
    async sendMessage(bot, text) {
      const result = mockSend(store, bot.id, text);
      return {
        ok: true,
        bot: result.bot,
        messageId: result.messageId,
        sentAtMs: Date.now()
      };
    },
    async getTranscript(bot, opts) {
      const found = requireBot(store, bot.id);
      const entries = store.transcripts.get(found.id) ?? [];
      return {
        ok: true,
        bot: found,
        entries: filterSince(entries, opts?.since, opts?.limit ?? 20)
      };
    },
    async ping() {
      return { ok: true, detail: "mock transport" };
    }
  };
}
