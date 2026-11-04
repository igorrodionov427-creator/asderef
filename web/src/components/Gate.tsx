"use client";

import { Delete, Lock, X, ArrowRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useAuth } from "./Providers";

/**
 * Public face of the site: a bland "503" server page. Nothing hints at a
 * payment app. Tapping the word "server" 3× quickly (or opening #unlock) reveals
 * the PIN pad. Brute force is stopped server-side (per-IP + global lockout).
 */
export function Gate() {
  const [open, setOpen] = useState(false);
  const taps = useRef<number[]>([]);

  useEffect(() => {
    const check = () => {
      if (location.hash === "#unlock") setOpen(true);
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);

  const tap = () => {
    const now = Date.now();
    taps.current = [...taps.current.filter((t) => now - t < 1500), now];
    if (taps.current.length >= 3) {
      taps.current = [];
      setOpen(true);
    }
  };

  return (
    <div className="min-h-dvh bg-white text-black" style={{ fontFamily: "Times New Roman, Times, serif" }}>
      <div className="px-2 pt-2">
        <h1 className="m-0 text-center text-[2em] font-bold leading-tight">503 Service Temporarily Unavailable</h1>
        <hr className="my-2 border-t border-gray-400" />
        <p className="text-center text-[16px]">
          {/* Hidden unlock: tap "server" 3× quickly. Padding gives a finger-sized target. */}
          <span onClick={tap} className="inline-block cursor-default select-none px-4 py-2" style={{ WebkitUserSelect: "none" }}>
            server
          </span>
        </p>
      </div>
      {open && (
        <PinPad
          onClose={() => {
            setOpen(false);
            if (location.hash) history.replaceState(null, "", location.pathname + location.search);
          }}
        />
      )}
    </div>
  );
}

function PinPad({ onClose }: { onClose: () => void }) {
  const { unlock } = useAuth();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!lockedUntil) return;
    const t = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= lockedUntil) {
        setLockedUntil(null);
        setError(null);
      }
    }, 500);
    return () => clearInterval(t);
  }, [lockedUntil]);

  const locked = lockedUntil !== null && lockedUntil > now;

  const submit = useCallback(async () => {
    if (busy || locked || pin.length < 4) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ token: string }>("/api/auth/login", { method: "POST", json: { pin } });
      await unlock(r.token);
    } catch (e) {
      const err = e as ApiError;
      setPin("");
      setShake((s) => s + 1);
      if (err.status === 429 && err.retryAfter) {
        setLockedUntil(Date.now() + err.retryAfter * 1000);
        setNow(Date.now());
        setError("Too many attempts");
      } else if (err.status === 401) {
        setError("Wrong code");
      } else {
        setError(err.message || "Unavailable");
      }
    } finally {
      setBusy(false);
    }
  }, [busy, locked, pin, unlock]);

  const press = useCallback(
    (d: string) => {
      if (busy || locked) return;
      setError(null);
      setPin((p) => (p.length >= 12 ? p : p + d));
    },
    [busy, locked],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") setPin((p) => p.slice(0, -1));
      else if (e.key === "Enter") submit();
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [press, submit, onClose]);

  const left = locked ? Math.ceil((lockedUntil! - now) / 1000) : 0;
  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  const slots = Math.max(4, pin.length);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 font-sans text-ink backdrop-blur-sm animate-fade sm:items-center">
      <div className="safe-bottom w-full max-w-sm rounded-t-3xl border border-line bg-surface p-6 pb-8 animate-rise sm:rounded-3xl">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2 text-muted">
            <Lock size={16} />
            <span className="text-sm">Access code</span>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-full p-2 text-faint hover:bg-surface-2 hover:text-ink">
            <X size={18} />
          </button>
        </div>

        <div key={shake} className={`mb-3 flex h-6 items-center justify-center gap-3 ${shake ? "animate-shake" : ""}`}>
          {Array.from({ length: slots }).map((_, i) => (
            <span
              key={i}
              className={`h-3 w-3 rounded-full transition-all duration-150 ${
                i < pin.length ? "scale-110 bg-accent" : "bg-surface-3"
              }`}
            />
          ))}
        </div>
        <p className={`mb-5 h-5 text-center text-sm ${error ? "text-bad" : "text-transparent"}`} aria-live="polite">
          {locked ? `Locked · try again in ${mm}:${ss}` : error ?? "·"}
        </p>

        <div className="grid grid-cols-3 gap-3">
          {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
            <Key key={d} onClick={() => press(d)} disabled={busy || locked}>
              {d}
            </Key>
          ))}
          <Key onClick={() => setPin((p) => p.slice(0, -1))} disabled={busy || locked || !pin} aria-label="Delete">
            <Delete size={22} />
          </Key>
          <Key onClick={() => press("0")} disabled={busy || locked}>
            0
          </Key>
          <Key
            onClick={submit}
            disabled={busy || locked || pin.length < 4}
            aria-label="Unlock"
            className="!bg-accent/90 text-white disabled:!bg-surface-2 disabled:text-faint"
          >
            {busy ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <ArrowRight size={22} />}
          </Key>
        </div>
      </div>
    </div>
  );
}

function Key({ className = "", ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`flex h-14 items-center sm:h-16 justify-center rounded-2xl bg-surface-2 text-2xl font-light tabular
        transition-[transform,background-color] duration-100 active:scale-95 active:bg-surface-3 disabled:opacity-40 ${className}`}
    />
  );
}
