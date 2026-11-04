import type { NextRequest } from "next/server";
import { revokeSession } from "@/lib/auth";
import { handle, json, preflight } from "@/lib/http";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

export const POST = handle(async (req: NextRequest) => {
  await revokeSession(req);
  return json(req, { ok: true });
});
