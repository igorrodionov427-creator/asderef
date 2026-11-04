import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { handle, HttpError, json, preflight } from "@/lib/http";
import { OnePayError } from "@/lib/onepay";
import { recoverCreating, serializePayment, syncPayment } from "@/lib/payments";
import { rateLimit } from "@/lib/ratelimit";
import { idSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

type Ctx = { params: Promise<{ id: string }> };

/** Re-reads the payment from the 1Pay API (authoritative status). */
export const POST = handle(async (req: NextRequest, { params }: Ctx) => {
  const session = await requireSession(req);
  await rateLimit(`refresh:${session.adminId}`, 60, 60);
  const id = idSchema.parse((await params).id);
  let payment = await db.payment.findUnique({ where: { id } });
  if (!payment) throw new HttpError(404, "not_found", "Payment not found.");
  try {
    payment = payment.onepayId ? await syncPayment(payment) : await recoverCreating(payment);
  } catch (e) {
    if (e instanceof OnePayError) throw new HttpError(502, "provider_error", e.message);
    throw e;
  }
  return json(req, { payment: serializePayment(payment) });
});
