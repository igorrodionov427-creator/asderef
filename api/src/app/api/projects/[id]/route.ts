import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { handle, HttpError, json, preflight } from "@/lib/http";
import { fromCents } from "@/lib/money";
import { projectBalanceCents, serializePayment } from "@/lib/payments";
import { idSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle(async (req: NextRequest, { params }: Ctx) => {
  await requireSession(req);
  const id = idSchema.parse((await params).id);
  const project = await db.project.findUnique({
    where: { id },
    include: { client: true, payments: { orderBy: { createdAt: "asc" } } },
  });
  if (!project) throw new HttpError(404, "not_found", "Project not found.");
  const bal = await projectBalanceCents(id);
  const paidCents = project.payments
    .filter((p) => p.status === "PAID")
    .reduce((s, p) => s + Math.round(Number(p.amount) * 100), 0);
  return json(req, {
    project: {
      id: project.id,
      serviceName: project.serviceName,
      totalAmount: project.totalAmount.toFixed(2),
      currency: project.currency,
      createdAt: project.createdAt,
      client: project.client ? { id: project.client.id, name: project.client.name, email: project.client.email } : null,
      paid: fromCents(paidCents),
      remaining: fromCents(bal.remaining),
      payments: project.payments.map((p) => serializePayment(p)),
    },
  });
});
