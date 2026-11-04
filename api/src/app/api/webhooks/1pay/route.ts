import { Prisma } from "@prisma/client";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { logError, logInfo } from "@/lib/log";
import { toCents } from "@/lib/money";
import { getPayment, isLiveKey } from "@/lib/onepay";
import { syncPayment } from "@/lib/payments";
import { verifySignatureV2 } from "@/lib/webhook";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const PAYMENT_EVENTS = new Set([
  "payment.paid",
  "payment.underpaid",
  "payment.expired",
  "payment.failed",
  "payment.forwarded",
]);

const text = (status: number, body = "") => new Response(body, { status, headers: { "Content-Type": "text/plain" } });

type Body = {
  id?: string;
  event?: string;
  data?: { paymentId?: string; reference?: string | null; amount?: number; currency?: string; livemode?: boolean; status?: string };
};

/**
 * 1Pay webhook receiver (per-payment notifyUrl, signed with the account's
 * notifyUrl secret). 2xx = handled (also for duplicates / ignored events);
 * 5xx = 1Pay retries (up to 9 attempts over ~3 days).
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > 64_000) return text(413);

  const secret = env().ONEPAY_WEBHOOK_SECRET;
  if (!secret) {
    logError("webhook received but ONEPAY_WEBHOOK_SECRET is not set");
    return text(503); // 1Pay will retry once configured
  }
  if (!verifySignatureV2(raw, req.headers.get("x-1pay-signature-v2"), secret)) {
    logInfo("webhook rejected: invalid signature");
    return text(401, "invalid signature");
  }

  let body: Body;
  try {
    body = JSON.parse(raw);
  } catch {
    return text(400, "bad json");
  }
  const eventId = String(body.id ?? req.headers.get("x-1pay-event-id") ?? "");
  const type = String(body.event ?? req.headers.get("x-1pay-event") ?? "");
  if (!/^whe_[A-Za-z0-9]+$/.test(eventId) || !type) return text(400, "missing id/event");
  if (type === "webhook.test") return text(200, "ok");

  // ── Deduplicate by event id (retries keep the same id) ──
  let event = await db.webhookEvent.findUnique({ where: { eventId } });
  if (event && event.status !== "RECEIVED" && event.status !== "ERROR") {
    return text(200, "duplicate");
  }
  const onepayPaymentId = body.data?.paymentId ? String(body.data.paymentId) : null;
  if (event) {
    event = await db.webhookEvent.update({ where: { id: event.id }, data: { attempts: { increment: 1 } } });
  } else {
    try {
      event = await db.webhookEvent.create({
        data: { eventId, type, onepayPaymentId, payload: body as Prisma.InputJsonValue },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return text(200, "in progress");
      throw e;
    }
  }

  const finish = (status: "PROCESSED" | "IGNORED" | "REJECTED", error: string | null, paymentId?: string) =>
    db.webhookEvent.update({
      where: { id: event!.id },
      data: { status, error, processedAt: new Date(), ...(paymentId ? { paymentId } : {}) },
    });

  try {
    const data = body.data ?? {};
    if (!PAYMENT_EVENTS.has(type) || !onepayPaymentId) {
      await finish("IGNORED", `unhandled event ${type}`);
      return text(200, "ignored");
    }
    if (data.livemode !== isLiveKey()) {
      await finish("IGNORED", "livemode does not match the configured API key");
      return text(200, "wrong mode");
    }

    const payment = await db.payment.findUnique({ where: { onepayId: onepayPaymentId } });
    if (!payment) {
      await finish("IGNORED", "unknown payment id");
      return text(200, "unknown payment");
    }
    if (data.reference && data.reference !== payment.id) {
      await finish("REJECTED", "reference does not match stored payment", payment.id);
      return text(200, "rejected");
    }

    // Never trust the body alone: re-read the payment with our API key.
    const remote = await getPayment(onepayPaymentId);
    if (!remote) throw new Error("payment not readable at 1Pay yet");

    if (type === "payment.paid" || type === "payment.underpaid") {
      if (toCents(data.amount ?? null) !== toCents(remote.amount)) {
        await finish("REJECTED", `webhook amount ${data.amount} != payment amount ${remote.amount}`, payment.id);
        return text(200, "rejected");
      }
      if (String(data.currency ?? "").toUpperCase() !== String(remote.currency).toUpperCase()) {
        await finish("REJECTED", "currency mismatch", payment.id);
        return text(200, "rejected");
      }
    }

    const updated = await syncPayment(payment, remote);
    if (updated.verifyError) {
      await finish("REJECTED", updated.verifyError, payment.id);
      return text(200, "rejected");
    }
    await finish("PROCESSED", null, payment.id);
    logInfo("webhook processed", { type, paymentId: payment.id, status: updated.status });
    return text(200, "ok");
  } catch (e) {
    logError("webhook processing failed", e, { eventId, type });
    await db.webhookEvent
      .update({ where: { id: event.id }, data: { status: "ERROR", error: String((e as Error).message).slice(0, 300) } })
      .catch(() => {});
    return text(500, "retry");
  }
}
