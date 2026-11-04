"use client";

import { ArrowDownUp, ChevronLeft, ChevronRight, Download, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Shell } from "@/components/Shell";
import { Empty, ErrorBox, PageHeader, PaymentRow, Spinner, StatusBadge } from "@/components/ui";
import { api, apiBlob } from "@/lib/api";
import { dateTime, KIND_LABEL, money } from "@/lib/format";
import type { Payment } from "@/lib/types";

const FILTERS = [
  { v: "ALL", label: "All" },
  { v: "PAID", label: "Paid" },
  { v: "OPEN", label: "Pending" },
  { v: "ISSUES", label: "Expired / failed" },
  { v: "CREATE_FAILED", label: "Not created" },
] as const;

type ListResponse = { items: Payment[]; page: number; pages: number; total: number };

export default function PaymentsPage() {
  return (
    <Shell>
      <Suspense>
        <PaymentsList />
      </Suspense>
    </Shell>
  );
}

function PaymentsList() {
  const params = useSearchParams();
  const router = useRouter();
  const status = params.get("status") ?? "ALL";
  const sort = params.get("sort") === "oldest" ? "oldest" : "newest";
  const page = Math.max(1, Number(params.get("page") ?? 1) || 1);
  const qParam = params.get("q") ?? "";

  const [q, setQ] = useState(qParam);
  const [data, setData] = useState<ListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const setParams = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "" || (k === "status" && v === "ALL") || (k === "page" && v === "1") || (k === "sort" && v === "newest")) next.delete(k);
        else next.set(k, v);
      }
      const s = next.toString();
      router.replace(`/payments/${s ? `?${s}` : ""}`, { scroll: false });
    },
    [params, router],
  );

  // Debounced search → URL
  useEffect(() => {
    if (q === qParam) return;
    const t = setTimeout(() => setParams({ q: q.trim() || null, page: "1" }), 300);
    return () => clearTimeout(t);
  }, [q, qParam, setParams]);

  const query = new URLSearchParams({ status, sort, page: String(page), pageSize: "20", ...(qParam ? { q: qParam } : {}) }).toString();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setError(null);
      setData(await api<ListResponse>(`/api/payments?${query}`));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    load();
  }, [load]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const { blob, filename } = await apiBlob(`/api/payments/export?${query}`);
      const file = new File([blob], filename, { type: "text/csv" });
      // iOS home-screen apps can't download; the share sheet can save to Files.
      if (navigator.canShare?.({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
        await navigator.share({ files: [file], title: filename }).catch(() => {});
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
      toast.success("CSV exported");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Payments"
        subtitle={data ? `${data.total} ${data.total === 1 ? "payment" : "payments"}` : "Payment history"}
        action={
          <button onClick={exportCsv} disabled={exporting} className="btn-secondary !px-3 !py-2.5 text-sm">
            {exporting ? <Spinner size={15} /> : <Download size={16} />}
            <span className="hidden sm:inline">Export CSV</span>
          </button>
        }
      />

      <div className="mb-4 space-y-3 animate-rise">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-faint" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Client, service or payment ID"
              className="input !pl-10 !pr-10"
              inputMode="search"
              enterKeyHint="search"
              autoCapitalize="off"
              autoCorrect="off"
            />
            {q && (
              <button onClick={() => setQ("")} aria-label="Clear" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-faint hover:text-ink">
                <X size={16} />
              </button>
            )}
          </div>
          <button
            onClick={() => setParams({ sort: sort === "newest" ? "oldest" : "newest", page: "1" })}
            className="btn-secondary shrink-0 !px-3 text-sm"
            aria-label="Toggle sort"
          >
            <ArrowDownUp size={16} />
            <span className="hidden sm:inline">{sort === "newest" ? "Newest" : "Oldest"}</span>
          </button>
        </div>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {FILTERS.map((f) => (
            <button key={f.v} data-active={status === f.v} onClick={() => setParams({ status: f.v, page: "1" })} className="chip shrink-0">
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="mb-4"><ErrorBox message={error} onRetry={load} /></div>}

      <section className={`card overflow-hidden transition-opacity ${loading && data ? "opacity-60" : ""}`}>
        {!data ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="skeleton h-12" />
            ))}
          </div>
        ) : data.items.length === 0 ? (
          <Empty title={qParam || status !== "ALL" ? "Nothing matches" : "No payments yet"}>
            {qParam || status !== "ALL" ? "Try another search or filter." : <Link href="/new/" className="text-accent">Create a payment →</Link>}
          </Empty>
        ) : (
          <>
            {/* Phones: compact rows */}
            <div className="divide-y divide-line md:hidden">
              {data.items.map((p) => (
                <PaymentRow key={p.id} p={p} />
              ))}
            </div>
            {/* Desktop: table */}
            <table className="hidden w-full text-left text-sm md:table">
              <thead>
                <tr className="border-b border-line text-[12px] uppercase tracking-wider text-faint">
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Service</th>
                  <th className="px-4 py-3 text-right font-medium">Amount</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">1Pay ID</th>
                  <th className="px-4 py-3 font-medium">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.items.map((p) => (
                  <tr
                    key={p.id}
                    onClick={() => router.push(`/payments/view/?id=${p.id}`)}
                    className="cursor-pointer transition-colors hover:bg-surface-2"
                  >
                    <td className="px-4 py-3">
                      <div className="font-medium">{p.clientName || "—"}</div>
                      <div className="text-[12.5px] text-faint">{p.clientEmail}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{p.serviceName}</div>
                      {p.kind !== "FULL" && <div className="text-[12.5px] text-faint">{KIND_LABEL[p.kind]}</div>}
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular">{money(p.amount, p.currency)}</td>
                    <td className="px-4 py-3"><StatusBadge status={p.status} /></td>
                    <td className="px-4 py-3 font-mono text-[12.5px] text-muted">{p.onepayId ?? "—"}</td>
                    <td className="px-4 py-3 text-muted">{dateTime(p.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      {data && data.pages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <button className="btn-secondary !py-2.5 text-sm" disabled={page <= 1} onClick={() => setParams({ page: String(page - 1) })}>
            <ChevronLeft size={16} /> Prev
          </button>
          <span className="text-sm text-muted tabular">
            Page {data.page} of {data.pages}
          </span>
          <button className="btn-secondary !py-2.5 text-sm" disabled={page >= data.pages} onClick={() => setParams({ page: String(page + 1) })}>
            Next <ChevronRight size={16} />
          </button>
        </div>
      )}
    </>
  );
}
