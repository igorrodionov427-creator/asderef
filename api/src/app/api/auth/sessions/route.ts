import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { handle, json, preflight } from "@/lib/http";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/** Sign out everywhere (including this device). */
export const DELETE = handle(async (req: NextRequest) => {
  const session = await requireSession(req);
  const { count } = await db.session.deleteMany({ where: { adminId: session.adminId } });
  return json(req, { ok: true, revoked: count });
});
