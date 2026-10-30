import fs from "node:fs";
import { Command } from "commander";
import { GrokBotClient } from "../client/index.js";
import { writeDefaultConfig } from "../config.js";
import { gatewayStatus, runDoctor } from "../doctor.js";
import { formatEntries } from "../gateway.js";
import { startHttpMcp } from "../mcp/http.js";
import { startStdioMcp } from "../mcp/server.js";
import { startMockBridge } from "../mock-bridge.js";
import { ensureGatewayHome } from "../paths.js";
import { audit } from "../security/audit.js";
import { assertAllowedAction } from "../security/guard.js";
import { createToken, listTokens, localActor, parseExpiry, parseScopes, revokeToken } from "../security/tokens.js";
import { PRODUCT_NAME, VERSION } from "../version.js";
import { formatInitHuman, runInit } from "./init.js";
import { CliError, fail, printHuman, printJson } from "./output.js";

function jsonFlag(cmd: Command): boolean {
  let current: Command | null = cmd;
  while (current) {
    if ((current.opts() as { json?: boolean }).json) return true;
    current = current.parent;
  }
  return false;
}

function readMessage(raw: string[], file?: string): string {
  if (file) {
    if (file === "-") return fs.readFileSync(0, "utf8");
    return fs.readFileSync(file, "utf8");
  }
  return raw.join(" ").trim();
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name("grokbot")
    .description("Talk to Grok Bot from an outside coding agent. Never emails, buys, or deletes on its own.")
    .version(VERSION)
    .option("--json", "Machine-readable JSON on stdout", false)
    .addHelpText(
      "after",
      `
Examples:
  grokbot init --yes
  grokbot doctor
  grokbot bots --json
  grokbot ask Chief "What can you help with?" --json
  grokbot mcp
A gateway token or stdio MCP process can message your bots as you.`
    );

  program
    .command("bots")
    .alias("list")
    .description("List Grok Bots in the signed-in desktop session")
    .addHelpText("after", "\nExamples:\n  grokbot bots\n  grokbot bots --json")
    .action(async function (this: Command) {
      const json = jsonFlag(this);
      try {
        assertAllowedAction("list_bots");
        const client = new GrokBotClient();
        const listed = await client.listBots();
        audit(localActor(), "list_bots", { ok: true, extra: { count: listed.bots.length } });
        const payload = {
          ok: true,
          liveConnected: listed.liveConnected,
          bots: listed.bots.map((b) => ({
            id: b.id,
            name: b.name,
            title: b.title,
            unreadCount: b.unreadCount ?? 0,
            lastPreview: b.lastPreview
          }))
        };
        if (json) printJson(payload);
        else {
          if (listed.bots.length === 0) printHuman(["No bots found."]);
          else {
            printHuman(
              listed.bots.map((b) => {
                const unread = b.unreadCount ? `  unread:${b.unreadCount}` : "";
                const preview = b.lastPreview?.text ? `  — ${b.lastPreview.text}` : "";
                return `${b.name}\t${b.id}${unread}${preview}`;
              })
            );
          }
        }
      } catch (err) {
        fail(err, json);
      }
    });

  program
    .command("send")
    .description("Send a message to a bot without waiting for a reply")
    .argument("<bot>", "Bot name or id")
    .argument("[message...]", "Message text")
    .option("-f, --file <path>", "Read message from a file, or - for stdin")
    .addHelpText("after", '\nExamples:\n  grokbot send Chief "Check the box disk"\n  grokbot send Chief -f ./note.txt --json')
    .action(async function (this: Command, bot: string, message: string[]) {
      const json = jsonFlag(this);
      try {
        assertAllowedAction("send_to_bot");
        const text = readMessage(message, this.opts().file);
        if (!text) throw new Error("Message is empty");
        const client = new GrokBotClient();
        const sent = await client.send(bot, text);
        audit(localActor(), "send_to_bot", {
          ok: true,
          botId: sent.bot.id,
          botName: sent.bot.name,
          messageChars: text.length
        });
        const payload = { ok: true, bot: { id: sent.bot.id, name: sent.bot.name }, messageId: sent.messageId };
        if (json) printJson(payload);
        else printHuman([`sent ${sent.messageId} → ${sent.bot.name}`]);
      } catch (err) {
        fail(err, json);
      }
    });

  program
    .command("ask")
    .description("Send a message and wait for the bot's reply")
    .argument("<bot>", "Bot name or id")
    .argument("[message...]", "Message text")
    .option("-f, --file <path>", "Read message from a file, or - for stdin")
    .option("-t, --timeout <seconds>", "Seconds to wait", "120")
    .addHelpText("after", '\nExamples:\n  grokbot ask Chief "Summarize today" --json\n  grokbot ask Ops --timeout 180 "df -h"')
    .action(async function (this: Command, bot: string, message: string[]) {
      const json = jsonFlag(this);
      try {
        assertAllowedAction("ask_bot");
        const text = readMessage(message, this.opts().file);
        if (!text) throw new Error("Message is empty");
        const timeoutMs = Number(this.opts().timeout) * 1000;
        const client = new GrokBotClient();
        let lastLen = 0;
        const result = await client.ask(bot, text, {
          timeoutMs,
          onUpdate: (entries) => {
            if (json) return;
            const joined = entries.map((e) => e.text).join("\n");
            if (joined.length > lastLen) {
              process.stdout.write(joined.slice(lastLen));
              lastLen = joined.length;
            }
          }
        });
        audit(localActor(), "ask_bot", {
          ok: true,
          botId: result.bot.id,
          botName: result.bot.name,
          messageChars: text.length
        });
        if (json) {
          printJson({
            ok: true,
            bot: { id: result.bot.id, name: result.bot.name },
            messageId: result.messageId,
            replies: result.replies
          });
        } else if (lastLen === 0) {
          printHuman(result.replies.map((e) => e.text));
        } else {
          process.stdout.write("\n");
        }
      } catch (err) {
        fail(err, json);
      }
    });

  program
    .command("read")
    .description("Read recent chat history for a bot")
    .argument("<bot>", "Bot name or id")
    .option("-n, --limit <n>", "Max entries", "20")
    .option("--since <id>", "Only entries after this message id")
    .addHelpText("after", "\nExamples:\n  grokbot read Chief --limit 20 --json")
    .action(async function (this: Command, bot: string) {
      const json = jsonFlag(this);
      try {
        assertAllowedAction("read_chat");
        const client = new GrokBotClient();
        const result = await client.read(bot, {
          limit: Number(this.opts().limit),
          since: this.opts().since
        });
        audit(localActor(), "read_chat", { ok: true, botId: result.bot.id, botName: result.bot.name });
        if (json) printJson({ ok: true, bot: { id: result.bot.id, name: result.bot.name }, entries: result.entries });
        else printHuman([`${result.bot.name} (${result.bot.id})`, "", formatEntries(result.entries)]);
      } catch (err) {
        fail(err, json);
      }
    });

  program
    .command("tail")
    .description("Follow a bot's chat until interrupted")
    .argument("<bot>", "Bot name or id")
    .option("-i, --interval <seconds>", "Poll interval", "2")
    .addHelpText("after", "\nExamples:\n  grokbot tail Ops\n  grokbot tail Ops --json")
    .action(async function (this: Command, bot: string) {
      const json = jsonFlag(this);
      try {
        assertAllowedAction("tail_chat");
        const client = new GrokBotClient();
        const first = await client.read(bot, { limit: 50 });
        const seen = new Set(first.entries.map((e) => e.id));
        audit(localActor(), "tail_chat", { ok: true, botId: first.bot.id, botName: first.bot.name });
        if (!json) printHuman([`tailing ${first.bot.name} — Ctrl-C to stop`, formatEntries(first.entries.slice(-5))]);
        else {
          for (const e of first.entries.slice(-5)) printJson({ type: "entry", bot: first.bot.name, ...e });
        }
        const intervalMs = Number(this.opts().interval) * 1000;
        const timer = setInterval(async () => {
          try {
            const next = await client.read(bot, { limit: 50 });
            const fresh = next.entries.filter((e) => !seen.has(e.id));
            for (const e of fresh) {
              seen.add(e.id);
              if (json) printJson({ type: "entry", bot: next.bot.name, ...e });
              else printHuman(["", `[${e.role}] ${e.text}`]);
            }
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            if (json) printJson({ type: "error", error: message });
            else process.stderr.write(`tail error: ${message}\n`);
          }
        }, intervalMs);
        await new Promise<void>((resolve) => {
          const stop = () => {
            clearInterval(timer);
            resolve();
          };
          process.on("SIGINT", stop);
          process.on("SIGTERM", stop);
        });
      } catch (err) {
        fail(err, json);
      }
    });

  program
    .command("status")
    .description("Show gateway transport, session, and box host")
    .addHelpText("after", "\nExamples:\n  grokbot status --json")
    .action(async function (this: Command) {
      const json = jsonFlag(this);
      try {
        assertAllowedAction("status");
        const status = await gatewayStatus();
        audit(localActor(), "status", { ok: status.ok });
        if (json) printJson(status);
        else {
          printHuman([
            `${PRODUCT_NAME} ${status.version}`,
            `transport  ${status.transport}  live=${status.liveConnected}  bots=${status.botCount}`,
            `box        ${status.boxHost}`,
            ...status.notes.map((n) => `note       ${n}`)
          ]);
        }
        if (!status.ok) process.exitCode = 1;
      } catch (err) {
        fail(err, json);
      }
    });

  program
    .command("doctor")
    .description("Check Node, session files, bind policy, Tailscale, and grokbot-box")
    .addHelpText("after", "\nExamples:\n  grokbot doctor\n  grokbot doctor --json\nFailed checks print a fix line.")
    .action(async function (this: Command) {
      const json = jsonFlag(this);
      try {
        assertAllowedAction("doctor");
        const result = await runDoctor();
        audit(localActor(), "doctor", { ok: result.ok });
        if (json) printJson(result);
        else {
          const lines: string[] = [];
          for (const c of result.checks) {
            lines.push(`${c.ok ? "ok  " : "FAIL"}  ${c.id.padEnd(14)} ${c.detail}`);
            if (!c.ok && c.fix) lines.push(`      fix: ${c.fix}`);
          }
          printHuman(lines);
        }
        if (!result.ok) process.exitCode = 1;
      } catch (err) {
        fail(err, json);
      }
    });

  const token = program
    .command("token")
    .description("Per-agent gateway tokens (HTTP MCP)")
    .addHelpText(
      "after",
      `
Examples:
  grokbot token create --name cursor-agent
  grokbot token list --json
  grokbot token revoke cursor-agent`
    );

  token
    .command("create")
    .description("Mint a token. The secret is printed once. Default scope is read-only.")
    .requiredOption("--name <name>", "Agent name, e.g. claude-code")
    .option("--scope <scopes>", "readonly (default), *, or comma list", "readonly")
    .option(
      "--bot <name>",
      "Allow only this bot name/id (repeatable)",
      (val: string, acc: string[]) => {
        acc.push(val);
        return acc;
      },
      [] as string[]
    )
    .option("--expires <when>", "30d (default), 12h, ISO date, or never", "30d")
    .addHelpText(
      "after",
      `
Examples:
  grokbot token create --name cursor-agent
  grokbot token create --name sender --scope bots:list,bots:read,bots:send,status --bot Chief --expires 7d
A token lets that agent message your bots as you. Prefer read-only unless it must send.`
    )
    .action(async function (this: Command) {
      const json = jsonFlag(this);
      try {
        assertAllowedAction("token_create");
        const rec = createToken({
          name: this.opts().name,
          scopes: parseScopes(this.opts().scope),
          botAllowlist: this.opts().bot as string[],
          expiresAt: parseExpiry(this.opts().expires)
        });
        audit(localActor(), "token_create", { ok: true, extra: { tokenId: rec.id, name: rec.name } });
        const payload = {
          ok: true,
          id: rec.id,
          name: rec.name,
          prefix: rec.prefix,
          scopes: rec.scopes,
          botAllowlist: rec.botAllowlist,
          expiresAt: rec.expiresAt,
          token: rec.token,
          warning: "Store this secret in the agent. It is not shown again. A send-capable token acts as you."
        };
        if (json) printJson(payload);
        else {
          printHuman([
            `id       ${rec.id}`,
            `name     ${rec.name}`,
            `scope    ${rec.scopes.join(",")}`,
            `bots     ${rec.botAllowlist.length ? rec.botAllowlist.join(",") : "(all)"}`,
            `expires  ${rec.expiresAt ?? "never"}`,
            `token    ${rec.token}`,
            "Store this secret now. It is not shown again."
          ]);
        }
      } catch (err) {
        fail(err, json);
      }
    });

  token
    .command("list")
    .description("List tokens (hashes only, never secrets)")
    .addHelpText("after", "\nExamples:\n  grokbot token list\n  grokbot token list --json")
    .action(async function (this: Command) {
      const json = jsonFlag(this);
      try {
        assertAllowedAction("token_list");
        const tokens = listTokens().map((t) => ({
          id: t.id,
          name: t.name,
          prefix: t.prefix,
          scopes: t.scopes,
          botAllowlist: t.botAllowlist,
          expiresAt: t.expiresAt,
          createdAt: t.createdAt,
          lastUsedAt: t.lastUsedAt,
          revokedAt: t.revokedAt
        }));
        audit(localActor(), "token_list", { ok: true, extra: { count: tokens.length } });
        if (json) printJson({ ok: true, tokens });
        else {
          if (tokens.length === 0) printHuman(["No tokens."]);
          else {
            printHuman(
              tokens.map((t) => {
                const state = t.revokedAt ? "revoked" : "active";
                return `${t.id}  ${t.name}  ${t.prefix}…  ${state}  ${t.scopes.join(",")}`;
              })
            );
          }
        }
      } catch (err) {
        fail(err, json);
      }
    });

  token
    .command("revoke")
    .description("Revoke a token by id, prefix, or name")
    .argument("<id>", "Token id, prefix, or name")
    .addHelpText("after", "\nExamples:\n  grokbot token revoke cursor-agent\n  grokbot token revoke gbgt_AbCd --json")
    .action(async function (this: Command, id: string) {
      const json = jsonFlag(this);
      try {
        assertAllowedAction("token_revoke");
        const rec = revokeToken(id);
        audit(localActor(), "token_revoke", { ok: true, extra: { tokenId: rec.id } });
        if (json) printJson({ ok: true, id: rec.id, revokedAt: rec.revokedAt });
        else printHuman([`revoked ${rec.id} (${rec.name})`]);
      } catch (err) {
        fail(err, json);
      }
    });

  program
    .command("mcp")
    .description("Run the MCP server (stdio by default)")
    .option("--http", "Streamable HTTP instead of stdio")
    .option("--port <n>", "HTTP port")
    .option("--bind <addr>", "127.0.0.1 (default) or tailscale. Never 0.0.0.0.")
    .option("--no-token", "HTTP without a bearer token (loopback only, for local experiments)")
    .addHelpText(
      "after",
      `
Examples:
  grokbot mcp
  grokbot mcp --http --bind 127.0.0.1 --port 14789
Never bind 0.0.0.0. HTTP on Tailscale requires a token.`
    )
    .action(async function (this: Command) {
      const json = jsonFlag(this);
      try {
        writeDefaultConfig();
        ensureGatewayHome();
        if (this.opts().http) {
          const bind = this.opts().bind;
          if (bind && (bind === "0.0.0.0" || bind === "::")) {
            throw new Error("Refusing to bind a public wildcard");
          }
          await startHttpMcp({
            bind,
            port: this.opts().port ? Number(this.opts().port) : undefined,
            requireToken: this.opts().token !== false
          });
        } else {
          await startStdioMcp();
        }
      } catch (err) {
        fail(err, json);
      }
    });

  program
    .command("mock")
    .description("Run a fake notch-compatible bridge for tests and demos")
    .option("--port <n>", "Port", "14790")
    .option("--bind <addr>", "Bind address", "127.0.0.1")
    .addHelpText(
      "after",
      `
Examples:
  grokbot mock --port 14790
Token comes from GROKBOT_MOCK_TOKEN (default mock-token). Do not pass secrets on argv.`
    )
    .action(async function (this: Command) {
      const json = jsonFlag(this);
      try {
        const bind = this.opts().bind as string;
        if (bind === "0.0.0.0" || bind === "::") throw new Error("Refusing to bind a public wildcard");
        const token = process.env.GROKBOT_MOCK_TOKEN || "mock-token";
        const bridge = await startMockBridge({
          host: bind,
          port: Number(this.opts().port),
          token
        });
        const info = {
          ok: true,
          url: bridge.url,
          token: bridge.token,
          env: {
            GROKBOT_TRANSPORT: "notch",
            GROKBOT_NOTCH_URL: bridge.url,
            GROKBOT_NOTCH_AUTH_TOKEN: bridge.token
          }
        };
        if (json) printJson(info);
        else {
          printHuman([
            `mock bridge ${bridge.url}`,
            `token ${bridge.token}`,
            "export GROKBOT_TRANSPORT=notch",
            `export GROKBOT_NOTCH_URL=${bridge.url}`,
            `export GROKBOT_NOTCH_AUTH_TOKEN=${bridge.token}`
          ]);
        }
        await new Promise<void>((resolve) => {
          process.on("SIGINT", () => resolve());
          process.on("SIGTERM", () => resolve());
        });
        await bridge.close();
      } catch (err) {
        fail(err, json);
      }
    });

  program
    .command("init")
    .description("Detect session/Notch/Tailscale, write config, print MCP snippets")
    .option("-y, --yes", "Non-interactive (for scripts and npx)")
    .addHelpText(
      "after",
      `
Examples:
  grokbot init
  grokbot init --yes --json
  npx grokbot-gateway init --yes`
    )
    .action(async function (this: Command) {
      const json = jsonFlag(this);
      try {
        writeDefaultConfig();
        const result = await runInit({ yes: Boolean(this.opts().yes) || json });
        if (json) printJson(result);
        else printHuman(formatInitHuman(result));
      } catch (err) {
        fail(err, json);
      }
    });

  attachJsonOption(program);
  return program;
}

function attachJsonOption(command: Command): void {
  if (!command.options.some((o) => o.long === "--json")) {
    command.option("--json", "Machine-readable JSON on stdout");
  }
  for (const child of command.commands) attachJsonOption(child);
}

export async function runCli(argv = process.argv): Promise<void> {
  const program = buildProgram();
  try {
    await program.parseAsync(argv);
  } catch (err) {
    if (err instanceof CliError) process.exit(process.exitCode || 1);
    throw err;
  }
}
