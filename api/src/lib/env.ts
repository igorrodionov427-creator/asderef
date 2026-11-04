import { z } from "zod";

const bool = z
  .string()
  .optional()
  .transform((v) => (v ?? "").trim().toLowerCase())
  .transform((v) => v === "" ? undefined : ["1", "true", "yes", "on"].includes(v));

const schema = z.object({
  ONEPAY_API_KEY: z.string().trim().optional(),
  ONEPAY_WEBHOOK_SECRET: z.string().trim().optional(),
  ONEPAY_API_BASE: z.string().trim().url().default("https://api.1pay.cx"),
  ONEPAY_CARD_ONLY: bool,
  PAYMENT_REDIRECT_URL: z.string().trim().optional(),
  PUBLIC_API_URL: z.string().trim().optional(),
  ALLOWED_ORIGINS: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
  CRON_SECRET: z.string().trim().optional(),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  SESSION_IDLE_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  VERCEL_PROJECT_PRODUCTION_URL: z.string().optional(),
  VERCEL_URL: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Parsed lazily so that `next build` does not require runtime secrets. */
export function env(): Env {
  if (!cached) cached = schema.parse(process.env);
  return cached;
}

export function allowedOrigins(): string[] {
  return (env().ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

/** Public https origin of this API, used for the 1Pay notifyUrl. */
export function publicApiUrl(): string | null {
  const e = env();
  const explicit = e.PUBLIC_API_URL?.replace(/\/+$/, "");
  if (explicit) return explicit;
  if (e.VERCEL_PROJECT_PRODUCTION_URL) return `https://${e.VERCEL_PROJECT_PRODUCTION_URL}`;
  return null;
}

export function cardOnly(): boolean {
  return env().ONEPAY_CARD_ONLY ?? true;
}
