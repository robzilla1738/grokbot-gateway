const SECRET_PATTERNS: RegExp[] = [
  /\bgbgt_[A-Za-z0-9_-]+\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi,
  /\bAuthorization:\s*[^\s,]+(?:\s+[^\s,]+)?/gi,
  /\b(access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|xai-client-secret)\s*[:=]\s*\S+/gi,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g
];

export function redact(value: string): string {
  let out = value;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, "[redacted]");
  }
  return out;
}

export function redactUnknown(value: unknown): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(redactUnknown);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (/token|secret|authorization|password|key$/i.test(k)) {
        next[k] = v == null ? v : "[redacted]";
      } else {
        next[k] = redactUnknown(v);
      }
    }
    return next;
  }
  return value;
}

export function looksLikeSecretHeader(name: string): boolean {
  return /authorization|token|secret|cookie/i.test(name);
}
