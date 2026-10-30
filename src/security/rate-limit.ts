const hitsByKey = new Map<string, number[]>();

export const DEFAULT_SEND_PER_MINUTE = 20;

export function resetRateLimitsForTests(): void {
  hitsByKey.clear();
}

export function assertSendRateLimit(key: string, limitPerMinute: number, now = Date.now()): void {
  const limit = Number.isFinite(limitPerMinute) && limitPerMinute > 0 ? limitPerMinute : DEFAULT_SEND_PER_MINUTE;
  const windowMs = 60_000;
  const recent = (hitsByKey.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    throw new Error(
      `Rate limit: ${limit} sends per minute for this token. Wait and retry, or raise sendPerMinute on a token you own.`
    );
  }
  recent.push(now);
  hitsByKey.set(key, recent);
}
