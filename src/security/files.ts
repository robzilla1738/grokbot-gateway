import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "../paths.js";

export function writeSecureFile(file: string, data: string): void {
  ensureDir(path.dirname(file), 0o700);
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, data, { mode: 0o600, encoding: "utf8" });
  fs.renameSync(tmp, file);
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // best-effort
  }
}

export function fileModeBits(file: string): number | null {
  try {
    return fs.statSync(file).mode & 0o777;
  } catch {
    return null;
  }
}

export function isGroupOrWorldReadable(file: string): boolean {
  const mode = fileModeBits(file);
  if (mode == null) return false;
  return (mode & 0o077) !== 0;
}
