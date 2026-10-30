/**
 * Cursor/Sand request checksum used by the Grok Bot desktop client.
 * Same scheme grokbot-notch sends as `x-cursor-checksum`.
 */
export function createCursorChecksum(machineId: string, nowMs = Date.now()): string {
  const t = Math.floor(nowMs / 1e6);
  const bytes = new Uint8Array([
    (t >> 40) & 255,
    (t >> 32) & 255,
    (t >> 24) & 255,
    (t >> 16) & 255,
    (t >> 8) & 255,
    t & 255
  ]);
  let prev = 165;
  for (let i = 0; i < bytes.length; i++) {
    const current = bytes[i] ?? 0;
    bytes[i] = ((current ^ prev) + (i % 256)) & 255;
    prev = bytes[i] ?? 0;
  }
  return `${Buffer.from(bytes).toString("base64url")}${machineId}`;
}
