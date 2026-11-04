import { timingSafeEqual } from "node:crypto";
import type { Payment } from "@prisma/client";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { logError, logInfo } from "@/lib/log";
import { isConfigured } from "@/lib/onepay";
import { recoverCreating, syncPayment } from "@/lib/payments";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: NextRequest): boolean {
  const secret = env().CRON_SECRET;
  if (!secret || secret.length < 16) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

async function runPool<T>(items: T[], size: number, fn: (t: T) => Promise<void>, deadline: number) {
  let i = 0;
  await Promise.all(
    Array.from({ length: size }, async () => {
      while (i < items.length && Date.now() < deadline) await fn(items[i++]);
    }),
  );
}

/**
 * Scheduled reconciliation (Vercel Cron daily + GitHub Actions every 15 min):
 * re-reads open payments from the 1Pay API so a missed webhook never leaves a
 * payment stuck in "pending".
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return new Response("Not Found", { status: 404 });
  if (!isConfigured()) return Response.json({ ok: false, reason: "1Pay not configured" });

  const now = Date.now();
  const deadline = now + 45_000;
  const [pending, recentlyExpired, creating] = await Promise.all([
    db.payment.findMany({
      where: { status: "PENDING", onepayId: { not: null }, createdAt: { gt: new Date(now - 30 * 86_400_000) } },
      orderBy: { lastSyncedAt: { sort: "asc", nulls: "first" } },
      take: 60,
    }),
    // Late money can still turn an expired payment into paid.
    db.payment.findMany({
      where: { status: "EXPIRED", onepayId: { not: null }, updatedAt: { gt: new Date(now - 3 * 86_400_000) } },
      orderBy: { lastSyncedAt: { sort: "asc", nulls: "first" } },
      take: 20,
    }),
    // Creation that timed out: find it at 1Pay by our reference.
    db.payment.findMany({
      where: {
        status: "CREATING",
        onepayId: null,
        createdAt: { lt: new Date(now - 2 * 60_000), gt: new Date(now - 2 * 86_400_000) },
      },
      take: 10,
    }),
  ]);

  const result = { checked: 0, changed: 0, recovered: 0, errors: 0 };
  const work: Payment[] = [...pending, ...recentlyExpired, ...creating];

  await runPool(
    work,
    4,
    async (p) => {
      try {
        const before = p.status;
        const after = p.onepayId ? await syncPayment(p) : await recoverCreating(p);
        result.checked++;
        if (after.status !== before) result.changed++;
        if (!p.onepayId && after.onepayId) result.recovered++;
      } catch (e) {
        result.errors++;
        logError("reconcile failed", e, { id: p.id });
      }
    },
    deadline,
  );

  logInfo("reconcile done", result);
  return Response.json({ ok: true, ...result });
}
