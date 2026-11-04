"use client";

import { Check, Copy, ExternalLink, Share2 } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import { toast } from "sonner";
import { KIND_LABEL, money, relative, STATUS_META } from "@/lib/format";
import type { Payment, PaymentStatus } from "@/lib/types";

export function Logo({ size = 30 }: { size?: number }) {
  const gid = `lg${useId().replace(/:/g, "")}`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a497ff" />
          <stop offset="1" stopColor="#5aa8ff" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${gid})`} />
      <path d="M9 22.5 15.2 9h1.6L23 22.5h-3.1l-1.3-3h-5.2l-1.3 3H9Zm5.4-5.6h3.2L16 13l-1.6 3.9Z" fill="#fff" />
    </svg>
  );
}

const TONE: Record<string, string> = {
  ok: "bg-ok/12 text-ok ring-ok/25",
  warn: "bg-warn/12 text-warn ring-warn/25",
  bad: "bg-bad/12 text-bad ring-bad/25",
  muted: "bg-white/5 text-muted ring-white/10",
  info: "bg-info/12 text-info ring-info/25",
};

export function StatusBadge({ status, size = "sm" }: { status: PaymentStatus; size?: "sm" | "md" }) {
  const m = STATUS_META[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full ring-1 ring-inset ${TONE[m.tone]} ${
        size === "md" ? "px-3 py-1 text-[13px]" : "px-2 py-0.5 text-[11.5px]"
      } font-medium`}
    >
      <span className={`h-1.5 w-1.5 rounded-full bg-current ${status === "PENDING" || status === "CREATING" ? "animate-pulse" : ""}`} />
      {m.label}
    </span>
  );
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for older iOS / non-secure contexts.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}

export function CopyButton({
  text,
  label = "Copy link",
  className = "btn-primary",
  toastText = "Payment link copied",
}: {
  text: string;
  label?: string;
  className?: string;
  toastText?: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          toast.success(toastText);
          navigator.vibrate?.(10);
          setTimeout(() => setDone(false), 1600);
        } else toast.error("Could not copy");
      }}
    >
      {done ? <Check size={17} /> : <Copy size={17} />}
      {done ? "Copied" : label}
    </button>
  );
}

export function LinkActions({ url, title }: { url: string; title: string }) {
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:flex sm:flex-wrap">
      <CopyButton text={url} className="btn-primary col-span-2 sm:col-span-1" label="Copy payment link" />
      <a href={url} target="_blank" rel="noopener noreferrer" className={`btn-secondary ${canShare ? "" : "col-span-2"}`}>
        <ExternalLink size={17} /> Open checkout
      </a>
      {canShare && (
        <button type="button" className="btn-secondary" onClick={() => navigator.share({ title, url }).catch(() => {})}>
          <Share2 size={17} /> Share
        </button>
      )}
    </div>
  );
}

export function LinkBox({ url }: { url: string }) {
  return (
    <div className="rounded-xl border border-accent/25 bg-accent/[0.06] px-3.5 py-3">
      <div className="label mb-1 !text-accent/80">Checkout URL</div>
      <div className="break-all font-mono text-[14px] leading-relaxed text-ink">{url}</div>
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex items-end justify-between gap-4 animate-rise">
      <div className="min-w-0">
        <h1 className="text-[26px] font-semibold tracking-tight md:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <span
      style={{ width: size, height: size }}
      className="inline-block animate-spin rounded-full border-2 border-current/25 border-t-current"
    />
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-3 h-10 w-10 rounded-2xl border border-line bg-surface-2" />
      <p className="font-medium">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card flex items-center justify-between gap-3 border-bad/25 p-4 text-sm">
      <span className="text-bad">{message}</span>
      {onRetry && (
        <button className="btn-secondary !py-2 text-sm" onClick={onRetry}>
          Retry
        </button>
      )}
    </div>
  );
}

/** Compact payment row used in lists (mobile-first). */
export function PaymentRow({ p }: { p: Payment }) {
  return (
    <Link
      href={`/payments/view/?id=${p.id}`}
      className="flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-2 active:bg-surface-2"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-2 text-[13px] font-medium text-muted">
        {(p.clientName ?? p.serviceName).slice(0, 1).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium">{p.clientName || p.serviceName}</div>
        <div className="truncate text-[13px] text-muted">
          {p.clientName ? p.serviceName : KIND_LABEL[p.kind]}
          {p.kind !== "FULL" && p.clientName ? ` · ${KIND_LABEL[p.kind]}` : ""} · {relative(p.createdAt)}
        </div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <div className="tabular text-[15px] font-medium">{money(p.amount, p.currency)}</div>
        <StatusBadge status={p.status} />
      </div>
    </Link>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  optional,
}: {
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between text-[13px] font-medium text-muted">
        <span>{label}</span>
        {optional && <span className="text-[12px] font-normal text-faint">Optional</span>}
      </span>
      {children}
      {error ? <span className="mt-1.5 block text-[13px] text-bad">{error}</span> : hint ? <span className="mt-1.5 block text-[12.5px] text-faint">{hint}</span> : null}
    </label>
  );
}

export function Row({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-3 last:border-0">
      <span className="shrink-0 text-[13.5px] text-muted">{label}</span>
      <span className={`min-w-0 text-right text-[14px] ${mono ? "break-all font-mono text-[13px]" : "break-words"}`}>{children}</span>
    </div>
  );
}
