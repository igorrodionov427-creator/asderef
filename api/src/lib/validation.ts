import { z } from "zod";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const amountSchema = z.coerce
  .number({ invalid_type_error: "Enter an amount" })
  .finite()
  .positive("Amount must be greater than 0")
  .max(1_000_000, "Amount is too large")
  .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, "Use at most 2 decimals");

export const createPaymentSchema = z
  .object({
    kind: z.enum(["FULL", "DEPOSIT", "BALANCE"]).default("FULL"),
    /** FULL: the price. DEPOSIT: the whole project price (50% is charged). BALANCE: ignored. */
    amount: amountSchema.optional(),
    serviceName: z.string().trim().max(120).optional(),
    clientName: optionalText(120),
    clientEmail: z
      .string()
      .trim()
      .max(200)
      .optional()
      .nullable()
      .transform((v) => (v ? v.toLowerCase() : null))
      .refine((v) => v === null || z.string().email().safeParse(v).success, "Invalid email"),
    description: optionalText(1000),
    projectId: z.string().trim().max(40).optional().nullable(),
    idempotencyKey: z
      .string()
      .trim()
      .min(16)
      .max(100)
      .regex(/^[A-Za-z0-9_-]+$/, "Invalid idempotency key"),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "BALANCE") {
      if (!v.projectId) ctx.addIssue({ code: "custom", path: ["projectId"], message: "Project is required" });
      return;
    }
    if (v.amount === undefined) ctx.addIssue({ code: "custom", path: ["amount"], message: "Amount is required" });
    if (!v.serviceName) ctx.addIssue({ code: "custom", path: ["serviceName"], message: "Service name is required" });
    if (v.kind === "DEPOSIT" && v.amount !== undefined && v.amount < 0.02) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: "Project total is too small" });
    }
  });

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;

export const STATUS_VALUES = [
  "CREATING",
  "CREATE_FAILED",
  "PENDING",
  "PAID",
  "UNDERPAID",
  "EXPIRED",
  "FAILED",
] as const;

export const listQuerySchema = z.object({
  q: z.string().trim().max(120).optional().default(""),
  /** ALL, a single status, OPEN (pending + creating) or ISSUES (expired + failed + underpaid). */
  status: z.enum(["ALL", "OPEN", "ISSUES", ...STATUS_VALUES]).optional().default("ALL"),
  sort: z.enum(["newest", "oldest"]).optional().default("newest"),
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export const noteSchema = z.object({ body: z.string().trim().min(1, "Note is empty").max(2000) });

export const idSchema = z.string().regex(/^[a-z0-9]{20,32}$/i, "Invalid id");
