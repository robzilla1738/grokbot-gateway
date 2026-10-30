import fs from "node:fs";
import { configPath, ensureGatewayHome } from "./paths.js";
import { writeSecureFile } from "./security/files.js";
import { DEFAULT_SEND_PER_MINUTE } from "./security/rate-limit.js";
import type { GatewayConfig, TransportName } from "./types.js";

export const DEFAULT_CONFIG: GatewayConfig = {
  transport: "auto",
  backendUrl: "https://api2.cursor.sh",
  notchUrl: "http://127.0.0.1:4789",
  bind: "127.0.0.1",
  httpPort: 14789,
  boxHost: "grokbot-box",
  clientVersion: "0.71.2",
  sendPerMinute: DEFAULT_SEND_PER_MINUTE
};

export function loadConfig(): GatewayConfig {
  const defaults = { ...DEFAULT_CONFIG };
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<GatewayConfig>;
    Object.assign(defaults, parsed);
  } catch {
    // missing config is fine
  }

  if (process.env.GROKBOT_TRANSPORT) {
    defaults.transport = process.env.GROKBOT_TRANSPORT as TransportName;
  }
  if (process.env.SAND_BACKEND_URL) defaults.backendUrl = process.env.SAND_BACKEND_URL;
  if (process.env.GROKBOT_NOTCH_URL) defaults.notchUrl = process.env.GROKBOT_NOTCH_URL;
  if (process.env.GROKBOT_BIND) defaults.bind = process.env.GROKBOT_BIND;
  if (process.env.GROKBOT_HTTP_PORT) defaults.httpPort = Number(process.env.GROKBOT_HTTP_PORT);
  if (process.env.GROKBOT_BOX_HOST) defaults.boxHost = process.env.GROKBOT_BOX_HOST;
  if (process.env.GROKBOT_CLIENT_VERSION) defaults.clientVersion = process.env.GROKBOT_CLIENT_VERSION;
  if (process.env.GROKBOT_MOCK === "1") defaults.transport = "mock";
  if (process.env.GROKBOT_SEND_PER_MINUTE) {
    defaults.sendPerMinute = Number(process.env.GROKBOT_SEND_PER_MINUTE) || defaults.sendPerMinute;
  }

  return defaults;
}

export function saveConfig(cfg: GatewayConfig): void {
  ensureGatewayHome();
  writeSecureFile(configPath(), JSON.stringify(cfg, null, 2) + "\n");
}

export function writeDefaultConfig(): GatewayConfig {
  ensureGatewayHome();
  const cfg = loadConfig();
  try {
    if (!fs.existsSync(configPath())) {
      saveConfig(DEFAULT_CONFIG);
    }
  } catch {
    // ignore
  }
  return cfg;
}
