import { createHash } from "node:crypto";
import { db } from "./db";
import { HttpError } from "./http";

export const hashKey = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 32);

/**
 * Atomic fixed-window counter stored in Postgres (works across serverless
 * instances, survives redeploys). Throws 429 when the limit is exceeded.
 */
export async function rateLimit(key: string, limit: number, windowSec: number) {
  const resetAt = new Date(Date.now() + windowSec * 1000);
  const rows = await db.$queryRaw<{ count: number; resetAt: Date }[]>`
    INSERT INTO "RateLimit" ("key", "count", "resetAt") VALUES (${key}, 1, ${resetAt})
    ON CONFLICT ("key") DO UPDATE SET
      "count"   = CASE WHEN "RateLimit"."resetAt" < NOW() THEN 1 ELSE "RateLimit"."count" + 1 END,
      "resetAt" = CASE WHEN "RateLimit"."resetAt" < NOW() THEN EXCLUDED."resetAt" ELSE "RateLimit"."resetAt" END
    RETURNING "count", "resetAt"`;
  const row = rows[0];
  if (row && row.count > limit) {
    const retryAfter = Math.max(1, Math.ceil((new Date(row.resetAt).getTime() - Date.now()) / 1000));
    throw new HttpError(429, "rate_limited", "Too many requests. Please slow down.", { retryAfter });
  }
}

// ─── Login PIN brute-force guard ────────────────────────────────────────────
// Per-IP: 5 wrong PINs → lock 15 min, every further lock doubles (max 24 h).
// Global: 10 wrong PINs from anywhere → lock everybody 15 min, doubling too.
// The global lock is what actually protects a short PIN against attackers
// rotating IPs; a successful login resets both counters.

const IP_RULE = { threshold: 5, baseMinutes: 15 };
const GLOBAL_RULE = { threshold: 10, baseMinutes: 15 };
const MAX_LOCK_MS = 24 * 60 * 60 * 1000;
export const GLOBAL_KEY = "global";

export async function lockedFor(keys: string[]): Promise<number> {
  const rows = await db.loginGuard.findMany({ where: { key: { in: keys } } });
  const now = Date.now();
  return rows.reduce((max, r) => {
    const left = r.lockedUntil ? r.lockedUntil.getTime() - now : 0;
    return Math.max(max, left);
  }, 0);
}

async function bump(key: string, rule: { threshold: number; baseMinutes: number }) {
  const row = await db.loginGuard.upsert({
    where: { key },
    create: { key, failures: 1 },
    update: { failures: { increment: 1 } },
  });
  if (row.failures >= rule.threshold) {
    const level = row.level + 1;
    const ms = Math.min(rule.baseMinutes * 60_000 * 2 ** (level - 1), MAX_LOCK_MS);
    await db.loginGuard.update({
      where: { key },
      data: { failures: 0, level, lockedUntil: new Date(Date.now() + ms) },
    });
  }
}

export async function registerLoginFailure(ipKey: string) {
  await bump(ipKey, IP_RULE);
  await bump(GLOBAL_KEY, GLOBAL_RULE);
}

export async function resetLoginGuards(ipKey: string) {
  await db.loginGuard.deleteMany({ where: { key: { in: [ipKey, GLOBAL_KEY] } } });
}
