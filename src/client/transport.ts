import type { BotRef, ChatEntry, SendResult, TranscriptResult } from "../types.js";

export type ListBotsResult = {
  ok: true;
  liveConnected: boolean;
  bots: BotRef[];
  user?: { name?: string; email?: string; teamId?: number | null; teamName?: string };
};

export type GrokBotTransport = {
  readonly name: "standalone" | "notch" | "mock";
  listBots(): Promise<ListBotsResult>;
  sendMessage(bot: BotRef, text: string): Promise<SendResult>;
  getTranscript(bot: BotRef, opts?: { limit?: number; since?: string }): Promise<TranscriptResult>;
  ping?(): Promise<{ ok: boolean; detail: string }>;
};

export class TransportError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "TransportError";
    this.status = status;
  }
}

export function filterSince(entries: ChatEntry[], since?: string, limit = 20): ChatEntry[] {
  let out = entries;
  if (since) {
    const idx = entries.findIndex((e) => e.id === since);
    out = idx >= 0 ? entries.slice(idx + 1) : entries;
  }
  return out.slice(-limit);
}

export function resolveBot(bots: BotRef[], ref: string): BotRef {
  const needle = ref.trim();
  if (!needle) throw new TransportError("Bot name or id is required");
  const exactId = bots.find((b) => b.id === needle);
  if (exactId) return exactId;
  const exactName = bots.find((b) => b.name.toLowerCase() === needle.toLowerCase());
  if (exactName) return exactName;
  const starts = bots.filter((b) => b.name.toLowerCase().startsWith(needle.toLowerCase()));
  if (starts.length === 1 && starts[0]) return starts[0];
  if (starts.length > 1) {
    throw new TransportError(
      `Ambiguous bot "${needle}". Matches: ${starts.map((b) => b.name).join(", ")}`
    );
  }
  const contains = bots.filter((b) => b.name.toLowerCase().includes(needle.toLowerCase()));
  if (contains.length === 1 && contains[0]) return contains[0];
  const names = bots.map((b) => b.name).join(", ") || "(none)";
  throw new TransportError(`No bot matching "${needle}". Known: ${names}`);
}
