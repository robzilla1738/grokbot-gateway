export type TransportName = "auto" | "standalone" | "notch" | "mock";

export type TokenScope = "bots:list" | "bots:read" | "bots:send" | "status" | "tokens" | "box:read";

export const ALL_SCOPES: TokenScope[] = ["bots:list", "bots:read", "bots:send", "status", "tokens", "box:read"];

/** Default for newly minted agent tokens: inspect, do not send. */
export const READONLY_SCOPES: TokenScope[] = ["bots:list", "bots:read", "status"];

export const MAX_MESSAGE_CHARS = 32_768;

export type BotRef = {
  id: string;
  name: string;
  title?: string;
  description?: string;
  hasUnread?: boolean;
  unreadCount?: number;
  isPinned?: boolean;
  harness?: string;
  updatedAtMs?: number;
  lastPreview?: { role: string; text: string; timestampMs: number | null } | null;
};

export type ChatEntry = {
  id: string;
  seq?: number;
  role: "user" | "assistant" | "system" | string;
  text: string;
  channel?: string | null;
  timestampMs?: number | null;
};

export type SendResult = {
  ok: true;
  bot: BotRef;
  messageId: string;
  sentAtMs: number;
};

export type TranscriptResult = {
  ok: true;
  bot: BotRef;
  entries: ChatEntry[];
};

export type GatewayStatus = {
  ok: boolean;
  version: string;
  transport: TransportName;
  liveConnected: boolean;
  botCount: number;
  user?: { name?: string; teamId?: number | null };
  bind?: string;
  boxHost: string;
  notes: string[];
};

export type DoctorCheck = {
  id: string;
  ok: boolean;
  detail: string;
  fix?: string;
};

export type GatewayConfig = {
  transport: TransportName;
  backendUrl: string;
  notchUrl: string;
  bind: string;
  httpPort: number;
  boxHost: string;
  boxUser: string;
  clientVersion: string;
  sendPerMinute: number;
};

export type Actor = {
  kind: "local-cli" | "mcp-stdio" | "mcp-http" | "token" | "test";
  id: string;
  scopes: TokenScope[];
  botAllowlist?: string[];
  sendPerMinute?: number;
};
