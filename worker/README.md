# Agency Pay — server on Cloudflare (one file, ~10 minutes)

`agency-pay-worker.js` is the whole Agency Pay backend. Paste it into Cloudflare and you're done: no Vercel, no database, nothing to install.
It stores the 1Pay key and the bot token, creates payment links, receives 1Pay webhooks, and checks open payments every 5 minutes. Telegram notifications are sent on every new link and every payment.

## 1. 1Pay (new account)
1. Sign up at [1pay.cx](https://1pay.cx).
2. **Funds → Where the money goes**: enter your payout wallet (Trust Wallet, e.g. USDT BEP-20).
3. **Settings → API & webhooks**:
   * create an API key with **payments:read** and **payments:write**. Start with a test key `pk_test_…`;
   * copy the **notifyUrl secret** for the same mode: `whsec_test_…`.

## 2. Worker
1. [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Create Worker**, name it `agency-pay` → **Deploy**.
2. **Edit code** → delete everything → paste the contents of `agency-pay-worker.js` → **Deploy**.

## 3. Storage (KV)
1. **Storage & Databases → KV** → **Create** → name it `agency-pay`.
2. Worker `agency-pay` → **Settings → Bindings** → **Add → KV namespace**: variable name **`AP`**, namespace `agency-pay` → Save.

## 4. Variables
Worker → **Settings → Variables and Secrets** → **Add**:

| Name | Type | Value |
|---|---|---|
| `ONEPAY_API_KEY` | Secret | `pk_test_…` (later `pk_…`) |
| `ONEPAY_WEBHOOK_SECRET` | Secret | `whsec_test_…` (later `whsec_…`) |
| `ADMIN_PASSWORD` | Secret | access code (digits) |
| `TG_BOT_TOKEN` | Secret | notification bot token |
| `TG_CHAT_ID` | Text | the chat ID notifications go to |
| `ALLOWED_ORIGIN` | Text | `https://igorrodionov427-creator.github.io` |
| `CARD_ONLY` | Text | `true` |

Secrets are encrypted: after saving, nobody can see them, including in the code or on GitHub.

## 5. Every-5-minute check
Worker → **Settings → Triggers → Cron Triggers → Add** → `*/5 * * * *` → Save.

## 6. Connect the site
Copy the worker address (`https://agency-pay.<name>.workers.dev`) into
[`web/public/config.json`](../web/public/config.json): `{ "apiUrl": "https://agency-pay.<name>.workers.dev" }`.
The site rebuilds itself within about a minute.

## Check (test mode)
Site → tap 3× on "503" → code → **New payment** → $5 → **Create**.
In Telegram you get "🆕 Payment link created". Open the link → **Simulate successful payment**.
Within a few seconds the status changes to **Paid**, and Telegram shows "✅ PAID [TEST]".

## Going live
Replace `ONEPAY_API_KEY` with `pk_…` and `ONEPAY_WEBHOOK_SECRET` with `whsec_…` (the live notifyUrl secret). Nothing else needs to change.
