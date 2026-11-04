"use client";

import { AlertTriangle, ArrowLeft, Ban, CopyPlus, RefreshCw, Trash2, UserPlus, Wallet } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Shell } from "@/components/Shell";
import { CopyButton, ErrorBox, LinkActions, LinkBox, Row, Spinner, StatusBadge } from "@/components/ui";
import { api } from "@/lib/api";
import { dateFull, KIND_LABEL, money, relative } from "@/lib/format";
import type { Note, Payment, Project } from "@/lib/types";

export default function PaymentViewPage() {
  return (
    <Shell>
      <Suspense>
        <PaymentView />
      </Suspense>
    </Shell>
  );
}

function PaymentView() {
  const id = useSearchParams().get("id") ?? "";
  const [p, setP] = useState<Payment | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setError(null);
      const r = await api<{ payment: Payment }>(`/api/payments/${id}`);
      setP(r.payment);
      if (r.payment.projectId) {
        const pr = await api<{ project: Project }>(`/api/projects/${r.payment.projectId}`);
        setProject(pr.project);
      } else setProject(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // While awaiting payment, poll our DB (updated by webhooks / reconciliation).
  useEffect(() => {
    if (!p || (p.status !== "PENDING" && p.status !== "CREATING")) return;
    const t = setInterval(() => document.visibilityState === "visible" && load(), 15_000);
    return () => clearInterval(t);
  }, [p, load]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      const r = await api<{ payment: Payment }>(`/api/payments/${id}/refresh`, { method: "POST" });
      setP((old) => ({ ...old!, ...r.payment }));
      toast.success("Status checked with 1Pay");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRefreshing(false);
    }
  };

  const cancel = async () => {
    if (!confirm("Cancel this payment? The checkout link will stop accepting payments.")) return;
    setCancelling(true);
    try {
      await api(`/api/payments/${id}/cancel`, { method: "POST" });
      toast.success("Payment cancelled");
      load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setCancelling(false);
    }
  };

  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!p)
    return (
      <div className="space-y-4">
        <div className="skeleton h-8 w-40" />
        <div className="skeleton h-56" />
        <div className="skeleton h-40" />
      </div>
    );

  const remaining = project ? Number(project.remaining) : 0;

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/payments/" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft size={16} /> Payments
      </Link>

      {/* Header */}
      <section className="card mb-4 space-y-4 p-4 animate-rise md:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[13px] text-muted">
              {KIND_LABEL[p.kind]}
              {p.livemode === false && <span className="ml-2 rounded-full bg-warn/15 px-2 py-0.5 text-[11px] text-warn">TEST</span>}
            </div>
            <div className="mt-1 text-[36px] font-semibold leading-none tracking-tight tabular">{money(p.amount, p.currency)}</div>
            <div className="mt-2 truncate text-[15px]">{p.clientName || "No client name"}</div>
            <div className="truncate text-sm text-muted">{p.serviceName}</div>
          </div>
          <StatusBadge status={p.status} size="md" />
        </div>

        {p.verifyError && (
          <div className="flex gap-2.5 rounded-xl border border-bad/25 bg-bad/10 p-3 text-sm text-bad">
            <AlertTriangle size={17} className="mt-0.5 shrink-0" />
            <span>
              Verification failed: {p.verifyError}. The payment was <b>not</b> marked as paid. Check it in your 1Pay dashboard.
            </span>
          </div>
        )}
        {p.lastError && !p.verifyError && (
          <div className="flex gap-2.5 rounded-xl border border-warn/25 bg-warn/10 p-3 text-sm text-warn">
            <AlertTriangle size={17} className="mt-0.5 shrink-0" />
            <span>{p.lastError}</span>
          </div>
        )}

        {p.checkoutUrl && (
          <>
            <LinkBox url={p.checkoutUrl} />
            <LinkActions url={p.checkoutUrl} title={`Payment: ${p.serviceName}`} />
          </>
        )}

        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <button onClick={refresh} disabled={refreshing} className="btn-ghost !px-3 !py-2 text-sm">
            {refreshing ? <Spinner size={15} /> : <RefreshCw size={15} />} {p.onepayId ? "Refresh status" : "Retry lookup"}
          </button>
          <Link href={`/new/?from=${p.id}`} className="btn-ghost !px-3 !py-2 text-sm">
            <CopyPlus size={15} /> Duplicate
          </Link>
          {(p.clientName || p.clientEmail) && (
            <Link href={`/new/?from=${p.id}&only=client`} className="btn-ghost !px-3 !py-2 text-sm">
              <UserPlus size={15} /> New for client
            </Link>
          )}
          {p.status === "PENDING" && p.onepayId && (
            <button onClick={cancel} disabled={cancelling} className="btn-ghost !px-3 !py-2 text-sm hover:!text-bad">
              {cancelling ? <Spinner size={15} /> : <Ban size={15} />} Cancel
            </button>
          )}
        </div>
      </section>

      {/* Project (deposit / balance) */}
      {project && (
        <section className="card mb-4 p-4 animate-rise md:p-6">
          <div className="mb-3 flex items-center gap-2">
            <Wallet size={17} className="text-accent" />
            <h2 className="font-medium">Project · {project.serviceName}</h2>
          </div>
          <div className="mb-4 grid grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-faint">Total</div>
              <div className="tabular">{money(project.totalAmount)}</div>
            </div>
            <div>
              <div className="text-faint">Paid</div>
              <div className="tabular text-ok">{money(project.paid)}</div>
            </div>
            <div>
              <div className="text-faint">Not yet billed</div>
              <div className="tabular">{money(project.remaining)}</div>
            </div>
          </div>
          <div className="divide-y divide-line rounded-xl border border-line">
            {project.payments.map((pp) => (
              <Link key={pp.id} href={`/payments/view/?id=${pp.id}`} className={`flex items-center justify-between gap-3 px-3 py-2.5 text-sm hover:bg-surface-2 ${pp.id === p.id ? "bg-surface-2" : ""}`}>
                <span>{KIND_LABEL[pp.kind]}</span>
                <span className="flex items-center gap-2">
                  <span className="tabular">{money(pp.amount)}</span>
                  <StatusBadge status={pp.status} />
                </span>
              </Link>
            ))}
          </div>
          {remaining > 0 && (
            <Link href={`/new/?project=${project.id}`} className="btn-primary mt-4 w-full">
              Create remaining balance · {money(project.remaining)}
            </Link>
          )}
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {/* Details */}
        <section className="card p-4 animate-rise md:p-5">
          <h2 className="mb-1 font-medium">Details</h2>
          <Row label="1Pay payment ID" mono>
            {p.onepayId ? (
              <span className="inline-flex items-center gap-2">
                {p.onepayId}
                <CopyButton text={p.onepayId} label="" className="text-faint hover:text-ink" toastText="ID copied" />
              </span>
            ) : (
              "—"
            )}
          </Row>
          <Row label="Internal ID" mono>{p.id}</Row>
          <Row label="Status">{p.status === "PENDING" && p.expiresAt ? `Expires ${relative(p.expiresAt).replace("ago", "from now")}` : p.status.toLowerCase()}</Row>
          <Row label="Amount">{money(p.amount, p.currency)}</Row>
          {p.chargedAmount && <Row label="Client charged">{money(p.chargedAmount, p.currency)}</Row>}
          <Row label="Currency">{p.currency}</Row>
          <Row label="Client">{p.clientName || "—"}</Row>
          <Row label="Email">{p.clientEmail || "—"}</Row>
          <Row label="Service">{p.serviceName}</Row>
          {p.description && <Row label="Description">{p.description}</Row>}
          <Row label="Created">{dateFull(p.createdAt)}</Row>
          <Row label="Paid">{dateFull(p.paidAt)}</Row>
          {p.settledAmount && (
            <Row label="Settled to wallet">
              {money(p.settledAmount)} {p.settledAsset ? `· ${p.settledAsset}` : ""}
            </Row>
          )}
          {p.txidOut && <Row label="Payout tx" mono>{p.txidOut}</Row>}
          <Row label="Last checked">{p.lastSyncedAt ? relative(p.lastSyncedAt) : "—"}</Row>
        </section>

        <div className="space-y-4">
          <Notes paymentId={p.id} notes={p.notes ?? []} onChange={load} />

          <section className="card p-4 animate-rise md:p-5">
            <h2 className="mb-2 font-medium">Webhook log</h2>
            {!p.events?.length ? (
              <p className="text-sm text-faint">No notifications from 1Pay yet.</p>
            ) : (
              <ul className="space-y-2.5">
                {p.events.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-3 text-sm">
                    <div className="min-w-0">
                      <div className="font-mono text-[12.5px]">{e.type}</div>
                      {e.error && <div className="truncate text-[12px] text-bad">{e.error}</div>}
                    </div>
                    <div className="shrink-0 text-right text-[12px]">
                      <div className={e.status === "PROCESSED" ? "text-ok" : e.status === "ERROR" || e.status === "REJECTED" ? "text-bad" : "text-muted"}>
                        {e.status.toLowerCase()}
                      </div>
                      <div className="text-faint">{relative(e.receivedAt)}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Notes({ paymentId, notes, onChange }: { paymentId: string; notes: Note[]; onChange: () => void }) {
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim() || saving) return;
    setSaving(true);
    try {
      await api(`/api/payments/${paymentId}/notes`, { method: "POST", json: { body: body.trim() } });
      setBody("");
      onChange();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async (noteId: string) => {
    try {
      await api(`/api/payments/${paymentId}/notes/${noteId}`, { method: "DELETE" });
      onChange();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <section className="card p-4 animate-rise md:p-5">
      <h2 className="mb-3 font-medium">Internal notes</h2>
      <form onSubmit={add} className="mb-3 flex gap-2">
        <input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note…" className="input !py-2.5" maxLength={2000} enterKeyHint="send" />
        <button disabled={!body.trim() || saving} className="btn-secondary shrink-0 !px-4 !py-2.5 text-sm">
          {saving ? <Spinner size={15} /> : "Add"}
        </button>
      </form>
      {notes.length === 0 ? (
        <p className="text-sm text-faint">Only you can see notes.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="group flex items-start justify-between gap-2 rounded-xl bg-surface-2 px-3 py-2.5">
              <div className="min-w-0">
                <p className="whitespace-pre-wrap break-words text-[14px]">{n.body}</p>
                <p className="mt-0.5 text-[11.5px] text-faint">{relative(n.createdAt)}</p>
              </div>
              <button onClick={() => remove(n.id)} aria-label="Delete note" className="rounded-lg p-1.5 text-faint hover:bg-surface-3 hover:text-bad">
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
