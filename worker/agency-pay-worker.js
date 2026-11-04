// =============================================================================
//  agency-pay-worker.js — Agency Pay backend as ONE Cloudflare Worker file.
//  Paste into Cloudflare → Workers → (new worker) → Edit code → Deploy.
//  No build step, no dependencies. Same HTTP API as /api (Next.js) version,
//  so the GitHub Pages site works with either.
//
//  Bindings / variables (Worker → Settings → Variables and Secrets / Bindings):
//    AP                    KV namespace binding (stores payments, projects, lockout)
//    ONEPAY_API_KEY        secret  pk_test_… / pk_…  (scopes payments:read + payments:write)
//    ONEPAY_WEBHOOK_SECRET secret  whsec_test_… / whsec_… (notifyUrl secret, same mode)
//    ADMIN_PASSWORD        secret  initial access code (digits); change later in Settings
//    TG_BOT_TOKEN          secret  Telegram bot token for notifications
//    TG_CHAT_ID            text    chat id that receives notifications
//    ALLOWED_ORIGIN        text    https://igorrodionov427-creator.github.io
//    CARD_ONLY             text    "true" (cards only on checkout) / "false"
//  Triggers → Cron: */5 * * * *   (re-checks open payments, catches missed webhooks)
//
//  1Pay API used (https://1pay.cx/ru/docs): POST /v1/payments (Idempotency-Key),
//  GET /v1/payments/{id}, GET /v1/payments?reference=, POST /v1/payments/{id}/cancel,
//  webhooks signed with X-1pay-Signature-V2 (HMAC-SHA256 of "t.body").
// =============================================================================

const ONEPAY = "https://api.1pay.cx";
const DB_KEY = "db:v1";
const GUARD_KEY = "guard:v1";
const AUTH_KEY = "auth:v1";
const TOKEN_TTL_MS = 30 * 86_400_000;
const enc = new TextEncoder();

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      const res = await route(req, env, ctx, url);
      const h = new Headers(res.headers);
      for (const [k, v] of Object.entries(cors)) h.set(k, v);
      h.set("Cache-Control", "no-store");
      h.set("X-Content-Type-Options", "nosniff");
      h.set("X-Robots-Tag", "noindex, nofollow");
      return new Response(res.body, { status: res.status, headers: h });
    } catch (e) {
      if (e instanceof HttpError) {
        return json({ error: e.code, message: e.message, ...(e.extra || {}) }, e.status, cors);
      }
      console.error("unhandled", scrub(String(e && e.stack ? e.stack : e)));
      return json({ error: "server_error", message: "Something went wrong. Please try again." }, 500, cors);
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(reconcile(env));
  },
};

// ─── Router ──────────────────────────────────────────────────────────────────
async function route(req, env, ctx, url) {
  const p = url.pathname.replace(/\/+$/, "");
  const m = req.method;
  let r;

  if (p === "/api/webhooks/1pay" && m === "POST") return webhook(req, env, ctx);
  if (p === "/api/health") return json({ ok: true });
  if (p === "/api/auth/login" && m === "POST") return login(req, env);

  if (!p.startsWith("/api/")) return new Response("Not Found", { status: 404 });

  const session = await requireSession(req, env);

  if (p === "/api/auth/logout" && m === "POST") return json({ ok: true });
  if (p === "/api/auth/session" && m === "GET") return sessionInfo(env, session, url);
  if (p === "/api/auth/password" && m === "POST") return changePin(req, env);
  if (p === "/api/auth/sessions" && m === "DELETE") return revokeAll(env);
  if (p === "/api/stats" && m === "GET") return stats(env, url);
  if (p === "/api/payments" && m === "GET") return listPayments(env, url);
  if (p === "/api/payments" && m === "POST") return createPaymentRoute(req, env, ctx, url);
  if (p === "/api/payments/export" && m === "GET") return exportCsv(env, url);
  if (p === "/api/clients" && m === "GET") return clients(env, url);
  if ((r = p.match(/^\/api\/projects\/([\w-]{6,40})$/)) && m === "GET") return projectRoute(env, r[1]);
  if ((r = p.match(/^\/api\/payments\/([\w-]{6,40})$/)) && m === "GET") return getPaymentRoute(env, r[1]);
  if ((r = p.match(/^\/api\/payments\/([\w-]{6,40})\/refresh$/)) && m === "POST") return refreshRoute(env, ctx, r[1]);
  if ((r = p.match(/^\/api\/payments\/([\w-]{6,40})\/cancel$/)) && m === "POST") return cancelRoute(env, ctx, r[1]);
  if ((r = p.match(/^\/api\/payments\/([\w-]{6,40})\/notes$/)) && m === "POST") return addNote(req, env, r[1]);
  if ((r = p.match(/^\/api\/payments\/([\w-]{6,40})\/notes\/([\w-]{6,40})$/)) && m === "DELETE") return delNote(env, r[1], r[2]);
  throw new HttpError(404, "not_found", "Not found.");
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, "Content-Type": "application/json" } });
}

function corsHeaders(req, env) {
  const origin = req.headers.get("Origin") || "";
  const allowed = String(env.ALLOWED_ORIGIN || "https://igorrodionov427-creator.github.io")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  const h = {
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "600",
    Vary: "Origin",
  };
  if (allowed.includes(origin)) h["Access-Control-Allow-Origin"] = origin;
  return h;
}

async function readJson(req, max = 16_000) {
  const t = await req.text();
  if (t.length > max) throw new HttpError(413, "too_large", "Request is too large.");
  if (!t) return {};
  try {
    return JSON.parse(t);
  } catch {
    throw new HttpError(400, "bad_json", "Malformed JSON.");
  }
}

function scrub(s) {
  return String(s)
    .replace(/pk_(test_)?[A-Za-z0-9]+\.[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/whsec_(test_)?[A-Za-z0-9]+/g, "[redacted]")
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]");
}

const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const newId = (prefix) => prefix + crypto.randomUUID().replace(/-/g, "").slice(0, 22);
const nowIso = () => new Date().toISOString();

async function hmac(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", key, enc.encode(msg));
}

async function sha256hex(s) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Money as integer cents.
const toCents = (v) => (v === null || v === undefined || v === "" ? null : Math.round(Number(v) * 100));
const fromCents = (c) => (c / 100).toFixed(2);

function clientIp(req) {
  return req.headers.get("CF-Connecting-IP") || req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() || "unknown";
}

// ─── Storage (KV) ────────────────────────────────────────────────────────────
function kv(env) {
  if (!env.AP) throw new HttpError(503, "not_configured", "KV binding AP is missing.");
  return env.AP;
}

async function loadDb(env) {
  const raw = await kv(env).get(DB_KEY);
  const db = raw ? JSON.parse(raw) : null;
  return db && Array.isArray(db.payments) ? db : { payments: [], projects: [], seenEvents: [] };
}

/** Read-modify-write against the freshest copy to keep the race window tiny. */
async function mutate(env, fn) {
  const db = await loadDb(env);
  const out = await fn(db);
  db.seenEvents = (db.seenEvents || []).slice(-500);
  await kv(env).put(DB_KEY, JSON.stringify(db));
  return out;
}

// ─── Auth: PIN + stateless signed tokens ────────────────────────────────────
async function authState(env) {
  const raw = await kv(env).get(AUTH_KEY);
  return raw ? JSON.parse(raw) : { pinHash: null, version: 1 };
}

function sessionSecret(env) {
  const base = env.SESSION_SECRET || env.ONEPAY_API_KEY || env.ADMIN_PASSWORD;
  if (!base) throw new HttpError(503, "not_configured", "Server is not configured yet.");
  return `agency-pay-session:${base}`;
}

async function pbkdf2(pin, saltB64) {
  const key = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: fromB64url(saltB64), iterations: 100_000 },
    key,
    256,
  );
  return b64url(bits);
}

async function checkPin(env, pin) {
  const st = await authState(env);
  if (st.pinHash) {
    const [salt, hash] = st.pinHash.split("$");
    return safeEqual(await pbkdf2(pin, salt), hash);
  }
  const initial = env.ADMIN_PASSWORD;
  if (!initial) throw new HttpError(503, "not_configured", "Server is not configured yet.");
  // Compare digests so timing does not depend on the PIN.
  return safeEqual(await sha256hex(pin), await sha256hex(String(initial)));
}

async function issueToken(env) {
  const st = await authState(env);
  const payload = { iat: Date.now(), exp: Date.now() + TOKEN_TTL_MS, v: st.version };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = b64url(await hmac(sessionSecret(env), body));
  return { token: `${body}.${sig}`, expiresAt: new Date(payload.exp).toISOString() };
}

async function requireSession(req, env) {
  const m = /^Bearer\s+([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(req.headers.get("Authorization") || "");
  if (!m) throw new HttpError(401, "unauthorized", "Not signed in.");
  const expected = b64url(await hmac(sessionSecret(env), m[1]));
  if (!safeEqual(expected, m[2])) throw new HttpError(401, "unauthorized", "Not signed in.");
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(fromB64url(m[1])));
  } catch {
    throw new HttpError(401, "unauthorized", "Not signed in.");
  }
  const st = await authState(env);
  if (!payload.exp || payload.exp < Date.now() || payload.v !== st.version) {
    throw new HttpError(401, "unauthorized", "Session expired.");
  }
  return payload;
}

// Brute-force guard: 5 wrong codes per IP → 15 min, 10 overall → 15 min for
// everyone; each repeat lock doubles (max 24 h). Correct code resets both.
const IP_RULE = { threshold: 5, baseMin: 15 };
const GLOBAL_RULE = { threshold: 10, baseMin: 15 };
const MAX_LOCK = 86_400_000;

async function loadGuard(env) {
  const raw = await kv(env).get(GUARD_KEY);
  return raw ? JSON.parse(raw) : { ips: {}, global: { f: 0, l: 0, until: 0 } };
}

function bumpGuard(entry, rule) {
  entry.f = (entry.f || 0) + 1;
  if (entry.f >= rule.threshold) {
    entry.l = (entry.l || 0) + 1;
    entry.f = 0;
    entry.until = Date.now() + Math.min(rule.baseMin * 60_000 * 2 ** (entry.l - 1), MAX_LOCK);
  }
}

async function login(req, env) {
  const ipKey = (await sha256hex(clientIp(req))).slice(0, 24);
  const guard = await loadGuard(env);
  const ipEntry = guard.ips[ipKey] || { f: 0, l: 0, until: 0 };
  const lockedMs = Math.max(ipEntry.until || 0, guard.global.until || 0) - Date.now();
  if (lockedMs > 0) {
    throw new HttpError(429, "locked", "Too many attempts. Try again later.", { retryAfter: Math.ceil(lockedMs / 1000) });
  }

  const body = await readJson(req, 1000);
  const pin = typeof body.pin === "string" ? body.pin : "";
  if (!pin || pin.length > 64) throw new HttpError(400, "invalid", "Enter the code.");

  if (!(await checkPin(env, pin))) {
    bumpGuard(ipEntry, IP_RULE);
    bumpGuard(guard.global, GLOBAL_RULE);
    guard.ips[ipKey] = ipEntry;
    // Drop stale IP entries.
    for (const [k, v] of Object.entries(guard.ips)) {
      if (!v.f && (v.until || 0) < Date.now() - MAX_LOCK) delete guard.ips[k];
    }
    await kv(env).put(GUARD_KEY, JSON.stringify(guard));
    await new Promise((r) => setTimeout(r, 600));
    const left = Math.max(ipEntry.until || 0, guard.global.until || 0) - Date.now();
    if (left > 0) throw new HttpError(429, "locked", "Too many attempts. Try again later.", { retryAfter: Math.ceil(left / 1000) });
    throw new HttpError(401, "invalid_pin", "Wrong code.");
  }

  if (ipEntry.f || ipEntry.l || guard.global.f || guard.global.l) {
    delete guard.ips[ipKey];
    guard.global = { f: 0, l: 0, until: 0 };
    await kv(env).put(GUARD_KEY, JSON.stringify(guard));
  }
  return json(await issueToken(env));
}

async function sessionInfo(env, session, url) {
  const configured = /^pk_(test_)?[^.\s]+\.\S+$/.test(env.ONEPAY_API_KEY || "");
  return json({
    session: { createdAt: new Date(session.iat).toISOString(), expiresAt: new Date(session.exp).toISOString() },
    config: {
      onepayConfigured: configured,
      livemode: configured ? isLive(env) : null,
      webhookSecretConfigured: !!env.ONEPAY_WEBHOOK_SECRET,
      webhookUrl: `${url.origin}/api/webhooks/1pay`,
      cardOnly: cardOnly(env),
      cronConfigured: true,
    },
  });
}

async function changePin(req, env) {
  const { current, next } = await readJson(req, 1000);
  if (typeof current !== "string" || !(await checkPin(env, current))) {
    throw new HttpError(400, "invalid", "Current code is wrong.", { issues: [{ path: "current", message: "Current code is wrong" }] });
  }
  if (typeof next !== "string" || !/^\d{4,12}$/.test(next)) {
    throw new HttpError(400, "invalid", "Use 4–12 digits.", { issues: [{ path: "next", message: "Use 4–12 digits" }] });
  }
  const st = await authState(env);
  const salt = b64url(crypto.getRandomValues(new Uint8Array(16)));
  st.pinHash = `${salt}$${await pbkdf2(next, salt)}`;
  st.version = (st.version || 1) + 1; // signs out every other device
  await kv(env).put(AUTH_KEY, JSON.stringify(st));
  return json({ ok: true, ...(await issueToken(env)) }); // fresh token for this device
}

async function revokeAll(env) {
  const st = await authState(env);
  st.version = (st.version || 1) + 1;
  await kv(env).put(AUTH_KEY, JSON.stringify(st));
  return json({ ok: true });
}

// ─── 1Pay client ─────────────────────────────────────────────────────────────
const isLive = (env) => !String(env.ONEPAY_API_KEY || "").startsWith("pk_test_");
const cardOnly = (env) => String(env.CARD_ONLY ?? "true").toLowerCase() !== "false";

class OnePayError extends Error {
  constructor(message, status, code, outcomeUnknown = false) {
    super(message);
    this.status = status;
    this.code = code;
    this.outcomeUnknown = outcomeUnknown;
  }
}

const ERRORS = {
  unauthorized: "1Pay rejected the API key (missing, revoked or account suspended).",
  insufficient_scope: "The 1Pay API key lacks the payments:read / payments:write scope.",
  invalid: "1Pay rejected the payment details.",
  currency_unsupported: "This currency is not supported by 1Pay.",
  no_payment_methods: "No payment methods are enabled for this payment.",
  invalid_notify_url: "1Pay rejected the webhook URL.",
  idempotency_key_reused: "This request was already used for a different payment. Reload the form.",
  rate_limited: "1Pay rate limit reached. Try again in a minute.",
  rate_unavailable: "1Pay has no exchange rate right now. Try again in a few minutes.",
  database_unavailable: "1Pay is temporarily unavailable. Try again shortly.",
  maintenance: "1Pay is under maintenance. Try again later.",
  panic: "1Pay has paused the platform. Try again later.",
  operation_outcome_unknown: "1Pay could not confirm the result. Retrying is safe.",
  not_found: "Payment not found at 1Pay.",
  not_cancellable: "This payment can no longer be cancelled.",
};

async function onepay(env, method, path, { body, idem, write } = {}) {
  if (!/^pk_(test_)?[^.\s]+\.\S+$/.test(env.ONEPAY_API_KEY || "")) {
    throw new OnePayError("1Pay API key is not configured.", 503, "not_configured");
  }
  const headers = { Authorization: `Bearer ${env.ONEPAY_API_KEY}`, Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (idem) headers["Idempotency-Key"] = idem;
  let res;
  try {
    res = await fetch(`${ONEPAY}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new OnePayError("Could not reach 1Pay in time.", 504, "timeout", !!write);
  }
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const code = String((data && (data.code || data.error)) || `http_${res.status}`);
    const msg = (data && typeof data.detail === "string" && data.detail) || ERRORS[code] || `1Pay error (${res.status}).`;
    throw new OnePayError(msg, res.status, code, !!write && (res.status >= 500 || code === "operation_outcome_unknown"));
  }
  return data;
}

async function onepayGet(env, id) {
  try {
    return await onepay(env, "GET", `/v1/payments/${encodeURIComponent(id)}`);
  } catch (e) {
    if (e instanceof OnePayError && e.status === 404) return null;
    throw e;
  }
}

// ─── Telegram ────────────────────────────────────────────────────────────────
async function tg(env, lines) {
  if (!env.TG_BOT_TOKEN || !env.TG_CHAT_ID) return;
  try {
    const res = await fetch(`https://api.telegram.org/bot${env.TG_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TG_CHAT_ID,
        text: lines.filter(Boolean).join("\n"),
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) console.error("telegram", res.status);
  } catch (e) {
    console.error("telegram", scrub(String(e)));
  }
}

const KIND_RU = { FULL: "", DEPOSIT: " (депозит 50%)", BALANCE: " (остаток)" };
const usd = (v) => `$${Number(v).toFixed(2)}`;

function notifyStatus(env, p, before) {
  if (p.status === before) return null;
  const who = [p.clientName, p.clientEmail].filter(Boolean).join(" · ") || "без имени";
  const mode = p.livemode === false ? " [TEST]" : "";
  const head = {
    PAID: `✅ ОПЛАЧЕНО${mode}`,
    UNDERPAID: `⚠️ НЕДОПЛАТА${mode} — платёж не засчитан`,
    EXPIRED: `⌛ Ссылка истекла / отменена${mode}`,
    FAILED: `❌ Платёж не прошёл${mode}`,
  }[p.status];
  if (!head) return null;
  return tg(env, [
    head,
    `${usd(p.amount)} — ${p.serviceName}${KIND_RU[p.kind] || ""}`,
    `Клиент: ${who}`,
    p.status === "PAID" && p.settledAmount ? `На кошелёк: ~${usd(p.settledAmount)} ${p.settledAsset || ""}` : "",
    `1Pay ID: ${p.onepayId}`,
  ]);
}

// ─── Payments ────────────────────────────────────────────────────────────────
const STATUS_MAP = { pending: "PENDING", paid: "PAID", underpaid: "UNDERPAID", expired: "EXPIRED", failed: "FAILED" };
const OPEN_OR_PAID = ["CREATING", "PENDING", "PAID"];

function serialize(p, db, full = false) {
  const out = { ...p };
  out.clientId = clientKey(p.clientName, p.clientEmail);
  if (!full) {
    delete out.notes;
    delete out.events;
  } else {
    out.notes = [...(p.notes || [])].reverse();
    out.events = [...(p.events || [])].reverse().slice(0, 20);
    const pr = p.projectId ? db.projects.find((x) => x.id === p.projectId) : null;
    out.project = pr ? { id: pr.id, serviceName: pr.serviceName, totalAmount: pr.totalAmount, currency: pr.currency } : null;
  }
  delete out.idempotencyKey;
  return out;
}

function clientKey(name, email) {
  if (email) return `email:${String(email).toLowerCase()}`;
  if (name) return `name:${String(name).toLowerCase().replace(/\s+/g, " ")}`;
  return null;
}

function textField(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim().slice(0, max);
  return s || null;
}

function validateCreate(b) {
  const issues = [];
  const kind = ["FULL", "DEPOSIT", "BALANCE"].includes(b.kind) ? b.kind : "FULL";
  const key = String(b.idempotencyKey || "");
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(key)) issues.push({ path: "idempotencyKey", message: "Invalid idempotency key" });
  let amount = null;
  const serviceName = textField(b.serviceName, 120);
  const clientName = textField(b.clientName, 120);
  let clientEmail = textField(b.clientEmail, 200);
  if (clientEmail) {
    clientEmail = clientEmail.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) issues.push({ path: "clientEmail", message: "Invalid email" });
  }
  if (kind === "BALANCE") {
    if (!b.projectId) issues.push({ path: "projectId", message: "Project is required" });
  } else {
    const n = Number(b.amount);
    if (b.amount === undefined || b.amount === null || b.amount === "") issues.push({ path: "amount", message: "Amount is required" });
    else if (!Number.isFinite(n) || n <= 0) issues.push({ path: "amount", message: "Amount must be greater than 0" });
    else if (n > 1_000_000) issues.push({ path: "amount", message: "Amount is too large" });
    else if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) issues.push({ path: "amount", message: "Use at most 2 decimals" });
    else amount = n;
    if (!serviceName) issues.push({ path: "serviceName", message: "Service name is required" });
  }
  if (issues.length) throw new HttpError(400, "invalid", "Please check the highlighted fields.", { issues });
  return { kind, key, amount, serviceName, clientName, clientEmail, description: textField(b.description, 1000), projectId: b.projectId || null };
}

function productName(p) {
  const suffix = p.kind === "DEPOSIT" ? " — 50% deposit" : p.kind === "BALANCE" ? " — remaining balance" : "";
  return `${p.serviceName}${suffix}`.replace(/[<>]/g, "").slice(0, 200);
}

async function createPaymentRoute(req, env, ctx, url) {
  const input = validateCreate(await readJson(req, 8000));

  // 1. Idempotency: an existing record with this key is returned / retried.
  let p = await mutate(env, (db) => {
    const existing = db.payments.find((x) => x.idempotencyKey === input.key);
    if (existing) return existing;

    let amountCents;
    let { serviceName, clientName, clientEmail } = input;
    let projectId = null;
    if (input.kind === "BALANCE") {
      const pr = db.projects.find((x) => x.id === input.projectId);
      if (!pr) throw new HttpError(404, "not_found", "Project not found.");
      const covered = db.payments
        .filter((x) => x.projectId === pr.id && OPEN_OR_PAID.includes(x.status))
        .reduce((s, x) => s + toCents(x.amount), 0);
      amountCents = toCents(pr.totalAmount) - covered;
      if (amountCents <= 0) throw new HttpError(409, "nothing_due", "This project has no remaining balance.");
      serviceName = pr.serviceName;
      clientName = clientName || pr.clientName || null;
      clientEmail = clientEmail || pr.clientEmail || null;
      projectId = pr.id;
    } else if (input.kind === "DEPOSIT") {
      const total = toCents(input.amount);
      const pr = { id: newId("j"), serviceName, totalAmount: fromCents(total), currency: "USD", clientName, clientEmail, createdAt: nowIso() };
      db.projects.push(pr);
      projectId = pr.id;
      amountCents = Math.floor((total + 1) / 2);
    } else {
      amountCents = toCents(input.amount);
    }
    const rec = {
      id: newId("p"),
      onepayId: null,
      idempotencyKey: input.key,
      kind: input.kind,
      status: "CREATING",
      amount: fromCents(amountCents),
      chargedAmount: null,
      currency: "USD",
      serviceName,
      clientName,
      clientEmail,
      description: input.description,
      checkoutUrl: null,
      livemode: null,
      expiresAt: null,
      paidAt: null,
      settledAmount: null,
      settledAsset: null,
      provider: null,
      txidOut: null,
      verifyError: null,
      lastError: null,
      lastSyncedAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      projectId,
      notes: [],
      events: [],
    };
    db.payments.push(rec);
    return rec;
  });

  const db0 = await loadDb(env);
  if (p.onepayId) return json({ payment: serialize(p, db0), replayed: true });

  // 2. Create at 1Pay (same Idempotency-Key on retries → same payment).
  const body = {
    amount: Number(p.amount),
    currency: p.currency,
    productName: productName(p),
    reference: p.id,
    notifyUrl: `${url.origin}/api/webhooks/1pay`,
  };
  if (p.clientEmail) body.email = p.clientEmail;
  if (cardOnly(env)) body.cryptoAssets = [];

  try {
    const created = await onepay(env, "POST", "/v1/payments", { body, idem: `agencypay-${p.idempotencyKey}`, write: true });
    if (!created || !created.id || !created.url) throw new OnePayError("1Pay returned no payment id.", 502, "bad_response", true);
    p = await mutate(env, (db) => {
      const x = db.payments.find((y) => y.id === p.id);
      Object.assign(x, { onepayId: created.id, checkoutUrl: created.url, status: "PENDING", livemode: isLive(env), lastError: null, updatedAt: nowIso() });
      return x;
    });
  } catch (e) {
    if (!(e instanceof OnePayError)) throw e;
    await mutate(env, (db) => {
      const x = db.payments.find((y) => y.id === p.id);
      Object.assign(x, { status: e.outcomeUnknown ? "CREATING" : "CREATE_FAILED", lastError: e.message, updatedAt: nowIso() });
    });
    console.error("1pay create failed", e.status, e.code);
    throw new HttpError(e.code === "not_configured" ? 503 : 502, "provider_error", e.message, {
      retryable: e.outcomeUnknown || e.status === 429 || e.status === 503,
      paymentId: p.id,
    });
  }

  // 3. Enrich (expiry, charged amount) — best effort.
  try {
    p = await syncOne(env, p.id);
  } catch (e) {
    console.error("post-create sync", scrub(String(e)));
  }

  ctx.waitUntil(
    tg(env, [
      `🆕 Ссылка на оплату создана${p.livemode === false ? " [TEST]" : ""}`,
      `${usd(p.amount)} — ${p.serviceName}${KIND_RU[p.kind] || ""}`,
      `Клиент: ${[p.clientName, p.clientEmail].filter(Boolean).join(" · ") || "—"}`,
      p.checkoutUrl,
    ]),
  );
  const db = await loadDb(env);
  return json({ payment: serialize(p, db), replayed: false }, 201);
}

function verifyRemote(p, r) {
  if (r.id !== p.onepayId) return "Payment id mismatch";
  if (p.livemode !== null && r.livemode !== p.livemode) return "Mode mismatch (test vs live)";
  if (String(r.currency).toUpperCase() !== p.currency) return `Currency mismatch: ${r.currency}`;
  const base = r.baseAmount ?? r.amount;
  if (toCents(base) !== toCents(p.amount)) return `Amount mismatch: expected ${p.amount}, got ${base}`;
  return null;
}

/**
 * Re-reads one payment from 1Pay and stores the authoritative state.
 * Never marks paid on mismatching id/mode/currency/amount.
 */
async function syncOne(env, localId, remoteIn) {
  const db0 = await loadDb(env);
  const cur = db0.payments.find((x) => x.id === localId);
  if (!cur || !cur.onepayId) return cur;
  const remote = remoteIn === undefined ? await onepayGet(env, cur.onepayId) : remoteIn;
  let before;
  const updated = await mutate(env, (db) => {
    const p = db.payments.find((x) => x.id === localId);
    before = p.status;
    p.lastSyncedAt = nowIso();
    if (!remote) {
      p.lastError = "Not found at 1Pay (different key or mode?)";
      return p;
    }
    const problem = verifyRemote(p, remote);
    if (problem) {
      p.verifyError = problem;
      return p;
    }
    const st = STATUS_MAP[String(remote.status).toLowerCase()];
    Object.assign(p, {
      ...(st ? { status: st } : {}),
      chargedAmount: remote.amount != null ? Number(remote.amount).toFixed(2) : p.chargedAmount,
      livemode: remote.livemode,
      expiresAt: remote.expiresAt || null,
      paidAt: remote.paidAt || null,
      settledAmount: remote.settledAmount != null ? Number(remote.settledAmount).toFixed(2) : null,
      settledAsset: remote.settledAsset || null,
      provider: remote.provider || null,
      txidOut: remote.txidOut || null,
      verifyError: null,
      lastError: null,
      updatedAt: nowIso(),
    });
    return p;
  });
  if (updated.status !== before) await notifyStatus(env, updated, before);
  return updated;
}

async function recoverCreating(env, localId) {
  const list = await onepay(env, "GET", `/v1/payments?${new URLSearchParams({ reference: localId, limit: "5" })}`);
  const found = (Array.isArray(list) ? list : []).find((r) => r.reference === localId);
  if (!found) return (await loadDb(env)).payments.find((x) => x.id === localId);
  await mutate(env, (db) => {
    const p = db.payments.find((x) => x.id === localId);
    Object.assign(p, { onepayId: found.id, checkoutUrl: `https://1pay.cx/pay/${found.id}`, status: "PENDING", livemode: found.livemode, lastError: null });
  });
  return syncOne(env, localId, found);
}

function findPayment(db, id) {
  const p = db.payments.find((x) => x.id === id);
  if (!p) throw new HttpError(404, "not_found", "Payment not found.");
  return p;
}

async function getPaymentRoute(env, id) {
  const db = await loadDb(env);
  return json({ payment: serialize(findPayment(db, id), db, true) });
}

async function refreshRoute(env, ctx, id) {
  const db = await loadDb(env);
  const p = findPayment(db, id);
  try {
    await (p.onepayId ? syncOne(env, id) : recoverCreating(env, id));
  } catch (e) {
    if (e instanceof OnePayError) throw new HttpError(502, "provider_error", e.message);
    throw e;
  }
  const db2 = await loadDb(env);
  return json({ payment: serialize(findPayment(db2, id), db2) });
}

async function cancelRoute(env, ctx, id) {
  const db = await loadDb(env);
  const p = findPayment(db, id);
  if (!p.onepayId || p.status !== "PENDING") throw new HttpError(409, "not_cancellable", "Only pending payments can be cancelled.");
  try {
    const remote = await onepay(env, "POST", `/v1/payments/${encodeURIComponent(p.onepayId)}/cancel`, { write: true });
    const updated = await syncOne(env, id, remote);
    const db2 = await loadDb(env);
    return json({ payment: serialize(updated, db2) });
  } catch (e) {
    if (e instanceof OnePayError) throw new HttpError(e.status === 409 ? 409 : 502, e.code, e.message);
    throw e;
  }
}

async function addNote(req, env, id) {
  const { body } = await readJson(req, 8000);
  const text = textField(body, 2000);
  if (!text) throw new HttpError(400, "invalid", "Note is empty.", { issues: [{ path: "body", message: "Note is empty" }] });
  const note = await mutate(env, (db) => {
    const p = findPayment(db, id);
    const n = { id: newId("n"), body: text, createdAt: nowIso() };
    (p.notes = p.notes || []).push(n);
    return n;
  });
  return json({ note }, 201);
}

async function delNote(env, id, noteId) {
  await mutate(env, (db) => {
    const p = findPayment(db, id);
    p.notes = (p.notes || []).filter((n) => n.id !== noteId);
  });
  return json({ ok: true });
}

// ─── Queries ─────────────────────────────────────────────────────────────────
function filterPayments(db, url) {
  const q = (url.searchParams.get("q") || "").trim().toLowerCase().slice(0, 120);
  const status = url.searchParams.get("status") || "ALL";
  const sort = url.searchParams.get("sort") === "oldest" ? "oldest" : "newest";
  let items = db.payments.slice();
  if (status === "OPEN") items = items.filter((p) => p.status === "PENDING" || p.status === "CREATING");
  else if (status === "ISSUES") items = items.filter((p) => ["EXPIRED", "FAILED", "UNDERPAID"].includes(p.status));
  else if (status !== "ALL") items = items.filter((p) => p.status === status);
  if (q) {
    items = items.filter((p) =>
      [p.clientName, p.clientEmail, p.serviceName, p.onepayId, p.id].some((v) => v && String(v).toLowerCase().includes(q)),
    );
  }
  items.sort((a, b) => (sort === "oldest" ? 1 : -1) * (Date.parse(a.createdAt) - Date.parse(b.createdAt)));
  return items;
}

async function listPayments(env, url) {
  const db = await loadDb(env);
  const items = filterPayments(db, url);
  const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get("pageSize")) || 20));
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(pages, Math.max(1, Number(url.searchParams.get("page")) || 1));
  return json({
    items: items.slice((page - 1) * pageSize, page * pageSize).map((p) => serialize(p, db)),
    page,
    pageSize,
    total: items.length,
    pages,
  });
}

function csvCell(v) {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function exportCsv(env, url) {
  const db = await loadDb(env);
  const rows = filterPayments(db, url);
  const header = ["Internal ID", "1Pay Payment ID", "Type", "Status", "Amount", "Charged", "Currency", "Service", "Client name", "Client email", "Description", "Checkout URL", "Created", "Paid", "Settled (USD)", "Settled asset", "Project ID", "Mode", "Notes"];
  const lines = [header.map(csvCell).join(",")];
  for (const p of rows) {
    lines.push(
      [p.id, p.onepayId, p.kind, p.status, p.amount, p.chargedAmount, p.currency, p.serviceName, p.clientName, p.clientEmail, p.description, p.checkoutUrl, p.createdAt, p.paidAt, p.settledAmount, p.settledAsset, p.projectId, p.livemode == null ? "" : p.livemode ? "live" : "test", (p.notes || []).map((n) => n.body).join(" | ")]
        .map(csvCell)
        .join(","),
    );
  }
  return new Response("﻿" + lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="agency-pay-${nowIso().slice(0, 10)}.csv"`,
      "Access-Control-Expose-Headers": "Content-Disposition",
    },
  });
}

async function stats(env, url) {
  const db = await loadDb(env);
  const days = ["7", "30", "90"].includes(url.searchParams.get("range")) ? Number(url.searchParams.get("range")) : 30;
  const tz = Math.max(-840, Math.min(840, Number(url.searchParams.get("tz")) || 0));
  const count = (s) => db.payments.filter((p) => p.status === s).length;
  const real = db.payments.filter((p) => p.status !== "CREATE_FAILED" && p.status !== "CREATING");
  const revenue = db.payments.filter((p) => p.status === "PAID").reduce((s, p) => s + toCents(p.amount), 0);

  const offsetMs = -tz * 60_000;
  const nowLocal = new Date(Date.now() + offsetMs);
  const today = Date.UTC(nowLocal.getUTCFullYear(), nowLocal.getUTCMonth(), nowLocal.getUTCDate());
  const startLocal = today - (days - 1) * 86_400_000;
  const buckets = new Map();
  for (let i = 0; i < days; i++) buckets.set(new Date(startLocal + i * 86_400_000).toISOString().slice(0, 10), { cents: 0, count: 0 });
  let rangeCents = 0;
  let paidCount = 0;
  for (const p of db.payments) {
    if (p.status !== "PAID" || !p.paidAt) continue;
    const key = new Date(Date.parse(p.paidAt) + offsetMs).toISOString().slice(0, 10);
    const b = buckets.get(key);
    if (!b) continue;
    b.cents += toCents(p.amount);
    b.count++;
    rangeCents += toCents(p.amount);
    paidCount++;
  }
  const recent = db.payments
    .filter((p) => p.status !== "CREATE_FAILED")
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 8);

  return json({
    totals: {
      revenue: fromCents(revenue),
      payments: real.length,
      paid: count("PAID"),
      pending: count("PENDING") + count("CREATING"),
      failed: count("FAILED") + count("EXPIRED") + count("UNDERPAID"),
      breakdown: { expired: count("EXPIRED"), underpaid: count("UNDERPAID"), failed: count("FAILED") },
    },
    range: {
      days,
      revenue: fromCents(rangeCents),
      paidCount,
      series: [...buckets.entries()].map(([date, b]) => ({ date, revenue: b.cents / 100, count: b.count })),
    },
    recent: recent.map((p) => serialize(p, db)),
  });
}

async function clients(env, url) {
  const db = await loadDb(env);
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const map = new Map();
  const sorted = db.payments.slice().sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  for (const p of sorted) {
    const key = clientKey(p.clientName, p.clientEmail);
    if (!key) continue;
    const c = map.get(key) || { id: key, name: p.clientName, email: p.clientEmail, paymentsCount: 0, lastService: p.serviceName, lastAmount: p.amount };
    c.paymentsCount++;
    c.name = c.name || p.clientName;
    c.email = c.email || p.clientEmail;
    map.set(key, c);
  }
  let list = [...map.values()];
  if (q) list = list.filter((c) => [c.name, c.email].some((v) => v && v.toLowerCase().includes(q)));
  return json({ clients: list.slice(0, 12) });
}

async function projectRoute(env, id) {
  const db = await loadDb(env);
  const pr = db.projects.find((x) => x.id === id);
  if (!pr) throw new HttpError(404, "not_found", "Project not found.");
  const pays = db.payments.filter((p) => p.projectId === id).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  const covered = pays.filter((p) => OPEN_OR_PAID.includes(p.status)).reduce((s, p) => s + toCents(p.amount), 0);
  const paid = pays.filter((p) => p.status === "PAID").reduce((s, p) => s + toCents(p.amount), 0);
  return json({
    project: {
      id: pr.id,
      serviceName: pr.serviceName,
      totalAmount: pr.totalAmount,
      currency: pr.currency,
      createdAt: pr.createdAt,
      client: pr.clientName || pr.clientEmail ? { id: clientKey(pr.clientName, pr.clientEmail), name: pr.clientName, email: pr.clientEmail } : null,
      paid: fromCents(paid),
      remaining: fromCents(Math.max(0, toCents(pr.totalAmount) - covered)),
      payments: pays.map((p) => serialize(p, db)),
    },
  });
}

// ─── Webhook ─────────────────────────────────────────────────────────────────
async function verifySig(raw, header, secret) {
  if (!header || !secret) return false;
  let t = "";
  const sigs = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i <= 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k === "t") t = v;
    else if (k === "v1") sigs.push(v);
  }
  if (!/^\d+$/.test(t) || Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const expected = hex(await hmac(secret, `${t}.${raw}`));
  return sigs.some((s) => safeEqual(s, expected));
}

async function webhook(req, env, ctx) {
  const raw = await req.text();
  if (raw.length > 64_000) return new Response("too large", { status: 413 });
  if (!env.ONEPAY_WEBHOOK_SECRET) return new Response("not configured", { status: 503 });
  if (!(await verifySig(raw, req.headers.get("X-1pay-Signature-V2"), env.ONEPAY_WEBHOOK_SECRET))) {
    return new Response("invalid signature", { status: 401 });
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("bad json", { status: 400 });
  }
  const eventId = String(body.id || "");
  const type = String(body.event || "");
  const data = body.data || {};
  if (!/^whe_\w+$/.test(eventId) || !type) return new Response("missing id", { status: 400 });
  if (type === "webhook.test") return new Response("ok");

  const db = await loadDb(env);
  if ((db.seenEvents || []).includes(eventId)) return new Response("duplicate");
  if (!type.startsWith("payment.") || !data.paymentId) return new Response("ignored");
  if (data.livemode !== isLive(env)) return new Response("wrong mode");

  const p = db.payments.find((x) => x.onepayId === data.paymentId);
  if (!p) return new Response("unknown payment");
  if (data.reference && data.reference !== p.id) return new Response("reference mismatch");

  const logEvent = (status, error) =>
    mutate(env, (d) => {
      const x = d.payments.find((y) => y.id === p.id);
      (x.events = x.events || []).push({ id: newId("e"), eventId, type, status, error: error || null, receivedAt: nowIso(), attempts: 1 });
      x.events = x.events.slice(-30);
      if (status !== "ERROR") (d.seenEvents = d.seenEvents || []).push(eventId);
    });

  try {
    // Never trust the body alone: re-read with our key.
    const remote = await onepayGet(env, data.paymentId);
    if (!remote) throw new Error("payment not readable at 1Pay yet");
    if ((type === "payment.paid" || type === "payment.underpaid") &&
        (toCents(data.amount) !== toCents(remote.amount) || String(data.currency).toUpperCase() !== String(remote.currency).toUpperCase())) {
      await logEvent("REJECTED", "webhook amount/currency differs from payment");
      return new Response("rejected");
    }
    const updated = await syncOne(env, p.id, remote);
    await logEvent(updated.verifyError ? "REJECTED" : "PROCESSED", updated.verifyError);
    return new Response("ok");
  } catch (e) {
    console.error("webhook failed", scrub(String(e)));
    await logEvent("ERROR", String(e.message || e).slice(0, 200)).catch(() => {});
    return new Response("retry", { status: 500 }); // 1Pay retries
  }
}

// ─── Cron: reconcile open payments ───────────────────────────────────────────
async function reconcile(env) {
  if (!env.AP || !env.ONEPAY_API_KEY) return;
  const db = await loadDb(env);
  const now = Date.now();
  const work = db.payments
    .filter(
      (p) =>
        (p.status === "PENDING" && p.onepayId && now - Date.parse(p.createdAt) < 30 * 86_400_000) ||
        (p.status === "EXPIRED" && p.onepayId && now - Date.parse(p.updatedAt) < 3 * 86_400_000) ||
        (p.status === "CREATING" && !p.onepayId && now - Date.parse(p.createdAt) > 120_000 && now - Date.parse(p.createdAt) < 2 * 86_400_000),
    )
    .sort((a, b) => Date.parse(a.lastSyncedAt || 0) - Date.parse(b.lastSyncedAt || 0))
    .slice(0, 30);
  for (const p of work) {
    try {
      if (!p.onepayId) {
        await recoverCreating(env, p.id);
        continue;
      }
      const remote = await onepayGet(env, p.onepayId);
      const unchanged =
        remote &&
        STATUS_MAP[String(remote.status).toLowerCase()] === p.status &&
        (remote.paidAt || null) === (p.paidAt || null) &&
        !p.verifyError;
      if (!unchanged) await syncOne(env, p.id, remote); // write only on real changes
    } catch (e) {
      console.error("reconcile", p.id, scrub(String(e)));
    }
  }
}
