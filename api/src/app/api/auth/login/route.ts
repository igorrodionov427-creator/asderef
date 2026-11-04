import type { NextRequest } from "next/server";
import { z } from "zod";
import { createSession, getOrCreateAdmin, verifyPassword } from "@/lib/auth";
import { clientIp, handle, HttpError, json, preflight, readJson } from "@/lib/http";
import { logInfo } from "@/lib/log";
import { GLOBAL_KEY, hashKey, lockedFor, rateLimit, registerLoginFailure, resetLoginGuards } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

const bodySchema = z.object({ pin: z.string().min(1).max(128) });

export const POST = handle(async (req: NextRequest) => {
  const ipKey = `ip:${hashKey(clientIp(req))}`;

  // Hard cap on request volume per IP, independent of right/wrong answers.
  await rateLimit(`login:${ipKey}`, 30, 15 * 60);

  const lockedMs = await lockedFor([ipKey, GLOBAL_KEY]);
  if (lockedMs > 0) {
    const retryAfter = Math.ceil(lockedMs / 1000);
    throw new HttpError(429, "locked", "Too many attempts. Try again later.", { retryAfter });
  }

  const { pin } = bodySchema.parse(await readJson(req, 1_000));
  const admin = await getOrCreateAdmin();
  const ok = await verifyPassword(pin, admin.passwordHash);

  if (!ok) {
    await registerLoginFailure(ipKey);
    await new Promise((r) => setTimeout(r, 600)); // slow down guessing
    const nowLocked = await lockedFor([ipKey, GLOBAL_KEY]);
    logInfo("login failed", { ip: ipKey });
    if (nowLocked > 0) {
      throw new HttpError(429, "locked", "Too many attempts. Try again later.", {
        retryAfter: Math.ceil(nowLocked / 1000),
      });
    }
    throw new HttpError(401, "invalid_pin", "Wrong code.");
  }

  await resetLoginGuards(ipKey);
  const { token, expiresAt } = await createSession(admin.id, req.headers.get("user-agent"));
  logInfo("login ok", { ip: ipKey });
  return json(req, { token, expiresAt });
});
