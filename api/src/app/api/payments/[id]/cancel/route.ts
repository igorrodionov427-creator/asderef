import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { handle, HttpError, json, preflight } from "@/lib/http";
import { cancelPayment, OnePayError } from "@/lib/onepay";
import { serializePayment, syncPayment } from "@/lib/payments";
import { idSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

type Ctx = { params: Promise<{ id: string }> };

/** Closes a pending payment at 1Pay (POST /v1/payments/{id}/cancel → status expired). */
export const POST = handle(async (req: NextRequest, { params }: Ctx) => {
  await requireSession(req);
  const id = idSchema.parse((await params).id);
  const payment = await db.payment.findUnique({ where: { id } });
  if (!payment) throw new HttpError(404, "not_found", "Payment not found.");
  if (!payment.onepayId || payment.status !== "PENDING") {
    throw new HttpError(409, "not_cancellable", "Only pending payments can be cancelled.");
  }
  try {
    const remote = await cancelPayment(payment.onepayId);
    const updated = await syncPayment(payment, remote);
    return json(req, { payment: serializePayment(updated) });
  } catch (e) {
    if (e instanceof OnePayError) throw new HttpError(e.status === 409 ? 409 : 502, e.code, e.message);
    throw e;
  }
});
