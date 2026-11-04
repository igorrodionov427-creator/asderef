"use client";

export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";
const TOKEN_KEY = "ap.session";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
    public issues: { path: string; message: string }[] = [],
    public retryAfter?: number,
    public retryable?: boolean,
  ) {
    super(message);
  }
}

// ─── API base URL ── read at runtime from /config.json (editable without rebuild) ──
let apiBasePromise: Promise<string> | null = null;

export function apiBase(): Promise<string> {
  if (!apiBasePromise) {
    apiBasePromise = (async () => {
      const fromEnv = process.env.NEXT_PUBLIC_API_URL;
      if (fromEnv) return fromEnv.replace(/\/+$/, "");
      try {
        const r = await fetch(`${BASE_PATH}/config.json`, { cache: "no-store" });
        const j = (await r.json()) as { apiUrl?: string };
        return (j.apiUrl ?? "").trim().replace(/\/+$/, "");
      } catch {
        return "";
      }
    })();
  }
  return apiBasePromise;
}

// ─── Session token ──
export const getToken = () => (typeof window === "undefined" ? null : localStorage.getItem(TOKEN_KEY));
export const setToken = (t: string) => localStorage.setItem(TOKEN_KEY, t);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

export const AUTH_LOST_EVENT = "agencypay:auth-lost";

async function request(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
  const base = await apiBase();
  if (!base) throw new ApiError("Server address is not configured yet.", 0, "not_configured");
  const headers = new Headers(init.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, { ...init, headers, body, cache: "no-store", credentials: "omit" });
  } catch {
    throw new ApiError("Network error — check your connection.", 0, "network", [], undefined, true);
  }
  if (res.status === 401 && token && !path.startsWith("/api/auth/login")) {
    clearToken();
    window.dispatchEvent(new Event(AUTH_LOST_EVENT));
  }
  return res;
}

async function toError(res: Response): Promise<ApiError> {
  let j: Record<string, unknown> = {};
  try {
    j = await res.json();
  } catch {
    /* not json */
  }
  return new ApiError(
    String(j.message ?? `Request failed (${res.status})`),
    res.status,
    String(j.error ?? "error"),
    Array.isArray(j.issues) ? (j.issues as { path: string; message: string }[]) : [],
    typeof j.retryAfter === "number" ? j.retryAfter : undefined,
    typeof j.retryable === "boolean" ? j.retryable : undefined,
  );
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const res = await request(path, init);
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}

export async function apiBlob(path: string): Promise<{ blob: Blob; filename: string }> {
  const res = await request(path);
  if (!res.ok) throw await toError(res);
  const cd = res.headers.get("content-disposition") ?? "";
  const filename = /filename="([^"]+)"/.exec(cd)?.[1] ?? "export.csv";
  return { blob: await res.blob(), filename };
}

export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") return `ap_${crypto.randomUUID().replace(/-/g, "")}`;
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return `ap_${Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}
