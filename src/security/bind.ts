import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export class BindError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BindError";
  }
}

export function isLoopback(host: string): boolean {
  const h = (host.toLowerCase().split("%")[0] ?? host).replace(/^\[|\]$/g, "");
  return h === "127.0.0.1" || h === "::1" || h === "localhost";
}

export function isPublicWildcard(host: string): boolean {
  return host === "0.0.0.0" || host === "::" || host === "*";
}

/** Tailscale CGNAT: 100.64.0.0/10 */
export function isTailscaleIPv4(host: string): boolean {
  const m = /^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  if ([a, b, c].some((n) => n > 255)) return false;
  return a >= 64 && a <= 127;
}

export function isAllowedBindAddress(host: string): boolean {
  if (isPublicWildcard(host)) return false;
  if (isLoopback(host)) return true;
  if (host === "tailscale" || host === "tailnet") return true;
  if (isTailscaleIPv4(host)) return true;
  return false;
}

export async function resolveBindAddress(requested: string): Promise<string> {
  const raw = requested.trim() || "127.0.0.1";
  if (isPublicWildcard(raw)) {
    throw new BindError("Refusing to bind 0.0.0.0 / ::. Use 127.0.0.1 or --bind tailscale.");
  }
  if (raw === "tailscale" || raw === "tailnet") {
    const ip = await tailscaleIPv4();
    if (!ip) {
      throw new BindError("Could not resolve a Tailscale IPv4 address. Is `tailscale` installed and up?");
    }
    return ip;
  }
  if (!isAllowedBindAddress(raw)) {
    throw new BindError(
      `Refusing to bind ${raw}. Allowed: 127.0.0.1, localhost, ::1, a Tailscale 100.x address, or --bind tailscale.`
    );
  }
  return raw;
}

export async function tailscaleIPv4(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("tailscale", ["ip", "-4"], { timeout: 4000 });
    const ip = stdout.trim().split(/\s+/)[0];
    return ip || null;
  } catch {
    return null;
  }
}

export function allowedHosts(bind: string, port: number, extra: string[] = []): Set<string> {
  const hosts = new Set<string>([
    `${bind}:${port}`,
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    `[::1]:${port}`,
    ...extra.map((h) => (h.includes(":") ? h : `${h}:${port}`))
  ]);
  return hosts;
}

export function allowedOrigins(bind: string, port: number): Set<string> {
  const origins = new Set<string>([
    `http://127.0.0.1:${port}`,
    `http://localhost:${port}`,
    `http://${bind}:${port}`
  ]);
  return origins;
}

export function validateHostAndOrigin(
  headers: { host?: string | string[]; origin?: string | string[] },
  bind: string,
  port: number,
  extraHosts: string[] = []
): { ok: true; origin: string | null } | { ok: false; status: number; error: string } {
  const host = String(headers.host ?? "").toLowerCase();
  const hosts = new Set([...allowedHosts(bind, port, extraHosts)].map((h) => h.toLowerCase()));
  if (!host || !hosts.has(host)) {
    return { ok: false, status: 403, error: "Invalid Host" };
  }
  const originHeader = headers.origin;
  const origin = Array.isArray(originHeader) ? originHeader[0] : originHeader;
  if (origin) {
    const origins = allowedOrigins(bind, port);
    if (!origins.has(origin)) {
      return { ok: false, status: 403, error: "Invalid Origin" };
    }
  }
  return { ok: true, origin: origin ?? null };
}

export function corsHeadersForOrigin(origin: string | null, bind: string, port: number): Record<string, string> {
  if (!origin) return {};
  if (!allowedOrigins(bind, port).has(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-GrokBot-Token, Mcp-Session-Id",
    Vary: "Origin"
  };
}
