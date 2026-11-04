import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifySignatureV2 } from "../src/lib/webhook";

// Official test vector from https://1pay.cx/ru/docs/webhooks ("Тестовые значения").
const SECRET = "whsec_test_6f1d2a9c4b7e8f0a3c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f";
const BODY =
  '{"id":"whe_3f6c9a1e0b8d4f7aa2c5e19d07b64c3e","event":"payment.paid","data":{"paymentId":"t7Qm2Xp9","reference":"order-1001","amount":25,"currency":"USD","valueForwarded":25,"valueCoin":25,"status":"paid","asset":null,"livemode":false},"at":"2026-10-24T09:15:00.000Z"}';
const T = 1792833300;
const HEADER = `t=${T},v1=95356be61319a0be454035ca079de4f73353d9c89e9195fcbe901464690a3003`;

describe("verifySignatureV2", () => {
  it("accepts the documented test vector", () => {
    expect(verifySignatureV2(BODY, HEADER, SECRET, T)).toBe(true);
  });

  it("matches the documented legacy body-only signature too (same secret handling)", () => {
    const legacy = createHmac("sha256", SECRET).update(BODY).digest("hex");
    expect(legacy).toBe("c34c85d96163d533ce3d6d0d0f2222d9f4fad7337c4aba017ac820b6e495d97d");
  });

  it("rejects a body changed by one character", () => {
    expect(verifySignatureV2(BODY.replace('"amount":25', '"amount":26'), HEADER, SECRET, T)).toBe(false);
  });

  it("rejects a signature changed by one character", () => {
    expect(verifySignatureV2(BODY, HEADER.slice(0, -1) + "4", SECRET, T)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    expect(verifySignatureV2(BODY, HEADER, SECRET + "x", T)).toBe(false);
  });

  it("rejects replays older than 5 minutes", () => {
    expect(verifySignatureV2(BODY, HEADER, SECRET, T + 301)).toBe(false);
    expect(verifySignatureV2(BODY, HEADER, SECRET, T + 299)).toBe(true);
  });

  it("accepts any v1 during secret rotation", () => {
    const rotated = `t=${T},v1=${"0".repeat(64)},v1=95356be61319a0be454035ca079de4f73353d9c89e9195fcbe901464690a3003`;
    expect(verifySignatureV2(BODY, rotated, SECRET, T)).toBe(true);
  });

  it("rejects missing / malformed headers", () => {
    expect(verifySignatureV2(BODY, null, SECRET, T)).toBe(false);
    expect(verifySignatureV2(BODY, "garbage", SECRET, T)).toBe(false);
    expect(verifySignatureV2(BODY, `v1=abc`, SECRET, T)).toBe(false);
  });
});
