import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth";
import { cardOnly, publicApiUrl, env } from "@/lib/env";
import { handle, json, preflight } from "@/lib/http";
import { isConfigured, isLiveKey } from "@/lib/onepay";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

export const GET = handle(async (req: NextRequest) => {
  const session = await requireSession(req);
  return json(req, {
    session: { createdAt: session.createdAt, expiresAt: session.expiresAt },
    config: {
      onepayConfigured: isConfigured(),
      livemode: isConfigured() ? isLiveKey() : null,
      webhookSecretConfigured: !!env().ONEPAY_WEBHOOK_SECRET,
      webhookUrl: publicApiUrl() ? `${publicApiUrl()}/api/webhooks/1pay` : null,
      cardOnly: cardOnly(),
      cronConfigured: !!env().CRON_SECRET,
    },
  });
});
