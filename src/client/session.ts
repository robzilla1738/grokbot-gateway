import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import { cursorStateDbPath, grokBotDotSettingsPath, grokBotSupportDir } from "../paths.js";
import { sha256Hex } from "./persistence.js";

export type AuthContext = {
  accountScope: string;
  accessToken: string | null;
  machineId: string;
  teamId: number | null;
  teamName: string;
  cachedEmail: string;
  userName: string;
  source: string;
};

function parseJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function getSafeStorageKey(): Buffer | null {
  if (process.platform !== "darwin") return null;
  try {
    const pw = execFileSync("/usr/bin/security", ["find-generic-password", "-w", "-s", "Grok Bot Safe Storage"], {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
    return crypto.pbkdf2Sync(pw, "saltysalt", 1003, 16, "sha1");
  } catch {
    return null;
  }
}

export function decryptSafeStorageValue(storedValue: string, key = getSafeStorageKey()): string | null {
  if (!storedValue) return null;
  if (storedValue.startsWith("plaintext:v1:")) {
    return Buffer.from(storedValue.slice("plaintext:v1:".length), "base64").toString("utf8");
  }
  let base64Ciphertext = storedValue;
  if (storedValue.startsWith("scoped:v1:")) {
    const idx = storedValue.indexOf(":", "scoped:v1:".length);
    if (idx < 0) return null;
    base64Ciphertext = storedValue.slice(idx + 1);
  }
  try {
    const raw = Buffer.from(base64Ciphertext, "base64");
    if (raw.length <= 3 || raw.subarray(0, 3).toString("latin1") !== "v10") return null;
    if (!key) return null;
    const iv = Buffer.alloc(16, 32);
    const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
    const decrypted = Buffer.concat([decipher.update(raw.subarray(3)), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return null;
  }
}

function readActiveScopeFromDisk(): string | null {
  const secretsFile = `${grokBotSupportDir()}/sand-secrets.json`;
  if (fs.existsSync(secretsFile)) {
    try {
      const secrets = JSON.parse(fs.readFileSync(secretsFile, "utf8")) as Record<string, string>;
      if (secrets["cursor-accounts"]) {
        const parsed = JSON.parse(secrets["cursor-accounts"]) as { active?: string };
        if (typeof parsed.active === "string" && parsed.active.length > 0) return parsed.active;
      }
    } catch {
      // ignore
    }
  }
  const settingsPath = grokBotDotSettingsPath();
  if (fs.existsSync(settingsPath)) {
    try {
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")) as {
        activeAccountScope?: string;
      };
      if (typeof settings.activeAccountScope === "string" && settings.activeAccountScope.length > 0) {
        return settings.activeAccountScope;
      }
    } catch {
      // ignore
    }
  }
  return null;
}

export async function readAuthContext(desiredScope?: string | null): Promise<AuthContext> {
  const scopeHint = desiredScope || readActiveScopeFromDisk();
  let accessToken = process.env.CURSOR_ACCESS_TOKEN || process.env.GROKBOT_ACCESS_TOKEN || null;
  let machineId = process.env.CURSOR_MACHINE_ID || process.env.GROKBOT_MACHINE_ID || null;
  let cachedEmail = "";
  let teamId = process.env.GROKBOT_TEAM_ID ? Number(process.env.GROKBOT_TEAM_ID) : null;
  let teamName = "";
  let userName = os.userInfo().username || "User";
  let matchedScope: string | null = null;
  let source = "env";

  const dbPath = cursorStateDbPath();
  if (!accessToken && fs.existsSync(dbPath)) {
    try {
      const { DatabaseSync } = await import("node:sqlite");
      const db = new DatabaseSync(dbPath, { open: true, readOnly: true });
      try {
        const getVal = (key: string): string | null => {
          const row = db.prepare("SELECT value FROM ItemTable WHERE key = ?").get(key) as
            | { value?: unknown }
            | undefined;
          return row?.value != null ? String(row.value) : null;
        };
        const vscToken = getVal("cursorAuth/accessToken");
        const vscMachineId = getVal("storage.serviceMachineId");
        if (vscMachineId && !machineId) machineId = vscMachineId;
        if (vscToken) {
          const jwt = parseJwtPayload(vscToken);
          const vscScope = typeof jwt?.sub === "string" ? sha256Hex(jwt.sub) : null;
          if (!scopeHint || vscScope === scopeHint) {
            accessToken = vscToken;
            matchedScope = vscScope;
            cachedEmail = getVal("cursorAuth/cachedEmail") || "";
            source = "cursor-state";
            try {
              const teamObj = JSON.parse(getVal("cursorAuth/cachedTeam") || "{}") as {
                teamId?: number;
                name?: string;
              };
              if (teamObj.teamId && teamId == null) teamId = Number(teamObj.teamId);
              if (teamObj.name) teamName = teamObj.name;
            } catch {
              // ignore
            }
            try {
              const profile = JSON.parse(getVal("cursorAuth/cachedScopedProfile") || "{}") as { name?: string };
              if (profile.name) userName = profile.name.split(/\s+/)[0] || userName;
            } catch {
              // ignore
            }
          }
        }
      } finally {
        db.close();
      }
    } catch {
      // ignore sqlite errors (wrong platform, locked, etc.)
    }
  }

  const secretsFile = `${grokBotSupportDir()}/sand-secrets.json`;
  if (!accessToken && fs.existsSync(secretsFile)) {
    try {
      const secrets = JSON.parse(fs.readFileSync(secretsFile, "utf8")) as Record<string, string>;
      if (secrets["cursor-machine-id"] && !machineId) {
        machineId = decryptSafeStorageValue(secrets["cursor-machine-id"]) || machineId;
      }
      const accountsObj = JSON.parse(secrets["cursor-accounts"] || "{}") as {
        active?: string;
        accounts?: Record<string, Record<string, string>>;
      };
      const scopeKey = scopeHint || accountsObj.active || Object.keys(accountsObj.accounts || {})[0];
      const acc = scopeKey ? accountsObj.accounts?.[scopeKey] : null;
      if (acc?.["cursor-access-token"]) {
        accessToken = decryptSafeStorageValue(acc["cursor-access-token"]);
        matchedScope = scopeKey ?? null;
        source = "sand-secrets";
      }
      if (acc?.["cursor-account-profile"]) {
        const profRaw = decryptSafeStorageValue(acc["cursor-account-profile"]);
        if (profRaw) {
          try {
            const prof = JSON.parse(profRaw) as { email?: string; name?: string };
            if (prof.email) cachedEmail = prof.email;
            if (prof.name) userName = prof.name.split(/\s+/)[0] || userName;
          } catch {
            // ignore
          }
        }
      }
      if (teamId == null && acc?.["cursor-selected-team-id"]) {
        const decTeam = decryptSafeStorageValue(acc["cursor-selected-team-id"]);
        if (decTeam && Number.isSafeInteger(Number(decTeam)) && Number(decTeam) > 0) {
          teamId = Number(decTeam);
        }
      }
    } catch {
      // ignore
    }
  }

  return {
    accountScope: matchedScope || scopeHint || "default",
    accessToken,
    machineId: machineId || crypto.randomUUID(),
    teamId: Number.isSafeInteger(teamId) && teamId && teamId > 0 ? teamId : null,
    teamName,
    cachedEmail,
    userName,
    source: accessToken ? source : "none"
  };
}

export function sessionPresent(): boolean {
  if (process.env.CURSOR_ACCESS_TOKEN || process.env.GROKBOT_ACCESS_TOKEN) return true;
  if (fs.existsSync(cursorStateDbPath())) return true;
  if (fs.existsSync(`${grokBotSupportDir()}/sand-secrets.json`)) return true;
  return false;
}
