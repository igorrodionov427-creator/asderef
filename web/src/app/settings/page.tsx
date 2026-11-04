"use client";

import { CheckCircle2, CircleAlert, KeyRound, LogOut, MonitorSmartphone, ShieldOff, Smartphone } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/components/Providers";
import { Shell } from "@/components/Shell";
import { CopyButton, Field, PageHeader, Spinner } from "@/components/ui";
import { api, ApiError, clearToken, setToken } from "@/lib/api";
import { dateFull } from "@/lib/format";

export default function SettingsPage() {
  return (
    <Shell>
      <Settings />
    </Shell>
  );
}

function Settings() {
  const { auth, logout } = useAuth();
  if (auth.status !== "ready") return null;
  const c = auth.config;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Settings" />

      <section className="card p-4 animate-rise md:p-5">
        <h2 className="mb-3 font-medium">1Pay connection</h2>
        <ul className="space-y-2.5 text-sm">
          <Check ok={c.onepayConfigured} label="API key" detail={c.onepayConfigured ? (c.livemode ? "Live mode — real payments" : "Test mode — simulated payments") : "ONEPAY_API_KEY is missing"} />
          <Check ok={c.webhookSecretConfigured} label="Webhook signing secret" detail={c.webhookSecretConfigured ? "Signatures are verified" : "ONEPAY_WEBHOOK_SECRET is missing"} />
          <Check ok={!!c.webhookUrl} label="Webhook URL" detail={c.webhookUrl ?? "PUBLIC_API_URL is missing"} />
          <Check ok={c.cronConfigured} label="Scheduled reconciliation" detail={c.cronConfigured ? "Open payments are re-checked automatically" : "CRON_SECRET is missing"} />
          <Check ok label="Payment methods" detail={c.cardOnly ? "Bank cards only" : "Methods from your 1Pay account"} />
        </ul>
        {c.webhookUrl && (
          <div className="mt-4 flex items-center gap-2 rounded-xl bg-surface-2 p-3">
            <code className="min-w-0 flex-1 break-all text-[12.5px] text-muted">{c.webhookUrl}</code>
            <CopyButton text={c.webhookUrl} label="Copy" className="btn-secondary !px-3 !py-2 text-xs" toastText="Webhook URL copied" />
          </div>
        )}
      </section>

      <ChangePin />

      <section className="card p-4 animate-rise md:p-5">
        <h2 className="mb-1 font-medium">Session</h2>
        <p className="mb-4 text-sm text-muted">This device stays signed in until {dateFull(auth.expiresAt)}.</p>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <button onClick={logout} className="btn-secondary">
            <LogOut size={16} /> Sign out
          </button>
          <button
            className="btn-secondary hover:!border-bad/40 hover:!text-bad"
            onClick={async () => {
              if (!confirm("Sign out on every device?")) return;
              try {
                await api("/api/auth/sessions", { method: "DELETE" });
              } catch {
                /* token already gone */
              }
              clearToken();
              location.reload();
            }}
          >
            <ShieldOff size={16} /> Sign out everywhere
          </button>
        </div>
      </section>

      <section className="card p-4 animate-rise md:p-5">
        <h2 className="mb-3 font-medium">Install on your phone</h2>
        <div className="space-y-3 text-sm text-muted">
          <p className="flex gap-2.5">
            <Smartphone size={17} className="mt-0.5 shrink-0 text-faint" />
            <span>
              <b className="font-medium text-ink">iPhone:</b> open in Safari → Share → <i>Add to Home Screen</i>.
            </span>
          </p>
          <p className="flex gap-2.5">
            <MonitorSmartphone size={17} className="mt-0.5 shrink-0 text-faint" />
            <span>
              <b className="font-medium text-ink">Android / desktop Chrome:</b> menu → <i>Install app</i>.
            </span>
          </p>
          <p className="text-[12.5px] text-faint">
            When signed out, the app shows a blank “503” page. Tap the word “server” three times to enter your code.
          </p>
        </div>
      </section>
    </div>
  );
}

function Check({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-2.5">
      {ok ? <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-ok" /> : <CircleAlert size={17} className="mt-0.5 shrink-0 text-warn" />}
      <span className="min-w-0">
        <span className="block">{label}</span>
        <span className="block break-all text-[12.5px] text-faint">{detail}</span>
      </span>
    </li>
  );
}

function ChangePin() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirmNext, setConfirmNext] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const er: Record<string, string> = {};
    if (!current) er.current = "Enter your current code";
    if (!/^\d{4,12}$/.test(next)) er.next = "Use 4–12 digits (the keypad only has digits)";
    if (next !== confirmNext) er.confirm = "Codes do not match";
    setErrors(er);
    if (Object.keys(er).length) return;
    setSaving(true);
    try {
      const r = await api<{ token?: string }>("/api/auth/password", { method: "POST", json: { current, next } });
      if (r.token) setToken(r.token);
      toast.success("Access code changed. Other devices were signed out.");
      setCurrent("");
      setNext("");
      setConfirmNext("");
    } catch (err) {
      const a = err as ApiError;
      const fe: Record<string, string> = {};
      for (const i of a.issues ?? []) fe[i.path] = i.message;
      setErrors(fe);
      if (!a.issues?.length) toast.error(a.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="card space-y-4 p-4 animate-rise md:p-5" noValidate>
      <div className="flex items-center gap-2">
        <KeyRound size={17} className="text-accent" />
        <h2 className="font-medium">Change access code</h2>
      </div>
      <p className="text-[13px] text-muted">
        Longer codes are much harder to guess. Wrong attempts are locked out on the server (5 per device, 10 overall, then an escalating cooldown).
      </p>
      <Field label="Current code" error={errors.current}>
        <input type="password" inputMode="numeric" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className="input" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="New code" error={errors.next}>
          <input type="password" inputMode="numeric" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className="input" />
        </Field>
        <Field label="Repeat new code" error={errors.confirm}>
          <input type="password" inputMode="numeric" autoComplete="new-password" value={confirmNext} onChange={(e) => setConfirmNext(e.target.value)} className="input" />
        </Field>
      </div>
      <button disabled={saving} className="btn-primary w-full sm:w-auto">
        {saving ? <Spinner /> : null} Save code
      </button>
    </form>
  );
}
