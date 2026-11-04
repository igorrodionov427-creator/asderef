import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { corsHeaders, handle, preflight } from "@/lib/http";
import { paymentWhere } from "@/lib/query";
import { rateLimit } from "@/lib/ratelimit";
import { listQuerySchema } from "@/lib/validation";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/** Escapes a CSV cell and neutralises spreadsheet formula injection (=, +, -, @). */
function cell(v: unknown): string {
  let s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const GET = handle(async (req: NextRequest) => {
  const session = await requireSession(req);
  await rateLimit(`export:${session.adminId}`, 20, 10 * 60);
  const q = listQuerySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const rows = await db.payment.findMany({
    where: paymentWhere(q),
    orderBy: { createdAt: q.sort === "oldest" ? "asc" : "desc" },
    take: 10_000,
    include: { notes: { orderBy: { createdAt: "asc" } } },
  });

  const header = [
    "Internal ID", "1Pay Payment ID", "Type", "Status", "Amount", "Charged", "Currency",
    "Service", "Client name", "Client email", "Description", "Checkout URL",
    "Created", "Paid", "Settled (USD)", "Settled asset", "Project ID", "Mode", "Notes",
  ];
  const lines = [header.map(cell).join(",")];
  for (const p of rows) {
    lines.push(
      [
        p.id, p.onepayId, p.kind, p.status, p.amount.toFixed(2), p.chargedAmount?.toFixed(2), p.currency,
        p.serviceName, p.clientName, p.clientEmail, p.description, p.checkoutUrl,
        p.createdAt, p.paidAt, p.settledAmount?.toFixed(2), p.settledAsset, p.projectId,
        p.livemode == null ? "" : p.livemode ? "live" : "test",
        p.notes.map((n) => n.body).join(" | "),
      ].map(cell).join(","),
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response("﻿" + lines.join("\r\n"), {
    status: 200,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="agency-pay-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
});
