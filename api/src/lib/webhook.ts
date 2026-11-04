import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies the X-1pay-Signature-V2 header exactly as documented at
 * https://1pay.cx/ru/docs/webhooks:
 *   header  = "t=<unix seconds>,v1=<hex>[,v1=<hex>]"  (two v1 for 24h after a secret roll)
 *   signed  = "<t>.<raw body>"
 *   v1      = lowercase hex HMAC-SHA256(signed, secret as UTF-8 text incl. "whsec_" prefix)
 *   reject if |now - t| > 300 s; accept if ANY v1 matches (constant-time compare).
 */
export function verifySignatureV2(
  rawBody: string,
  header: string | null | undefined,
  secret: string,
  nowSec: number = Date.now() / 1000,
  toleranceSec = 300,
): boolean {
  if (!secret || !header) return false;
  let t = "";
  const sigs: string[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") t = v;
    else if (k === "v1") sigs.push(v);
  }
  if (!/^[0-9]+$/.test(t) || Math.abs(nowSec - Number(t)) > toleranceSec) return false;
  const expected = createHmac("sha256", secret).update(`${t}.`).update(rawBody, "utf8").digest("hex");
  const exp = Buffer.from(expected);
  return sigs.some((s) => s.length === expected.length && timingSafeEqual(exp, Buffer.from(s)));
}
