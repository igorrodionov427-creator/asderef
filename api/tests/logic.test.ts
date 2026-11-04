import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../src/lib/auth";
import { scrub } from "../src/lib/log";
import { fromCents, halfOf, toCents } from "../src/lib/money";
import { mapStatus } from "../src/lib/payments";
import { createPaymentSchema } from "../src/lib/validation";

const key = "k_0123456789abcdef";

describe("money", () => {
  it("converts to cents without float drift", () => {
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents("400")).toBe(40000);
    expect(toCents(84.5)).toBe(8450);
    expect(fromCents(40000)).toBe("400.00");
  });
  it("computes a 50% deposit rounded half-up", () => {
    expect(halfOf(40000)).toBe(20000);
    expect(halfOf(40001)).toBe(20001);
  });
});

describe("status mapping", () => {
  it("maps every documented 1Pay status", () => {
    expect(mapStatus("pending")).toBe("PENDING");
    expect(mapStatus("paid")).toBe("PAID");
    expect(mapStatus("underpaid")).toBe("UNDERPAID");
    expect(mapStatus("expired")).toBe("EXPIRED");
    expect(mapStatus("failed")).toBe("FAILED");
    expect(mapStatus("weird")).toBeNull();
  });
});

describe("createPaymentSchema", () => {
  it("accepts the example payment", () => {
    const r = createPaymentSchema.parse({
      amount: "400",
      serviceName: "Website Development",
      clientName: "John Smith",
      clientEmail: "John@Example.com",
      idempotencyKey: key,
    });
    expect(r.amount).toBe(400);
    expect(r.kind).toBe("FULL");
    expect(r.clientEmail).toBe("john@example.com");
    expect(r.description).toBeNull();
  });
  it("rejects bad input", () => {
    expect(createPaymentSchema.safeParse({ amount: 0, serviceName: "x", idempotencyKey: key }).success).toBe(false);
    expect(createPaymentSchema.safeParse({ amount: 1.234, serviceName: "x", idempotencyKey: key }).success).toBe(false);
    expect(createPaymentSchema.safeParse({ amount: 10, serviceName: "", idempotencyKey: key }).success).toBe(false);
    expect(createPaymentSchema.safeParse({ amount: 10, serviceName: "x", clientEmail: "nope", idempotencyKey: key }).success).toBe(false);
    expect(createPaymentSchema.safeParse({ amount: 10, serviceName: "x", idempotencyKey: "short" }).success).toBe(false);
  });
  it("requires a project for remaining balance", () => {
    expect(createPaymentSchema.safeParse({ kind: "BALANCE", idempotencyKey: key }).success).toBe(false);
    expect(createPaymentSchema.safeParse({ kind: "BALANCE", projectId: "cabc", idempotencyKey: key }).success).toBe(true);
  });
});

describe("password hashing", () => {
  it("verifies the right PIN and rejects a wrong one", async () => {
    const h = await hashPassword("2468");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("2468", h)).toBe(true);
    expect(await verifyPassword("2469", h)).toBe(false);
  });
});

describe("log scrubbing", () => {
  it("removes secrets", () => {
    const s = scrub("key pk_test_abc.def123 secret whsec_test_ff00 Bearer abc.def postgresql://u:p@h/db");
    expect(s).not.toMatch(/pk_test_abc|whsec_test_ff00|abc\.def|u:p@h/);
  });
});
