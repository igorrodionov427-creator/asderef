import type { NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { handle, json, preflight } from "@/lib/http";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

const q = z.object({ q: z.string().trim().max(120).optional().default("") });

/** Existing clients for quick payment creation, most recently used first. */
export const GET = handle(async (req: NextRequest) => {
  await requireSession(req);
  const { q: search } = q.parse(Object.fromEntries(new URL(req.url).searchParams));
  const contains = { contains: search, mode: "insensitive" as const };
  const clients = await db.client.findMany({
    where: search ? { OR: [{ name: contains }, { email: contains }] } : {},
    orderBy: { updatedAt: "desc" },
    take: 12,
    include: {
      payments: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { serviceName: true, amount: true, createdAt: true },
      },
      _count: { select: { payments: true } },
    },
  });
  return json(req, {
    clients: clients.map((c) => ({
      id: c.id,
      name: c.name,
      email: c.email,
      paymentsCount: c._count.payments,
      lastService: c.payments[0]?.serviceName ?? null,
      lastAmount: c.payments[0]?.amount.toFixed(2) ?? null,
    })),
  });
});
