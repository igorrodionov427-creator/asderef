"use client";

import { ArrowRight, CheckCircle2, ChevronRight, Plus, Receipt, User } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Shell } from "@/components/Shell";
import { Field, LinkActions, LinkBox, PageHeader, Row, Spinner, StatusBadge } from "@/components/ui";
import { api, ApiError, newIdempotencyKey } from "@/lib/api";
import { KIND_LABEL, money } from "@/lib/format";
import type { ClientRow, Payment, PaymentKind, Project } from "@/lib/types";

const SERVICES = ["Website Development", "Landing Page", "Web Design", "E-commerce Store", "Website Maintenance", "SEO"];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function NewPaymentPage() {
  return (
    <Shell>
      <Suspense>
        <NewPayment />
      </Suspense>
    </Shell>
  );
}

function NewPayment() {
  const params = useSearchParams();
  const router = useRouter();
  const fromId = params.get("from");
  const onlyClient = params.get("only") === "client";
  const projectId = params.get("project");

  const [kind, setKind] = useState<PaymentKind>(projectId ? "BALANCE" : "FULL");
  const [amount, setAmount] = useState("");
  const [serviceName, setServiceName] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Payment | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [prefillLoading, setPrefillLoading] = useState(!!(fromId || projectId));

  // Idempotency: one key per distinct form submission; a retry of the same values reuses it.
  const idem = useRef<{ key: string; snap: string } | null>(null);

  // Prefill: duplicate a payment, new payment for the same client, or remaining balance of a project.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (projectId) {
          const { project } = await api<{ project: Project }>(`/api/projects/${projectId}`);
          if (cancelled) return;
          setProject(project);
          setKind("BALANCE");
          setClientName(project.client?.name ?? "");
          setClientEmail(project.client?.email ?? "");
        } else if (fromId) {
          const { payment } = await api<{ payment: Payment }>(`/api/payments/${fromId}`);
          if (cancelled) return;
          setClientName(payment.clientName ?? "");
          setClientEmail(payment.clientEmail ?? "");
          if (!onlyClient) {
            setServiceName(payment.serviceName);
            setDescription(payment.description ?? "");
            const total = payment.kind === "DEPOSIT" && payment.project ? payment.project.totalAmount : payment.amount;
            setAmount(String(Number(total)));
            setKind(payment.kind === "BALANCE" ? "FULL" : payment.kind);
          } else {
            setServiceName(payment.serviceName);
          }
        }
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        if (!cancelled) setPrefillLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fromId, onlyClient, projectId]);

  const amountNum = Number(amount);
  const depositPreview = kind === "DEPOSIT" && amountNum > 0 ? Math.floor((Math.round(amountNum * 100) + 1) / 2) / 100 : null;

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (kind !== "BALANCE") {
      if (!amount.trim()) e.amount = "Enter an amount";
      else if (!(amountNum > 0)) e.amount = "Amount must be greater than 0";
      else if (amountNum > 1_000_000) e.amount = "Amount is too large";
      else if (!/^\d+(\.\d{1,2})?$/.test(amount.trim())) e.amount = "Use at most 2 decimals";
      if (!serviceName.trim()) e.serviceName = "Service name is required";
    }
    if (clientEmail.trim() && !EMAIL_RE.test(clientEmail.trim())) e.clientEmail = "Invalid email";
    return e;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (submitting) return;
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length) {
      navigator.vibrate?.(30);
      return;
    }
    const body =
      kind === "BALANCE"
        ? { kind, projectId, clientName: clientName.trim() || null, clientEmail: clientEmail.trim() || null, description: description.trim() || null }
        : {
            kind,
            amount: amount.trim(),
            serviceName: serviceName.trim(),
            clientName: clientName.trim() || null,
            clientEmail: clientEmail.trim() || null,
            description: description.trim() || null,
          };
    const snap = JSON.stringify(body);
    if (!idem.current || idem.current.snap !== snap) idem.current = { key: newIdempotencyKey(), snap };

    setSubmitting(true);
    try {
      const r = await api<{ payment: Payment; replayed: boolean }>("/api/payments", {
        method: "POST",
        json: { ...body, idempotencyKey: idem.current.key },
      });
      setResult(r.payment);
      idem.current = null;
      navigator.vibrate?.([10, 40, 10]);
      toast.success(r.replayed ? "Already created — showing the same link" : "Payment link created");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      const a = err as ApiError;
      if (a.issues?.length) {
        const fe: Record<string, string> = {};
        for (const i of a.issues) fe[i.path] = i.message;
        setErrors(fe);
      }
      toast.error(a.message, a.retryable ? { description: "Tap Create again — it will not create a duplicate." } : undefined);
    } finally {
      setSubmitting(false);
    }
  };

  const reset = () => {
    setResult(null);
    setAmount("");
    setServiceName("");
    setClientName("");
    setClientEmail("");
    setDescription("");
    setErrors({});
    setKind("FULL");
    setProject(null);
    router.replace("/new/");
  };

  if (result) return <Created payment={result} onNew={reset} />;

  const projectRemaining = project ? Number(project.remaining) : 0;

  return (
    <>
      <PageHeader title={kind === "BALANCE" ? "Remaining balance" : "New payment"} subtitle="Creates a real checkout link via 1Pay" />

      <form onSubmit={submit} noValidate className="grid gap-4 lg:grid-cols-[1fr_340px] lg:items-start">
        <div className="card space-y-5 p-4 animate-rise md:p-6">
          {kind !== "BALANCE" && (
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-line bg-surface-2 p-1">
              {(["FULL", "DEPOSIT"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`rounded-lg py-2.5 text-[14px] transition-colors ${kind === k ? "bg-surface-3 text-ink shadow-sm" : "text-muted"}`}
                >
                  {k === "FULL" ? "Full payment" : "50% deposit"}
                </button>
              ))}
            </div>
          )}

          {kind === "BALANCE" ? (
            prefillLoading || !project ? (
              <div className="skeleton h-28" />
            ) : (
              <div className="rounded-xl border border-line bg-surface-2 p-4">
                <div className="label">Project</div>
                <div className="mt-1 text-lg font-medium">{project.serviceName}</div>
                <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                  <div>
                    <div className="text-faint">Total</div>
                    <div className="tabular">{money(project.totalAmount)}</div>
                  </div>
                  <div>
                    <div className="text-faint">Paid</div>
                    <div className="tabular text-ok">{money(project.paid)}</div>
                  </div>
                  <div>
                    <div className="text-faint">To charge</div>
                    <div className="text-[17px] font-semibold tabular">{money(project.remaining)}</div>
                  </div>
                </div>
                {projectRemaining <= 0 && <p className="mt-3 text-sm text-warn">Nothing left to charge on this project.</p>}
              </div>
            )
          ) : (
            <Field label={kind === "DEPOSIT" ? "Project total (USD)" : "Amount (USD)"} error={errors.amount}>
              <div className={`flex items-center rounded-2xl border bg-surface-2 px-4 transition-colors focus-within:border-accent/60 ${errors.amount ? "border-bad/50" : "border-line"}`}>
                <span className="text-[34px] font-light text-faint">$</span>
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(",", ".").replace(/[^\d.]/g, ""))}
                  inputMode="decimal"
                  enterKeyHint="next"
                  placeholder="0.00"
                  autoFocus={!fromId && !projectId}
                  className="w-full bg-transparent py-3 pl-1 text-[40px] font-semibold tracking-tight tabular outline-none placeholder:text-surface-3"
                  aria-label="Amount"
                />
                <span className="text-sm text-faint">USD</span>
              </div>
              {depositPreview !== null && (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted">
                  <span>
                    Charge now: <b className="font-medium text-ink tabular">{money(depositPreview)}</b>
                  </span>
                  <span>
                    Balance later: <span className="tabular">{money(Math.round(amountNum * 100 - depositPreview * 100) / 100)}</span>
                  </span>
                </div>
              )}
            </Field>
          )}

          {kind !== "BALANCE" && (
            <Field label="Service" error={errors.serviceName}>
              <input
                value={serviceName}
                onChange={(e) => setServiceName(e.target.value)}
                placeholder="Website Development"
                className="input"
                maxLength={120}
                enterKeyHint="next"
                autoCapitalize="words"
              />
              <div className="-mx-1 mt-2 flex flex-wrap gap-1.5">
                {SERVICES.map((s) => (
                  <button type="button" key={s} data-active={serviceName === s} onClick={() => setServiceName(s)} className="chip !py-1 !text-[12.5px]">
                    {s}
                  </button>
                ))}
              </div>
            </Field>
          )}

          <ClientPicker
            name={clientName}
            email={clientEmail}
            onName={setClientName}
            onEmail={setClientEmail}
            onPick={(c) => {
              setClientName(c.name ?? "");
              setClientEmail(c.email ?? "");
              if (!serviceName && c.lastService && kind !== "BALANCE") setServiceName(c.lastService);
            }}
            emailError={errors.clientEmail}
          />

          <Field label="Description" optional error={errors.description}>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="Internal description (not shown to the client)"
              className="input resize-none"
            />
          </Field>
        </div>

        {/* Summary / submit — sticky on desktop, inline on phones */}
        <aside className="card space-y-4 p-4 animate-rise md:p-5 lg:sticky lg:top-8">
          <div>
            <div className="label">Client pays</div>
            <div className="mt-1 text-[30px] font-semibold tracking-tight tabular">
              {kind === "BALANCE"
                ? money(project?.remaining ?? 0)
                : depositPreview !== null
                  ? money(depositPreview)
                  : amountNum > 0
                    ? money(amountNum)
                    : "$0.00"}
            </div>
            <div className="text-[13px] text-muted">
              {KIND_LABEL[kind]}
              {(serviceName || project?.serviceName) && ` · ${kind === "BALANCE" ? project?.serviceName : serviceName}`}
            </div>
          </div>
          <button
            type="submit"
            disabled={submitting || prefillLoading || (kind === "BALANCE" && projectRemaining <= 0)}
            className="btn-primary w-full !py-4 text-[16px]"
          >
            {submitting ? (
              <>
                <Spinner /> Creating…
              </>
            ) : (
              <>
                Create payment <ArrowRight size={18} />
              </>
            )}
          </button>
          <p className="text-center text-[12px] leading-relaxed text-faint">
            The amount is charged by 1Pay by card. A card surcharge may be added if enabled in your 1Pay account.
          </p>
        </aside>
      </form>
    </>
  );
}

function ClientPicker({
  name,
  email,
  onName,
  onEmail,
  onPick,
  emailError,
}: {
  name: string;
  email: string;
  onName: (v: string) => void;
  onEmail: (v: string) => void;
  onPick: (c: ClientRow) => void;
  emailError?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [clients, setClients] = useState<ClientRow[]>([]);

  useEffect(() => {
    if (!focused) return;
    const t = setTimeout(async () => {
      try {
        const r = await api<{ clients: ClientRow[] }>(`/api/clients?q=${encodeURIComponent(name.trim())}`);
        setClients(r.clients);
      } catch {
        setClients([]);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [name, focused]);

  const visible = useMemo(
    () => (focused ? clients.filter((c) => !(c.name === name && (c.email ?? "") === email)).slice(0, 5) : []),
    [clients, focused, name, email],
  );

  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="relative">
        <Field label="Client name" optional>
          <input
            value={name}
            onChange={(e) => onName(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setTimeout(() => setFocused(false), 150)}
            placeholder="John Smith"
            className="input"
            maxLength={120}
            autoComplete="off"
            autoCapitalize="words"
            enterKeyHint="next"
          />
        </Field>
        {visible.length > 0 && (
          <div className="absolute inset-x-0 top-full z-20 mt-1.5 overflow-hidden rounded-xl border border-line-strong bg-surface-2 shadow-2xl animate-pop">
            <div className="label px-3 pb-1 pt-2.5">Existing clients</div>
            {visible.map((c) => (
              <button
                key={c.id}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(c);
                  setFocused(false);
                }}
                className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-3"
              >
                <User size={16} className="shrink-0 text-faint" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px]">{c.name || c.email}</span>
                  <span className="block truncate text-[12px] text-faint">
                    {c.email && c.name ? `${c.email} · ` : ""}
                    {c.paymentsCount} payment{c.paymentsCount === 1 ? "" : "s"}
                    {c.lastService ? ` · ${c.lastService}` : ""}
                  </span>
                </span>
                <ChevronRight size={15} className="text-faint" />
              </button>
            ))}
          </div>
        )}
      </div>
      <Field label="Client email" optional error={emailError} hint="1Pay sends the receipt here">
        <input
          value={email}
          onChange={(e) => onEmail(e.target.value)}
          placeholder="john@example.com"
          className="input"
          type="email"
          inputMode="email"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          maxLength={200}
        />
      </Field>
    </div>
  );
}

/** Success screen: shows the real checkout URL and keeps polling the stored status. */
function Created({ payment: initial, onNew }: { payment: Payment; onNew: () => void }) {
  const [p, setP] = useState(initial);

  useEffect(() => {
    if (p.status !== "PENDING" && p.status !== "CREATING") return;
    const t = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const r = await api<{ payment: Payment }>(`/api/payments/${p.id}`);
        if (r.payment.status !== p.status && r.payment.status === "PAID") toast.success("Payment received 🎉");
        setP(r.payment);
      } catch {
        /* keep polling */
      }
    }, 10_000);
    return () => clearInterval(t);
  }, [p.id, p.status]);

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-5 flex flex-col items-center text-center animate-pop">
        <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-ok/15 text-ok ring-1 ring-ok/30">
          <CheckCircle2 size={28} />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Payment link ready</h1>
        <p className="mt-1 text-sm text-muted">Send it to your client — status updates automatically.</p>
      </div>

      <div className="card space-y-4 p-4 animate-rise md:p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-[34px] font-semibold tracking-tight tabular">{money(p.amount, p.currency)}</div>
            <div className="text-sm text-muted">
              {p.serviceName}
              {p.kind !== "FULL" ? ` · ${KIND_LABEL[p.kind]}` : ""}
            </div>
          </div>
          <StatusBadge status={p.status} size="md" />
        </div>

        {p.checkoutUrl ? (
          <>
            <LinkBox url={p.checkoutUrl} />
            <LinkActions url={p.checkoutUrl} title={`Payment: ${p.serviceName}`} />
          </>
        ) : (
          <p className="rounded-xl bg-warn/10 p-3 text-sm text-warn">1Pay has not returned a link yet. Open the payment and tap “Refresh status”.</p>
        )}

        <div>
          <Row label="Client">{p.clientName || "—"}</Row>
          {p.clientEmail && <Row label="Email">{p.clientEmail}</Row>}
          <Row label="Service">{p.serviceName}</Row>
          <Row label="Payment ID" mono>
            {p.onepayId ?? "—"}
          </Row>
          {p.chargedAmount && p.chargedAmount !== p.amount && <Row label="Client is charged">{money(p.chargedAmount, p.currency)}</Row>}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <button onClick={onNew} className="btn-secondary">
          <Plus size={17} /> New payment
        </button>
        <Link href={`/payments/view/?id=${p.id}`} className="btn-secondary">
          <Receipt size={16} /> Details
        </Link>
      </div>
    </div>
  );
}
