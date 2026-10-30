import crypto from "node:crypto";
import fs from "node:fs";
import { ensureGatewayHome, tokensPath } from "../paths.js";
import { ALL_SCOPES, READONLY_SCOPES, type Actor, type TokenScope } from "../types.js";
import { writeSecureFile } from "./files.js";

export const TOKEN_PREFIX = "gbgt_";
export const DEFAULT_TOKEN_TTL = "30d";

export type StoredToken = {
  id: string;
  name: string;
  hash: string;
  prefix: string;
  scopes: TokenScope[];
  botAllowlist: string[];
  expiresAt: string | null;
  sendPerMinute: number | null;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
};

export type TokenFile = {
  version: 1;
  tokens: StoredToken[];
};

export type CreatedToken = StoredToken & { token: string };

export type TokenCreateInput = {
  name: string;
  scopes?: TokenScope[];
  botAllowlist?: string[];
  expiresAt?: Date | string | null;
  sendPerMinute?: number | null;
};

function emptyFile(): TokenFile {
  return { version: 1, tokens: [] };
}

function normalizeStored(raw: Partial<StoredToken> & { id: string; name: string; hash: string }): StoredToken {
  return {
    id: raw.id,
    name: raw.name,
    hash: raw.hash,
    prefix: raw.prefix ?? raw.hash.slice(0, 10),
    scopes: Array.isArray(raw.scopes) ? raw.scopes : [...READONLY_SCOPES],
    botAllowlist: Array.isArray(raw.botAllowlist) ? raw.botAllowlist : [],
    expiresAt: raw.expiresAt ?? null,
    sendPerMinute: raw.sendPerMinute ?? null,
    createdAt: raw.createdAt ?? new Date().toISOString(),
    lastUsedAt: raw.lastUsedAt ?? null,
    revokedAt: raw.revokedAt ?? null
  };
}

export function loadTokenFile(): TokenFile {
  try {
    const raw = fs.readFileSync(tokensPath(), "utf8");
    const parsed = JSON.parse(raw) as TokenFile;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.tokens)) return emptyFile();
    return { version: 1, tokens: parsed.tokens.map((t) => normalizeStored(t)) };
  } catch {
    return emptyFile();
  }
}

function saveTokenFile(file: TokenFile): void {
  ensureGatewayHome();
  writeSecureFile(tokensPath(), JSON.stringify(file, null, 2) + "\n");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time compare. Length mismatch still runs a dummy compare. */
export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) {
    crypto.timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32));
    return false;
  }
  return crypto.timingSafeEqual(left, right);
}

export function parseScopes(input?: string[] | string): TokenScope[] {
  if (input == null || input === "") return [...READONLY_SCOPES];
  const raw = Array.isArray(input) ? input.flatMap((s) => s.split(",")) : input.split(",");
  const scopes = raw
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((s) => (s === "*" || s === "all" ? [...ALL_SCOPES] : s === "readonly" ? [...READONLY_SCOPES] : [s as TokenScope]));
  const unique = [...new Set(scopes)];
  for (const s of unique) {
    if (!ALL_SCOPES.includes(s)) {
      throw new Error(`Unknown scope "${s}". Allowed: ${ALL_SCOPES.join(", ")}, readonly, or *`);
    }
  }
  return unique.length ? unique : [...READONLY_SCOPES];
}

function resolveExpiry(input?: Date | string | null): string | null {
  if (input === undefined) return parseExpiry(DEFAULT_TOKEN_TTL);
  if (input === null) return null;
  if (input instanceof Date) return input.toISOString();
  return input;
}

export function parseExpiry(input?: string | null): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed || trimmed === "never") return null;
  const duration = /^(\d+)([smhd])$/.exec(trimmed);
  if (duration) {
    const n = Number(duration[1]);
    const unit = duration[2];
    const ms =
      unit === "s" ? n * 1000 : unit === "m" ? n * 60_000 : unit === "h" ? n * 3_600_000 : n * 86_400_000;
    return new Date(Date.now() + ms).toISOString();
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid expiry "${input}". Use ISO date or a duration like 7d, 12h, 30m.`);
  }
  return date.toISOString();
}

export function isExpired(rec: StoredToken, now = Date.now()): boolean {
  if (!rec.expiresAt) return false;
  const t = Date.parse(rec.expiresAt);
  return Number.isFinite(t) && t <= now;
}

export function createToken(nameOrInput: string | TokenCreateInput, scopes?: TokenScope[]): CreatedToken {
  const input: TokenCreateInput =
    typeof nameOrInput === "string" ? { name: nameOrInput, scopes } : nameOrInput;
  const token = TOKEN_PREFIX + crypto.randomBytes(32).toString("base64url");
  const expiresAt = resolveExpiry(input.expiresAt);
  const record: StoredToken = {
    id: crypto.randomUUID(),
    name: input.name,
    hash: hashToken(token),
    prefix: token.slice(0, 10),
    scopes: input.scopes && input.scopes.length ? input.scopes : [...READONLY_SCOPES],
    botAllowlist: (input.botAllowlist ?? []).map((s) => s.trim()).filter(Boolean),
    expiresAt,
    sendPerMinute: input.sendPerMinute ?? null,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    revokedAt: null
  };
  const file = loadTokenFile();
  file.tokens.push(record);
  saveTokenFile(file);
  return { ...record, token };
}

export function listTokens(): StoredToken[] {
  return loadTokenFile().tokens;
}

export function revokeToken(idOrPrefix: string): StoredToken {
  const file = loadTokenFile();
  const rec = file.tokens.find(
    (t) => t.id === idOrPrefix || t.prefix === idOrPrefix || t.name === idOrPrefix
  );
  if (!rec) throw new Error(`No token matching "${idOrPrefix}"`);
  if (rec.revokedAt) throw new Error(`Token ${rec.id} is already revoked`);
  rec.revokedAt = new Date().toISOString();
  saveTokenFile(file);
  return rec;
}

export function verifyToken(presented: string | null | undefined, now = Date.now()): StoredToken | null {
  if (!presented) return null;
  const hash = hashToken(presented);
  const file = loadTokenFile();
  let matched: StoredToken | undefined;
  for (const rec of file.tokens) {
    if (hashesMatch(rec.hash, hash)) matched = rec;
  }
  if (!matched) return null;
  if (matched.revokedAt) return null;
  if (isExpired(matched, now)) return null;
  matched.lastUsedAt = new Date().toISOString();
  saveTokenFile(file);
  return matched;
}

export function actorFromToken(rec: StoredToken): Actor {
  return {
    kind: "token",
    id: rec.id,
    scopes: rec.scopes,
    botAllowlist: rec.botAllowlist,
    sendPerMinute: rec.sendPerMinute ?? undefined
  };
}

export function localActor(kind: Actor["kind"] = "local-cli"): Actor {
  return { kind, id: "local", scopes: [...ALL_SCOPES] };
}

export function hasScope(actor: Actor, scope: TokenScope): boolean {
  return actor.scopes.includes(scope);
}

export function assertScope(actor: Actor, scope: TokenScope): void {
  if (!hasScope(actor, scope)) {
    throw new Error(`Token ${actor.id} is missing scope ${scope}`);
  }
}

export function assertBotAllowed(actor: Actor, botId: string, botName: string): void {
  const list = actor.botAllowlist;
  if (!list || list.length === 0) return;
  const ok = list.some(
    (entry) => entry === botId || entry.toLowerCase() === botName.toLowerCase()
  );
  if (!ok) {
    throw new Error(`Token ${actor.id} is not allowed to use bot "${botName}" (${botId})`);
  }
}

export function extractBearer(authorization: string | string[] | undefined): string | null {
  const raw = Array.isArray(authorization) ? authorization[0] : authorization;
  if (!raw) return null;
  if (raw.startsWith("Bearer ")) return raw.slice("Bearer ".length).trim();
  return raw.trim();
}
