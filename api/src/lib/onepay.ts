/**
 * Server-side client for the 1Pay REST API (https://1pay.cx/ru/docs).
 *
 * Verified against the official docs (API version 2026-10-28):
 *  - Auth:      Authorization: Bearer pk_<prefix>.<secret>  (pk_test_… = test mode)
 *  - Create:    POST /v1/payments            → { id, checkoutUrl, url }   scope payments:write
 *               Idempotency-Key header: same key + same body returns the original payment
 *  - Read:      GET  /v1/payments/{id}       → payment object             scope payments:read
 *  - List:      GET  /v1/payments?reference=… (array, newest first)
 *  - Cancel:    POST /v1/payments/{id}/cancel → payment object (status expired)
 *  - Statuses:  pending | paid | underpaid | expired | failed (failed = test mode only)
 *  - Webhooks:  see webhook.ts
 *
 * This module never runs in the browser; the API key only lives in env vars.
 */
import { env } from "./env";

export type OnePayStatus = "pending" | "paid" | "underpaid" | "expired" | "failed";

export interface OnePayCreated {
  id: string;
  checkoutUrl: string;
  url: string;
}

export interface OnePayPayment {
  id: string;
  merchantId: string;
  mode: string;
  amount: number;
  baseAmount: number | null;
  currency: string;
  status: OnePayStatus | string;
  expiresAt: string | null;
  email: string | null;
  productName: string | null;
  reference: string | null;
  redirectUrl: string | null;
  notifyUrl: string | null;
  provider: string | null;
  valueCoin: number | null;
  commissionAmount: number | null;
  txidIn: string | null;
  txidOut: string | null;
  settleTo: string | null;
  settledAsset: string | null;
  settledAmount: number | null;
  livemode: boolean;
  createdAt: string;
  paidAt: string | null;
}

export interface CreatePaymentBody {
  amount: number;
  currency: string;
  productName: string;
  reference: string;
  email?: string;
  notifyUrl?: string;
  redirectUrl?: string;
  cryptoAssets?: string[];
}

export class OnePayError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    /** true when we cannot know whether 1Pay stored the write (timeout, 5xx, 409 operation_outcome_unknown) */
    public outcomeUnknown = false,
    public retryAfter?: number,
  ) {
    super(message);
    this.name = "OnePayError";
  }
}

const TIMEOUT_MS = 15_000;

function apiKey(): string {
  const key = env().ONEPAY_API_KEY;
  if (!key || !/^pk_(test_)?[^.\s]+\.\S+$/.test(key)) {
    throw new OnePayError("1Pay API key is not configured", 503, "not_configured");
  }
  return key;
}

export function isLiveKey(): boolean {
  return !(env().ONEPAY_API_KEY ?? "").startsWith("pk_test_");
}

export function isConfigured(): boolean {
  try {
    apiKey();
    return true;
  } catch {
    return false;
  }
}

async function call<T>(
  method: "GET" | "POST",
  path: string,
  opts: { body?: unknown; idempotencyKey?: string; isWrite?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey()}`,
    Accept: "application/json",
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(`${env().ONEPAY_API_BASE.replace(/\/+$/, "")}${path}`, {
      method,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new OnePayError(
      timeout ? "1Pay did not respond in time" : "Could not reach 1Pay",
      504,
      timeout ? "timeout" : "network_error",
      !!opts.isWrite,
    );
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const obj = (data ?? {}) as Record<string, unknown>;
    // 1Pay errors: { error: "<code>", issues?, detail? } or { error: "<sentence>", code: "<code>" }
    const code = String(obj.code ?? obj.error ?? `http_${res.status}`);
    const detail = typeof obj.detail === "string" ? obj.detail : undefined;
    const retryAfter = Number(res.headers.get("retry-after")) || undefined;
    const unknown =
      !!opts.isWrite && (res.status >= 500 || code === "operation_outcome_unknown");
    throw new OnePayError(detail ?? describe(code, res.status), res.status, code, unknown, retryAfter);
  }
  return data as T;
}

/** Human-readable messages for documented 1Pay error codes. */
export function describe(code: string, status: number): string {
  const map: Record<string, string> = {
    unauthorized: "1Pay rejected the API key (missing, revoked or account suspended).",
    insufficient_scope: "The 1Pay API key lacks the payments:read / payments:write scope.",
    invalid: "1Pay rejected the payment details.",
    currency_unsupported: "This currency is not supported by 1Pay.",
    no_payment_methods: "No payment methods are enabled for this payment.",
    invalid_notify_url: "1Pay rejected the webhook URL (must be public https).",
    invalid_idempotency_key: "Invalid idempotency key.",
    idempotency_key_reused: "This request was already used for a different payment. Reload the form.",
    rate_limited: "1Pay rate limit reached. Try again in a minute.",
    rate_unavailable: "1Pay has no exchange rate right now. Try again in a few minutes.",
    database_unavailable: "1Pay is temporarily unavailable. Try again shortly.",
    maintenance: "1Pay is under maintenance. Try again later.",
    panic: "1Pay has paused the platform. Try again later.",
    operation_outcome_unknown: "1Pay could not confirm the result. Retrying is safe.",
    not_found: "Payment not found at 1Pay.",
    not_cancellable: "This payment can no longer be cancelled.",
  };
  return map[code] ?? `1Pay error (${status}).`;
}

export function createPayment(body: CreatePaymentBody, idempotencyKey: string) {
  return call<OnePayCreated>("POST", "/v1/payments", { body, idempotencyKey, isWrite: true });
}

export async function getPayment(id: string): Promise<OnePayPayment | null> {
  try {
    return await call<OnePayPayment>("GET", `/v1/payments/${encodeURIComponent(id)}`);
  } catch (e) {
    if (e instanceof OnePayError && e.status === 404) return null;
    throw e;
  }
}

export function findByReference(reference: string) {
  const q = new URLSearchParams({ reference, limit: "5" });
  return call<OnePayPayment[]>("GET", `/v1/payments?${q}`);
}

export function cancelPayment(id: string) {
  return call<OnePayPayment>("POST", `/v1/payments/${encodeURIComponent(id)}/cancel`, { isWrite: true });
}
