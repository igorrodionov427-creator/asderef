# Agency Pay

Private dashboard for creating real 1Pay ([1pay.cx](https://1pay.cx)) payment links, tracking them automatically through signed webhooks, and seeing revenue at a glance. Mobile-first and installable as an app on iPhone and Android.

```
┌──────────────────────────┐   HTTPS + Bearer token   ┌─────────────────────────────┐      ┌───────────────┐
│  web/  (GitHub Pages)    │ ───────────────────────▶ │  api/  (Vercel, serverless) │ ───▶ │  1Pay REST API │
│  Next.js static export   │                          │  Next.js route handlers     │ ◀─── │  webhooks      │
│  React · Tailwind · PWA  │                          │  Prisma ─▶ PostgreSQL       │      └───────────────┘
└──────────────────────────┘                          └─────────────────────────────┘
```

* **web/** is the interface: Next.js (App Router, static export), React, TypeScript, Tailwind CSS 4, Recharts, PWA. It's hosted on **GitHub Pages**. It holds no secrets.
* **api/** is the backend: Next.js route handlers, Prisma 6 with PostgreSQL, and Zod. It's hosted on **Vercel**. The 1Pay key, webhooks, PIN login, and cron all live here.

GitHub Pages can only serve static files. It cannot store secrets, receive webhooks, or talk to a database, so the backend has to live on Vercel (or any Node host).

---

## What's built

| Area | What it does |
|---|---|
| Disguise | Anyone who opens the site sees a plain **"503 Service Temporarily Unavailable"** page. To get the PIN keypad, **tap the heading 3 times** (or open `…/#unlock`). The site has `noindex`, `robots.txt Disallow`, and a 503 page title. The API answers `404` to everything without a token. |
| Login | Numeric code (4–12 digits). It's stored on the server as a **scrypt** hash. Sessions are random 256-bit tokens, and the database keeps only their SHA-256. Session lifetime: 30 days absolute / 7 days of inactivity. You can sign out, or sign out on every device. |
| Brute-force protection | **5 wrong codes from one IP** lock that IP for 15 min. **10 wrong codes in total, from any IP,** lock everyone for 15 min. Each repeat lockout doubles the time, up to 24 h. On top of that: a 0.6 s delay on every wrong code and a limit of 30 requests per 15 min per IP. All counters live in Postgres, so they survive restarts. |
| Creating payments | Amount, service, client, email, description. Validation runs in the browser (instant) and again on the server (Zod). The server calls `POST /v1/payments` and saves the real `id` and `url` from 1Pay. You can copy, open, or share (iOS share sheet) the link. |
| No duplicates | Each submission gets an `idempotencyKey`. It's unique in the database **and** sent to 1Pay as the `Idempotency-Key` header, so tapping twice or retrying after a timeout won't create a second payment. |
| 50% deposit / remaining balance | A deposit creates a **Project** (the full price) and a real payment for 50% (rounded half-up to the cent). "Create remaining balance" makes a second real payment for the amount still unbilled. Both are linked to the same project. |
| Quick payments | Previous clients are suggested as you type a name. **Duplicate** copies a payment's details into a new form. **New for client** starts a new payment for the same client. |
| History | Search by client, email, service, or 1Pay ID; status filters; sort by date; pagination; payment detail page; CSV export (with protection against spreadsheet formula injection). |
| Webhooks | `POST /api/webhooks/1pay` checks the **X-1pay-Signature-V2** signature (HMAC-SHA256 of `t.body`, ±300 s window, two `v1` values during secret rotation). Events are deduplicated by `whe_…` id. Test vs live mode is checked. Then the payment is **re-read with `GET /v1/payments/{id}`**, and the id, currency, `baseAmount`, and charged amount are compared before the status is saved. On a mismatch the payment is **not** marked paid. On an error the endpoint returns 500, so 1Pay retries. Every event is written to `WebhookEvent`. |
| Reconciliation | `/api/cron/reconcile` (protected by `CRON_SECRET`) re-checks open payments through the 1Pay API. If a create request timed out, it looks the payment up by `reference`. It runs from Vercel Cron (once a day on the free plan) and from GitHub Actions (**every 15 minutes**). |
| Dashboard | Total revenue, total, paid, pending, failed/expired, a revenue chart for 7/30/90 days in your local timezone, and recent payments. All of it comes from database records. |
| PWA | Manifest, icons (including maskable and apple-touch), service worker, standalone mode, safe-area insets, no zoom when focusing inputs. |

### 1Pay statuses → labels
`pending` → Awaiting payment · `paid` → Paid · `underpaid` → Underpaid · `expired` → Expired · `failed` → Failed (test mode only).
Local-only states: `CREATING` (the request to 1Pay is in progress or got no reply) and `CREATE_FAILED` (1Pay rejected the request).

### What the 1Pay API does not offer (per the docs)
* Webhook endpoints are registered **only in the dashboard**, not through the API. That's why each payment passes its own `notifyUrl`, which 1Pay signs with the account's notifyUrl secret.
* Reusable payment links can only be created in the dashboard. This app creates one-off payments through the API.
* Accepting a partial crypto payment as paid can only be done by hand in the 1Pay dashboard.
* You **can't choose the coin** you receive per payment. It's set by your 1Pay account (payout wallet / settlement).
* `redirectUrl` is only a link on the checkout page. It is not a redirect, and it carries no status. Payments are never marked paid because of it.

---

## Setup: about 15 minutes, done once

### 1. Database (free): Neon
1. Go to [neon.tech](https://neon.tech) → Sign up → **Create project** (region close to you, e.g. Frankfurt).
2. **Connection string**: copy the **Pooled** URL into `DATABASE_URL` and the **Direct** URL (pooling off) into `DIRECT_DATABASE_URL`. If you only get one, use it for both.

> Vercel Postgres, Supabase, or any other managed PostgreSQL also works.

### 2. 1Pay keys
1. [1pay.cx](https://1pay.cx) → **Settings → API & webhooks**.
2. Create an **API key** with the `payments:read` and `payments:write` scopes:
   * start with a **test key** `pk_test_…` (no money moves; the checkout page has "Simulate payment" buttons)
   * then switch to a **live key** `pk_…`
3. Copy the **notifyUrl secret** for the *same* mode: `whsec_test_…` for test, `whsec_…` for live.
4. **Funds → Payout wallets**: set the wallet that should receive the crypto.

You don't need to register a webhook in the 1Pay dashboard. The app passes `notifyUrl` with every payment.

### 3. Backend on Vercel
1. [vercel.com](https://vercel.com) → sign in with GitHub → **Add New → Project** → import `asderef`.
2. **Root Directory: `api`** (important). Framework: Next.js (detected automatically).
3. **Environment Variables**: everything from [`api/.env.example`](api/.env.example):

   | Variable | Value |
   |---|---|
   | `DATABASE_URL`, `DIRECT_DATABASE_URL` | from Neon |
   | `ADMIN_PASSWORD` | your access code, **digits only**, 4–12 of them (used once to create the admin) |
   | `ONEPAY_API_KEY` | `pk_test_…` / `pk_…` |
   | `ONEPAY_WEBHOOK_SECRET` | `whsec_test_…` / `whsec_…` |
   | `ONEPAY_CARD_ONLY` | `true` (cards only on checkout) |
   | `ALLOWED_ORIGINS` | `https://igorrodionov427-creator.github.io` |
   | `CRON_SECRET` | 32+ random characters |
   | `PUBLIC_API_URL` | can be skipped (the Vercel domain is used); set it if you add your own domain |

4. **Deploy**. On build, `prisma migrate deploy` creates the tables.
5. Copy the API address, e.g. `https://asderef-api.vercel.app`.

### 4. Connect the interface to the API
In the repository, open [`web/public/config.json`](web/public/config.json) → ✏️ → set the address:
```json
{ "apiUrl": "https://asderef-api.vercel.app" }
```
Commit it. The **Deploy web to GitHub Pages** workflow rebuilds the site in about 1–2 minutes.

### 5. Reconciliation every 15 minutes
Repository → **Settings → Secrets and variables → Actions → New repository secret**:
* `AGENCY_PAY_API_URL` = the API address
* `CRON_SECRET` = the same value as on Vercel

### 6. On iPhone
Safari → `https://igorrodionov427-creator.github.io/asderef/` → tap the "503" heading 3× → code → **Share → Add to Home Screen**.

### 7. Check in test mode
1. Settings in the app: everything should be green, and the badge should say **TEST MODE**.
2. Create a payment → open checkout → **Simulate successful payment**.
3. Within a few seconds, a `payment.paid` webhook arrives and the status changes to **Paid**. The event shows up in the payment's "Webhook log".
4. When everything works, switch `ONEPAY_API_KEY` and `ONEPAY_WEBHOOK_SECRET` to the live ones → Redeploy on Vercel.

---

## Custom domain (optional)
* **Interface**: repo Settings → Pages → Custom domain (e.g. `pay.example.com`, with a CNAME pointing to `igorrodionov427-creator.github.io`). Then remove `NEXT_PUBLIC_BASE_PATH` from `.github/workflows/pages.yml` (the site will live at the domain root) and add the domain to `ALLOWED_ORIGINS`.
* **API**: Vercel → Project → Settings → Domains (e.g. `api.example.com`). Update `PUBLIC_API_URL` and `config.json`.

---

## Local development
Requires Node 20+ and PostgreSQL.
```bash
cd api && cp .env.example .env   # fill in DATABASE_URL etc.; ALLOWED_ORIGINS=http://localhost:3000
npm install && npx prisma migrate dev && npm run dev        # http://localhost:4000
cd ../web && echo NEXT_PUBLIC_API_URL=http://localhost:4000 > .env.development.local
npm install && npm run dev                                 # http://localhost:3000
```
Checks: `npm run lint`, `npm run typecheck`, `npm test` (api: signature verification against the official 1Pay test vector, money math, validation, hashing).

`notifyUrl` must be public https. 1Pay rejects localhost, so you can only receive webhooks locally through an https tunnel. Without one, use "Refresh status" in the payment detail page.

## API (all endpoints require `Authorization: Bearer <token>` unless noted)
| Method | Path | |
|---|---|---|
| POST | `/api/auth/login` | `{pin}` → `{token, expiresAt}` (no token required; brute-force lockout) |
| POST | `/api/auth/logout` · DELETE `/api/auth/sessions` | sign out / sign out everywhere |
| GET | `/api/auth/session` | session + configuration status |
| POST | `/api/auth/password` | change the code |
| GET | `/api/stats?range=7\|30\|90&tz=` | dashboard |
| GET / POST | `/api/payments` | list (q, status, sort, page) / create |
| GET | `/api/payments/export` | CSV |
| GET | `/api/payments/:id` | details + notes + webhook log |
| POST | `/api/payments/:id/refresh` · `/cancel` | re-read from 1Pay / cancel |
| POST / DELETE | `/api/payments/:id/notes[/:noteId]` | notes |
| GET | `/api/clients?q=` · `/api/projects/:id` | clients / project (deposit + balance) |
| POST | `/api/webhooks/1pay` | 1Pay webhooks (signature, no token) |
| GET | `/api/cron/reconcile` | reconciliation (`Bearer CRON_SECRET`) |

## Security
* Secrets exist only in Vercel environment variables, never in the repository or the browser. Logs are scrubbed of keys, tokens, and DB URLs.
* The token is sent in a header, not a cookie. That's needed because the interface and API are on different domains (iOS Safari blocks third-party cookies), and it also makes CSRF impossible.
* CORS allows only `ALLOWED_ORIGINS`. The API sends HSTS, `nosniff`, `frame-ancestors 'none'`, and `no-store`. The interface has a CSP and React escapes all output.
* A 4-digit code has only 10,000 combinations. The lockout makes guessing it take months, but a longer code (6–8 digits) is much stronger. You can change it in Settings.
