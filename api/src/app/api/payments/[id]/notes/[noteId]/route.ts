import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { handle, json, preflight } from "@/lib/http";
import { idSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

type Ctx = { params: Promise<{ id: string; noteId: string }> };

export const DELETE = handle(async (req: NextRequest, { params }: Ctx) => {
  await requireSession(req);
  const p = await params;
  const paymentId = idSchema.parse(p.id);
  const noteId = idSchema.parse(p.noteId);
  await db.note.deleteMany({ where: { id: noteId, paymentId } });
  return json(req, { ok: true });
});
