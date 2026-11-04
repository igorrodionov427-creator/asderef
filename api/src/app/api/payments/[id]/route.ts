import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { handle, HttpError, json, preflight } from "@/lib/http";
import { serializePayment } from "@/lib/payments";
import { idSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req: NextRequest, { params }: Ctx) => {
  await requireSession(req);
  const id = idSchema.parse((await params).id);
  const payment = await db.payment.findUnique({
    where: { id },
    include: {
      notes: { orderBy: { createdAt: "desc" }, select: { id: true, body: true, createdAt: true } },
      events: {
        orderBy: { receivedAt: "desc" },
        take: 20,
        select: { id: true, eventId: true, type: true, status: true, error: true, receivedAt: true, attempts: true },
      },
      project: { select: { id: true, serviceName: true, totalAmount: true, currency: true } },
    },
  });
  if (!payment) throw new HttpError(404, "not_found", "Payment not found.");
  return json(req, { payment: serializePayment(payment) });
});
