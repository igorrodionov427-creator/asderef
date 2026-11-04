import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { handle, HttpError, json, preflight, readJson } from "@/lib/http";
import { idSchema, noteSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle(async (req: NextRequest, { params }: Ctx) => {
  await requireSession(req);
  const paymentId = idSchema.parse((await params).id);
  const { body } = noteSchema.parse(await readJson(req, 8_000));
  const exists = await db.payment.count({ where: { id: paymentId } });
  if (!exists) throw new HttpError(404, "not_found", "Payment not found.");
  const note = await db.note.create({
    data: { paymentId, body },
    select: { id: true, body: true, createdAt: true },
  });
  return json(req, { note }, 201);
});
