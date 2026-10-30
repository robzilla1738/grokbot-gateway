import fs from "node:fs";
import readline from "node:readline/promises";
import { loadConfig, saveConfig, TRANSPORT_NAMES } from "../config.js";
import { runDoctor } from "../doctor.js";
import { grokBotAppPath, notchAuthTokenPath, ensureGatewayHome } from "../paths.js";
import { sessionPresent } from "../client/session.js";
import { tailscaleIPv4 } from "../security/bind.js";
import type { GatewayConfig, TransportName } from "../types.js";
import { claudeAndCursorJson, codexToml, formatMcpCopyPaste } from "./mcp-snippets.js";

export type InitResult = {
  ok: true;
  home: string;
  config: GatewayConfig;
  detected: {
    grokBotApp: boolean;
    session: boolean;
    notch: boolean;
    tailscaleIp: string | null;
  };
  mcp: { claudeCursor: string; codex: string };
  doctor: Awaited<ReturnType<typeof runDoctor>>;
};

async function prompt(question: string, fallback: string, interactive: boolean): Promise<string> {
  if (!interactive) return fallback;
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(`${question} [${fallback}]: `);
    return answer.trim() || fallback;
  } finally {
    rl.close();
  }
}

export async function runInit(opts: { yes?: boolean }): Promise<InitResult> {
  const home = ensureGatewayHome();
  const current = loadConfig();
  const interactive = Boolean(process.stdin.isTTY) && !opts.yes;
  const grokBotApp = fs.existsSync(grokBotAppPath());
  const session = sessionPresent();
  const notch = fs.existsSync(notchAuthTokenPath());
  const tailscaleIp = await tailscaleIPv4();

  let transport = current.transport;
  let boxHost = current.boxHost;
  if (interactive) {
    transport = (await prompt(
      "Transport (auto|standalone|notch|mock)",
      current.transport,
      true
    )) as TransportName;
    if (!TRANSPORT_NAMES.includes(transport)) {
      throw new Error(`Invalid transport "${transport}". Use one of: ${TRANSPORT_NAMES.join(", ")}.`);
    }
    boxHost = await prompt("Box hostname (Tailscale MagicDNS)", current.boxHost, true);
  }

  const next: GatewayConfig = {
    ...current,
    transport,
    boxHost
  };
  saveConfig(next);

  const doctor = await runDoctor();
  return {
    ok: true,
    home,
    config: next,
    detected: { grokBotApp, session, notch, tailscaleIp },
    mcp: {
      claudeCursor: claudeAndCursorJson(),
      codex: codexToml()
    },
    doctor
  };
}

export function formatInitHuman(result: InitResult): string[] {
  const d = result.detected;
  const lines = [
    `gateway home  ${result.home}`,
    `transport     ${result.config.transport}`,
    `box           ${result.config.boxHost}`,
    "",
    "Detected:",
    `  Grok Bot.app     ${d.grokBotApp ? "yes" : "no"}`,
    `  session files    ${d.session ? "yes" : "no"}`,
    `  Notch token      ${d.notch ? "yes" : "no"}`,
    `  Tailscale IPv4   ${d.tailscaleIp ?? "no"}`,
    "",
    ...formatMcpCopyPaste(),
    "",
    "Doctor:"
  ];
  for (const c of result.doctor.checks) {
    lines.push(`  ${c.ok ? "ok  " : "FAIL"}  ${c.id.padEnd(14)} ${c.detail}`);
    if (!c.ok && c.fix) lines.push(`        fix: ${c.fix}`);
  }
  return lines;
}
