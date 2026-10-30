import type { ChatEntry } from "../types.js";
import type { GrokBotTransport } from "./transport.js";
import type { BotRef } from "../types.js";
import { TransportError } from "./transport.js";

export type WaitOptions = {
  timeoutMs?: number;
  pollMs?: number;
  sinceIds?: Set<string>;
  onUpdate?: (entries: ChatEntry[]) => void;
};

export async function waitForReply(
  transport: GrokBotTransport,
  bot: BotRef,
  opts: WaitOptions = {}
): Promise<ChatEntry[]> {
  const timeoutMs = opts.timeoutMs ?? 120_000;
  const pollMs = opts.pollMs ?? 750;
  const baseline = opts.sinceIds ?? new Set<string>();
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const transcript = await transport.getTranscript(bot, { limit: 50 });
    const fresh = transcript.entries.filter((e) => e.role === "assistant" && e.text && !baseline.has(e.id));
    if (fresh.length > 0) {
      opts.onUpdate?.(fresh);
      return fresh;
    }
    opts.onUpdate?.([]);
    await sleep(pollMs);
  }
  throw new TransportError(`Timed out after ${timeoutMs}ms waiting for a reply from ${bot.name}`);
}

export async function snapshotAssistantIds(transport: GrokBotTransport, bot: BotRef): Promise<Set<string>> {
  const transcript = await transport.getTranscript(bot, { limit: 50 });
  return new Set(transcript.entries.filter((e) => e.role === "assistant").map((e) => e.id));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
