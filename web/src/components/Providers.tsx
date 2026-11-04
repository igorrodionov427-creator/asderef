"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Toaster } from "sonner";
import { api, AUTH_LOST_EVENT, BASE_PATH, clearToken, getToken, setToken } from "@/lib/api";
import type { ServerConfig } from "@/lib/types";

type AuthState =
  | { status: "checking" }
  | { status: "locked" }
  | { status: "ready"; config: ServerConfig; expiresAt: string };

interface AuthCtx {
  auth: AuthState;
  unlock: (token: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshConfig: () => Promise<void>;
}

const Ctx = createContext<AuthCtx | null>(null);

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside provider");
  return v;
}

type SessionResponse = { session: { expiresAt: string }; config: ServerConfig };

export function Providers({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthState>({ status: "checking" });

  const load = useCallback(async () => {
    if (!getToken()) {
      setAuth({ status: "locked" });
      return;
    }
    try {
      const r = await api<SessionResponse>("/api/auth/session");
      setAuth({ status: "ready", config: r.config, expiresAt: r.session.expiresAt });
    } catch (e) {
      // Offline or server down with a token present: stay locked rather than leak UI.
      if ((e as { status?: number }).status === 401) clearToken();
      setAuth({ status: "locked" });
    }
  }, []);

  useEffect(() => {
    load();
    const lost = () => setAuth({ status: "locked" });
    window.addEventListener(AUTH_LOST_EVENT, lost);
    return () => window.removeEventListener(AUTH_LOST_EVENT, lost);
  }, [load]);

  // Service worker for installability / offline shell.
  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register(`${BASE_PATH}/sw.js`, { scope: `${BASE_PATH}/` }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    document.title = auth.status === "ready" ? "Agency Pay" : "503 Service Temporarily Unavailable";
  }, [auth.status]);

  const unlock = useCallback(
    async (token: string) => {
      setToken(token);
      await load();
    },
    [load],
  );

  const logout = useCallback(async () => {
    try {
      await api("/api/auth/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    clearToken();
    setAuth({ status: "locked" });
  }, []);

  return (
    <Ctx.Provider value={{ auth, unlock, logout, refreshConfig: load }}>
      {children}
      <Toaster
        theme="dark"
        position="top-center"
        offset={16}
        mobileOffset={{ top: "calc(env(safe-area-inset-top) + 8px)" }}
        toastOptions={{
          style: {
            background: "#13161d",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "#ececf1",
            borderRadius: 14,
          },
        }}
      />
    </Ctx.Provider>
  );
}
