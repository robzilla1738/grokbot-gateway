import fs from "node:fs";
import { auditLogPath, ensureGatewayHome } from "../paths.js";
import { redact, redactUnknown } from "../redact.js";
import type { Actor } from "../types.js";

export type AuditEvent = {
  ts: string;
  actor: string;
  action: string;
  ok: boolean;
  botId?: string;
  botName?: string;
  messageChars?: number;
  error?: string;
  extra?: Record<string, unknown>;
};

export function appendAudit(event: AuditEvent): void {
  ensureGatewayHome();
  const line = JSON.stringify({
    ts: event.ts,
    actor: event.actor,
    action: event.action,
    ok: event.ok,
    botId: event.botId,
    botName: event.botName,
    messageChars: event.messageChars,
    error: event.error ? redact(event.error) : undefined,
    extra: event.extra ? redactUnknown(event.extra) : undefined
  });
  fs.appendFileSync(auditLogPath(), line + "\n", { mode: 0o600 });
  try {
    fs.chmodSync(auditLogPath(), 0o600);
  } catch {
    // ignore
  }
}

export function audit(
  actor: Actor,
  action: string,
  fields: Omit<AuditEvent, "ts" | "actor" | "action">
): void {
  appendAudit({
    ts: new Date().toISOString(),
    actor: `${actor.kind}:${actor.id}`,
    action,
    ...fields
  });
}

export function actorLabel(actor: Actor): string {
  return `${actor.kind}:${actor.id}`;
}
