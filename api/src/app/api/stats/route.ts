import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { handle, json, preflight } from "@/lib/http";
import { fromCents, toCents } from "@/lib/money";
import { serializePayment } from "@/lib/payments";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

const q = z.object({
  range: z.enum(["7", "30", "90"]).default("30"),
  /** Browser timezone offset in minutes (Date#getTimezoneOffset), to bucket days locally. */
  tz: z.coerce.number().int().min(-840).max(840).default(0),
});

export const GET = handle(async (req: NextRequest) => {
  await requireSession(req);
  const { range, tz } = q.parse(Object.fromEntries(new URL(req.url).searchParams));
  const days = Number(range);

  const [byStatus, paidSum, recent] = await Promise.all([
    db.payment.groupBy({ by: ["status"], _count: { _all: true } }),
    db.payment.aggregate({ where: { status: "PAID" }, _sum: { amount: true } }),
    db.payment.findMany({
      where: { status: { notIn: ["CREATE_FAILED"] } },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ]);

  const count = (s: string) => byStatus.find((r) => r.status === s)?._count._all ?? 0;
  const total = byStatus
    .filter((r) => r.status !== "CREATE_FAILED" && r.status !== "CREATING")
    .reduce((s, r) => s + r._count._all, 0);

  // Daily revenue (paid payments by paidAt) in the admin's local timezone.
  const offsetMs = -tz * 60_000; // local = utc + offsetMs
  const nowLocal = new Date(Date.now() + offsetMs);
  const todayLocalMidnight = Date.UTC(nowLocal.getUTCFullYear(), nowLocal.getUTCMonth(), nowLocal.getUTCDate());
  const startLocal = todayLocalMidnight - (days - 1) * 86_400_000;
  const startUtc = new Date(startLocal - offsetMs);

  const paidInRange = await db.payment.findMany({
    where: { status: "PAID", paidAt: { gte: startUtc } },
    select: { amount: true, paidAt: true },
  });

  const buckets = new Map<string, { cents: number; count: number }>();
  for (let i = 0; i < days; i++) {
    buckets.set(new Date(startLocal + i * 86_400_000).toISOString().slice(0, 10), { cents: 0, count: 0 });
  }
  let rangeCents = 0;
  for (const p of paidInRange) {
    const key = new Date(p.paidAt!.getTime() + offsetMs).toISOString().slice(0, 10);
    const b = buckets.get(key);
    const c = toCents(p.amount)!;
    if (b) {
      b.cents += c;
      b.count += 1;
      rangeCents += c;
    }
  }

  return json(req, {
    totals: {
      revenue: paidSum._sum.amount ? paidSum._sum.amount.toFixed(2) : "0.00",
      payments: total,
      paid: count("PAID"),
      pending: count("PENDING") + count("CREATING"),
      failed: count("FAILED") + count("EXPIRED") + count("UNDERPAID"),
      breakdown: {
        expired: count("EXPIRED"),
        underpaid: count("UNDERPAID"),
        failed: count("FAILED"),
      },
    },
    range: {
      days,
      revenue: fromCents(rangeCents),
      paidCount: paidInRange.length,
      series: [...buckets.entries()].map(([date, b]) => ({ date, revenue: b.cents / 100, count: b.count })),
    },
    recent: recent.map((p) => serializePayment(p)),
  });
});
