/**
 * The gateway never emails, DMs third parties, buys, or deletes.
 * Those actions belong to Grok Bot, which already shows an Allow/Deny card.
 * This module is the hard allow-list for tools and gateway-side actions.
 */

export const ALLOWED_ACTIONS = [
  "list_bots",
  "send_to_bot",
  "ask_bot",
  "read_chat",
  "wait_for_reply",
  "tail_chat",
  "status",
  "box_list",
  "box_read_file",
  "doctor",
  "token_create",
  "token_list",
  "token_revoke"
] as const;

export type AllowedAction = (typeof ALLOWED_ACTIONS)[number];

export const FORBIDDEN_ACTIONS = [
  "send_email",
  "send_sms",
  "send_slack",
  "dm_third_party",
  "purchase",
  "buy",
  "checkout",
  "delete_bot",
  "delete_file",
  "delete_account",
  "destroy",
  "rm",
  "transfer_money"
] as const;

const ALLOWED = new Set<string>(ALLOWED_ACTIONS);
const FORBIDDEN = new Set<string>(FORBIDDEN_ACTIONS);

export class GuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuardError";
  }
}

export function assertAllowedAction(action: string): asserts action is AllowedAction {
  const normalized = action.trim();
  if (FORBIDDEN.has(normalized) || FORBIDDEN.has(normalized.replace(/-/g, "_"))) {
    throw new GuardError(
      `Refused: the gateway never ${normalized.replace(/_/g, " ")}. Ask a Grok Bot to do it so the owner sees an Allow/Deny card.`
    );
  }
  if (!ALLOWED.has(normalized)) {
    throw new GuardError(
      `Refused: "${normalized}" is not a gateway action. Allowed: ${ALLOWED_ACTIONS.join(", ")}.`
    );
  }
}

export function isForbiddenToolName(name: string): boolean {
  return FORBIDDEN.has(name) || FORBIDDEN.has(name.replace(/-/g, "_"));
}
