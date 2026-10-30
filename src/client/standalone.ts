import crypto from "node:crypto";
import { loadConfig } from "../config.js";
import type { BotRef, ChatEntry } from "../types.js";
import { readPersistenceSnapshot } from "./persistence.js";
import { callGrokBotRpc, parseServerTranscriptEntry, resolveRegisteredSandMachineId } from "./rpc.js";
import { readAuthContext } from "./session.js";
import {
  filterSince,
  type GrokBotTransport,
  type ListBotsResult,
  TransportError
} from "./transport.js";

type AgentRow = {
  agentId?: string;
  id?: string;
  name?: string;
  title?: string;
  description?: string;
  hasUnread?: boolean;
  unreadCount?: number;
  harness?: string;
  updatedAtMs?: number;
};

function normalizeAgent(raw: AgentRow, local?: BotRef): BotRef {
  const id = raw.agentId || raw.id || local?.id || "";
  return {
    id,
    name: raw.name || local?.name || "Grok Bot",
    title: raw.title || local?.title || "",
    description: raw.description || local?.description || "",
    hasUnread: Boolean(raw.hasUnread ?? local?.hasUnread),
    unreadCount: Number(raw.unreadCount ?? local?.unreadCount ?? 0),
    harness: raw.harness || local?.harness,
    updatedAtMs: Number(raw.updatedAtMs || local?.updatedAtMs || 0),
    lastPreview: local?.lastPreview ?? null
  };
}

export function createStandaloneTransport(): GrokBotTransport {
  const cfg = loadConfig();

  return {
    name: "standalone",
    async listBots(): Promise<ListBotsResult> {
      const snap = readPersistenceSnapshot();
      const auth = await readAuthContext(snap.activeAccountScope);
      let serverAgents: AgentRow[] = [];
      let liveConnected = false;
      if (auth.accessToken) {
        try {
          const res = await callGrokBotRpc<{ agents?: AgentRow[] }>(
            "ListGrokBotAgents",
            {},
            auth,
            cfg.backendUrl
          );
          if (Array.isArray(res.agents)) {
            serverAgents = res.agents;
            liveConnected = true;
          }
        } catch {
          // fall back to local roster
        }
      }
      const byId = new Map<string, BotRef>();
      const localById = new Map(snap.localBots.map((b) => [b.id, b]));
      for (const agent of serverAgents) {
        const id = agent.agentId || agent.id;
        if (!id) continue;
        byId.set(id, normalizeAgent(agent, localById.get(id)));
      }
      for (const local of snap.localBots) {
        if (!byId.has(local.id)) byId.set(local.id, local);
      }
      if (!auth.accessToken && byId.size === 0) {
        throw new TransportError(
          "No Grok Bot session found. Sign in to Desktop Grok Bot on this Mac, or set GROKBOT_TRANSPORT=notch if GrokBot Notch is running."
        );
      }
      return {
        ok: true,
        liveConnected,
        bots: [...byId.values()],
        user: { name: auth.userName, email: auth.cachedEmail, teamId: auth.teamId, teamName: auth.teamName }
      };
    },
    async sendMessage(bot, text) {
      const snap = readPersistenceSnapshot();
      const auth = await readAuthContext(snap.activeAccountScope);
      const sandMachineId = await resolveRegisteredSandMachineId(auth, cfg.backendUrl);
      const nowStr = String(Date.now());
      const messageId = crypto.randomUUID();
      const rpcRes = await callGrokBotRpc<{ delivery?: string | number; refusal?: { message?: string } }>(
        "SendGrokBotUserMessage",
        {
          agentId: bot.id,
          messageId,
          text,
          sentAtMs: nowStr,
          enterEpochMs: nowStr,
          composedAtMs: nowStr,
          isFork: false,
          source: "GROK_BOT_CLIENT_SURFACE_DESKTOP",
          initiator: "GROK_BOT_USER_MESSAGE_INITIATOR_USER",
          sendSource: "GROK_BOT_SEND_SOURCE_CHAT",
          machineId: sandMachineId
        },
        auth,
        cfg.backendUrl
      );
      if (rpcRes.delivery === "GROK_BOT_USER_MESSAGE_DELIVERY_REFUSED" || rpcRes.delivery === 4) {
        throw new TransportError(rpcRes.refusal?.message || "Message refused by Grok Bot", 400);
      }
      return { ok: true, bot, messageId, sentAtMs: Date.now() };
    },
    async getTranscript(bot, opts) {
      const snap = readPersistenceSnapshot();
      const auth = await readAuthContext(snap.activeAccountScope);
      const entries: ChatEntry[] = [];
      if (auth.accessToken) {
        try {
          const res = await callGrokBotRpc<{
            entries?: Array<{ body?: string; seq?: number; entryKind?: string }>;
          }>("ListGrokBotTranscriptEntries", { agentId: bot.id, limit: opts?.limit ?? 30 }, auth, cfg.backendUrl);
          if (Array.isArray(res.entries)) {
            for (const raw of res.entries) {
              const parsed = parseServerTranscriptEntry(raw);
              if (!parsed) continue;
              if (parsed.kind === "send-message") {
                const message = parsed.message as { type?: string; content?: string; channel?: string } | undefined;
                if (message?.type === "text") {
                  entries.push({
                    id: String(parsed.id ?? crypto.randomUUID()),
                    seq: typeof parsed.seq === "number" ? parsed.seq : undefined,
                    role: "assistant",
                    text: String(message.content || "").trim(),
                    channel: message.channel ?? null,
                    timestampMs: typeof parsed.timestampMs === "number" ? parsed.timestampMs : null
                  });
                }
              } else if (parsed.kind === "message" && typeof parsed.content === "string") {
                entries.push({
                  id: String(parsed.id ?? crypto.randomUUID()),
                  seq: typeof parsed.seq === "number" ? parsed.seq : undefined,
                  role: String(parsed.role || "user"),
                  text: parsed.content.trim(),
                  channel: typeof parsed.channel === "string" ? parsed.channel : null,
                  timestampMs: typeof parsed.timestampMs === "number" ? parsed.timestampMs : null
                });
              }
            }
          }
          return { ok: true, bot, entries: filterSince(entries, opts?.since, opts?.limit ?? 20) };
        } catch {
          // local fallback
        }
      }
      const local = snap.transcripts.get(bot.id) ?? [];
      return { ok: true, bot, entries: filterSince(local, opts?.since, opts?.limit ?? 20) };
    },
    async ping() {
      const auth = await readAuthContext();
      if (!auth.accessToken) {
        const snap = readPersistenceSnapshot();
        if (snap.localBots.length > 0) {
          return { ok: true, detail: "local roster only (not signed in to backend)" };
        }
        return { ok: false, detail: "no Grok Bot session on this machine" };
      }
      try {
        await callGrokBotRpc("ListGrokBotAgents", {}, auth, cfg.backendUrl);
        return { ok: true, detail: `standalone session via ${auth.source}` };
      } catch (err) {
        return { ok: false, detail: err instanceof Error ? err.message : String(err) };
      }
    }
  };
}
