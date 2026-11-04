"use client";

import { ArrowUpRight, CircleCheck, Clock, Plus, Receipt, XCircle } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RevenueChart } from "@/components/RevenueChart";
import { Shell } from "@/components/Shell";
import { Empty, ErrorBox, PageHeader, PaymentRow } from "@/components/ui";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import type { Stats } from "@/lib/types";

const RANGES = ["7", "30", "90"] as const;

export default function DashboardPage() {
  return (
    <Shell>
      <Dashboard />
    </Shell>
  );
}

function Dashboard() {
  const [range, setRange] = useState<(typeof RANGES)[number]>("30");
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const s = await api<Stats>(`/api/stats?range=${range}&tz=${new Date().getTimezoneOffset()}`);
      setStats(s);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [range]);

  useEffect(() => {
    load();
    // Live-ish: statuses change via webhooks, refresh while the screen is open.
    const t = setInterval(() => document.visibilityState === "visible" && load(), 30_000);
    const vis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", vis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [load]);

  const t = stats?.totals;

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Live from your payment records"
        action={
          <Link href="/new/" className="btn-primary hidden !py-2.5 md:inline-flex">
            <Plus size={17} /> New payment
          </Link>
        }
      />

      {error && <div className="mb-4"><ErrorBox message={error} onRetry={load} /></div>}

      {/* Revenue hero */}
      <section className="card mb-4 overflow-hidden p-5 animate-rise md:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="label">Total revenue</div>
            {t ? (
              <div className="mt-2 text-[34px] font-semibold tracking-tight tabular md:text-[40px]">{money(t.revenue)}</div>
            ) : (
              <div className="skeleton mt-3 h-10 w-44" />
            )}
            <div className="mt-1 text-sm text-muted">
              {stats ? (
                <>
                  <span className="text-ok">{money(stats.range.revenue)}</span> in the last {stats.range.days} days ·{" "}
                  {stats.range.paidCount} paid
                </>
              ) : (
                <span className="skeleton inline-block h-4 w-40" />
              )}
            </div>
          </div>
          <div className="flex rounded-xl border border-line bg-surface-2 p-1">
            {RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`rounded-lg px-3 py-1.5 text-[13px] transition-colors ${
                  range === r ? "bg-surface-3 text-ink shadow-sm" : "text-muted hover:text-ink"
                }`}
              >
                {r}d
              </button>
            ))}
          </div>
        </div>
        <div className="mt-5">{stats ? <RevenueChart data={stats.range.series} /> : <div className="skeleton h-56 md:h-64" />}</div>
      </section>

      {/* KPIs */}
      <section className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi icon={Receipt} label="Total payments" value={t?.payments} tone="text-ink" href="/payments/" />
        <Kpi icon={CircleCheck} label="Successful" value={t?.paid} tone="text-ok" href="/payments/?status=PAID" />
        <Kpi icon={Clock} label="Pending" value={t?.pending} tone="text-warn" href="/payments/?status=OPEN" />
        <Kpi
          icon={XCircle}
          label="Failed / expired"
          value={t?.failed}
          tone="text-bad"
          href="/payments/?status=ISSUES"
          hint={t ? `${t.breakdown.expired} expired · ${t.breakdown.underpaid} underpaid` : undefined}
        />
      </section>

      {/* Recent */}
      <section className="card overflow-hidden animate-rise">
        <div className="flex items-center justify-between border-b border-line px-4 py-3.5">
          <h2 className="text-[15px] font-medium">Recent payments</h2>
          <Link href="/payments/" className="flex items-center gap-1 text-[13px] text-muted hover:text-ink">
            View all <ArrowUpRight size={14} />
          </Link>
        </div>
        {!stats ? (
          <div className="space-y-3 p-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-12" />
            ))}
          </div>
        ) : stats.recent.length === 0 ? (
          <Empty title="No payments yet">
            <Link href="/new/" className="text-accent">Create your first payment link →</Link>
          </Empty>
        ) : (
          <div className="divide-y divide-line">
            {stats.recent.map((p) => (
              <PaymentRow key={p.id} p={p} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  tone,
  href,
  hint,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value?: number;
  tone: string;
  href: string;
  hint?: string;
}) {
  return (
    <Link href={href} className="card group p-4 transition-colors hover:border-line-strong animate-rise">
      <div className="flex items-center justify-between">
        <span className="text-[13px] text-muted">{label}</span>
        <Icon size={16} className={tone} />
      </div>
      {value === undefined ? (
        <div className="skeleton mt-3 h-8 w-12" />
      ) : (
        <div className="mt-2 text-[28px] font-semibold tracking-tight tabular">{value}</div>
      )}
      {hint && <div className="mt-0.5 truncate text-[11.5px] text-faint">{hint}</div>}
    </Link>
  );
}
