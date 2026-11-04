import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Session } from "@prisma/client";
import { db } from "./db";
import { env } from "./env";
import { HttpError } from "./http";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  opts: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEYLEN = 32;

/** scrypt$N$r$p$salt(b64)$hash(b64) */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return ["scrypt", N, R, P, salt.toString("base64"), hash.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, saltB64, hashB64] = stored.split("$");
  if (algo !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Returns the single admin, creating it from ADMIN_PASSWORD the first time. */
export async function getOrCreateAdmin() {
  const existing = await db.admin.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing) return existing;
  const initial = env().ADMIN_PASSWORD;
  if (!initial || initial.length < 4) {
    throw new HttpError(503, "not_configured", "Server is not configured yet.");
  }
  return db.admin.create({ data: { passwordHash: await hashPassword(initial) } });
}

export async function createSession(adminId: string, userAgent: string | null) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + env().SESSION_TTL_DAYS * 86_400_000);
  await db.session.create({
    data: { adminId, tokenHash: sha256(token), expiresAt, userAgent: userAgent?.slice(0, 200) ?? null },
  });
  // Opportunistic cleanup of expired sessions.
  await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return { token, expiresAt };
}

function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,100})$/.exec(h);
  return m ? m[1] : null;
}

/**
 * Authenticates a request by its bearer token. Tokens are sent in the
 * Authorization header (not cookies) because the UI is hosted on a different
 * site (GitHub Pages) and iOS Safari blocks third-party cookies. Header-based
 * auth also makes CSRF impossible: browsers never attach it automatically.
 */
export async function requireSession(req: Request): Promise<Session> {
  const token = bearer(req);
  if (!token) throw new HttpError(401, "unauthorized", "Not signed in.");
  const session = await db.session.findUnique({ where: { tokenHash: sha256(token) } });
  const now = Date.now();
  const idleMs = env().SESSION_IDLE_DAYS * 86_400_000;
  if (!session || session.expiresAt.getTime() < now || session.lastSeenAt.getTime() + idleMs < now) {
    if (session) await db.session.delete({ where: { id: session.id } }).catch(() => {});
    throw new HttpError(401, "unauthorized", "Session expired.");
  }
  if (now - session.lastSeenAt.getTime() > 5 * 60_000) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  return session;
}

export async function revokeSession(req: Request) {
  const token = bearer(req);
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
}
