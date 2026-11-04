import { Prisma, type Payment, type PaymentStatus } from "@prisma/client";
import { db } from "./db";
import { cardOnly, env, publicApiUrl } from "./env";
import { HttpError } from "./http";
import { logError, logInfo } from "./log";
import { fromCents, halfOf, money, toCents } from "./money";
import {
  createPayment as onepayCreate,
  findByReference,
  getPayment as onepayGet,
  isLiveKey,
  OnePayError,
  type CreatePaymentBody,
  type OnePayPayment,
} from "./onepay";
import type { CreatePaymentInput } from "./validation";

const STATUS_MAP: Record<string, PaymentStatus> = {
  pending: "PENDING",
  paid: "PAID",
  underpaid: "UNDERPAID",
  expired: "EXPIRED",
  failed: "FAILED",
};

export function mapStatus(s: string): PaymentStatus | null {
  return STATUS_MAP[s.toLowerCase()] ?? null;
}

// ─── Serialisation ─────────────────────────────────────────────────────────

type PaymentWithRelations = Payment & {
  notes?: { id: string; body: string; createdAt: Date }[];
  events?: { id: string; eventId: string; type: string; status: string; error: string | null; receivedAt: Date; attempts: number }[];
  project?: { id: string; serviceName: string; totalAmount: Prisma.Decimal; currency: string } | null;
};

export function serializePayment(p: PaymentWithRelations) {
  return {
    id: p.id,
    onepayId: p.onepayId,
    kind: p.kind,
    status: p.status,
    amount: money(p.amount),
    chargedAmount: money(p.chargedAmount),
    currency: p.currency,
    serviceName: p.serviceName,
    clientName: p.clientName,
    clientEmail: p.clientEmail,
    description: p.description,
    checkoutUrl: p.checkoutUrl,
    livemode: p.livemode,
    expiresAt: p.expiresAt,
    paidAt: p.paidAt,
    settledAmount: money(p.settledAmount),
    settledAsset: p.settledAsset,
    provider: p.provider,
    txidOut: p.txidOut,
    verifyError: p.verifyError,
    lastError: p.lastError,
    lastSyncedAt: p.lastSyncedAt,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    clientId: p.clientId,
    projectId: p.projectId,
    ...(p.notes ? { notes: p.notes } : {}),
    ...(p.events ? { events: p.events } : {}),
    ...(p.project !== undefined
      ? {
          project: p.project
            ? { id: p.project.id, serviceName: p.project.serviceName, totalAmount: money(p.project.totalAmount), currency: p.project.currency }
            : null,
        }
      : {}),
  };
}

// ─── Creation ──────────────────────────────────────────────────────────────

function clientKey(name: string | null, email: string | null): string | null {
  if (email) return `email:${email.toLowerCase()}`;
  if (name) return `name:${name.toLowerCase().replace(/\s+/g, " ")}`;
  return null;
}

async function upsertClient(tx: Prisma.TransactionClient, name: string | null, email: string | null) {
  const key = clientKey(name, email);
  if (!key) return null;
  const client = await tx.client.upsert({
    where: { key },
    create: { key, name, email },
    update: { ...(name ? { name } : {}), ...(email ? { email } : {}) },
  });
  return client.id;
}

/** Payments of a project that still count toward its total. */
const OPEN_OR_PAID: PaymentStatus[] = ["CREATING", "PENDING", "PAID"];

export async function projectBalanceCents(projectId: string): Promise<{ total: number; covered: number; remaining: number }> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: { payments: { where: { status: { in: OPEN_OR_PAID } }, select: { amount: true } } },
  });
  if (!project) throw new HttpError(404, "not_found", "Project not found.");
  const total = toCents(project.totalAmount)!;
  const covered = project.payments.reduce((s, p) => s + toCents(p.amount)!, 0);
  return { total, covered, remaining: Math.max(0, total - covered) };
}

function productName(p: Pick<Payment, "serviceName" | "kind">): string {
  const suffix = p.kind === "DEPOSIT" ? " — 50% deposit" : p.kind === "BALANCE" ? " — remaining balance" : "";
  return `${p.serviceName}${suffix}`.replace(/[<>]/g, "").slice(0, 200);
}

/** Deterministic request body: a retry with the same Idempotency-Key must send the same body. */
function buildOnePayBody(p: Payment): CreatePaymentBody {
  const notify = publicApiUrl();
  if (!notify || !notify.startsWith("https://")) {
    throw new HttpError(503, "not_configured", "PUBLIC_API_URL (https) is not configured, webhooks would be lost.");
  }
  const body: CreatePaymentBody = {
    amount: Number(p.amount.toFixed(2)),
    currency: p.currency,
    productName: productName(p),
    reference: p.id,
    notifyUrl: `${notify}/api/webhooks/1pay`,
  };
  if (p.clientEmail) body.email = p.clientEmail;
  const redirect = env().PAYMENT_REDIRECT_URL;
  if (redirect && /^https?:\/\//.test(redirect)) body.redirectUrl = redirect;
  if (cardOnly()) body.cryptoAssets = [];
  return body;
}

export async function createPayment(input: CreatePaymentInput) {
  // 1. Idempotency: the same form submission never creates two payments.
  const existing = await db.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing?.onepayId) return { payment: existing, replayed: true };

  let payment = existing;
  if (!payment) {
    payment = await insertLocal(input);
  }

  // 2. Ask 1Pay. Same Idempotency-Key → 1Pay returns the original payment on retry.
  try {
    const created = await onepayCreate(buildOnePayBody(payment), `agencypay-${payment.idempotencyKey}`);
    if (!created?.id || !created?.url) throw new OnePayError("1Pay returned no payment id", 502, "bad_response", true);
    payment = await db.payment.update({
      where: { id: payment.id },
      data: {
        onepayId: created.id,
        checkoutUrl: created.url,
        status: "PENDING",
        livemode: isLiveKey(),
        lastError: null,
      },
    });
    logInfo("payment created", { id: payment.id, onepayId: created.id });
  } catch (e) {
    if (e instanceof OnePayError) {
      payment = await db.payment.update({
        where: { id: payment.id },
        data: { status: e.outcomeUnknown ? "CREATING" : "CREATE_FAILED", lastError: e.message.slice(0, 300) },
      });
      logError("1pay create failed", e, { id: payment.id, status: e.status, code: e.code });
      throw new HttpError(e.status === 503 && e.code === "not_configured" ? 503 : 502, "provider_error", e.message, {
        retryable: e.outcomeUnknown || e.status === 429 || e.status === 503,
        paymentId: payment.id,
      });
    }
    if (e instanceof HttpError) {
      await db.payment.update({ where: { id: payment.id }, data: { status: "CREATE_FAILED", lastError: e.message } });
    }
    throw e;
  }

  // 3. Best-effort enrichment (expiry, charged amount incl. surcharge). Never fails the request.
  try {
    payment = await syncPayment(payment);
  } catch (e) {
    logError("post-create sync failed", e, { id: payment.id });
  }
  return { payment, replayed: false };
}

async function insertLocal(input: CreatePaymentInput): Promise<Payment> {
  try {
    return await db.$transaction(async (tx) => {
      let amountCents: number;
      let serviceName = input.serviceName ?? "";
      let clientName = input.clientName ?? null;
      let clientEmail = input.clientEmail ?? null;
      let projectId: string | null = null;
      let clientId: string | null = null;

      if (input.kind === "BALANCE") {
        const project = await tx.project.findUnique({
          where: { id: input.projectId! },
          include: {
            client: true,
            payments: { where: { status: { in: OPEN_OR_PAID } }, select: { amount: true } },
          },
        });
        if (!project) throw new HttpError(404, "not_found", "Project not found.");
        const total = toCents(project.totalAmount)!;
        const covered = project.payments.reduce((s, p) => s + toCents(p.amount)!, 0);
        amountCents = total - covered;
        if (amountCents <= 0) throw new HttpError(409, "nothing_due", "This project has no remaining balance.");
        serviceName = project.serviceName;
        clientName = input.clientName ?? project.client?.name ?? null;
        clientEmail = input.clientEmail ?? project.client?.email ?? null;
        projectId = project.id;
        clientId = project.clientId;
      } else {
        const totalCents = toCents(input.amount!)!;
        clientId = await upsertClient(tx, clientName, clientEmail);
        if (input.kind === "DEPOSIT") {
          const project = await tx.project.create({
            data: { serviceName, totalAmount: fromCents(totalCents), currency: "USD", clientId },
          });
          projectId = project.id;
          amountCents = halfOf(totalCents);
        } else {
          amountCents = totalCents;
        }
      }

      return tx.payment.create({
        data: {
          idempotencyKey: input.idempotencyKey,
          kind: input.kind,
          status: "CREATING",
          amount: fromCents(amountCents),
          currency: "USD",
          serviceName,
          clientName,
          clientEmail,
          description: input.description ?? null,
          clientId,
          projectId,
        },
      });
    });
  } catch (e) {
    // Concurrent duplicate submit with the same key: reuse the row the other request created.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const row = await db.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (row) return row;
    }
    throw e;
  }
}

// ─── Sync with 1Pay (webhooks, manual refresh, scheduled reconciliation) ───

/**
 * Re-reads the payment from 1Pay with our API key and applies it.
 * Status is only ever taken from this authenticated read — never from the
 * browser and never from a webhook body alone. If livemode, currency or the
 * base amount differ from what we stored, the payment is NOT updated to paid
 * and verifyError is recorded instead.
 */
export async function syncPayment(p: Payment, remoteIn?: OnePayPayment | null): Promise<Payment> {
  if (!p.onepayId) return p;
  const remote = remoteIn === undefined ? await onepayGet(p.onepayId) : remoteIn;
  if (!remote) {
    return db.payment.update({
      where: { id: p.id },
      data: { lastSyncedAt: new Date(), lastError: "Not found at 1Pay (different mode or key?)" },
    });
  }
  const problem = verifyRemote(p, remote);
  if (problem) {
    logError("1pay verification mismatch", undefined, { id: p.id, problem });
    return db.payment.update({ where: { id: p.id }, data: { verifyError: problem, lastSyncedAt: new Date() } });
  }
  const status = mapStatus(String(remote.status));
  if (!status) {
    logError("unknown 1pay status", undefined, { id: p.id, status: remote.status });
  }
  return db.payment.update({
    where: { id: p.id },
    data: {
      ...(status ? { status } : {}),
      chargedAmount: remote.amount != null ? new Prisma.Decimal(remote.amount).toFixed(2) : undefined,
      checkoutUrl: p.checkoutUrl ?? undefined,
      livemode: remote.livemode,
      expiresAt: remote.expiresAt ? new Date(remote.expiresAt) : null,
      paidAt: remote.paidAt ? new Date(remote.paidAt) : null,
      settledAmount: remote.settledAmount != null ? new Prisma.Decimal(remote.settledAmount).toFixed(2) : null,
      settledAsset: remote.settledAsset ?? null,
      provider: remote.provider ?? null,
      txidOut: remote.txidOut ?? null,
      verifyError: null,
      lastError: null,
      lastSyncedAt: new Date(),
    },
  });
}

export function verifyRemote(p: Payment, remote: OnePayPayment): string | null {
  if (remote.id !== p.onepayId) return "Payment id mismatch";
  if (remote.livemode !== isLiveKey()) return "Mode mismatch (test vs live)";
  if (String(remote.currency).toUpperCase() !== p.currency.toUpperCase()) {
    return `Currency mismatch: expected ${p.currency}, got ${remote.currency}`;
  }
  const base = remote.baseAmount ?? remote.amount;
  if (toCents(base) !== toCents(p.amount)) {
    return `Amount mismatch: expected ${p.amount.toFixed(2)}, got ${base}`;
  }
  return null;
}

/**
 * A payment stuck in CREATING (1Pay timed out) may still exist at 1Pay.
 * Look it up by our reference (= local id) and attach it.
 */
export async function recoverCreating(p: Payment): Promise<Payment> {
  if (p.onepayId) return p;
  const found = (await findByReference(p.id)).find((r) => r.reference === p.id);
  if (!found) return p;
  const attached = await db.payment.update({
    where: { id: p.id },
    data: {
      onepayId: found.id,
      checkoutUrl: `https://1pay.cx/pay/${found.id}`,
      status: "PENDING",
      livemode: found.livemode,
      lastError: null,
    },
  });
  return syncPayment(attached, found);
}
