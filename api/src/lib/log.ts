/**
 * Minimal structured logger that scrubs anything that looks like a secret
 * (API keys, webhook secrets, bearer tokens, DB URLs) before printing.
 */
const SECRET_PATTERNS: RegExp[] = [
  /pk_(test_)?[A-Za-z0-9]+\.[A-Za-z0-9_-]+/g,
  /whsec_(test_)?[A-Za-z0-9]+/g,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /postgres(ql)?:\/\/[^\s"']+/gi,
];

export function scrub(input: string): string {
  return SECRET_PATTERNS.reduce((s, re) => s.replace(re, "[redacted]"), input);
}

function fmt(v: unknown): string {
  if (v instanceof Error) return scrub(`${v.name}: ${v.message}`);
  try {
    return scrub(typeof v === "string" ? v : JSON.stringify(v));
  } catch {
    return "[unserialisable]";
  }
}

export function logInfo(msg: string, meta?: Record<string, unknown>) {
  console.log(`[agency-pay] ${msg}${meta ? " " + fmt(meta) : ""}`);
}

export function logError(msg: string, err?: unknown, meta?: Record<string, unknown>) {
  console.error(`[agency-pay] ${msg}${err ? " " + fmt(err) : ""}${meta ? " " + fmt(meta) : ""}`);
}
