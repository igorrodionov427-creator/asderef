import type { Prisma } from "@prisma/client";
import type { z } from "zod";
import type { listQuerySchema } from "./validation";

export function paymentWhere(q: z.infer<typeof listQuerySchema>): Prisma.PaymentWhereInput {
  const where: Prisma.PaymentWhereInput = {};
  if (q.status === "OPEN") where.status = { in: ["PENDING", "CREATING"] };
  else if (q.status === "ISSUES") where.status = { in: ["EXPIRED", "FAILED", "UNDERPAID"] };
  else if (q.status !== "ALL") where.status = q.status;
  if (q.q) {
    const contains = { contains: q.q, mode: "insensitive" as const };
    where.OR = [
      { clientName: contains },
      { clientEmail: contains },
      { serviceName: contains },
      { onepayId: contains },
      { id: q.q },
    ];
  }
  return where;
}
