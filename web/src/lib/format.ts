import type { PaymentKind, PaymentStatus } from "./types";

const usdFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usdShort = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function money(v: string | number | null | undefined, currency = "USD"): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "number" ? v : Number(v);
  if (currency === "USD") return usdFmt.format(n);
  return `${n.toFixed(2)} ${currency}`;
}

export const moneyShort = (n: number) => usdShort.format(n);

export function dateTime(v: string | null | undefined): string {
  if (!v) return "—";
  return new Date(v).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function dateFull(v: string | null | undefined): string {
  if (!v) return "—";
  return new Date(v).toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function relative(v: string | null | undefined): string {
  if (!v) return "—";
  const diff = (Date.now() - new Date(v).getTime()) / 1000;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60) return "just now";
  if (abs < 3600) return rtf.format(-Math.round(diff / 60), "minute");
  if (abs < 86400) return rtf.format(-Math.round(diff / 3600), "hour");
  if (abs < 86400 * 30) return rtf.format(-Math.round(diff / 86400), "day");
  return dateTime(v);
}

export const STATUS_META: Record<PaymentStatus, { label: string; tone: "ok" | "warn" | "bad" | "muted" | "info" }> = {
  CREATING: { label: "Creating", tone: "info" },
  CREATE_FAILED: { label: "Not created", tone: "bad" },
  PENDING: { label: "Awaiting payment", tone: "warn" },
  PAID: { label: "Paid", tone: "ok" },
  UNDERPAID: { label: "Underpaid", tone: "bad" },
  EXPIRED: { label: "Expired", tone: "muted" },
  FAILED: { label: "Failed", tone: "bad" },
};

export const KIND_LABEL: Record<PaymentKind, string> = {
  FULL: "Full payment",
  DEPOSIT: "50% deposit",
  BALANCE: "Remaining balance",
};

export function initials(name: string | null | undefined): string {
  if (!name) return "—";
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]!.toUpperCase())
    .join("");
}
