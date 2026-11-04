import type { NextRequest } from "next/server";
import { z } from "zod";
import { hashPassword, requireSession, verifyPassword } from "@/lib/auth";
import { db } from "@/lib/db";
import { handle, HttpError, json, preflight, readJson } from "@/lib/http";
import { rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

const schema = z.object({
  current: z.string().min(1).max(128),
  next: z.string().regex(/^\d{4,12}$/, "Use 4–12 digits"),
});

/** Change the PIN/password. Revokes every other session. */
export const POST = handle(async (req: NextRequest) => {
  const session = await requireSession(req);
  await rateLimit(`pwchange:${session.id}`, 5, 15 * 60);
  const { current, next } = schema.parse(await readJson(req, 1_000));
  const admin = await db.admin.findUniqueOrThrow({ where: { id: session.adminId } });
  if (!(await verifyPassword(current, admin.passwordHash))) {
    throw new HttpError(400, "invalid", "Current code is wrong.", {
      issues: [{ path: "current", message: "Current code is wrong" }],
    });
  }
  await db.$transaction([
    db.admin.update({ where: { id: admin.id }, data: { passwordHash: await hashPassword(next) } }),
    db.session.deleteMany({ where: { adminId: admin.id, NOT: { id: session.id } } }),
  ]);
  return json(req, { ok: true });
});
