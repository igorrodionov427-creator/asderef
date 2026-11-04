import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { handle, json, preflight } from "@/lib/http";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

// Intentionally minimal: reveals nothing about configuration to anonymous callers.
export const GET = handle(async (req: NextRequest) => {
  await db.$queryRaw`SELECT 1`;
  return json(req, { ok: true });
});
