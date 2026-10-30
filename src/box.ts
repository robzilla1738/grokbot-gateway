import { spawn } from "node:child_process";
import { loadConfig } from "./config.js";
import { redact } from "./redact.js";

export const BOX_READ_DEFAULT_BYTES = 262_144;
export const BOX_READ_MAX_BYTES = 1_048_576;
export const BOX_LIST_MAX_ENTRIES = 1_000;
const SSH_TIMEOUT_MS = 30_000;

export type BoxEntry = {
  name: string;
  type: "file" | "dir" | "link" | "other";
  size: number;
  modifiedAt: string | null;
};

export type BoxListing = { host: string; path: string; entries: BoxEntry[]; truncated: boolean };

export type BoxFile = {
  host: string;
  path: string;
  size: number;
  truncated: boolean;
  binary: boolean;
  text: string | null;
};

export type SshResult = { code: number | null; stdout: Buffer; stderr: string; timedOut: boolean };

export type SshRunner = (target: string, remoteCommand: string, stdin: string) => Promise<SshResult>;

export class BoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoxError";
  }
}

// The remote command is a constant; the requested path arrives on stdin so it
// never passes through a remote shell parser.
const EXPAND_PATH = 'IFS= read -r p; case "$p" in "~") p=$HOME;; "~/"*) p=$HOME/${p#"~/"};; esac';

const LIST_SCRIPT = `${EXPAND_PATH}; cd -- "$p" 2>/dev/null || { echo "not a directory: $p" >&2; exit 2; }; pwd; find . -mindepth 1 -maxdepth 1 -printf "%y\\t%s\\t%T@\\t%f\\0"`;

const READ_SCRIPT = `${EXPAND_PATH}; read -r max; [ -f "$p" ] || { echo "not a regular file: $p" >&2; exit 2; }; a=$(readlink -f -- "$p"); s=$(stat -L -c %s -- "$p") || exit 2; printf "%s\\0%s\\0" "$a" "$s"; head -c "$max" -- "$p"`;

function remote(script: string): string {
  return `sh -c '${script}'`;
}

export function boxTarget(): { target: string; host: string } {
  const cfg = loadConfig();
  return { target: `${cfg.boxUser}@${cfg.boxHost}`, host: cfg.boxHost };
}

export const runSsh: SshRunner = (target, remoteCommand, stdin) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      "ssh",
      ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", "-o", "StrictHostKeyChecking=accept-new", "-T", target, remoteCommand],
      { stdio: ["pipe", "pipe", "pipe"] }
    );
    const out: Buffer[] = [];
    let outBytes = 0;
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, SSH_TIMEOUT_MS);
    child.stdout.on("data", (chunk: Buffer) => {
      outBytes += chunk.length;
      if (outBytes <= BOX_READ_MAX_BYTES + 65_536) out.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 8_192) stderr += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(out), stderr, timedOut });
    });
    child.stdin.end(stdin);
  });

function sshFailure(host: string, res: SshResult): BoxError {
  const check = /https:\/\/login\.tailscale\.com\/\S+/.exec(res.stderr);
  if (check) {
    return new BoxError(
      `Tailscale SSH needs a browser check before it will connect to ${host}. Ask the owner to open ${check[0]} and approve it, then retry.`
    );
  }
  if (res.timedOut) {
    return new BoxError(`SSH to ${host} timed out after ${SSH_TIMEOUT_MS / 1000}s. Run grokbot doctor and see docs/box.md.`);
  }
  if (res.code === 2) {
    return new BoxError(redact(res.stderr.trim().split("\n").pop() || "remote command failed"));
  }
  const last = redact(res.stderr.trim().split("\n").pop() || `ssh exited ${res.code}`);
  return new BoxError(`Cannot reach ${host} over SSH: ${last}. Run grokbot doctor and see docs/box.md.`);
}

function cleanPath(raw: string): string {
  const p = raw.trim();
  if (!p || p.length > 4_096 || /[\0\n\r]/.test(p)) throw new BoxError("Path must be 1-4096 characters with no newlines or null bytes");
  return p;
}

const TYPE_MAP: Record<string, BoxEntry["type"]> = { f: "file", d: "dir", l: "link" };

export function parseListing(host: string, stdout: Buffer): BoxListing {
  const text = stdout.toString("utf8");
  const nl = text.indexOf("\n");
  const path = nl === -1 ? text : text.slice(0, nl);
  const records = (nl === -1 ? "" : text.slice(nl + 1)).split("\0").filter(Boolean);
  const entries = records.map((rec): BoxEntry => {
    const [type = "", size = "0", mtime = "", ...nameParts] = rec.split("\t");
    const seconds = Number(mtime);
    return {
      name: nameParts.join("\t"),
      type: TYPE_MAP[type] ?? "other",
      size: Number(size) || 0,
      modifiedAt: Number.isFinite(seconds) && mtime ? new Date(seconds * 1000).toISOString() : null
    };
  });
  entries.sort((a, b) => (a.type === "dir") !== (b.type === "dir") ? (a.type === "dir" ? -1 : 1) : a.name.localeCompare(b.name));
  return {
    host,
    path,
    entries: entries.slice(0, BOX_LIST_MAX_ENTRIES),
    truncated: entries.length > BOX_LIST_MAX_ENTRIES
  };
}

export function parseFile(host: string, stdout: Buffer, maxBytes: number): BoxFile {
  const first = stdout.indexOf(0);
  const second = first === -1 ? -1 : stdout.indexOf(0, first + 1);
  if (second === -1) throw new BoxError("Unexpected response from the box while reading the file");
  const path = stdout.subarray(0, first).toString("utf8");
  const size = Number(stdout.subarray(first + 1, second).toString("utf8")) || 0;
  const body = stdout.subarray(second + 1, second + 1 + maxBytes);
  const binary = body.subarray(0, 8_192).includes(0);
  return {
    host,
    path,
    size,
    truncated: size > body.length,
    binary,
    text: binary ? null : body.toString("utf8")
  };
}

export async function boxList(rawPath = "~", run: SshRunner = runSsh): Promise<BoxListing> {
  const path = cleanPath(rawPath);
  const { target, host } = boxTarget();
  const res = await run(target, remote(LIST_SCRIPT), `${path}\n`);
  if (res.code !== 0 || res.timedOut) throw sshFailure(host, res);
  return parseListing(host, res.stdout);
}

export async function boxReadFile(
  rawPath: string,
  maxBytes = BOX_READ_DEFAULT_BYTES,
  run: SshRunner = runSsh
): Promise<BoxFile> {
  const path = cleanPath(rawPath);
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > BOX_READ_MAX_BYTES) {
    throw new BoxError(`maxBytes must be an integer from 1 to ${BOX_READ_MAX_BYTES}`);
  }
  const { target, host } = boxTarget();
  const res = await run(target, remote(READ_SCRIPT), `${path}\n${maxBytes}\n`);
  if (res.code !== 0 || res.timedOut) throw sshFailure(host, res);
  return parseFile(host, res.stdout, maxBytes);
}
