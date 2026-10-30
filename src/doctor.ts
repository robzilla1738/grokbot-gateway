import fs from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { VERSION } from "./version.js";
import { loadConfig } from "./config.js";
import {
  auditLogPath,
  configPath,
  gatewayHome,
  grokBotAppPath,
  grokBotSupportDir,
  notchAuthTokenPath,
  tokensPath
} from "./paths.js";
import { selectTransportName } from "./client/index.js";
import { sessionPresent } from "./client/session.js";
import { fileModeBits, isGroupOrWorldReadable } from "./security/files.js";
import { isAllowedBindAddress, isPublicWildcard, tailscaleIPv4 } from "./security/bind.js";
import type { DoctorCheck, GatewayStatus } from "./types.js";

const execFileAsync = promisify(execFile);

async function which(cmd: string): Promise<boolean> {
  try {
    await execFileAsync("sh", ["-c", `command -v ${cmd}`], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

function permCheck(id: string, file: string, missingOk: boolean): DoctorCheck {
  if (!fs.existsSync(file)) {
    return {
      id,
      ok: true,
      detail: missingOk ? `${file} not created yet` : `missing ${file}`
    };
  }
  const mode = fileModeBits(file);
  const leaky = isGroupOrWorldReadable(file);
  return {
    id,
    ok: !leaky,
    detail: leaky ? `${file} mode ${mode?.toString(8)} is group/world readable` : `${file} mode ${mode?.toString(8)}`,
    fix: leaky ? `chmod 600 "${file}" && chmod 700 "$(dirname "${file}")"` : undefined
  };
}

async function boxReachable(host: string, hasTailscale: boolean): Promise<DoctorCheck> {
  const fix =
    "Join the same Tailscale tailnet as the box, then see docs/box.md. Override the hostname with GROKBOT_BOX_HOST if it is not grokbot-box.";
  try {
    const { stdout } = await execFileAsync("getent", ["hosts", host], { timeout: 2000 });
    if (stdout.trim()) {
      return { id: "box", ok: true, detail: `${host} resolves: ${stdout.trim().split(/\s+/)[0]}` };
    }
  } catch {
    // try tailscale next
  }
  if (!hasTailscale) {
    return {
      id: "box",
      ok: false,
      detail: `${host} is not in DNS and the tailscale CLI is missing.`,
      fix
    };
  }
  try {
    const { stdout } = await execFileAsync("tailscale", ["ping", "-c", "1", host], { timeout: 4000 });
    return { id: "box", ok: true, detail: stdout.trim().split("\n").pop() || `${host} ping ok` };
  } catch {
    return {
      id: "box",
      ok: false,
      detail: `${host} is not reachable from this machine.`,
      fix
    };
  }
}

export async function runDoctor(): Promise<{ ok: boolean; checks: DoctorCheck[] }> {
  const cfg = loadConfig();
  const checks: DoctorCheck[] = [];
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  const nodeMinor = Number(process.versions.node.split(".")[1]);
  const nodeOk = nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 5);
  checks.push({
    id: "node",
    ok: nodeOk,
    detail: `Node ${process.versions.node} (need >= 22.5 for node:sqlite)`,
    fix: nodeOk ? undefined : "Install Node.js 22.5+ from https://nodejs.org or `brew install node@22`."
  });

  const transport = selectTransportName(cfg.transport);
  checks.push({
    id: "transport",
    ok: true,
    detail: `transport=${transport} (config ${cfg.transport})`
  });

  const darwin = process.platform === "darwin";
  const platformOk = darwin || transport === "mock" || Boolean(process.env.GROKBOT_ACCESS_TOKEN);
  checks.push({
    id: "platform",
    ok: platformOk,
    detail: darwin
      ? "macOS: Desktop Grok Bot session discovery is supported"
      : "Not macOS. Live session discovery needs a Mac, or use GROKBOT_TRANSPORT=mock.",
    fix: platformOk
      ? undefined
      : "Run grokbot on the Mac where Desktop Grok Bot is signed in, or `export GROKBOT_TRANSPORT=mock` for tests."
  });

  if (darwin) {
    const appOk = fs.existsSync(grokBotAppPath());
    checks.push({
      id: "grokbot-app",
      ok: appOk,
      detail: appOk ? `found ${grokBotAppPath()}` : `Desktop Grok Bot not found at ${grokBotAppPath()}`,
      fix: appOk ? undefined : "Install Desktop Grok Bot into /Applications and sign in."
    });
    const sessOk = sessionPresent();
    checks.push({
      id: "session",
      ok: sessOk,
      detail: sessOk
        ? "Grok Bot / Cursor session files are present"
        : `No session at ${grokBotSupportDir()} or Cursor state db`,
      fix: sessOk ? undefined : "Open Desktop Grok Bot, sign in, send one chat, then rerun grokbot doctor."
    });
    checks.push({
      id: "notch-token",
      ok: true,
      detail: fs.existsSync(notchAuthTokenPath())
        ? `GrokBot Notch token file exists (optional fallback): ${notchAuthTokenPath()}`
        : "GrokBot Notch is not running (optional; standalone transport does not need it)",
      fix: "Only needed if GROKBOT_TRANSPORT=notch. Start GrokBot Notch from https://github.com/robzilla1738/grokbot-notch."
    });
  }

  const bindOk = isAllowedBindAddress(cfg.bind) && !isPublicWildcard(cfg.bind);
  checks.push({
    id: "bind",
    ok: bindOk,
    detail: bindOk ? `bind=${cfg.bind} port=${cfg.httpPort}` : `Unsafe bind ${cfg.bind}`,
    fix: bindOk ? undefined : "Set bind to 127.0.0.1 or tailscale in ~/.config/grokbot-gateway/config.json."
  });

  const home = gatewayHome();
  const homeExists = fs.existsSync(home);
  checks.push({
    id: "config-dir",
    ok: true,
    detail: homeExists ? `gateway home ${home}` : `gateway home ${home} will be created on first use`,
    fix: homeExists ? undefined : "Run `grokbot init --yes`."
  });

  checks.push(permCheck("tokens", tokensPath(), true));
  checks.push(permCheck("audit", auditLogPath(), true));
  checks.push(permCheck("config-file", configPath(), true));

  const tsOk = await which("tailscale");
  const tsIp = tsOk ? await tailscaleIPv4() : null;
  checks.push({
    id: "tailscale",
    ok: tsOk,
    detail: tsOk
      ? `tailscale present${tsIp ? ` ip=${tsIp}` : ""}`
      : "tailscale CLI not found (needed for box SSH and --bind tailscale)",
    fix: tsOk ? undefined : "Install Tailscale from https://tailscale.com/download and run `tailscale up`."
  });

  checks.push(await boxReachable(cfg.boxHost, tsOk));

  const ok = checks
    .filter((c) => c.id !== "box" && c.id !== "tailscale" && c.id !== "notch-token")
    .every((c) => c.ok);
  return { ok, checks };
}

export async function gatewayStatus(): Promise<GatewayStatus> {
  const cfg = loadConfig();
  const transport = selectTransportName(cfg.transport);
  const notes: string[] = [];
  let liveConnected = false;
  let botCount = 0;
  let user: GatewayStatus["user"];
  try {
    const { GrokBotClient } = await import("./client/index.js");
    const client = new GrokBotClient(undefined, transport);
    const listed = await client.listBots();
    liveConnected = listed.liveConnected;
    botCount = listed.bots.length;
    user = listed.user
      ? { name: listed.user.name, teamId: listed.user.teamId ?? null }
      : undefined;
  } catch (err) {
    notes.push(err instanceof Error ? err.message : String(err));
  }
  if (transport === "mock") notes.push("Using the mock transport. Not talking to a live Grok Bot session.");
  if (!liveConnected && transport !== "mock") notes.push("Backend list did not succeed; bots may be from local cache.");
  return {
    ok: notes.length === 0 || liveConnected || transport === "mock",
    version: VERSION,
    transport,
    liveConnected,
    botCount,
    user,
    bind: cfg.bind,
    boxHost: cfg.boxHost,
    notes
  };
}
