import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { handle, json, preflight, readJson } from "@/lib/http";
import { createPayment, serializePayment } from "@/lib/payments";
import { paymentWhere } from "@/lib/query";
import { rateLimit } from "@/lib/ratelimit";
import { createPaymentSchema, listQuerySchema } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const maxDuration = 30;
export const OPTIONS = preflight;

export const GET = handle(async (req: NextRequest) => {
  await requireSession(req);
  const q = listQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const where = paymentWhere(q);
  const [items, total] = await Promise.all([
    db.payment.findMany({
      where,
      orderBy: { createdAt: q.sort === "oldest" ? "asc" : "desc" },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.payment.count({ where }),
  ]);
  return json(req, {
    items: items.map((p) => serializePayment(p)),
    page: q.page,
    pageSize: q.pageSize,
    total,
    pages: Math.max(1, Math.ceil(total / q.pageSize)),
  });
});

export const POST = handle(async (req: NextRequest) => {
  const session = await requireSession(req);
  await rateLimit(`create:${session.adminId}`, 30, 10 * 60);
  const input = createPaymentSchema.parse(await readJson(req, 8_000));
  const { payment, replayed } = await createPayment(input);
  return json(req, { payment: serializePayment(payment), replayed }, replayed ? 200 : 201);
});
