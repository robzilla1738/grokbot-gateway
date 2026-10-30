import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function gatewayHome(): string {
  if (process.env.GROKBOT_GATEWAY_HOME) {
    return path.resolve(process.env.GROKBOT_GATEWAY_HOME);
  }
  return path.join(os.homedir(), ".config", "grokbot-gateway");
}

export function tokensPath(): string {
  return path.join(gatewayHome(), "tokens.json");
}

export function configPath(): string {
  return path.join(gatewayHome(), "config.json");
}

export function auditLogPath(): string {
  return path.join(gatewayHome(), "audit.log");
}

export function sshDir(): string {
  return path.join(gatewayHome(), "ssh");
}

export function grokBotSupportDir(): string {
  if (process.env.GROKBOT_SUPPORT_DIR) return path.resolve(process.env.GROKBOT_SUPPORT_DIR);
  return path.join(os.homedir(), "Library", "Application Support", "Grok Bot");
}

export function grokBotAppPath(): string {
  return process.env.GROKBOT_APP_PATH || "/Applications/Grok Bot.app";
}

export function cursorStateDbPath(): string {
  if (process.env.CURSOR_STATE_DB) return path.resolve(process.env.CURSOR_STATE_DB);
  return path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "Cursor",
    "User",
    "globalStorage",
    "state.vscdb"
  );
}

export function grokBotDotSettingsPath(): string {
  if (process.env.GROKBOT_SETTINGS_PATH) return path.resolve(process.env.GROKBOT_SETTINGS_PATH);
  return path.join(os.homedir(), ".grokbot", "settings.json");
}

export function notchAuthTokenPath(): string {
  if (process.env.GROKBOT_NOTCH_TOKEN_FILE) return path.resolve(process.env.GROKBOT_NOTCH_TOKEN_FILE);
  return path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "GrokBot Notch",
    "launch-auth-token"
  );
}

export function notchLogDir(): string {
  return path.join(os.homedir(), "Library", "Logs", "grokbot-notch");
}

export function ensureDir(dir: string, mode = 0o700): void {
  fs.mkdirSync(dir, { recursive: true, mode });
  try {
    fs.chmodSync(dir, mode);
  } catch {
    // best-effort on filesystems that ignore chmod
  }
}

export function ensureGatewayHome(): string {
  const home = gatewayHome();
  ensureDir(home, 0o700);
  return home;
}
