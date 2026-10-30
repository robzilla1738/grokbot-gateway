import { GrokBotClient } from "./client/index.js";
import { loadConfig } from "./config.js";
import { gatewayStatus } from "./doctor.js";
import { toolByName } from "./mcp/tools.js";
import { audit } from "./security/audit.js";
import { assertAllowedAction } from "./security/guard.js";
import { withUntrustedNotice } from "./security/injection.js";
import { assertSendRateLimit, DEFAULT_SEND_PER_MINUTE } from "./security/rate-limit.js";
import { assertBotAllowed, assertScope } from "./security/tokens.js";
import type { Actor, ChatEntry } from "./types.js";

export type Gateway = {
  client: GrokBotClient;
  actor: Actor;
};

function jsonResult(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function parseArgs(name: string, args: Record<string, unknown>): Record<string, unknown> {
  const tool = toolByName(name);
  if (!tool) return args;
  const parsed = tool.inputSchema.safeParse(args ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path?.join(".") || "input";
    throw new Error(`Invalid ${name} ${path}: ${issue?.message ?? parsed.error.message}`);
  }
  return parsed.data as Record<string, unknown>;
}

function sendLimit(actor: Actor): number {
  if (typeof actor.sendPerMinute === "number" && actor.sendPerMinute > 0) return actor.sendPerMinute;
  return loadConfig().sendPerMinute || DEFAULT_SEND_PER_MINUTE;
}

export async function dispatchTool(
  gateway: Gateway,
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: "text"; text: string }>; isError?: boolean }> {
  try {
    assertAllowedAction(name);
    const parsed = parseArgs(name, args);
    const { client, actor } = gateway;

    switch (name) {
      case "list_bots": {
        assertScope(actor, "bots:list");
        const listed = await client.listBots();
        const bots = listed.bots.filter((b) => {
          try {
            assertBotAllowed(actor, b.id, b.name);
            return true;
          } catch {
            return false;
          }
        });
        audit(actor, name, { ok: true, extra: { count: bots.length } });
        return jsonResult({
          liveConnected: listed.liveConnected,
          bots: bots.map((b) => ({
            id: b.id,
            name: b.name,
            title: b.title,
            unreadCount: b.unreadCount,
            lastPreview: b.lastPreview
          }))
        });
      }
      case "send_to_bot": {
        assertScope(actor, "bots:send");
        assertSendRateLimit(actor.id, sendLimit(actor));
        const bot = String(parsed.bot ?? "");
        const text = String(parsed.text ?? "");
        const resolved = await client.resolve(bot);
        assertBotAllowed(actor, resolved.id, resolved.name);
        const sent = await client.transport.sendMessage(resolved, text);
        audit(actor, name, {
          ok: true,
          botId: sent.bot.id,
          botName: sent.bot.name,
          messageChars: text.length
        });
        return jsonResult({
          ok: true,
          bot: { id: sent.bot.id, name: sent.bot.name },
          messageId: sent.messageId,
          hint: "Call wait_for_reply with since=messageId, or use ask_bot next time."
        });
      }
      case "ask_bot": {
        assertScope(actor, "bots:send");
        assertSendRateLimit(actor.id, sendLimit(actor));
        const bot = String(parsed.bot ?? "");
        const text = String(parsed.text ?? "");
        const timeoutMs = typeof parsed.timeoutMs === "number" ? parsed.timeoutMs : undefined;
        const resolved = await client.resolve(bot);
        assertBotAllowed(actor, resolved.id, resolved.name);
        const result = await client.ask(resolved.name, text, { timeoutMs });
        audit(actor, name, {
          ok: true,
          botId: result.bot.id,
          botName: result.bot.name,
          messageChars: text.length
        });
        return jsonResult(
          withUntrustedNotice({
            ok: true,
            bot: { id: result.bot.id, name: result.bot.name },
            messageId: result.messageId,
            replies: result.replies
          })
        );
      }
      case "read_chat": {
        assertScope(actor, "bots:read");
        const bot = String(parsed.bot ?? "");
        const limit = typeof parsed.limit === "number" ? parsed.limit : 20;
        const since = typeof parsed.since === "string" ? parsed.since : undefined;
        const resolved = await client.resolve(bot);
        assertBotAllowed(actor, resolved.id, resolved.name);
        const result = await client.read(resolved.name, { limit, since });
        audit(actor, name, { ok: true, botId: result.bot.id, botName: result.bot.name });
        return jsonResult(
          withUntrustedNotice({
            ok: true,
            bot: { id: result.bot.id, name: result.bot.name },
            entries: result.entries
          })
        );
      }
      case "wait_for_reply": {
        assertScope(actor, "bots:read");
        const bot = String(parsed.bot ?? "");
        const since = typeof parsed.since === "string" ? parsed.since : undefined;
        const timeoutMs = typeof parsed.timeoutMs === "number" ? parsed.timeoutMs : undefined;
        const resolved = await client.resolve(bot);
        assertBotAllowed(actor, resolved.id, resolved.name);
        const replies = await client.wait(resolved.name, { since, timeoutMs });
        audit(actor, name, { ok: true, botId: resolved.id, botName: resolved.name });
        return jsonResult(
          withUntrustedNotice({
            ok: true,
            bot: { id: resolved.id, name: resolved.name },
            replies
          })
        );
      }
      case "status": {
        assertScope(actor, "status");
        const status = await gatewayStatus();
        audit(actor, name, { ok: status.ok });
        return jsonResult(status);
      }
      default:
        return { content: [{ type: "text", text: `Unknown tool ${name}` }], isError: true };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    audit(gateway.actor, name, { ok: false, error: message });
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

export function formatEntries(entries: ChatEntry[]): string {
  if (entries.length === 0) return "(no messages)";
  return entries
    .map((e) => {
      const ts = e.timestampMs ? new Date(e.timestampMs).toISOString() : "";
      return `[${e.role}] ${e.id}${ts ? " " + ts : ""}\n${e.text}`;
    })
    .join("\n\n");
}

